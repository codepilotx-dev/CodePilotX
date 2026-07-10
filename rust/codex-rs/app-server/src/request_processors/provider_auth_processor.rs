use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use codepilotx_app_server_protocol::{
    JSONRPCErrorError, ProviderApiKeyDeleteParams, ProviderApiKeyDeleteResponse,
    ProviderApiKeyReadParams, ProviderApiKeyReadResponse, ProviderApiKeySaveParams,
    ProviderApiKeySaveResponse, ProviderAuthCancelLoginParams, ProviderAuthCancelLoginResponse,
    ProviderAuthLogoutParams, ProviderAuthLogoutResponse, ProviderAuthPollLoginParams,
    ProviderAuthPollLoginResponse, ProviderAuthPollStatus, ProviderAuthReadStatusParams,
    ProviderAuthReadStatusResponse, ProviderAuthStartLoginParams, ProviderAuthStartLoginResponse,
    ProviderBalanceInfo, ProviderBalanceParams, ProviderBalanceResponse, ProviderModelListParams,
    ProviderModelListResponse, ProviderRepoCloneParams, ProviderRepoCloneResponse,
    ProviderRepoInfo, ProviderRepoListParams, ProviderRepoListResponse, ProviderUserInfo,
};
use codepilotx_keyring_store::{DefaultKeyringStore, KeyringStore};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

//  In-memory state for device-code flows

struct DeviceCodeAttempt {
    provider_id: String,
    device_code: String,
    client_id: Option<String>,
    expires_at: Instant,
    interval_secs: u32,
    cancelled: bool,
}

struct ProviderAuthInner {
    /// In-flight device-code login attempts, keyed by provider_id.
    attempts: HashMap<String, DeviceCodeAttempt>,
}

//  Token storage

#[derive(Serialize, Deserialize)]
struct StoredProviderToken {
    provider_id: String,
    access_token: String,
    token_type: String,
    scope: Option<String>,
    user: ProviderUserInfo,
    stored_at: u64, // unix epoch millis
}

const PROVIDER_AUTH_KEYRING_SERVICE: &str = "CodePilotX Provider Auth";

//  Public processor

#[derive(Clone)]
pub(crate) struct ProviderAuthRequestProcessor {
    inner: Arc<Mutex<ProviderAuthInner>>,
    config_dir: PathBuf,
    approved_clone_root: PathBuf,
    trusted_provider_endpoints: Arc<HashMap<String, String>>,
    keyring: Arc<dyn KeyringStore>,
}

impl ProviderAuthRequestProcessor {
    pub(crate) fn new(
        config_dir: PathBuf,
        approved_clone_root: PathBuf,
        trusted_provider_endpoints: HashMap<String, String>,
    ) -> Self {
        Self::new_with_keyring_and_endpoints(
            config_dir,
            approved_clone_root,
            trusted_provider_endpoints,
            Arc::new(DefaultKeyringStore),
        )
    }

    fn new_with_keyring(
        config_dir: PathBuf,
        approved_clone_root: PathBuf,
        keyring: Arc<dyn KeyringStore>,
    ) -> Self {
        Self::new_with_keyring_and_endpoints(
            config_dir,
            approved_clone_root,
            HashMap::new(),
            keyring,
        )
    }

    fn new_with_keyring_and_endpoints(
        config_dir: PathBuf,
        approved_clone_root: PathBuf,
        trusted_provider_endpoints: HashMap<String, String>,
        keyring: Arc<dyn KeyringStore>,
    ) -> Self {
        Self {
            inner: Arc::new(Mutex::new(ProviderAuthInner {
                attempts: HashMap::new(),
            })),
            config_dir,
            approved_clone_root,
            trusted_provider_endpoints: Arc::new(trusted_provider_endpoints),
            keyring,
        }
    }

    //  Read status

    pub(crate) async fn read_status(
        &self,
        params: ProviderAuthReadStatusParams,
    ) -> Result<ProviderAuthReadStatusResponse, JSONRPCErrorError> {
        self.migrate_legacy_provider_api_keys().await?;
        let stored = self.load_token(&params.provider_id).await?;
        match stored {
            Some(token) => Ok(ProviderAuthReadStatusResponse {
                authenticated: true,
                user: Some(token.user),
                error: None,
            }),
            None => Ok(ProviderAuthReadStatusResponse {
                authenticated: false,
                user: None,
                error: None,
            }),
        }
    }

    //  Start device-code login

    pub(crate) async fn start_login(
        &self,
        params: ProviderAuthStartLoginParams,
    ) -> Result<ProviderAuthStartLoginResponse, JSONRPCErrorError> {
        if params.provider_id != "github-repositories" && params.provider_id != "github-copilot" {
            return Err(JSONRPCErrorError::invalid_params(format!(
                "unsupported provider: {}",
                params.provider_id
            )));
        }

        let client_id = resolve_client_id(&params)?;
        let resp = github_device_code_request(&client_id).await?;

        let expires_at = Instant::now() + Duration::from_secs(resp.expires_in as u64);

        let mut inner = self.inner.lock().await;
        inner.attempts.insert(
            params.provider_id.clone(),
            DeviceCodeAttempt {
                provider_id: params.provider_id,
                device_code: resp.device_code.clone(),
                client_id: Some(client_id),
                expires_at,
                interval_secs: resp.interval,
                cancelled: false,
            },
        );

        Ok(ProviderAuthStartLoginResponse {
            device_code: resp.device_code,
            user_code: resp.user_code,
            verification_uri: resp.verification_uri,
            expires_in: resp.expires_in,
            interval: resp.interval,
        })
    }

    //  Poll device-code login

    pub(crate) async fn poll_login(
        &self,
        params: ProviderAuthPollLoginParams,
    ) -> Result<ProviderAuthPollLoginResponse, JSONRPCErrorError> {
        let attempt = {
            let inner = self.inner.lock().await;
            inner.attempts.get(&params.provider_id).cloned()
        };

        let attempt = match attempt {
            Some(a) => a,
            None => {
                // No in-progress attempt  check if token already stored
                let stored = self.load_token(&params.provider_id).await?;
                return Ok(ProviderAuthPollLoginResponse {
                    status: if stored.is_some() {
                        ProviderAuthPollStatus::Completed
                    } else {
                        ProviderAuthPollStatus::Expired
                    },
                    auth: stored.map(|t| ProviderAuthReadStatusResponse {
                        authenticated: true,
                        user: Some(t.user),
                        error: None,
                    }),
                });
            }
        };

        if attempt.cancelled {
            let mut inner = self.inner.lock().await;
            inner.attempts.remove(&params.provider_id);
            return Ok(ProviderAuthPollLoginResponse {
                status: ProviderAuthPollStatus::Denied,
                auth: None,
            });
        }

        if Instant::now() > attempt.expires_at {
            let mut inner = self.inner.lock().await;
            inner.attempts.remove(&params.provider_id);
            return Ok(ProviderAuthPollLoginResponse {
                status: ProviderAuthPollStatus::Expired,
                auth: None,
            });
        }

        let client_id = attempt.client_id.as_deref().unwrap_or("");
        let token_result = github_poll_access_token(&attempt.device_code, client_id).await?;

        match token_result {
            GithubTokenPollResult::Pending => Ok(ProviderAuthPollLoginResponse {
                status: ProviderAuthPollStatus::Pending,
                auth: None,
            }),
            GithubTokenPollResult::Expired => {
                let mut inner = self.inner.lock().await;
                inner.attempts.remove(&params.provider_id);
                Ok(ProviderAuthPollLoginResponse {
                    status: ProviderAuthPollStatus::Expired,
                    auth: None,
                })
            }
            GithubTokenPollResult::Denied => {
                let mut inner = self.inner.lock().await;
                inner.attempts.remove(&params.provider_id);
                Ok(ProviderAuthPollLoginResponse {
                    status: ProviderAuthPollStatus::Denied,
                    auth: None,
                })
            }
            GithubTokenPollResult::Success {
                access_token,
                scope,
                token_type,
            } => {
                // Fetch the authenticated user
                let user = github_fetch_user(&access_token).await?;

                // Store the token
                let stored = StoredProviderToken {
                    provider_id: params.provider_id.clone(),
                    access_token: access_token.clone(),
                    token_type,
                    scope,
                    user: user.clone(),
                    stored_at: timestamp_millis(),
                };
                self.store_token(&params.provider_id, &stored).await?;

                // Copilot: also fetch / refresh the Copilot token
                if params.provider_id == "github-copilot" {
                    self.refresh_copilot_token(&access_token).await?;
                }

                let mut inner = self.inner.lock().await;
                inner.attempts.remove(&params.provider_id);

                Ok(ProviderAuthPollLoginResponse {
                    status: ProviderAuthPollStatus::Completed,
                    auth: Some(ProviderAuthReadStatusResponse {
                        authenticated: true,
                        user: Some(user),
                        error: None,
                    }),
                })
            }
        }
    }

