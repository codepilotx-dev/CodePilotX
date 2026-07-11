use std::{
    collections::HashMap,
    ffi::OsString,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use codepilotx_app_server_protocol::{
    GithubContributionDay, GithubContributionWeek, GithubContributions, GithubProfileLanguage,
    GithubProfileOrganization, GithubProfileOverview, GithubProfileRepository, GithubProfileUser,
    GithubUserStatus, JSONRPCErrorError, ProviderApiKeyDeleteParams, ProviderApiKeyDeleteResponse,
    ProviderApiKeyReadParams, ProviderApiKeyReadResponse, ProviderApiKeySaveParams,
    ProviderApiKeySaveResponse, ProviderAuthAppTokenAccount, ProviderAuthAppTokenExchangeResponse,
    ProviderAuthAppTokenLogoutResponse, ProviderAuthAppTokenParams,
    ProviderAuthAppTokenRefreshResponse, ProviderAuthAppTokenStatusResponse,
    ProviderAuthCancelLoginParams, ProviderAuthCancelLoginResponse, ProviderAuthLogoutParams,
    ProviderAuthLogoutResponse, ProviderAuthPollLoginParams, ProviderAuthPollLoginResponse,
    ProviderAuthPollStatus, ProviderAuthProfileReadParams, ProviderAuthProfileReadResponse,
    ProviderAuthReadStatusParams, ProviderAuthReadStatusResponse, ProviderAuthStartLoginParams,
    ProviderAuthStartLoginResponse, ProviderAuthStatusClearParams, ProviderAuthStatusClearResponse,
    ProviderAuthStatusSetParams, ProviderAuthStatusSetResponse, ProviderBalanceInfo,
    ProviderBalanceParams, ProviderBalanceResponse, ProviderModelListParams,
    ProviderModelListResponse, ProviderRepoCloneParams, ProviderRepoCloneResponse,
    ProviderRepoInfo, ProviderRepoListParams, ProviderRepoListResponse, ProviderUserInfo,
};
use codepilotx_keyring_store::{DefaultKeyringStore, KeyringStore};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::error_code::{internal_error, invalid_params, invalid_request};

//  In-memory state for device-code flows

#[derive(Clone)]
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
const APP_TOKEN_KEYRING_SERVICE: &str = "CodePilotX App Auth";
const GITHUB_REPOSITORIES_PROVIDER_ID: &str = "github-repositories";
const APP_TOKEN_KEYRING_ACCOUNT: &str = "app-auth/github-repositories";
#[derive(Serialize, Deserialize, Clone)]
struct StoredAppToken {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: Option<u64>,
    scopes: Vec<String>,
    account: Option<ProviderAuthAppTokenAccount>,
    #[serde(skip)]
    scope_present: bool,
    #[serde(skip)]
    account_present: bool,
}
#[derive(Deserialize)]
struct AppTokenWire {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    scope: Option<String>,
    account: Option<AppAccountWire>,
    organization: Option<AppOrgWire>,
}
#[derive(Deserialize)]
struct AppAccountWire {
    uuid: String,
    email_address: String,
}
#[derive(Deserialize)]
struct AppOrgWire {
    uuid: String,
}

trait CredentialsWriter: Send + Sync {
    fn write(&self, path: &Path, contents: &[u8]) -> std::io::Result<()>;
}

#[derive(Debug, Default)]
struct AtomicCredentialsWriter;

impl CredentialsWriter for AtomicCredentialsWriter {
    fn write(&self, path: &Path, contents: &[u8]) -> std::io::Result<()> {
        let parent = path.parent().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("path {} has no parent directory", path.display()),
            )
        })?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
        temporary.write_all(contents)?;
        temporary.flush()?;
        temporary.as_file().sync_all()?;
        temporary.persist(path).map_err(|error| error.error)?;
        Ok(())
    }
}

//  Public processor