    //  Cancel

    pub(crate) async fn cancel_login(
        &self,
        params: ProviderAuthCancelLoginParams,
    ) -> Result<ProviderAuthCancelLoginResponse, JSONRPCErrorError> {
        let mut inner = self.inner.lock().await;
        if let Some(attempt) = inner.attempts.get_mut(&params.provider_id) {
            attempt.cancelled = true;
        }
        Ok(ProviderAuthCancelLoginResponse {})
    }

    //  Logout

    pub(crate) async fn logout(
        &self,
        params: ProviderAuthLogoutParams,
    ) -> Result<ProviderAuthLogoutResponse, JSONRPCErrorError> {
        validate_provider_id(&params.provider_id)?;
        self.keyring
            .delete(
                PROVIDER_AUTH_KEYRING_SERVICE,
                &provider_auth_account(&params.provider_id),
            )
            .map_err(|error| keyring_error("delete", error))?;
        remove_legacy_file_if_present(&self.legacy_token_path(&params.provider_id)).await?;
        Ok(ProviderAuthLogoutResponse {})
    }

    pub(crate) async fn read_provider_api_keys(
        &self,
        params: ProviderApiKeyReadParams,
    ) -> Result<ProviderApiKeyReadResponse, JSONRPCErrorError> {
        self.migrate_legacy_provider_api_keys().await?;
        let mut configured_provider_ids = Vec::new();
        for provider_id in params.provider_ids {
            validate_provider_id(&provider_id)?;
            let configured = self
                .keyring
                .load(
                    PROVIDER_AUTH_KEYRING_SERVICE,
                    &provider_api_key_account(&provider_id),
                )
                .map_err(|error| keyring_error("read", error))?
                .is_some_and(|value| !value.trim().is_empty());
            if configured {
                configured_provider_ids.push(provider_id);
            }
        }
        Ok(ProviderApiKeyReadResponse {
            configured_provider_ids,
        })
    }

    pub(crate) async fn save_provider_api_key(
        &self,
        params: ProviderApiKeySaveParams,
    ) -> Result<ProviderApiKeySaveResponse, JSONRPCErrorError> {
        validate_provider_id(&params.provider_id)?;
        validate_provider_api_key(&params.api_key)?;
        self.migrate_legacy_provider_api_keys().await?;
        self.keyring
            .save(
                PROVIDER_AUTH_KEYRING_SERVICE,
                &provider_api_key_account(&params.provider_id),
                &params.api_key,
            )
            .map_err(|error| keyring_error("write", error))?;
        Ok(ProviderApiKeySaveResponse {})
    }

    pub(crate) async fn delete_provider_api_key(
        &self,
        params: ProviderApiKeyDeleteParams,
    ) -> Result<ProviderApiKeyDeleteResponse, JSONRPCErrorError> {
        validate_provider_id(&params.provider_id)?;
        self.migrate_legacy_provider_api_keys().await?;
        self.keyring
            .delete(
                PROVIDER_AUTH_KEYRING_SERVICE,
                &provider_api_key_account(&params.provider_id),
            )
            .map_err(|error| keyring_error("delete", error))?;
        Ok(ProviderApiKeyDeleteResponse {})
    }

    pub(crate) async fn fetch_provider_models(
        &self,
        params: ProviderModelListParams,
    ) -> Result<ProviderModelListResponse, JSONRPCErrorError> {
        validate_provider_id(&params.provider_id)?;
        let explicit_api_key = params.api_key.as_deref();
        let Some(base_url) = self.resolve_provider_base_url(
            &params.provider_id,
            params.base_url.as_deref(),
            explicit_api_key.is_some(),
        )?
        else {
            return Ok(ProviderModelListResponse {
                models: params.default_models,
                error: Some(format!(
                    "{} has no trusted OpenAI-compatible endpoint configured.",
                    params.provider_id
                )),
            });
        };
        let Some(api_key) = self
            .resolve_provider_api_key(&params.provider_id, explicit_api_key)
            .await?
        else {
            return Ok(ProviderModelListResponse {
                models: params.default_models,
                error: Some(format!("{} API key is not configured.", params.provider_id)),
            });
        };
        let endpoint = provider_endpoint(&base_url, "models")?;
        let response = match reqwest::Client::new()
            .get(endpoint)
            .bearer_auth(&api_key)
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                return Ok(ProviderModelListResponse {
                    models: params.default_models,
                    error: Some(format!("Provider request failed: {error}")),
                });
            }
        };
        if !response.status().is_success() {
            return Ok(ProviderModelListResponse {
                models: params.default_models,
                error: Some(format!("Provider returned HTTP {}", response.status())),
            });
        }
        let parsed: ProviderModelsPayload = match response.json().await {
            Ok(parsed) => parsed,
            Err(error) => {
                return Ok(ProviderModelListResponse {
                    models: params.default_models,
                    error: Some(format!("Failed to parse provider models: {error}")),
                });
            }
        };
        let mut models = Vec::new();
        for model in parsed.data {
            if !model.id.is_empty() && !models.contains(&model.id) {
                models.push(model.id);
            }
        }
        if models.is_empty() {
            return Ok(ProviderModelListResponse {
                models: params.default_models,
                error: Some("Provider returned no models.".to_string()),
            });
        }
        for default_model in params.default_models {
            if !models.contains(&default_model) {
                models.push(default_model);
            }
        }
        Ok(ProviderModelListResponse {
            models,
            error: None,
        })
    }

    pub(crate) async fn fetch_provider_balance(
        &self,
        params: ProviderBalanceParams,
    ) -> Result<ProviderBalanceResponse, JSONRPCErrorError> {
        validate_provider_id(&params.provider_id)?;
        if params.provider_id != "deepseek" {
            return Ok(ProviderBalanceResponse {
                is_available: false,
                balances: Vec::new(),
                error: Some(format!(
                    "{} does not support balance checking yet.",
                    params.provider_id
                )),
            });
        }
        let explicit_api_key = params.api_key.as_deref();
        let Some(base_url) = self.resolve_provider_base_url(
            &params.provider_id,
            params.base_url.as_deref(),
            explicit_api_key.is_some(),
        )?
        else {
            return Ok(ProviderBalanceResponse {
                is_available: false,
                balances: Vec::new(),
                error: Some("DeepSeek has no trusted endpoint configured.".to_string()),
            });
        };
        let Some(api_key) = self
            .resolve_provider_api_key(&params.provider_id, explicit_api_key)
            .await?
        else {
            return Ok(ProviderBalanceResponse {
                is_available: false,
                balances: Vec::new(),
                error: Some("DeepSeek API key is not configured.".to_string()),
            });
        };
        let endpoint = provider_endpoint(&base_url, "user/balance")?;
        let response = match reqwest::Client::new()
            .get(endpoint)
            .bearer_auth(&api_key)
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                return Ok(ProviderBalanceResponse {
                    is_available: false,
                    balances: Vec::new(),
                    error: Some(format!("Provider request failed: {error}")),
                });
            }
        };
        if !response.status().is_success() {
            return Ok(ProviderBalanceResponse {
                is_available: false,
                balances: Vec::new(),
                error: Some(format!("Provider returned HTTP {}", response.status())),
            });
        }
        let parsed: ProviderBalancePayload = match response.json().await {
            Ok(parsed) => parsed,
            Err(error) => {
                return Ok(ProviderBalanceResponse {
                    is_available: false,
                    balances: Vec::new(),
                    error: Some(format!("Failed to parse provider balance: {error}")),
                });
            }
        };
        Ok(ProviderBalanceResponse {
            is_available: parsed.is_available,
            balances: parsed
                .balance_infos
                .into_iter()
                .map(|info| ProviderBalanceInfo {
                    currency: info.currency,
                    total_balance: info.total_balance,
                    granted_balance: info.granted_balance,
                    topped_up_balance: info.topped_up_balance,
                })
                .collect(),
            error: None,
        })
    }

    async fn resolve_provider_api_key(
        &self,
        provider_id: &str,
        explicit_api_key: Option<&str>,
    ) -> Result<Option<String>, JSONRPCErrorError> {
        if let Some(api_key) = explicit_api_key {
            validate_provider_api_key(api_key)?;
            return Ok(Some(api_key.to_string()));
        }
        self.migrate_legacy_provider_api_keys().await?;
        self.keyring
            .load(
                PROVIDER_AUTH_KEYRING_SERVICE,
                &provider_api_key_account(provider_id),
            )
            .map_err(|error| keyring_error("read", error))
            .map(|value| value.filter(|api_key| !api_key.trim().is_empty()))
    }

    fn resolve_provider_base_url(
        &self,
        provider_id: &str,
        caller_base_url: Option<&str>,
        has_transient_api_key: bool,
    ) -> Result<Option<String>, JSONRPCErrorError> {
        let base_url = if has_transient_api_key {
            caller_base_url
        } else {
            self.trusted_provider_endpoints
                .get(provider_id)
                .map(String::as_str)
        };
        let Some(base_url) = base_url.filter(|value| !value.trim().is_empty()) else {
            return Ok(None);
        };
        let parsed = url::Url::parse(base_url).map_err(|_| {
            JSONRPCErrorError::invalid_params("provider endpoint must be a valid HTTPS URL")
        })?;
        if parsed.scheme() != "https" {
            return Err(JSONRPCErrorError::invalid_params(
                "provider credentials may only be sent to HTTPS endpoints",
            ));
        }
        Ok(Some(base_url.to_string()))
    }

    //  List repositories

    pub(crate) async fn list_repos(
        &self,
        params: ProviderRepoListParams,
    ) -> Result<ProviderRepoListResponse, JSONRPCErrorError> {
        let token = self.require_token(&params.provider_id).await?.access_token;

        let client = reqwest::Client::new();
        let resp = client
            .get("https://api.github.com/user/repos?per_page=100&sort=updated")
            .header("Accept", "application/vnd.github.v3+json")
            .header("User-Agent", "codepilotx-app-server")
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| internal_error(format!("GitHub API request failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(internal_error(format!(
                "GitHub API returned {}",
                resp.status()
            )));
        }

        let gh_repos: Vec<GithubRepo> = resp
            .json()
            .await
            .map_err(|e| internal_error(format!("Failed to parse GitHub response: {e}")))?;

        let repos = gh_repos
            .into_iter()
            .map(|r| ProviderRepoInfo {
                name: r.name,
                full_name: r.full_name,
                description: r.description,
                private: r.private,
                html_url: r.html_url,
                clone_url: r.clone_url,
                default_branch: r.default_branch,
            })
            .collect();

        Ok(ProviderRepoListResponse { repos })
    }

    //  Clone repository

    pub(crate) async fn clone_repo(
        &self,
        params: ProviderRepoCloneParams,
    ) -> Result<ProviderRepoCloneResponse, JSONRPCErrorError> {
        let clone_request = validate_github_clone_request(
            &params.repo_url,
            std::path::Path::new(&params.local_path),
            &self.approved_clone_root,
        )?;
        let token = self.require_token(&params.provider_id).await?.access_token;

        clone_with_github_token(&clone_request, &token, &SystemGitCloneRunner).await?;

        Ok(ProviderRepoCloneResponse {
            local_path: clone_request.target.to_string_lossy().into_owned(),
        })
    }

    //  Copilot token refresh

    async fn refresh_copilot_token(&self, github_token: &str) -> Result<(), JSONRPCErrorError> {
        let client = reqwest::Client::new();
        let resp = client
            .get("https://api.github.com/copilot_internal/v2/token")
            .header("Accept", "application/json")
            .header("User-Agent", "codepilotx-app-server")
            .header("Authorization", format!("Bearer {github_token}"))
            .send()
            .await
            .map_err(|e| internal_error(format!("Copilot token request failed: {e}")))?;

        if !resp.status().is_success() {
            // Copilot token fetch is best-effort during login; user can retry
            return Ok(());
        }

        let copilot_data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| internal_error(format!("Failed to parse Copilot token response: {e}")))?;

        // Store the Copilot token alongside the GitHub token under a separate key
        // or embedded in the same provider token record. For now, store as
        // a separate file.
        let copilot_token = copilot_data
            .get("token")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if !copilot_token.is_empty() {
            let stored = StoredProviderToken {
                provider_id: "github-copilot".to_string(),
                access_token: copilot_token.to_string(),
                token_type: "bearer".to_string(),
                scope: None,
                user: ProviderUserInfo {
                    login: "copilot".to_string(),
                    name: None,
                    avatar_url: None,
                },
                stored_at: timestamp_millis(),
            };
            self.store_token("github-copilot", &stored).await?;
        }

        Ok(())
    }

    //  Token persistence helpers

    fn legacy_token_dir(&self) -> PathBuf {
        self.config_dir.join("provider-auth")
    }

    fn legacy_token_path(&self, provider_id: &str) -> PathBuf {
        self.legacy_token_dir().join(format!("{provider_id}.json"))
    }

    async fn load_token(
        &self,
        provider_id: &str,
    ) -> Result<Option<StoredProviderToken>, JSONRPCErrorError> {
        validate_provider_id(provider_id)?;
        let account = provider_auth_account(provider_id);
        if let Some(data) = self
            .keyring
            .load(PROVIDER_AUTH_KEYRING_SERVICE, &account)
            .map_err(|error| keyring_error("read", error))?
        {
            let token = serde_json::from_str(&data)
                .map_err(|error| internal_error(format!("Invalid provider credential: {error}")))?;
            remove_legacy_file_if_present(&self.legacy_token_path(provider_id)).await?;
            return Ok(Some(token));
        }

        self.migrate_legacy_token(provider_id).await
    }

    async fn store_token(
        &self,
        provider_id: &str,
        token: &StoredProviderToken,
    ) -> Result<(), JSONRPCErrorError> {
        validate_provider_id(provider_id)?;
        let data = serde_json::to_string(token).map_err(|error| {
            internal_error(format!("Failed to serialize provider credential: {error}"))
        })?;
        self.keyring
            .save(
                PROVIDER_AUTH_KEYRING_SERVICE,
                &provider_auth_account(provider_id),
                &data,
            )
            .map_err(|error| keyring_error("write", error))
    }

    async fn migrate_legacy_token(
        &self,
        provider_id: &str,
    ) -> Result<Option<StoredProviderToken>, JSONRPCErrorError> {
        let path = self.legacy_token_path(provider_id);
        let data = match tokio::fs::read_to_string(&path).await {
            Ok(data) => data,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(internal_error(format!(
                    "Failed to read legacy provider credential: {error}"
                )));
            }
        };
        let token: StoredProviderToken = serde_json::from_str(&data).map_err(|error| {
            internal_error(format!("Invalid legacy provider credential: {error}"))
        })?;
        if token.provider_id != provider_id {
            return Err(internal_error(
                "Legacy provider credential does not match provider id".to_string(),
            ));
        }

        self.store_token(provider_id, &token).await?;
        remove_legacy_file_if_present(&path).await?;
        Ok(Some(token))
    }

    async fn migrate_legacy_provider_api_keys(&self) -> Result<(), JSONRPCErrorError> {
        let path = self.config_dir.join(".credentials.json");
        let data = match tokio::fs::read_to_string(&path).await {
            Ok(data) => data,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(internal_error(format!(
                    "Failed to read legacy provider API keys: {error}"
                )));
            }
        };
        let mut root: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&data)
            .map_err(|error| internal_error(format!("Invalid legacy credentials file: {error}")))?;
        let Some(provider_api_keys) = root.get("providerApiKeys") else {
            return Ok(());
        };
        let provider_api_keys = provider_api_keys.as_object().ok_or_else(|| {
            internal_error("Legacy providerApiKeys must be an object".to_string())
        })?;

        for (provider_id, value) in provider_api_keys {
            validate_provider_id(provider_id)?;
            let api_key = value
                .as_str()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    internal_error(format!(
                        "Legacy provider API key for '{provider_id}' must be a non-empty string"
                    ))
                })?;
            let account = provider_api_key_account(provider_id);
            let existing = self
                .keyring
                .load(PROVIDER_AUTH_KEYRING_SERVICE, &account)
                .map_err(|error| keyring_error("read", error))?;
            if existing
                .as_deref()
                .is_none_or(|value| value.trim().is_empty())
            {
                self.keyring
                    .save(PROVIDER_AUTH_KEYRING_SERVICE, &account, api_key)
                    .map_err(|error| keyring_error("write", error))?;
            }
        }

        root.remove("providerApiKeys");
        let redacted = serde_json::to_vec_pretty(&root).map_err(|error| {
            internal_error(format!(
                "Failed to redact legacy provider API keys: {error}"
            ))
        })?;
        tokio::fs::write(&path, redacted).await.map_err(|error| {
            internal_error(format!(
                "Failed to redact legacy provider API keys: {error}"
            ))
        })?;
        Ok(())
    }

    async fn require_token(
        &self,
        provider_id: &str,
    ) -> Result<StoredProviderToken, JSONRPCErrorError> {
        self.load_token(provider_id).await?.ok_or_else(|| {
            JSONRPCErrorError::invalid_request(format!(
                "Provider '{provider_id}' is not authenticated"
            ))
        })
    }
}