#[derive(Clone)]
pub(crate) struct ProviderAuthRequestProcessor {
    inner: Arc<Mutex<ProviderAuthInner>>,
    config_dir: PathBuf,
    approved_clone_root: PathBuf,
    trusted_provider_endpoints: Arc<HashMap<String, String>>,
    keyring: Arc<dyn KeyringStore>,
    credentials_writer: Arc<dyn CredentialsWriter>,
    github_graphql_endpoint: String,
    github_graphql_timeout: Duration,
    app_auth_base_url: String,
    app_auth_timeout: Duration,
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
        Self::new_with_keyring_endpoints_and_writer(
            config_dir,
            approved_clone_root,
            trusted_provider_endpoints,
            keyring,
            Arc::new(AtomicCredentialsWriter),
        )
    }

    fn new_with_keyring_and_writer(
        config_dir: PathBuf,
        approved_clone_root: PathBuf,
        keyring: Arc<dyn KeyringStore>,
        credentials_writer: Arc<dyn CredentialsWriter>,
    ) -> Self {
        Self::new_with_keyring_endpoints_and_writer(
            config_dir,
            approved_clone_root,
            HashMap::new(),
            keyring,
            credentials_writer,
        )
    }

    fn new_with_keyring_endpoints_and_writer(
        config_dir: PathBuf,
        approved_clone_root: PathBuf,
        trusted_provider_endpoints: HashMap<String, String>,
        keyring: Arc<dyn KeyringStore>,
        credentials_writer: Arc<dyn CredentialsWriter>,
    ) -> Self {
        Self {
            inner: Arc::new(Mutex::new(ProviderAuthInner {
                attempts: HashMap::new(),
            })),
            config_dir,
            approved_clone_root,
            trusted_provider_endpoints: Arc::new(trusted_provider_endpoints),
            keyring,
            credentials_writer,
            github_graphql_endpoint: "https://api.github.com/graphql".into(),
            github_graphql_timeout: Duration::from_secs(30),
            app_auth_base_url: "https://auth.codepilotx.com".into(),
            app_auth_timeout: Duration::from_secs(30),
        }
    }
    #[cfg(test)]
    fn with_github_graphql_endpoint(mut self, endpoint: String) -> Self {
        self.github_graphql_endpoint = endpoint;
        self
    }
    #[cfg(test)]
    fn with_github_graphql_timeout(mut self, timeout: Duration) -> Self {
        self.github_graphql_timeout = timeout;
        self
    }
    pub(crate) async fn profile_read(
        &self,
        p: ProviderAuthProfileReadParams,
    ) -> Result<ProviderAuthProfileReadResponse, JSONRPCErrorError> {
        let t = self.require_token(&p.provider_id).await?.access_token;
        let d = self
            .graphql(&t, PROFILE_QUERY, serde_json::json!({}))
            .await?;
        let v = d
            .get("viewer")
            .ok_or_else(|| internal_error("GitHub GraphQL response did not include viewer"))?;
        Ok(ProviderAuthProfileReadResponse {
            overview: map_profile(v)?,
        })
    }
    pub(crate) async fn status_set(
        &self,
        p: ProviderAuthStatusSetParams,
    ) -> Result<ProviderAuthStatusSetResponse, JSONRPCErrorError> {
        let t = self.require_token(&p.provider_id).await?.access_token;
        let e = norm_emoji(&p.emoji);
        let m: String = p.message.trim().chars().take(80).collect();
        let d=self.graphql(&t,SET_QUERY,serde_json::json!({"emoji":e,"message":m,"limitedAvailability":p.limited_availability,"expiresAt":p.expires_at})).await?;
        let status = required_status_payload(&d, "changeUserStatus")?;
        Ok(ProviderAuthStatusSetResponse {
            status: (!status.is_null())
                .then(|| map_status(status))
                .transpose()?,
        })
    }
    pub(crate) async fn status_clear(
        &self,
        p: ProviderAuthStatusClearParams,
    ) -> Result<ProviderAuthStatusClearResponse, JSONRPCErrorError> {
        let t = self.require_token(&p.provider_id).await?.access_token;
        let d = self.graphql(&t, CLEAR_QUERY, serde_json::json!({})).await?;
        let s = required_status_payload(&d, "clearUserStatus")?;
        Ok(ProviderAuthStatusClearResponse {
            status: (!s.is_null()).then(|| map_status(s)).transpose()?,
        })
    }
    async fn graphql(
        &self,
        token: &str,
        query: &str,
        variables: serde_json::Value,
    ) -> Result<serde_json::Value, JSONRPCErrorError> {
        let r = reqwest::Client::builder()
            .timeout(self.github_graphql_timeout)
            .build()
            .map_err(|e| internal_error(format!("GitHub client failed: {e}")))?
            .post(&self.github_graphql_endpoint)
            .header("User-Agent", "codepilotx-app-server")
            .bearer_auth(token)
            .json(&serde_json::json!({"query":query,"variables":variables}))
            .send()
            .await
            .map_err(|e| internal_error(format!("GitHub GraphQL request failed: {e}")))?;
        let status = r.status();
        if !status.is_success() {
            return Err(internal_error(format!("GitHub GraphQL returned {status}")));
        }
        let p: serde_json::Value = r
            .json()
            .await
            .map_err(|e| internal_error(format!("Failed to parse GitHub GraphQL response: {e}")))?;
        if let Some(es) = p
            .get("errors")
            .and_then(|x| x.as_array())
            .filter(|x| !x.is_empty())
        {
            let m = es
                .iter()
                .filter_map(|e| e["message"].as_str())
                .collect::<Vec<_>>()
                .join("; ");
            return Err(internal_error(if m.is_empty() {
                "GitHub GraphQL request failed".to_string()
            } else {
                redact_secret(&m, token)
            }));
        }
        p.get("data")
            .cloned()
            .ok_or_else(|| internal_error("GitHub GraphQL response did not include data"))
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
            return Err(invalid_params(format!(
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
        let parsed = url::Url::parse(base_url)
            .map_err(|_| invalid_params("provider endpoint must be a valid HTTPS URL"))?;
        if parsed.scheme() != "https" {
            return Err(invalid_params(
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
                id: r.id,
                name: r.name,
                full_name: r.full_name,
                description: r.description,
                private: r.private,
                fork: r.fork,
                archived: r.archived,
                disabled: r.disabled,
                html_url: r.html_url,
                clone_url: r.clone_url,
                ssh_url: r.ssh_url,
                default_branch: r.default_branch,
                language: r.language,
                stargazers_count: r.stargazers_count,
                updated_at: r.updated_at,
                pushed_at: r.pushed_at,
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
                    id: 0,
                    login: "copilot".to_string(),
                    name: None,
                    avatar_url: None,
                    html_url: "https://github.com/features/copilot".to_string(),
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
        self.credentials_writer
            .write(&path, &redacted)
            .map_err(|error| {
                internal_error(format!(
                    "Failed to redact legacy provider API keys: {error}"
                ))
            })?;
        Ok(())
    }

    #[cfg(test)]
    fn with_app_auth_endpoint(mut self, endpoint: String) -> Self {
        self.app_auth_base_url = endpoint;
        self
    }
    #[cfg(test)]
    fn with_app_auth_timeout(mut self, timeout: Duration) -> Self {
        self.app_auth_timeout = timeout;
        self
    }
    pub(crate) async fn app_token_exchange(
        &self,
        p: ProviderAuthAppTokenParams,
    ) -> Result<ProviderAuthAppTokenExchangeResponse, JSONRPCErrorError> {
        validate_app_token_provider(&p.provider_id)?;
        let github = self.require_token(&p.provider_id).await?;
        let token=self.request_app_token("api/auth/github/exchange",serde_json::json!({"github_access_token":github.access_token,"github_user":{"login":github.user.login,"name":github.user.name,"avatar_url":github.user.avatar_url},"client":"desktop"})).await?;
        self.save_app_token(&p.provider_id, &token)?;
        Ok(ProviderAuthAppTokenExchangeResponse {
            authenticated: true,
            expires_at: token.expires_at,
            scopes: token.scopes.clone(),
            account: token.account.clone(),
        })
    }
    pub(crate) async fn app_token_refresh(
        &self,
        p: ProviderAuthAppTokenParams,
    ) -> Result<ProviderAuthAppTokenRefreshResponse, JSONRPCErrorError> {
        validate_app_token_provider(&p.provider_id)?;
        let old = self
            .load_app_token(&p.provider_id)?
            .ok_or_else(|| invalid_request("CodePilotX app token is not available"))?;
        let refresh = old
            .refresh_token
            .clone()
            .ok_or_else(|| invalid_request("CodePilotX refresh token is not available"))?;
        let mut token = self
            .request_app_token(
                "api/auth/token",
                serde_json::json!({"grant_type":"refresh_token","refresh_token":refresh}),
            )
            .await?;
        if token.refresh_token.is_none() {
            token.refresh_token = old.refresh_token;
        }
        if !token.scope_present {
            token.scopes = old.scopes;
        }
        if !token.account_present {
            token.account = old.account;
        }
        self.save_app_token(&p.provider_id, &token)?;
        Ok(ProviderAuthAppTokenRefreshResponse {
            authenticated: true,
            expires_at: token.expires_at,
            scopes: token.scopes.clone(),
            account: token.account.clone(),
        })
    }
    pub(crate) async fn app_token_status(
        &self,
        p: ProviderAuthAppTokenParams,
    ) -> Result<ProviderAuthAppTokenStatusResponse, JSONRPCErrorError> {
        validate_app_token_provider(&p.provider_id)?;
        Ok(match self.load_app_token(&p.provider_id)? {
            Some(t) => ProviderAuthAppTokenStatusResponse {
                authenticated: t
                    .expires_at
                    .is_none_or(|expires_at| expires_at > timestamp_millis()),
                expires_at: t.expires_at,
                scopes: t.scopes,
                account: t.account,
            },
            None => ProviderAuthAppTokenStatusResponse {
                authenticated: false,
                expires_at: None,
                scopes: vec![],
                account: None,
            },
        })
    }
    pub(crate) async fn app_token_logout(
        &self,
        p: ProviderAuthAppTokenParams,
    ) -> Result<ProviderAuthAppTokenLogoutResponse, JSONRPCErrorError> {
        validate_app_token_provider(&p.provider_id)?;
        self.keyring
            .delete(APP_TOKEN_KEYRING_SERVICE, APP_TOKEN_KEYRING_ACCOUNT)
            .map_err(|e| internal_error(format!("Failed to delete app token: {e}")))?;
        Ok(ProviderAuthAppTokenLogoutResponse {})
    }
    async fn request_app_token(
        &self,
        path: &str,
        body: serde_json::Value,
    ) -> Result<StoredAppToken, JSONRPCErrorError> {
        if !self.app_auth_base_url.starts_with("https://")
            && !(cfg!(test) && self.app_auth_base_url.starts_with("http://127.0.0.1:"))
        {
            return Err(invalid_request("CodePilotX authentication requires HTTPS"));
        }
        let response = reqwest::Client::builder()
            .timeout(self.app_auth_timeout)
            .build()
            .map_err(|_| internal_error("CodePilotX authentication client failed"))?
            .post(format!(
                "{}/{}",
                self.app_auth_base_url.trim_end_matches('/'),
                path
            ))
            .json(&body)
            .send()
            .await
            .map_err(|_| internal_error("CodePilotX authentication request failed"))?;
        if !response.status().is_success() {
            return Err(internal_error(format!(
                "CodePilotX authentication failed ({})",
                response.status().as_u16()
            )));
        }
        let w: AppTokenWire = response.json().await.map_err(|_| {
            internal_error("CodePilotX authentication returned an invalid response")
        })?;
        if w.access_token.trim().is_empty() {
            return Err(internal_error(
                "CodePilotX authentication response did not include an access token",
            ));
        }
        if w.expires_in.is_some_and(|value| value == 0) {
            return Err(internal_error(
                "CodePilotX authentication response expiry is invalid",
            ));
        }
        let scope_present = w.scope.is_some();
        let account_present = w.account.is_some() || w.organization.is_some();
        let account = match (w.account, w.organization) {
            (Some(a), o)
                if !a.uuid.trim().is_empty()
                    && !a.email_address.trim().is_empty()
                    && o.as_ref().is_none_or(|v| !v.uuid.trim().is_empty()) =>
            {
                Some(ProviderAuthAppTokenAccount {
                    uuid: a.uuid,
                    email_address: a.email_address,
                    organization_uuid: o.map(|v| v.uuid),
                })
            }
            (None, None) => None,
            _ => {
                return Err(internal_error(
                    "CodePilotX authentication response account is invalid",
                ));
            }
        };
        Ok(StoredAppToken {
            access_token: w.access_token,
            refresh_token: w.refresh_token.filter(|v| !v.is_empty()),
            expires_at: w
                .expires_in
                .map(|v| timestamp_millis().saturating_add(v.saturating_mul(1000))),
            scopes: w
                .scope
                .map(|s| s.split_whitespace().map(str::to_owned).collect())
                .unwrap_or_else(|| vec!["user:inference".into()]),
            account,
            scope_present,
            account_present,
        })
    }
    fn load_app_token(&self, _id: &str) -> Result<Option<StoredAppToken>, JSONRPCErrorError> {
        self.keyring
            .load(APP_TOKEN_KEYRING_SERVICE, APP_TOKEN_KEYRING_ACCOUNT)
            .map_err(|e| keyring_error("read app token", e))?
            .map(|v| {
                serde_json::from_str(&v)
                    .map_err(|_| internal_error("Stored CodePilotX app token is invalid"))
            })
            .transpose()
    }
    fn save_app_token(&self, _id: &str, t: &StoredAppToken) -> Result<(), JSONRPCErrorError> {
        let value = serde_json::to_string(t)
            .map_err(|_| internal_error("Failed to serialize CodePilotX app token"))?;
        self.keyring
            .save(APP_TOKEN_KEYRING_SERVICE, APP_TOKEN_KEYRING_ACCOUNT, &value)
            .map_err(|e| keyring_error("save app token", e))
    }

    async fn require_token(
        &self,
        provider_id: &str,
    ) -> Result<StoredProviderToken, JSONRPCErrorError> {
        self.load_token(provider_id).await?.ok_or_else(|| {
            invalid_request(format!("Provider '{provider_id}' is not authenticated"))
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
        return Err(invalid_params(
            "provider_id must contain only ASCII letters, digits, '-' or '_'",
        ));
    }
    Ok(())
}
fn validate_app_token_provider(provider_id: &str) -> Result<(), JSONRPCErrorError> {
    if provider_id == GITHUB_REPOSITORIES_PROVIDER_ID {
        Ok(())
    } else {
        Err(invalid_params(
            "provider_id must be 'github-repositories' for CodePilotX app authentication",
        ))
    }
}
fn malformed(path: &str) -> JSONRPCErrorError {
    internal_error(format!("Malformed GitHub GraphQL response at {path}"))
}
fn obj<'a>(
    v: &'a serde_json::Value,
    path: &str,
) -> Result<&'a serde_json::Map<String, serde_json::Value>, JSONRPCErrorError> {
    v.as_object().ok_or_else(|| malformed(path))
}
fn val<'a>(
    v: &'a serde_json::Value,
    k: &str,
    path: &str,
) -> Result<&'a serde_json::Value, JSONRPCErrorError> {
    obj(v, path)?
        .get(k)
        .ok_or_else(|| malformed(&format!("{path}.{k}")))
}
fn st(v: &serde_json::Value, k: &str, path: &str) -> Result<String, JSONRPCErrorError> {
    val(v, k, path)?
        .as_str()
        .map(Into::into)
        .ok_or_else(|| malformed(&format!("{path}.{k}")))
}
fn ost(v: &serde_json::Value, k: &str, path: &str) -> Result<Option<String>, JSONRPCErrorError> {
    match val(v, k, path)? {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::String(value) => Ok(Some(value.clone())),
        _ => Err(malformed(&format!("{path}.{k}"))),
    }
}
fn num(v: &serde_json::Value, k: &str, path: &str) -> Result<i64, JSONRPCErrorError> {
    val(v, k, path)?
        .as_i64()
        .ok_or_else(|| malformed(&format!("{path}.{k}")))
}
fn boolean(v: &serde_json::Value, k: &str, path: &str) -> Result<bool, JSONRPCErrorError> {
    val(v, k, path)?
        .as_bool()
        .ok_or_else(|| malformed(&format!("{path}.{k}")))
}
fn tc(v: &serde_json::Value, k: &str, path: &str) -> Result<i64, JSONRPCErrorError> {
    num(val(v, k, path)?, "totalCount", &format!("{path}.{k}"))
}
fn map_status(v: &serde_json::Value) -> Result<GithubUserStatus, JSONRPCErrorError> {
    obj(v, "status")?;
    Ok(GithubUserStatus {
        emoji: ost(v, "emoji", "status")?,
        message: ost(v, "message", "status")?,
        indicates_limited_availability: boolean(v, "indicatesLimitedAvailability", "status")?,
        expires_at: ost(v, "expiresAt", "status")?,
    })
}
fn repo(v: &serde_json::Value, path: &str) -> Result<GithubProfileRepository, JSONRPCErrorError> {
    if st(v, "__typename", path)? != "Repository" {
        return Err(malformed(&format!("{path}.__typename")));
    }
    let name = st(v, "name", path)?;
    Ok(GithubProfileRepository {
        id: st(v, "id", path)?,
        name: name.clone(),
        full_name: format!(
            "{}/{}",
            st(val(v, "owner", path)?, "login", &format!("{path}.owner"))?,
            name
        ),
        url: st(v, "url", path)?,
        description: ost(v, "description", path)?,
        is_private: boolean(v, "isPrivate", path)?,
        is_fork: boolean(v, "isFork", path)?,
        primary_language: (!val(v, "primaryLanguage", path)?.is_null())
            .then(|| {
                Ok(GithubProfileLanguage {
                    name: st(
                        &v["primaryLanguage"],
                        "name",
                        &format!("{path}.primaryLanguage"),
                    )?,
                    color: ost(
                        &v["primaryLanguage"],
                        "color",
                        &format!("{path}.primaryLanguage"),
                    )?,
                })
            })
            .transpose()?,
        stargazer_count: num(v, "stargazerCount", path)?,
        fork_count: num(v, "forkCount", path)?,
        updated_at: st(v, "updatedAt", path)?,
    })
}
fn rps(v: &serde_json::Value, k: &str) -> Result<Vec<GithubProfileRepository>, JSONRPCErrorError> {
    val(val(v, k, "viewer")?, "nodes", &format!("viewer.{k}"))?
        .as_array()
        .ok_or_else(|| malformed(&format!("viewer.{k}.nodes")))?
        .iter()
        .enumerate()
        .map(|(i, x)| repo(x, &format!("viewer.{k}.nodes[{i}]")))
        .collect()
}
fn required_status_payload<'a>(
    d: &'a serde_json::Value,
    mutation: &str,
) -> Result<&'a serde_json::Value, JSONRPCErrorError> {
    let p = val(d, mutation, "data")?;
    val(p, "status", &format!("data.{mutation}"))
}
fn map_profile(v: &serde_json::Value) -> Result<GithubProfileOverview, JSONRPCErrorError> {
    obj(v, "viewer")?;
    let c = val(v, "contributionsCollection", "viewer")?;
    let a = val(c, "contributionCalendar", "viewer.contributionsCollection")?;
    let status = val(v, "status", "viewer")?;
    let org_nodes = val(
        val(v, "organizations", "viewer")?,
        "nodes",
        "viewer.organizations",
    )?
    .as_array()
    .ok_or_else(|| malformed("viewer.organizations.nodes"))?;
    Ok(GithubProfileOverview {
        user: GithubProfileUser {
            login: st(v, "login", "viewer")?,
            id: num(v, "databaseId", "viewer")?,
            name: ost(v, "name", "viewer")?,
            avatar_url: ost(v, "avatarUrl", "viewer")?,
            html_url: st(v, "url", "viewer")?,
            bio: ost(v, "bio", "viewer")?,
            company: ost(v, "company", "viewer")?,
            location: ost(v, "location", "viewer")?,
            website_url: ost(v, "websiteUrl", "viewer")?,
            email: ost(v, "email", "viewer")?,
            followers: tc(v, "followers", "viewer")?,
            following: tc(v, "following", "viewer")?,
            repository_count: tc(v, "repositories", "viewer")?,
            starred_repository_count: tc(v, "starredRepositories", "viewer")?,
            status: (!status.is_null())
                .then(|| map_status(status))
                .transpose()?,
        },
        organizations: org_nodes
            .iter()
            .enumerate()
            .map(|(i, o)| {
                let p = format!("viewer.organizations.nodes[{i}]");
                Ok(GithubProfileOrganization {
                    login: st(o, "login", &p)?,
                    name: ost(o, "name", &p)?,
                    avatar_url: ost(o, "avatarUrl", &p)?,
                    url: st(o, "url", &p)?,
                })
            })
            .collect::<Result<_, JSONRPCErrorError>>()?,
        pinned_repositories: rps(v, "pinnedItems")?,
        popular_repositories: rps(v, "topRepositories")?,
        contributions: GithubContributions {
            total_contributions: num(
                a,
                "totalContributions",
                "viewer.contributionsCollection.contributionCalendar",
            )?,
            total_commit_contributions: num(
                c,
                "totalCommitContributions",
                "viewer.contributionsCollection",
            )?,
            total_issue_contributions: num(
                c,
                "totalIssueContributions",
                "viewer.contributionsCollection",
            )?,
            total_pull_request_contributions: num(
                c,
                "totalPullRequestContributions",
                "viewer.contributionsCollection",
            )?,
            total_pull_request_review_contributions: num(
                c,
                "totalPullRequestReviewContributions",
                "viewer.contributionsCollection",
            )?,
            restricted_contributions_count: num(
                c,
                "restrictedContributionsCount",
                "viewer.contributionsCollection",
            )?,
            weeks: val(
                a,
                "weeks",
                "viewer.contributionsCollection.contributionCalendar",
            )?
            .as_array()
            .ok_or_else(|| malformed("viewer.contributionsCollection.contributionCalendar.weeks"))?
            .iter()
            .enumerate()
            .map(|(wi, w)| {
                let path =
                    format!("viewer.contributionsCollection.contributionCalendar.weeks[{wi}]");
                let days = val(w, "contributionDays", &path)?
                    .as_array()
                    .ok_or_else(|| malformed(&format!("{path}.contributionDays")))?
                    .iter()
                    .enumerate()
                    .map(|(di, d)| {
                        let day_path = format!("{path}.contributionDays[{di}]");
                        Ok(GithubContributionDay {
                            date: st(d, "date", &day_path)?,
                            count: num(d, "contributionCount", &day_path)?,
                            color: st(d, "color", &day_path)?,
                        })
                    })
                    .collect::<Result<_, JSONRPCErrorError>>()?;
                Ok(GithubContributionWeek { days })
            })
            .collect::<Result<_, JSONRPCErrorError>>()?,
        },
    })
}
fn norm_emoji(v: &str) -> String {
    let t = v.trim();
    if t.is_empty() {
        ":speech_balloon:".into()
    } else if t.starts_with(':') && t.ends_with(':') {
        t.into()
    } else {
        format!(":{}:", t.trim_matches(':'))
    }
}

fn redact_secret(message: &str, secret: &str) -> String {
    if secret.is_empty() {
        message.to_string()
    } else {
        message.replace(secret, "[REDACTED]")
    }
}
const PROFILE_QUERY: &str = r#"query DesktopGithubProfileOverview { viewer { databaseId login name avatarUrl url bio company location websiteUrl email organizations(first:20){nodes{login name avatarUrl url}} followers { totalCount } following { totalCount } repositories(privacy: PUBLIC, ownerAffiliations: OWNER) { totalCount } starredRepositories { totalCount } status { emoji message indicatesLimitedAvailability expiresAt } pinnedItems(first: 6, types: REPOSITORY) { nodes { __typename ... on Repository { id name url description isPrivate isFork stargazerCount forkCount updatedAt owner { login } primaryLanguage { name color } } } } topRepositories(first: 6, orderBy: { field: STARGAZERS, direction: DESC }) { nodes { __typename id name url description isPrivate isFork stargazerCount forkCount updatedAt owner { login } primaryLanguage { name color } } } contributionsCollection { totalCommitContributions totalIssueContributions totalPullRequestContributions totalPullRequestReviewContributions restrictedContributionsCount contributionCalendar { totalContributions weeks { contributionDays { date contributionCount color } } } } } }"#;
const SET_QUERY: &str = r#"mutation DesktopGithubSetUserStatus($emoji:String!,$message:String!,$limitedAvailability:Boolean!,$expiresAt:DateTime){changeUserStatus(input:{emoji:$emoji message:$message limitedAvailability:$limitedAvailability expiresAt:$expiresAt}){status{emoji message indicatesLimitedAvailability expiresAt}}}"#;
const CLEAR_QUERY: &str = r#"mutation DesktopGithubClearUserStatus{clearUserStatus(input:{}){status{emoji message indicatesLimitedAvailability expiresAt}}}"#;

fn validate_provider_api_key(api_key: &str) -> Result<(), JSONRPCErrorError> {
    if api_key.trim().is_empty()
        || api_key.contains('\r')
        || api_key.contains('\n')
        || !api_key.chars().all(|value| (value as u32) <= 0xff)
    {
        return Err(invalid_params(
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
    let url = url::Url::parse(&endpoint)
        .map_err(|error| invalid_params(format!("Invalid provider URL: {error}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(invalid_params("Provider URL must use http or https"));
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
    id: i64,
    login: String,
    name: Option<String>,
    avatar_url: Option<String>,
    html_url: String,
}

#[derive(Deserialize)]
struct GithubRepo {
    id: i64,
    name: String,
    full_name: String,
    description: Option<String>,
    private: bool,
    fork: bool,
    archived: bool,
    disabled: bool,
    html_url: String,
    clone_url: String,
    ssh_url: String,
    default_branch: String,
    language: Option<String>,
    stargazers_count: i64,
    updated_at: String,
    pushed_at: Option<String>,
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
        id: gh_user.id,
        login: gh_user.login,
        name: gh_user.name,
        avatar_url: gh_user.avatar_url,
        html_url: gh_user.html_url,
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
        .map_err(|_| invalid_params("repo_url must be a valid HTTPS URL"))?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid_params(
            "repo_url must be an HTTPS github.com repository URL without credentials",
        ));
    }

    let segments = url
        .path_segments()
        .ok_or_else(|| invalid_params("repo_url has no repository path"))?
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    if segments.len() != 2 {
        return Err(invalid_params(
            "repo_url must identify one GitHub owner and repository",
        ));
    }
    let repo_name = segments[1].strip_suffix(".git").unwrap_or(segments[1]);
    if !is_safe_github_path_segment(segments[0]) || !is_safe_github_path_segment(repo_name) {
        return Err(invalid_params(
            "repo_url contains an invalid owner or repository name",
        ));
    }

    if !local_path.is_absolute()
        || local_path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err(invalid_params(
            "local_path must be an absolute normalized path",
        ));
    }
    let target_name = local_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| invalid_params("local_path has no target directory"))?;
    if target_name != repo_name {
        return Err(invalid_params(
            "local_path target must match the GitHub repository name",
        ));
    }
    let parent = local_path
        .parent()
        .ok_or_else(|| invalid_params("local_path has no approved parent"))?;
    let trusted_root = std::fs::canonicalize(trusted_root).map_err(|error| {
        invalid_params(format!("approved clone root is not accessible: {error}"))
    })?;
    let canonical_parent = std::fs::canonicalize(parent).map_err(|error| {
        invalid_params(format!(
            "local_path parent is not an accessible approved directory: {error}"
        ))
    })?;
    let target = canonical_parent.join(target_name);
    if !target.starts_with(&trusted_root) || target == trusted_root {
        return Err(invalid_params(
            "local_path escaped the server-approved clone root",
        ));
    }

    match std::fs::symlink_metadata(&target) {
        Ok(_) => {
            return Err(invalid_params("local_path target must not already exist"));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(invalid_params(format!(
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
        args: &[OsString],
        env: &HashMap<OsString, OsString>,
        target: &Path,
    ) -> std::io::Result<GitCloneOutput>;
}

#[derive(Debug)]
struct SystemGitCloneRunner;

impl GitCloneRunner for SystemGitCloneRunner {
    async fn run(
        &self,
        args: &[OsString],
        env: &HashMap<OsString, OsString>,
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
        .ok_or_else(|| invalid_params("local_path has no approved parent"))?;
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
        OsString::from("clone"),
        OsString::from("--"),
        OsString::from(&request.repo_url),
        staging_target.as_os_str().to_os_string(),
    ];
    let mut env = minimal_git_environment();
    env.insert(
        OsString::from("GIT_ASKPASS"),
        askpass_path.as_os_str().to_os_string(),
    );
    env.insert(OsString::from("GIT_TERMINAL_PROMPT"), OsString::from("0"));
    env.insert(
        OsString::from("GIT_USERNAME"),
        OsString::from("x-access-token"),
    );
    env.insert(OsString::from("GIT_PASSWORD"), OsString::from(token));
    env.insert(
        OsString::from("HOME"),
        isolated_home.as_os_str().to_os_string(),
    );
    env.insert(
        OsString::from("USERPROFILE"),
        isolated_home.as_os_str().to_os_string(),
    );
    env.insert(OsString::from("GIT_CONFIG_NOSYSTEM"), OsString::from("1"));
    env.insert(
        OsString::from("GIT_CONFIG_GLOBAL"),
        isolated_git_config.as_os_str().to_os_string(),
    );
    env.insert(OsString::from("GIT_CONFIG_COUNT"), OsString::from("0"));

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
    // The Windows rename operation fails when the destination already exists,
    // providing atomic no-replace publication without a separate existence check.
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

fn minimal_git_environment() -> HashMap<OsString, OsString> {
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
        .filter_map(|key| std::env::var_os(key).map(|value| (OsString::from(key), value)))
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
    Err(invalid_params(
        "GitHub OAuth App client_id is required for github-repositories",
    ))
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
    use std::ffi::OsStr;
    use std::fs;
    use std::path::Path;
    use std::sync::Mutex as StdMutex;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};
    #[derive(Debug)]
    struct FailAppSaveKeyring {
        provider: String,
        app: StdMutex<Option<String>>,
    }
    impl KeyringStore for FailAppSaveKeyring {
        fn load(
            &self,
            service: &str,
            _account: &str,
        ) -> Result<Option<String>, codepilotx_keyring_store::CredentialStoreError> {
            Ok(if service == PROVIDER_AUTH_KEYRING_SERVICE {
                Some(self.provider.clone())
            } else {
                self.app.lock().unwrap().clone()
            })
        }
        fn save(
            &self,
            service: &str,
            _account: &str,
            value: &str,
        ) -> Result<(), codepilotx_keyring_store::CredentialStoreError> {
            if service == APP_TOKEN_KEYRING_SERVICE {
                return Err(codepilotx_keyring_store::CredentialStoreError::new(
                    KeyringError::NoStorageAccess(Box::new(std::io::Error::other("denied"))),
                ));
            }
            *self.app.lock().unwrap() = Some(value.into());
            Ok(())
        }
        fn delete(
            &self,
            _: &str,
            _: &str,
        ) -> Result<bool, codepilotx_keyring_store::CredentialStoreError> {
            Ok(false)
        }
    }

    fn stored_token(provider_id: &str) -> StoredProviderToken {
        StoredProviderToken {
            provider_id: provider_id.to_string(),
            access_token: "sentinel-github-token".to_string(),
            token_type: "bearer".to_string(),
            scope: Some("repo".to_string()),
            user: ProviderUserInfo {
                id: 42,
                login: "octocat".to_string(),
                name: None,
                avatar_url: None,
                html_url: "https://github.com/octocat".to_string(),
            },
            stored_at: 1,
        }
    }

    fn github_processor(server: &MockServer) -> ProviderAuthRequestProcessor {
        let home = tempfile::tempdir().expect("home");
        let keyring = MockKeyringStore::default();
        keyring
            .save(
                PROVIDER_AUTH_KEYRING_SERVICE,
                "provider-auth/github-repositories",
                &serde_json::to_string(&stored_token("github-repositories")).unwrap(),
            )
            .unwrap();
        ProviderAuthRequestProcessor::new_with_keyring(
            home.path().into(),
            home.path().into(),
            Arc::new(keyring),
        )
        .with_github_graphql_endpoint(format!("{}/graphql", server.uri()))
    }
    fn stored_app_token(access: &str, refresh: Option<&str>) -> StoredAppToken {
        StoredAppToken {
            access_token: access.into(),
            refresh_token: refresh.map(str::to_owned),
            expires_at: Some(1),
            scopes: vec!["user:inference".into()],
            account: None,
            scope_present: true,
            account_present: true,
        }
    }
    #[tokio::test]
    async fn app_token_exchange_is_secure() {
        let s = MockServer::start().await;
        Mock::given(method("POST")).and(path("/api/auth/github/exchange")).respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"access_token":"sentinel-app-access","refresh_token":"sentinel-app-refresh","expires_in":3600,"account":{"uuid":"a","email_address":"e"}}))).mount(&s).await;
        let p = github_processor(&s).with_app_auth_endpoint(s.uri());
        let r = p
            .app_token_exchange(ProviderAuthAppTokenParams {
                provider_id: "github-repositories".into(),
            })
            .await
            .unwrap();
        let out = serde_json::to_string(&r).unwrap();
        assert!(!out.contains("sentinel-app"));
        assert!(
            String::from_utf8_lossy(&s.received_requests().await.unwrap()[0].body)
                .contains("sentinel-github-token")
        );
    }
    #[tokio::test]
    async fn app_token_logout_removes_only_app_token() {
        let s = MockServer::start().await;
        let p = github_processor(&s);
        p.save_app_token(
            "github-repositories",
            &stored_app_token("app-access", Some("app-refresh")),
        )
        .unwrap();
        p.app_token_logout(ProviderAuthAppTokenParams {
            provider_id: "github-repositories".into(),
        })
        .await
        .unwrap();
        assert!(p.load_app_token("github-repositories").unwrap().is_none());
        assert!(p.load_token("github-repositories").await.unwrap().is_some());
        assert!(
            !p.app_token_status(ProviderAuthAppTokenParams {
                provider_id: "github-repositories".into(),
            })
            .await
            .unwrap()
            .authenticated
        );
    }
    #[test]
    fn github_repo_payload_requires_complete_desktop_metadata() {
        let value = serde_json::json!({
            "id": 42, "name": "repo", "full_name": "octo/repo",
            "description": null, "private": false, "fork": true,
            "archived": false, "disabled": false,
            "html_url": "https://github.com/octo/repo",
            "clone_url": "https://github.com/octo/repo.git",
            "ssh_url": "git@github.com:octo/repo.git", "default_branch": "main",
            "language": "Rust", "stargazers_count": 7,
            "updated_at": "2026-01-01T00:00:00Z", "pushed_at": null
        });
        let repo: GithubRepo = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(repo.id, 42);
        assert_eq!(repo.stargazers_count, 7);
        let mut missing = value.as_object().unwrap().clone();
        missing.remove("ssh_url");
        assert!(serde_json::from_value::<GithubRepo>(missing.into()).is_err());
    }
    #[test]
    fn github_user_payload_requires_real_identity_fields() {
        let value = serde_json::json!({
            "id": 42, "login": "octo", "name": null,
            "avatar_url": null, "html_url": "https://github.com/octo"
        });
        let user: GithubUser = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(user.id, 42);
        assert_eq!(user.html_url, "https://github.com/octo");
        let mut missing = value.as_object().unwrap().clone();
        missing.remove("id");
        assert!(serde_json::from_value::<GithubUser>(missing.into()).is_err());
    }
    #[tokio::test]
    async fn app_token_errors_do_not_leak_body() {
        let s = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(401).set_body_string("sentinel-server-secret"))
            .mount(&s)
            .await;
        let e = github_processor(&s)
            .with_app_auth_endpoint(s.uri())
            .app_token_exchange(ProviderAuthAppTokenParams {
                provider_id: "github-repositories".into(),
            })
            .await
            .unwrap_err();
        assert!(e.message.contains("401"));
        assert!(!e.message.contains("sentinel"));
    }
    #[tokio::test]
    async fn app_token_timeout_is_redacted() {
        let s = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_millis(50)))
            .mount(&s)
            .await;
        assert!(
            github_processor(&s)
                .with_app_auth_endpoint(s.uri())
                .with_app_auth_timeout(Duration::from_millis(5))
                .app_token_exchange(ProviderAuthAppTokenParams {
                    provider_id: "github-repositories".into()
                })
                .await
                .is_err()
        );
    }
    #[tokio::test]
    async fn app_token_refresh_failure_preserves_old_token() {
        let s = MockServer::start().await;
        let p = github_processor(&s).with_app_auth_endpoint(s.uri());
        p.save_app_token(
            "github-repositories",
            &stored_app_token("old-access", Some("old-refresh")),
        )
        .unwrap();
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&s)
            .await;
        assert!(
            p.app_token_refresh(ProviderAuthAppTokenParams {
                provider_id: "github-repositories".into()
            })
            .await
            .is_err()
        );
        assert_eq!(
            p.load_app_token("github-repositories")
                .unwrap()
                .unwrap()
                .access_token,
            "old-access"
        );
    }
    #[tokio::test]
    async fn app_token_refresh_retains_or_rotates_refresh_token() {
        for (returned, expected) in [(None, "old-refresh"), (Some("new-refresh"), "new-refresh")] {
            let s = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/auth/token"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "access_token":"new-access", "refresh_token":returned, "expires_in":60
                })))
                .mount(&s)
                .await;
            let p = github_processor(&s).with_app_auth_endpoint(s.uri());
            p.save_app_token(
                "github-repositories",
                &stored_app_token("old-access", Some("old-refresh")),
            )
            .unwrap();
            p.app_token_refresh(ProviderAuthAppTokenParams {
                provider_id: "github-repositories".into(),
            })
            .await
            .unwrap();
            assert_eq!(
                p.load_app_token("github-repositories")
                    .unwrap()
                    .unwrap()
                    .refresh_token
                    .as_deref(),
                Some(expected)
            );
        }
    }

    #[tokio::test]
    async fn app_token_exchange_rejects_malformed_json() {
        let s = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_string("sentinel-not-json"))
            .mount(&s)
            .await;
        let e = github_processor(&s)
            .with_app_auth_endpoint(s.uri())
            .app_token_exchange(ProviderAuthAppTokenParams {
                provider_id: "github-repositories".into(),
            })
            .await
            .unwrap_err();
        assert!(!e.message.contains("sentinel"));
    }
    #[tokio::test]
    async fn app_token_keyring_write_failure_is_reported_without_secret() {
        let s = MockServer::start().await;
        Mock::given(method("POST")).respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"access_token":"sentinel-new-access","refresh_token":"sentinel-new-refresh"}))).mount(&s).await;
        let home = tempfile::tempdir().unwrap();
        let keyring = FailAppSaveKeyring {
            provider: serde_json::to_string(&stored_token("github-repositories")).unwrap(),
            app: StdMutex::new(Some(
                serde_json::to_string(&stored_app_token("old-access", Some("old-refresh")))
                    .unwrap(),
            )),
        };
        let p = ProviderAuthRequestProcessor::new_with_keyring(
            home.path().into(),
            home.path().into(),
            Arc::new(keyring),
        )
        .with_app_auth_endpoint(s.uri());
        let e = p
            .app_token_exchange(ProviderAuthAppTokenParams {
                provider_id: "github-repositories".into(),
            })
            .await
            .unwrap_err();
        assert!(!e.message.contains("sentinel"));
        assert!(e.message.contains("secure storage"));
        assert_eq!(
            p.load_app_token("github-repositories")
                .unwrap()
                .unwrap()
                .access_token,
            "old-access"
        );
    }
    #[tokio::test]
    async fn app_token_keyring_read_failure_is_reported() {
        let home = tempfile::tempdir().unwrap();
        let keyring = MockKeyringStore::default();
        keyring.set_error(
            APP_TOKEN_KEYRING_ACCOUNT,
            KeyringError::NoStorageAccess(Box::new(std::io::Error::other("denied"))),
        );
        let p = ProviderAuthRequestProcessor::new_with_keyring(
            home.path().into(),
            home.path().into(),
            Arc::new(keyring),
        );
        let e = p
            .app_token_status(ProviderAuthAppTokenParams {
                provider_id: "github-repositories".into(),
            })
            .await
            .unwrap_err();
        assert!(e.message.contains("secure storage"));
    }

    #[tokio::test]
    async fn app_token_rejects_non_repository_provider_before_http() {
        let s = MockServer::start().await;
        for id in ["github-copilot", "other"] {
            let e = github_processor(&s)
                .with_app_auth_endpoint(s.uri())
                .app_token_exchange(ProviderAuthAppTokenParams {
                    provider_id: id.into(),
                })
                .await
                .unwrap_err();
            assert!(e.message.contains("github-repositories"));
        }
        assert!(s.received_requests().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn app_token_status_uses_stable_account_and_rejects_expired_token() {
        let home = tempfile::tempdir().unwrap();
        let keyring = MockKeyringStore::default();
        let mut expired = stored_app_token("access", Some("refresh"));
        expired.expires_at = Some(timestamp_millis() - 1);
        keyring
            .save(
                APP_TOKEN_KEYRING_SERVICE,
                "app-auth/github-repositories",
                &serde_json::to_string(&expired).unwrap(),
            )
            .unwrap();
        let p = ProviderAuthRequestProcessor::new_with_keyring(
            home.path().into(),
            home.path().into(),
            Arc::new(keyring.clone()),
        );
        assert!(
            !p.app_token_status(ProviderAuthAppTokenParams {
                provider_id: "github-repositories".into()
            })
            .await
            .unwrap()
            .authenticated
        );
        let mut future = expired;
        future.expires_at = Some(timestamp_millis() + 60_000);
        keyring
            .save(
                APP_TOKEN_KEYRING_SERVICE,
                "app-auth/github-repositories",
                &serde_json::to_string(&future).unwrap(),
            )
            .unwrap();
        assert!(
            p.app_token_status(ProviderAuthAppTokenParams {
                provider_id: "github-repositories".into()
            })
            .await
            .unwrap()
            .authenticated
        );
    }

    #[tokio::test]
    async fn app_token_exchange_strictly_validates_metadata() {
        for body in [
            serde_json::json!({"access_token":"x","expires_in":0}),
            serde_json::json!({"access_token":"x","account":{"uuid":"","email_address":"e"}}),
            serde_json::json!({"access_token":"x","account":{"uuid":"u","email_address":""}}),
            serde_json::json!({"access_token":"x","organization":{"uuid":""}}),
        ] {
            let s = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(200).set_body_json(body))
                .mount(&s)
                .await;
            assert!(
                github_processor(&s)
                    .with_app_auth_endpoint(s.uri())
                    .app_token_exchange(ProviderAuthAppTokenParams {
                        provider_id: "github-repositories".into()
                    })
                    .await
                    .is_err()
            );
        }
    }

    #[tokio::test]
    async fn app_token_refresh_preserves_missing_account_and_scopes() {
        let s = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"access_token":"new","expires_in":60})),
            )
            .mount(&s)
            .await;
        let p = github_processor(&s).with_app_auth_endpoint(s.uri());
        let mut old = stored_app_token("old", Some("refresh"));
        old.scopes = vec!["old:scope".into()];
        old.account = Some(ProviderAuthAppTokenAccount {
            uuid: "u".into(),
            email_address: "e".into(),
            organization_uuid: Some("o".into()),
        });
        p.save_app_token("github-repositories", &old).unwrap();
        p.app_token_refresh(ProviderAuthAppTokenParams {
            provider_id: "github-repositories".into(),
        })
        .await
        .unwrap();
        let saved = p.load_app_token("github-repositories").unwrap().unwrap();
        assert_eq!(saved.scopes, old.scopes);
        assert_eq!(saved.account, old.account);
    }

    #[tokio::test]
    async fn github_profile_maps_complete_overview() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/graphql")).respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data":{"viewer":{"databaseId":7,"login":"octocat","name":"Octo","avatarUrl":"a","url":"u","bio":"b","company":"c","location":"l","websiteUrl":"w","email":"e","organizations":{"nodes":[{"login":"github","name":"GitHub","avatarUrl":"oa","url":"ou"}]},"followers":{"totalCount":1},"following":{"totalCount":2},"repositories":{"totalCount":3},"starredRepositories":{"totalCount":4},"status":{"emoji":":wave:","message":"hi","indicatesLimitedAvailability":true,"expiresAt":"2030"},"pinnedItems":{"nodes":[{"__typename":"Repository","id":"R","name":"repo","owner":{"login":"octocat"},"url":"r","description":null,"isPrivate":false,"isFork":false,"stargazerCount":5,"forkCount":6,"updatedAt":"now","primaryLanguage":{"name":"Rust","color":"#dea584"}}]},"topRepositories":{"nodes":[]},"contributionsCollection":{"totalCommitContributions":8,"totalIssueContributions":9,"totalPullRequestContributions":10,"totalPullRequestReviewContributions":11,"restrictedContributionsCount":12,"contributionCalendar":{"totalContributions":13,"weeks":[{"contributionDays":[{"date":"2026-01-01","contributionCount":2,"color":"green"}]}]}}}}}))).mount(&server).await;
        let r = github_processor(&server)
            .profile_read(ProviderAuthProfileReadParams {
                provider_id: "github-repositories".into(),
            })
            .await
            .unwrap();
        assert_eq!(r.overview.user.repository_count, 3);
        assert_eq!(r.overview.organizations[0].login, "github");
        assert_eq!(r.overview.pinned_repositories[0].full_name, "octocat/repo");
        assert_eq!(r.overview.contributions.weeks[0].days[0].count, 2)
    }

    #[tokio::test]
    async fn github_status_normalizes_input_and_errors_redact_token() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/graphql")).respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data":{"changeUserStatus":{"status":{"emoji":":wave:","message":"ok","indicatesLimitedAvailability":true,"expiresAt":null}}}}))).mount(&server).await;
        let p = github_processor(&server);
        p.status_set(ProviderAuthStatusSetParams {
            provider_id: "github-repositories".into(),
            emoji: " wave ".into(),
            message: format!("  {}  ", "x".repeat(90)),
            limited_availability: true,
            expires_at: Some("2030-01-01T00:00:00Z".into()),
        })
        .await
        .unwrap();
        let reqs = server.received_requests().await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&reqs[0].body).unwrap();
        assert_eq!(body["variables"]["emoji"], ":wave:");
        assert_eq!(body["variables"]["message"].as_str().unwrap().len(), 80);
        assert_eq!(body["variables"]["limitedAvailability"], true);
        assert_eq!(body["variables"]["expiresAt"], "2030-01-01T00:00:00Z");
        assert_eq!(
            reqs[0]
                .headers
                .get("authorization")
                .unwrap()
                .to_str()
                .unwrap(),
            "Bearer sentinel-github-token"
        );
        drop(reqs);
        server.reset().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                serde_json::json!({"errors":[{"message":"sentinel-github-token denied"}]}),
            ))
            .mount(&server)
            .await;
        let e = p
            .status_clear(ProviderAuthStatusClearParams {
                provider_id: "github-repositories".into(),
            })
            .await
            .unwrap_err();
        assert!(e.message.contains("denied"));
        assert!(!e.message.contains("sentinel-github-token"))
    }

    #[tokio::test]
    async fn github_status_set_preserves_null_status() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/graphql"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(
                    serde_json::json!({"data":{"changeUserStatus":{"status":null}}}),
                ),
            )
            .mount(&server)
            .await;

        let response = github_processor(&server)
            .status_set(ProviderAuthStatusSetParams {
                provider_id: "github-repositories".into(),
                emoji: "wave".into(),
                message: "hello".into(),
                limited_availability: false,
                expires_at: None,
            })
            .await
            .expect("null status is a valid GitHub response");

        assert_eq!(response.status, None);
    }

    #[tokio::test]
    async fn github_rejects_missing_viewer_and_status_payload_fields() {
        for body in [
            serde_json::json!({"data":{"viewer":null}}),
            serde_json::json!({"data":{"viewer":{}}}),
        ] {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(200).set_body_json(body))
                .mount(&server)
                .await;
            assert!(
                github_processor(&server)
                    .profile_read(ProviderAuthProfileReadParams {
                        provider_id: "github-repositories".into()
                    })
                    .await
                    .is_err()
            );
        }
        for (mutation, clear) in [("changeUserStatus", false), ("clearUserStatus", true)] {
            let missing_payload = if clear {
                serde_json::json!({"data":{"clearUserStatus":{}}})
            } else {
                serde_json::json!({"data":{"changeUserStatus":{}}})
            };
            for body in [serde_json::json!({"data":{}}), missing_payload] {
                let server = MockServer::start().await;
                Mock::given(method("POST"))
                    .respond_with(ResponseTemplate::new(200).set_body_json(body))
                    .mount(&server)
                    .await;
                let p = github_processor(&server);
                let result = if clear {
                    p.status_clear(ProviderAuthStatusClearParams {
                        provider_id: "github-repositories".into(),
                    })
                    .await
                    .map(|_| ())
                } else {
                    p.status_set(ProviderAuthStatusSetParams {
                        provider_id: "github-repositories".into(),
                        emoji: "wave".into(),
                        message: "hi".into(),
                        limited_availability: false,
                        expires_at: None,
                    })
                    .await
                    .map(|_| ())
                };
                assert!(result.is_err(), "missing {mutation}.status must fail");
            }
        }
    }

    #[tokio::test]
    async fn github_transport_errors_and_auth_boundary_are_enforced() {
        let server = MockServer::start().await;
        let home = tempfile::tempdir().unwrap();
        let unauthenticated = ProviderAuthRequestProcessor::new_with_keyring(
            home.path().into(),
            home.path().into(),
            Arc::new(MockKeyringStore::default()),
        )
        .with_github_graphql_endpoint(format!("{}/graphql", server.uri()));
        assert!(
            unauthenticated
                .profile_read(ProviderAuthProfileReadParams {
                    provider_id: "github-repositories".into()
                })
                .await
                .is_err()
        );

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(401).set_body_string("sentinel-github-token"))
            .mount(&server)
            .await;
        let error = github_processor(&server)
            .profile_read(ProviderAuthProfileReadParams {
                provider_id: "github-repositories".into(),
            })
            .await
            .unwrap_err();
        assert!(!error.message.contains("sentinel-github-token"));
        server.reset().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_string("not-json"))
            .mount(&server)
            .await;
        assert!(
            github_processor(&server)
                .profile_read(ProviderAuthProfileReadParams {
                    provider_id: "github-repositories".into()
                })
                .await
                .is_err()
        );
        server.reset().await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_delay(Duration::from_millis(100))
                    .set_body_json(serde_json::json!({"data":{}})),
            )
            .mount(&server)
            .await;
        let p = github_processor(&server).with_github_graphql_timeout(Duration::from_millis(5));
        assert!(
            p.profile_read(ProviderAuthProfileReadParams {
                provider_id: "github-repositories".into()
            })
            .await
            .unwrap_err()
            .message
            .contains("request failed")
        );
    }

    #[test]
    fn github_profile_requires_and_maps_organizations_strictly() {
        let profile = serde_json::json!({
            "databaseId":7,"login":"octocat","name":null,"avatarUrl":null,"url":"u","bio":null,"company":null,"location":null,"websiteUrl":null,"email":null,
            "followers":{"totalCount":1},"following":{"totalCount":2},"repositories":{"totalCount":3},"starredRepositories":{"totalCount":4},"status":null,
            "pinnedItems":{"nodes":[]},"topRepositories":{"nodes":[]},
            "contributionsCollection":{"totalCommitContributions":1,"totalIssueContributions":2,"totalPullRequestContributions":3,"totalPullRequestReviewContributions":4,"restrictedContributionsCount":5,"contributionCalendar":{"totalContributions":6,"weeks":[]}}
        });
        assert!(
            map_profile(&profile).is_err(),
            "organizations is queried and required"
        );
        let mut complete = profile.clone();
        complete["organizations"] = serde_json::json!({"nodes":[{"login":"github","name":"GitHub","avatarUrl":"a","url":"https://github.com/github"}]});
        let mapped = map_profile(&complete).unwrap();
        assert_eq!(mapped.organizations[0].login, "github");
        let mut wrong_nodes = complete.clone();
        wrong_nodes["organizations"]["nodes"] = serde_json::json!({});
        assert!(map_profile(&wrong_nodes).is_err());
        let mut missing_login = complete;
        missing_login["organizations"]["nodes"][0]
            .as_object_mut()
            .unwrap()
            .remove("login");
        assert!(map_profile(&missing_login).is_err());
    }

    #[test]
    fn github_nullable_fields_reject_missing_or_wrong_types() {
        let value = serde_json::json!({"emoji":null,"message":"ok","indicatesLimitedAvailability":false,"expiresAt":null});
        assert!(map_status(&value).is_ok());
        let mut missing = value.clone();
        missing.as_object_mut().unwrap().remove("emoji");
        assert!(map_status(&missing).is_err());
        let mut wrong = value;
        wrong["message"] = serde_json::json!(42);
        assert!(map_status(&wrong).is_err());
    }

    #[tokio::test]
    async fn github_status_clear_maps_success_and_http_500_fails() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data":{"clearUserStatus":{"status":{"emoji":":wave:","message":"bye","indicatesLimitedAvailability":true,"expiresAt":"2030"}}}}))).mount(&server).await;
        let status = github_processor(&server)
            .status_clear(ProviderAuthStatusClearParams {
                provider_id: "github-repositories".into(),
            })
            .await
            .unwrap()
            .status
            .unwrap();
        assert_eq!(status.emoji.as_deref(), Some(":wave:"));
        assert_eq!(status.message.as_deref(), Some("bye"));
        assert!(status.indicates_limited_availability);
        assert_eq!(status.expires_at.as_deref(), Some("2030"));
        server.reset().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;
        assert!(
            github_processor(&server)
                .status_clear(ProviderAuthStatusClearParams {
                    provider_id: "github-repositories".into()
                })
                .await
                .unwrap_err()
                .message
                .contains("500")
        );
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
            r#"{"providerApiKeys":{"zhipu":"sentinel-provider-key"},"oauth":{"accessToken":"keep-me"},"other":true}"#,
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

    #[derive(Debug)]
    struct FailingCredentialsWriter {
        kind: std::io::ErrorKind,
        called: AtomicBool,
    }

    impl FailingCredentialsWriter {
        fn new(kind: std::io::ErrorKind) -> Self {
            Self {
                kind,
                called: AtomicBool::new(false),
            }
        }
    }

    impl CredentialsWriter for FailingCredentialsWriter {
        fn write(&self, _path: &Path, _contents: &[u8]) -> std::io::Result<()> {
            self.called.store(true, Ordering::SeqCst);
            Err(std::io::Error::from(self.kind))
        }
    }

    #[tokio::test]
    async fn provider_api_key_migration_keeps_original_bytes_when_writer_is_out_of_space() {
        let home = tempfile::tempdir().expect("temp home");
        let credentials_path = home.path().join(".credentials.json");
        let original = br#"{"oauth":{"accessToken":"keep-me"},"providerApiKeys":{"zhipu":"sentinel-provider-key"}}"#;
        fs::write(&credentials_path, original).expect("legacy credentials");
        let writer = Arc::new(FailingCredentialsWriter::new(
            std::io::ErrorKind::StorageFull,
        ));
        let processor = ProviderAuthRequestProcessor::new_with_keyring_and_writer(
            home.path().to_path_buf(),
            home.path().to_path_buf(),
            Arc::new(MockKeyringStore::default()),
            writer,
        );

        processor
            .migrate_legacy_provider_api_keys()
            .await
            .expect_err("ENOSPC must reach caller");

        assert_eq!(
            fs::read(credentials_path).expect("original credentials"),
            original
        );
    }

    #[tokio::test]
    async fn provider_api_key_migration_keeps_oauth_and_original_when_writer_is_denied() {
        let home = tempfile::tempdir().expect("temp home");
        let credentials_path = home.path().join(".credentials.json");
        let original = br#"{"oauth":{"refreshToken":"keep-me"},"providerApiKeys":{"zhipu":"sentinel-provider-key"},"other":true}"#;
        fs::write(&credentials_path, original).expect("legacy credentials");
        let writer = Arc::new(FailingCredentialsWriter::new(
            std::io::ErrorKind::PermissionDenied,
        ));
        let processor = ProviderAuthRequestProcessor::new_with_keyring_and_writer(
            home.path().to_path_buf(),
            home.path().to_path_buf(),
            Arc::new(MockKeyringStore::default()),
            writer,
        );

        processor
            .migrate_legacy_provider_api_keys()
            .await
            .expect_err("permission failure must reach caller");

        assert_eq!(
            fs::read(credentials_path).expect("original credentials"),
            original
        );
    }

    #[tokio::test]
    async fn provider_api_key_migration_does_not_call_writer_when_keyring_save_fails() {
        let home = tempfile::tempdir().expect("temp home");
        let credentials_path = home.path().join(".credentials.json");
        let original = br#"{"providerApiKeys":{"zhipu":"sentinel-provider-key"},"other":true}"#;
        fs::write(&credentials_path, original).expect("legacy credentials");
        let keyring = MockKeyringStore::default();
        keyring.set_error(
            "providerApiKeys/zhipu",
            KeyringError::NoStorageAccess(Box::new(std::io::Error::other("denied"))),
        );
        let writer = Arc::new(FailingCredentialsWriter::new(
            std::io::ErrorKind::PermissionDenied,
        ));
        let processor = ProviderAuthRequestProcessor::new_with_keyring_and_writer(
            home.path().to_path_buf(),
            home.path().to_path_buf(),
            Arc::new(keyring),
            writer.clone(),
        );

        processor
            .migrate_legacy_provider_api_keys()
            .await
            .expect_err("keyring failure must reach caller");

        assert!(!writer.called.load(Ordering::SeqCst));
        assert_eq!(
            fs::read(credentials_path).expect("original credentials"),
            original
        );
    }

    #[tokio::test]
    async fn provider_api_key_migration_redacts_plaintext_after_secure_save() {
        let home = tempfile::tempdir().expect("temp home");
        let credentials_path = home.path().join(".credentials.json");
        fs::write(
            &credentials_path,
            r#"{"providerApiKeys":{"zhipu":"sentinel-provider-key"},"oauth":{"accessToken":"keep-me"},"other":true}"#,
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
        let redacted: serde_json::Value =
            serde_json::from_str(&redacted).expect("valid redacted credentials");
        assert_eq!(redacted["oauth"]["accessToken"], "keep-me");
        assert_eq!(redacted["other"], true);
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
            _args: &[OsString],
            env: &HashMap<OsString, OsString>,
            target: &Path,
        ) -> std::io::Result<GitCloneOutput> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let askpass = PathBuf::from(env.get(OsStr::new("GIT_ASKPASS")).expect("askpass env"));
            assert!(askpass.exists(), "askpass must exist only while git runs");
            let isolated_home = PathBuf::from(env.get(OsStr::new("HOME")).expect("isolated HOME"));
            assert!(isolated_home.starts_with(askpass.parent().expect("askpass parent")));
            assert_eq!(
                env.get(OsStr::new("USERPROFILE")),
                env.get(OsStr::new("HOME")),
            );
            assert_eq!(
                env.get(OsStr::new("GIT_CONFIG_NOSYSTEM"))
                    .map(OsString::as_os_str),
                Some(OsStr::new("1"))
            );
            assert_eq!(
                env.get(OsStr::new("GIT_CONFIG_COUNT"))
                    .map(OsString::as_os_str),
                Some(OsStr::new("0"))
            );
            assert!(
                Path::new(
                    env.get(OsStr::new("GIT_CONFIG_GLOBAL"))
                        .expect("isolated config"),
                )
                .exists()
            );
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
            args: &[OsString],
            env: &HashMap<OsString, OsString>,
            staging_target: &Path,
        ) -> std::io::Result<GitCloneOutput> {
            assert_eq!(
                args.last().map(OsString::as_os_str),
                Some(staging_target.as_os_str()),
                "staging path must reach git without lossy string conversion",
            );
            let staging_root = staging_target.parent().expect("staging root");
            for key in ["GIT_ASKPASS", "HOME", "USERPROFILE", "GIT_CONFIG_GLOBAL"] {
                let path = PathBuf::from(env.get(OsStr::new(key)).expect("path environment"));
                assert!(
                    path.starts_with(staging_root),
                    "{key} must preserve the exact staging path",
                );
            }
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

    #[tokio::test]
    async fn clone_preserves_unicode_staging_and_environment_paths() {
        let root = tempfile::tempdir().expect("clone root");
        let unicode_root = root.path().join("克隆路径-ß");
        fs::create_dir(&unicode_root).expect("unicode root");
        let target = unicode_root.join("repo");
        let request = validate_github_clone_request(
            "https://github.com/owner/repo.git",
            &target,
            &unicode_root,
        )
        .expect("valid unicode clone request");
        let runner = SuccessfulGitRunner {
            final_target: target.clone(),
            create_concurrent_target: false,
        };

        clone_with_github_token(&request, "sentinel-github-token", &runner)
            .await
            .expect("unicode clone publishes");

        assert_eq!(fs::read(target.join("README.md")).expect("file"), b"cloned");
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