fn validate_provider_id(provider_id: &str) -> Result<(), JSONRPCErrorError> {
    if provider_id.is_empty()
        || provider_id.len() > 64
        || !provider_id
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'))
    {
        return Err(JSONRPCErrorError::invalid_params(
            "provider_id must contain only ASCII letters, digits, '-' or '_'",
        ));
    }
    Ok(())
}

fn validate_provider_api_key(api_key: &str) -> Result<(), JSONRPCErrorError> {
    if api_key.trim().is_empty()
        || api_key.contains('\r')
        || api_key.contains('\n')
        || !api_key.chars().all(|value| (value as u32) <= 0xff)
    {
        return Err(JSONRPCErrorError::invalid_params(
            "api_key must be a non-empty single-line HTTP header value",
        ));
    }
    Ok(())
}

fn provider_auth_account(provider_id: &str) -> String {
    format!("provider-auth/{provider_id}")
}

fn provider_api_key_account(provider_id: &str) -> String {
    format!("providerApiKeys/{provider_id}")
}

fn provider_endpoint(base_url: &str, path: &str) -> Result<url::Url, JSONRPCErrorError> {
    let endpoint = format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    );
    let url = url::Url::parse(&endpoint).map_err(|error| {
        JSONRPCErrorError::invalid_params(format!("Invalid provider URL: {error}"))
    })?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(JSONRPCErrorError::invalid_params(
            "Provider URL must use http or https",
        ));
    }
    Ok(url)
}

fn keyring_error(
    operation: &str,
    error: codepilotx_keyring_store::CredentialStoreError,
) -> JSONRPCErrorError {
    internal_error(format!(
        "Failed to {operation} provider credential in secure storage: {error}"
    ))
}

async fn remove_legacy_file_if_present(path: &std::path::Path) -> Result<(), JSONRPCErrorError> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(internal_error(format!(
            "Failed to remove legacy provider credential: {error}"
        ))),
    }
}

//  GitHub API helpers

#[derive(Deserialize)]
struct GithubDeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u32,
    interval: u32,
}

#[derive(Deserialize)]
struct GithubAccessTokenResponse {
    access_token: Option<String>,
    token_type: Option<String>,
    scope: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

enum GithubTokenPollResult {
    Pending,
    Expired,
    Denied,
    Success {
        access_token: String,
        scope: Option<String>,
        token_type: String,
    },
}

#[derive(Deserialize)]
struct GithubUser {
    login: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct GithubRepo {
    name: String,
    full_name: String,
    description: Option<String>,
    private: bool,
    html_url: String,
    clone_url: String,
    default_branch: String,
}

#[derive(Deserialize)]
struct ProviderModelsPayload {
    #[serde(default)]
    data: Vec<ProviderModelPayload>,
}

#[derive(Deserialize)]
struct ProviderModelPayload {
    #[serde(default)]
    id: String,
}

#[derive(Deserialize)]
struct ProviderBalancePayload {
    #[serde(default)]
    is_available: bool,
    #[serde(default)]
    balance_infos: Vec<ProviderBalancePayloadInfo>,
}

#[derive(Deserialize)]
struct ProviderBalancePayloadInfo {
    #[serde(default)]
    currency: String,
    #[serde(default)]
    total_balance: String,
    #[serde(default)]
    granted_balance: String,
    #[serde(default)]
    topped_up_balance: String,
}

async fn github_device_code_request(
    client_id: &str,
) -> Result<GithubDeviceCodeResponse, JSONRPCErrorError> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://github.com/login/device/code")
        .form(&[("client_id", client_id), ("scope", "repo user")])
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| internal_error(format!("GitHub device code request failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(internal_error(format!(
            "GitHub device code endpoint returned {}",
            resp.status()
        )));
    }

    resp.json()
        .await
        .map_err(|e| internal_error(format!("Failed to parse device code response: {e}")))
}

async fn github_poll_access_token(
    device_code: &str,
    client_id: &str,
) -> Result<GithubTokenPollResult, JSONRPCErrorError> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://github.com/login/oauth/access_token")
        .form(&[
            ("client_id", client_id),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| internal_error(format!("GitHub token poll failed: {e}")))?;

    let token_resp: GithubAccessTokenResponse = resp
        .json()
        .await
        .map_err(|e| internal_error(format!("Failed to parse token response: {e}")))?;

    match token_resp.error.as_deref() {
        Some("authorization_pending") | None if token_resp.access_token.is_none() => {
            Ok(GithubTokenPollResult::Pending)
        }
        Some("slow_down") => Ok(GithubTokenPollResult::Pending),
        Some("expired_token") => Ok(GithubTokenPollResult::Expired),
        Some("access_denied") => Ok(GithubTokenPollResult::Denied),
        _ => {
            let access_token = token_resp.access_token.ok_or_else(|| {
                internal_error(format!(
                    "GitHub returned error: {:?}",
                    token_resp.error_description
                ))
            })?;
            Ok(GithubTokenPollResult::Success {
                access_token,
                scope: token_resp.scope,
                token_type: token_resp
                    .token_type
                    .unwrap_or_else(|| "bearer".to_string()),
            })
        }
    }
}

async fn github_fetch_user(access_token: &str) -> Result<ProviderUserInfo, JSONRPCErrorError> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/user")
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "codepilotx-app-server")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| internal_error(format!("GitHub user fetch failed: {e}")))?;

    let gh_user: GithubUser = resp
        .json()
        .await
        .map_err(|e| internal_error(format!("Failed to parse GitHub user: {e}")))?;

    Ok(ProviderUserInfo {
        login: gh_user.login,
        name: gh_user.name,
        avatar_url: gh_user.avatar_url,
    })
}

#[derive(Debug)]
struct ValidatedCloneRequest {
    repo_url: String,
    target: PathBuf,
}

fn validate_github_clone_request(
    repo_url: &str,
    local_path: &Path,
    trusted_root: &Path,
) -> Result<ValidatedCloneRequest, JSONRPCErrorError> {
    let url = url::Url::parse(repo_url)
        .map_err(|_| JSONRPCErrorError::invalid_params("repo_url must be a valid HTTPS URL"))?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(JSONRPCErrorError::invalid_params(
            "repo_url must be an HTTPS github.com repository URL without credentials",
        ));
    }

    let segments = url
        .path_segments()
        .ok_or_else(|| JSONRPCErrorError::invalid_params("repo_url has no repository path"))?
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    if segments.len() != 2 {
        return Err(JSONRPCErrorError::invalid_params(
            "repo_url must identify one GitHub owner and repository",
        ));
    }
    let repo_name = segments[1].strip_suffix(".git").unwrap_or(segments[1]);
    if !is_safe_github_path_segment(segments[0]) || !is_safe_github_path_segment(repo_name) {
        return Err(JSONRPCErrorError::invalid_params(
            "repo_url contains an invalid owner or repository name",
        ));
    }

    if !local_path.is_absolute()
        || local_path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err(JSONRPCErrorError::invalid_params(
            "local_path must be an absolute normalized path",
        ));
    }
    let target_name = local_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| JSONRPCErrorError::invalid_params("local_path has no target directory"))?;
    if target_name != repo_name {
        return Err(JSONRPCErrorError::invalid_params(
            "local_path target must match the GitHub repository name",
        ));
    }
    let parent = local_path
        .parent()
        .ok_or_else(|| JSONRPCErrorError::invalid_params("local_path has no approved parent"))?;
    let trusted_root = std::fs::canonicalize(trusted_root).map_err(|error| {
        JSONRPCErrorError::invalid_params(format!("approved clone root is not accessible: {error}"))
    })?;
    let canonical_parent = std::fs::canonicalize(parent).map_err(|error| {
        JSONRPCErrorError::invalid_params(format!(
            "local_path parent is not an accessible approved directory: {error}"
        ))
    })?;
    let target = canonical_parent.join(target_name);
    if !target.starts_with(&trusted_root) || target == trusted_root {
        return Err(JSONRPCErrorError::invalid_params(
            "local_path escaped the server-approved clone root",
        ));
    }

    match std::fs::symlink_metadata(&target) {
        Ok(_) => {
            return Err(JSONRPCErrorError::invalid_params(
                "local_path target must not already exist",
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(JSONRPCErrorError::invalid_params(format!(
                "local_path target cannot be inspected: {error}"
            )));
        }
    };

    Ok(ValidatedCloneRequest {
        repo_url: url.to_string(),
        target,
    })
}

fn is_safe_github_path_segment(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

#[derive(Debug)]
struct GitCloneOutput {
    success: bool,
    stderr: String,
}

trait GitCloneRunner: std::fmt::Debug + Send + Sync {
    async fn run(
        &self,
        args: &[String],
        env: &HashMap<String, String>,
        target: &Path,
    ) -> std::io::Result<GitCloneOutput>;
}

#[derive(Debug)]
struct SystemGitCloneRunner;

impl GitCloneRunner for SystemGitCloneRunner {
    async fn run(
        &self,
        args: &[String],
        env: &HashMap<String, String>,
        _target: &Path,
    ) -> std::io::Result<GitCloneOutput> {
        let output = tokio::process::Command::new("git")
            .args(args)
            .env_clear()
            .envs(env)
            .output()
            .await?;
        Ok(GitCloneOutput {
            success: output.status.success(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

async fn clone_with_github_token<R: GitCloneRunner>(
    request: &ValidatedCloneRequest,
    token: &str,
    runner: &R,
) -> Result<(), JSONRPCErrorError> {
    let target_parent = request
        .target
        .parent()
        .ok_or_else(|| JSONRPCErrorError::invalid_params("local_path has no approved parent"))?;
    let staging_dir = tempfile::Builder::new()
        .prefix(".codepilotx-github-")
        .tempdir_in(target_parent)
        .map_err(|error| {
            internal_error(format!(
                "Failed to create Git clone staging directory: {error}"
            ))
        })?;
    let staging_target = staging_dir.path().join("repository");
    let isolated_home = staging_dir.path().join("home");
    tokio::fs::create_dir(&isolated_home)
        .await
        .map_err(|error| internal_error(format!("Failed to create isolated Git home: {error}")))?;
    let isolated_git_config = staging_dir.path().join("gitconfig");
    tokio::fs::write(&isolated_git_config, b"")
        .await
        .map_err(|error| internal_error(format!("Failed to isolate Git config: {error}")))?;
    let askpass_path = staging_dir.path().join(if cfg!(windows) {
        "askpass.cmd"
    } else {
        "askpass.sh"
    });
    let askpass_contents = if cfg!(windows) {
        "@echo off\r\necho %* | findstr /I \"Username\" >nul\r\nif %errorlevel%==0 (\r\n  echo %GIT_USERNAME%\r\n) else (\r\n  echo %GIT_PASSWORD%\r\n)\r\n"
    } else {
        "#!/bin/sh\ncase \"$1\" in\n*Username*) printf \"%s\\n\" \"$GIT_USERNAME\" ;;\n*) printf \"%s\\n\" \"$GIT_PASSWORD\" ;;\nesac\n"
    };
    tokio::fs::write(&askpass_path, askpass_contents)
        .await
        .map_err(|error| internal_error(format!("Failed to write Git AskPass helper: {error}")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&askpass_path, std::fs::Permissions::from_mode(0o700))
            .await
            .map_err(|error| {
                internal_error(format!("Failed to secure Git AskPass helper: {error}"))
            })?;
    }

    let args = vec![
        "clone".to_string(),
        "--".to_string(),
        request.repo_url.clone(),
        staging_target.to_string_lossy().into_owned(),
    ];
    let mut env = minimal_git_environment();
    env.insert(
        "GIT_ASKPASS".to_string(),
        askpass_path.to_string_lossy().into_owned(),
    );
    env.insert("GIT_TERMINAL_PROMPT".to_string(), "0".to_string());
    env.insert("GIT_USERNAME".to_string(), "x-access-token".to_string());
    env.insert("GIT_PASSWORD".to_string(), token.to_string());
    env.insert(
        "HOME".to_string(),
        isolated_home.to_string_lossy().into_owned(),
    );
    env.insert(
        "USERPROFILE".to_string(),
        isolated_home.to_string_lossy().into_owned(),
    );
    env.insert("GIT_CONFIG_NOSYSTEM".to_string(), "1".to_string());
    env.insert(
        "GIT_CONFIG_GLOBAL".to_string(),
        isolated_git_config.to_string_lossy().into_owned(),
    );
    env.insert("GIT_CONFIG_COUNT".to_string(), "0".to_string());

    let output = match runner.run(&args, &env, &staging_target).await {
        Ok(output) => output,
        Err(error) => {
            return Err(internal_error(format!("Failed to spawn git: {error}")));
        }
    };
    if !output.success {
        return Err(internal_error(format!(
            "Git clone failed: {}",
            sanitize_git_error(&output.stderr, token)
        )));
    }
    publish_clone_noclobber(&staging_target, &request.target)
        .map_err(|error| internal_error(format!("Failed to publish cloned repository: {error}")))?;
    Ok(())
}

#[cfg(windows)]
fn publish_clone_noclobber(source: &Path, destination: &Path) -> std::io::Result<()> {
    // MoveFileExW without MOVEFILE_REPLACE_EXISTING is the behavior used by
    // std::fs::rename on Windows, so an existing destination is never replaced.
    std::fs::rename(source, destination)
}

#[cfg(target_os = "linux")]
fn publish_clone_noclobber(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let source = CString::new(source.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "NUL in source path"))?;
    let destination = CString::new(destination.as_os_str().as_bytes()).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "NUL in destination path")
    })?;
    // SAFETY: both C strings are NUL-terminated and remain alive for the syscall.
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(target_os = "macos")]
fn publish_clone_noclobber(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let source = CString::new(source.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "NUL in source path"))?;
    let destination = CString::new(destination.as_os_str().as_bytes()).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "NUL in destination path")
    })?;
    // SAFETY: both C strings are NUL-terminated and remain alive for the call.
    let result =
        unsafe { libc::renamex_np(source.as_ptr(), destination.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn publish_clone_noclobber(_source: &Path, _destination: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "atomic no-replace clone publish is unsupported on this platform",
    ))
}

fn minimal_git_environment() -> HashMap<String, String> {
    const ALLOWED: &[&str] = &[
        "PATH",
        "Path",
        "PATHEXT",
        "SystemRoot",
        "SYSTEMROOT",
        "WINDIR",
        "COMSPEC",
        "TEMP",
        "TMP",
    ];
    ALLOWED
        .iter()
        .filter_map(|key| {
            std::env::var(key)
                .ok()
                .map(|value| ((*key).to_string(), value))
        })
        .collect()
}

fn sanitize_git_error(stderr: &str, token: &str) -> String {
    let mut sanitized = stderr.replace(token, "***");
    sanitized = sanitized.replace("x-access-token:", "x-access-token:***@");
    sanitized.replace("***@***@", "***@")
}

//  Helpers

fn resolve_client_id(params: &ProviderAuthStartLoginParams) -> Result<String, JSONRPCErrorError> {
    if let Some(client_id) = &params.client_id {
        if !client_id.is_empty() {
            return Ok(client_id.clone());
        }
    }
    // For github-copilot, use the public Copilot client ID
    if params.provider_id == "github-copilot" {
        return Ok("Iv1.b507a97c6c0a9f1b".to_string());
    }
    Err(JSONRPCErrorError::invalid_params(
        "GitHub OAuth App client_id is required for github-repositories",
    ))
}

fn internal_error(msg: String) -> JSONRPCErrorError {
    JSONRPCErrorError::new(-32603, &msg)
}

fn timestamp_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use codepilotx_keyring_store::KeyringStore;
    use codepilotx_keyring_store::tests::MockKeyringStore;
    use keyring::Error as KeyringError;
    use std::collections::HashMap;
    use std::fs;
    use std::path::Path;
    use std::sync::Mutex as StdMutex;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use wiremock::MockServer;

    fn stored_token(provider_id: &str) -> StoredProviderToken {
        StoredProviderToken {
            provider_id: provider_id.to_string(),
            access_token: "sentinel-github-token".to_string(),
            token_type: "bearer".to_string(),
            scope: Some("repo".to_string()),
            user: ProviderUserInfo {
                login: "octocat".to_string(),
                name: None,
                avatar_url: None,
            },
            stored_at: 1,
        }
    }

    #[tokio::test]
    async fn rejects_provider_id_path_traversal_before_storage_access() {
        let home = tempfile::tempdir().expect("temp home");
        let keyring = MockKeyringStore::default();
        let processor = ProviderAuthRequestProcessor::new_with_keyring(
            home.path().to_path_buf(),
            home.path().to_path_buf(),
            Arc::new(keyring.clone()),
        );

        let error = processor
            .read_status(ProviderAuthReadStatusParams {
                provider_id: "../github-repositories".to_string(),
            })
            .await
            .expect_err("traversal provider id must fail");

        assert_eq!(error.code, -32602);
        assert!(!keyring.contains("provider-auth/../github-repositories"));
    }

    #[tokio::test]
    async fn legacy_token_migration_keeps_source_when_keyring_write_fails() {
        let home = tempfile::tempdir().expect("temp home");
        let legacy_dir = home.path().join("provider-auth");
        fs::create_dir_all(&legacy_dir).expect("legacy dir");
        let legacy_path = legacy_dir.join("github-repositories.json");
        fs::write(
            &legacy_path,
            serde_json::to_vec(&stored_token("github-repositories")).expect("serialize token"),
        )
        .expect("legacy token");

        let keyring = MockKeyringStore::default();
        keyring.set_error(
            "provider-auth/github-repositories",
            KeyringError::NoStorageAccess(Box::new(std::io::Error::other("denied"))),
        );
        let processor = ProviderAuthRequestProcessor::new_with_keyring(
            home.path().to_path_buf(),
            home.path().to_path_buf(),
            Arc::new(keyring),
        );

        let error = processor
            .read_status(ProviderAuthReadStatusParams {
                provider_id: "github-repositories".to_string(),
            })
            .await
            .expect_err("keyring write failure must reach caller");

        assert_eq!(error.code, -32603);
        assert!(
            legacy_path.exists(),
            "failed migration must retain plaintext source"
        );
    }

    #[tokio::test]
    async fn legacy_token_migration_deletes_source_only_after_keyring_save() {
        let home = tempfile::tempdir().expect("temp home");
        let legacy_dir = home.path().join("provider-auth");
        fs::create_dir_all(&legacy_dir).expect("legacy dir");
        let legacy_path = legacy_dir.join("github-repositories.json");
        fs::write(
            &legacy_path,
            serde_json::to_vec(&stored_token("github-repositories")).expect("serialize token"),
        )
        .expect("legacy token");

        let keyring = MockKeyringStore::default();
        let processor = ProviderAuthRequestProcessor::new_with_keyring(
            home.path().to_path_buf(),
            home.path().to_path_buf(),
            Arc::new(keyring.clone()),
        );

        let status = processor
            .read_status(ProviderAuthReadStatusParams {
                provider_id: "github-repositories".to_string(),
            })
            .await
            .expect("migration succeeds");

        assert!(status.authenticated);
        assert!(
            !legacy_path.exists(),
            "successful migration removes plaintext source"
        );
        assert!(
            keyring
                .saved_value("provider-auth/github-repositories")
                .is_some(),
            "token must be persisted in keyring"
        );
    }

    #[tokio::test]
    async fn provider_api_key_migration_keeps_plaintext_when_keyring_write_fails() {
        let home = tempfile::tempdir().expect("temp home");
        let credentials_path = home.path().join(".credentials.json");
        fs::write(
            &credentials_path,
            r#"{"providerApiKeys":{"zhipu":"sentinel-provider-key"},"other":true}"#,
        )
        .expect("legacy credentials");
        let keyring = MockKeyringStore::default();
        keyring.set_error(
            "providerApiKeys/zhipu",
            KeyringError::NoStorageAccess(Box::new(std::io::Error::other("denied"))),
        );
        let processor = ProviderAuthRequestProcessor::new_with_keyring(
            home.path().to_path_buf(),
            home.path().to_path_buf(),
            Arc::new(keyring),
        );

        processor
            .migrate_legacy_provider_api_keys()
            .await
            .expect_err("keyring write must fail migration");

        assert!(
            fs::read_to_string(credentials_path)
                .expect("credentials retained")
                .contains("sentinel-provider-key")
        );
    }

    #[tokio::test]
    async fn provider_api_key_migration_redacts_plaintext_after_secure_save() {
        let home = tempfile::tempdir().expect("temp home");
        let credentials_path = home.path().join(".credentials.json");
        fs::write(
            &credentials_path,
            r#"{"providerApiKeys":{"zhipu":"sentinel-provider-key"},"other":true}"#,
        )
        .expect("legacy credentials");
        let keyring = MockKeyringStore::default();
        let processor = ProviderAuthRequestProcessor::new_with_keyring(
            home.path().to_path_buf(),
            home.path().to_path_buf(),
            Arc::new(keyring.clone()),
        );

        processor
            .migrate_legacy_provider_api_keys()
            .await
            .expect("migration succeeds");

        let redacted = fs::read_to_string(credentials_path).expect("redacted credentials");
        assert!(!redacted.contains("sentinel-provider-key"));
        assert!(!redacted.contains("providerApiKeys"));
        assert_eq!(
            keyring.saved_value("providerApiKeys/zhipu").as_deref(),
            Some("sentinel-provider-key")
        );
    }

    #[tokio::test]
    async fn provider_api_key_migration_replaces_empty_keyring_entry_before_redaction() {
        let home = tempfile::tempdir().expect("temp home");
        let credentials_path = home.path().join(".credentials.json");
        fs::write(
            &credentials_path,
            r#"{"providerApiKeys":{"zhipu":"sentinel-provider-key"}}"#,
        )
        .expect("legacy credentials");
        let keyring = MockKeyringStore::default();
        keyring
            .save(PROVIDER_AUTH_KEYRING_SERVICE, "providerApiKeys/zhipu", "")
            .expect("seed empty keyring entry");
        let processor = ProviderAuthRequestProcessor::new_with_keyring(
            home.path().to_path_buf(),
            home.path().to_path_buf(),
            Arc::new(keyring.clone()),
        );

        processor
            .migrate_legacy_provider_api_keys()
            .await
            .expect("migration succeeds");

        assert_eq!(
            keyring.saved_value("providerApiKeys/zhipu").as_deref(),
            Some("sentinel-provider-key")
        );
        assert!(
            !fs::read_to_string(credentials_path)
                .expect("redacted credentials")
                .contains("sentinel-provider-key")
        );
    }

    #[tokio::test]
    async fn successful_keyring_read_retries_legacy_token_cleanup() {
        let home = tempfile::tempdir().expect("temp home");
        let legacy_dir = home.path().join("provider-auth");
        fs::create_dir_all(&legacy_dir).expect("legacy dir");
        let legacy_path = legacy_dir.join("github-repositories.json");
        fs::create_dir(&legacy_path).expect("force initial cleanup failure");
        let keyring = MockKeyringStore::default();
        keyring
            .save(
                PROVIDER_AUTH_KEYRING_SERVICE,
                "provider-auth/github-repositories",
                &serde_json::to_string(&stored_token("github-repositories"))
                    .expect("serialize token"),
            )
            .expect("seed keyring token");
        let processor = ProviderAuthRequestProcessor::new_with_keyring(
            home.path().to_path_buf(),
            home.path().to_path_buf(),
            Arc::new(keyring),
        );

        processor
            .read_status(ProviderAuthReadStatusParams {
                provider_id: "github-repositories".to_string(),
            })
            .await
            .expect_err("directory cannot be removed as legacy file");
        fs::remove_dir(&legacy_path).expect("remove blocking directory");
        fs::write(&legacy_path, b"legacy plaintext").expect("restore legacy file");

        let status = processor
            .read_status(ProviderAuthReadStatusParams {
                provider_id: "github-repositories".to_string(),
            })
            .await
            .expect("cleanup retries on next secure read");

        assert!(status.authenticated);
        assert!(!legacy_path.exists());
    }

    #[tokio::test]
    async fn provider_api_key_write_failure_reaches_rpc_caller() {
        let home = tempfile::tempdir().expect("temp home");
        let keyring = MockKeyringStore::default();
        keyring.set_error(
            "providerApiKeys/zhipu",
            KeyringError::NoStorageAccess(Box::new(std::io::Error::other("denied"))),
        );
        let processor = ProviderAuthRequestProcessor::new_with_keyring(
            home.path().to_path_buf(),
            home.path().to_path_buf(),
            Arc::new(keyring),
        );

        let error = processor
            .save_provider_api_key(ProviderApiKeySaveParams {
                provider_id: "zhipu".to_string(),
                api_key: "sentinel-provider-key".to_string(),
            })
            .await
            .expect_err("keyring failure must reach RPC caller");

        assert_eq!(error.code, -32603);
    }

    #[tokio::test]
    async fn stored_provider_key_never_uses_caller_base_url() {
        let server = MockServer::start().await;
        let home = tempfile::tempdir().expect("temp home");
        let keyring = MockKeyringStore::default();
        keyring
            .save(
                PROVIDER_AUTH_KEYRING_SERVICE,
                "providerApiKeys/deepseek",
                "sentinel-provider-key",
            )
            .expect("seed provider key");
        let processor = ProviderAuthRequestProcessor::new_with_keyring(
            home.path().to_path_buf(),
            home.path().to_path_buf(),
            Arc::new(keyring),
        );
        for attacker_base_url in [
            format!("{}/v1", server.uri()),
            format!("{}/v1", server.uri()).replacen("http://", "https://", 1),
        ] {
            let models = processor
                .fetch_provider_models(ProviderModelListParams {
                    provider_id: "deepseek".to_string(),
                    base_url: Some(attacker_base_url.clone()),
                    api_key: None,
                    default_models: vec!["default-model".to_string()],
                })
                .await
                .expect("model fetch fails closed");
            assert_eq!(models.models, vec!["default-model"]);
            assert!(models.error.is_some());
            let balance = processor
                .fetch_provider_balance(ProviderBalanceParams {
                    provider_id: "deepseek".to_string(),
                    base_url: Some(attacker_base_url),
                    api_key: None,
                })
                .await
                .expect("balance fetch fails closed");
            assert!(!balance.is_available);
            assert!(balance.error.is_some());
        }
        assert!(
            server
                .received_requests()
                .await
                .expect("request recording")
                .is_empty(),
            "caller endpoints must not receive stored credentials"
        );
    }

    #[test]
    fn provider_endpoint_selection_uses_trusted_config_or_transient_key_only() {
        let home = tempfile::tempdir().expect("temp home");
        let processor = ProviderAuthRequestProcessor::new_with_keyring_and_endpoints(
            home.path().to_path_buf(),
            home.path().to_path_buf(),
            HashMap::from([(
                "deepseek".to_string(),
                "https://trusted.example/v1".to_string(),
            )]),
            Arc::new(MockKeyringStore::default()),
        );

        assert_eq!(
            processor
                .resolve_provider_base_url("deepseek", Some("https://attacker.example/v1"), false,)
                .expect("trusted endpoint"),
            Some("https://trusted.example/v1".to_string())
        );
        assert_eq!(
            processor
                .resolve_provider_base_url("deepseek", Some("https://transient.example/v1"), true,)
                .expect("transient endpoint"),
            Some("https://transient.example/v1".to_string())
        );
        assert!(
            processor
                .resolve_provider_base_url("deepseek", Some("http://attacker.example/v1"), true,)
                .is_err()
        );
    }

    #[tokio::test]
    async fn logout_propagates_keyring_delete_failure() {
        let home = tempfile::tempdir().expect("temp home");
        let keyring = MockKeyringStore::default();
        let serialized =
            serde_json::to_string(&stored_token("github-repositories")).expect("serialize token");
        keyring
            .save(
                PROVIDER_AUTH_KEYRING_SERVICE,
                "provider-auth/github-repositories",
                &serialized,
            )
            .expect("seed keyring");
        keyring.set_error(
            "provider-auth/github-repositories",
            KeyringError::NoStorageAccess(Box::new(std::io::Error::other("denied"))),
        );
        let processor = ProviderAuthRequestProcessor::new_with_keyring(
            home.path().to_path_buf(),
            home.path().to_path_buf(),
            Arc::new(keyring),
        );

        let error = processor
            .logout(ProviderAuthLogoutParams {
                provider_id: "github-repositories".to_string(),
            })
            .await
            .expect_err("delete failure must reach caller");

        assert_eq!(error.code, -32603);
    }

    #[test]
    fn rejects_non_https_non_github_and_escaped_clone_targets() {
        let root = tempfile::tempdir().expect("clone root");
        let valid_target = root.path().join("repo");

        assert!(
            validate_github_clone_request(
                "git@github.com:owner/repo.git",
                &valid_target,
                root.path(),
            )
            .is_err()
        );
        let outside = tempfile::tempdir().expect("outside root");
        assert!(
            validate_github_clone_request(
                "https://github.com/owner/repo.git",
                &outside.path().join("repo"),
                root.path(),
            )
            .is_err()
        );
        assert!(
            validate_github_clone_request(
                "https://example.com/owner/repo.git",
                &valid_target,
                root.path(),
            )
            .is_err()
        );
        assert!(
            validate_github_clone_request(
                "https://github.com/owner/repo.git",
                &root.path().join("..").join("repo"),
                root.path(),
            )
            .is_err()
        );
    }

    #[derive(Debug, Default)]
    struct FailingGitRunner {
        calls: AtomicUsize,
        askpass_path: StdMutex<Option<PathBuf>>,
        staging_path: StdMutex<Option<PathBuf>>,
    }

    impl GitCloneRunner for FailingGitRunner {
        async fn run(
            &self,
            _args: &[String],
            env: &HashMap<String, String>,
            target: &Path,
        ) -> std::io::Result<GitCloneOutput> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let askpass = PathBuf::from(env.get("GIT_ASKPASS").expect("askpass env"));
            assert!(askpass.exists(), "askpass must exist only while git runs");
            let isolated_home = PathBuf::from(env.get("HOME").expect("isolated HOME"));
            assert!(isolated_home.starts_with(askpass.parent().expect("askpass parent")));
            assert_eq!(env.get("USERPROFILE"), env.get("HOME"));
            assert_eq!(
                env.get("GIT_CONFIG_NOSYSTEM").map(String::as_str),
                Some("1")
            );
            assert_eq!(env.get("GIT_CONFIG_COUNT").map(String::as_str), Some("0"));
            assert!(Path::new(env.get("GIT_CONFIG_GLOBAL").expect("isolated config")).exists());
            *self.askpass_path.lock().expect("askpass lock") = Some(askpass);
            *self.staging_path.lock().expect("staging lock") = Some(target.to_path_buf());
            fs::create_dir_all(target.join(".git"))?;
            Ok(GitCloneOutput {
                success: false,
                stderr: "injected sentinel-github-token https://x-access-token:sentinel-github-token@github.com/owner/repo.git failure".to_string(),
            })
        }
    }

    #[tokio::test]
    async fn clone_failure_cleans_askpass_and_partial_target() {
        let root = tempfile::tempdir().expect("clone root");
        let target = root.path().join("repo");
        let request = validate_github_clone_request(
            "https://github.com/owner/repo.git",
            &target,
            root.path(),
        )
        .expect("valid clone request");
        let runner = FailingGitRunner::default();

        let error = clone_with_github_token(&request, "sentinel-github-token", &runner)
            .await
            .expect_err("injected clone must fail");

        assert!(error.message.contains("injected"));
        assert!(!error.message.contains("sentinel-github-token"));
        assert!(error.message.contains("x-access-token:***@github.com"));
        assert_eq!(runner.calls.load(Ordering::SeqCst), 1);
        assert!(!target.exists(), "partial clone target must be removed");
        let askpass = runner
            .askpass_path
            .lock()
            .expect("askpass lock")
            .clone()
            .expect("captured askpass");
        assert!(!askpass.exists(), "temporary askpass must be removed");
        let staging = runner
            .staging_path
            .lock()
            .expect("staging lock")
            .clone()
            .expect("captured staging target");
        assert!(!staging.exists(), "server staging target must be removed");
    }

    #[derive(Debug)]
    struct SuccessfulGitRunner {
        final_target: PathBuf,
        create_concurrent_target: bool,
    }

    impl GitCloneRunner for SuccessfulGitRunner {
        async fn run(
            &self,
            _args: &[String],
            _env: &HashMap<String, String>,
            staging_target: &Path,
        ) -> std::io::Result<GitCloneOutput> {
            fs::create_dir_all(staging_target.join(".git"))?;
            fs::write(staging_target.join("README.md"), b"cloned")?;
            if self.create_concurrent_target {
                fs::create_dir_all(&self.final_target)?;
                fs::write(self.final_target.join("user.txt"), b"keep")?;
            }
            Ok(GitCloneOutput {
                success: true,
                stderr: String::new(),
            })
        }
    }

    #[tokio::test]
    async fn successful_clone_atomically_publishes_server_staging_directory() {
        let root = tempfile::tempdir().expect("clone root");
        let target = root.path().join("repo");
        let request = validate_github_clone_request(
            "https://github.com/owner/repo.git",
            &target,
            root.path(),
        )
        .expect("valid clone request");
        let runner = SuccessfulGitRunner {
            final_target: target.clone(),
            create_concurrent_target: false,
        };

        clone_with_github_token(&request, "sentinel-github-token", &runner)
            .await
            .expect("clone publishes");

        assert_eq!(
            fs::read(target.join("README.md")).expect("published file"),
            b"cloned"
        );
    }

    #[test]
    fn atomic_publish_never_replaces_concurrent_empty_target() {
        let root = tempfile::tempdir().expect("clone root");
        let source = root.path().join("staging-repository");
        let target = root.path().join("repo");
        fs::create_dir(&source).expect("source");
        fs::write(source.join("README.md"), b"cloned").expect("source file");
        fs::create_dir(&target).expect("concurrent empty target");

        publish_clone_noclobber(&source, &target)
            .expect_err("atomic publish must reject an existing empty target");

        assert!(source.join("README.md").exists());
        assert!(target.exists());
        assert!(
            fs::read_dir(&target)
                .expect("target contents")
                .next()
                .is_none()
        );
    }

    #[tokio::test]
    async fn concurrent_target_is_never_removed_or_replaced() {
        let root = tempfile::tempdir().expect("clone root");
        let target = root.path().join("repo");
        let request = validate_github_clone_request(
            "https://github.com/owner/repo.git",
            &target,
            root.path(),
        )
        .expect("valid clone request");
        let runner = SuccessfulGitRunner {
            final_target: target.clone(),
            create_concurrent_target: true,
        };

        clone_with_github_token(&request, "sentinel-github-token", &runner)
            .await
            .expect_err("concurrent target must block publish");

        assert_eq!(
            fs::read(target.join("user.txt")).expect("caller file"),
            b"keep"
        );
        assert!(!target.join("README.md").exists());
    }
}
