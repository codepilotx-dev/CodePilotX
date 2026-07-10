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
    ProviderRepoCloneParams, ProviderRepoCloneResponse, ProviderRepoInfo, ProviderRepoListParams,
    ProviderRepoListResponse, ProviderUserInfo,
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
    keyring: Arc<dyn KeyringStore>,
}

impl ProviderAuthRequestProcessor {
    pub(crate) fn new(config_dir: PathBuf) -> Self {
        Self::new_with_keyring(config_dir, Arc::new(DefaultKeyringStore))
    }

    fn new_with_keyring(config_dir: PathBuf, keyring: Arc<dyn KeyringStore>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(ProviderAuthInner {
                attempts: HashMap::new(),
            })),
            config_dir,
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
            return serde_json::from_str(&data)
                .map(Some)
                .map_err(|error| internal_error(format!("Invalid provider credential: {error}")));
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
            if existing.is_none() {
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
    target_existed: bool,
}

fn validate_github_clone_request(
    repo_url: &str,
    local_path: &Path,
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
    let approved_parent = std::fs::canonicalize(parent).map_err(|error| {
        JSONRPCErrorError::invalid_params(format!(
            "local_path parent is not an accessible approved directory: {error}"
        ))
    })?;
    let target = approved_parent.join(target_name);
    if !target.starts_with(&approved_parent) || target == approved_parent {
        return Err(JSONRPCErrorError::invalid_params(
            "local_path escaped the approved parent directory",
        ));
    }

    let target_existed = match std::fs::symlink_metadata(&target) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(JSONRPCErrorError::invalid_params(
                    "local_path target must be a regular directory",
                ));
            }
            let mut entries = std::fs::read_dir(&target).map_err(|error| {
                JSONRPCErrorError::invalid_params(format!(
                    "local_path target cannot be inspected: {error}"
                ))
            })?;
            if entries
                .next()
                .transpose()
                .map_err(|error| {
                    JSONRPCErrorError::invalid_params(format!(
                        "local_path target cannot be inspected: {error}"
                    ))
                })?
                .is_some()
            {
                return Err(JSONRPCErrorError::invalid_params(
                    "local_path target directory must be empty",
                ));
            }
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => {
            return Err(JSONRPCErrorError::invalid_params(format!(
                "local_path target cannot be inspected: {error}"
            )));
        }
    };

    Ok(ValidatedCloneRequest {
        repo_url: url.to_string(),
        target,
        target_existed,
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
    let askpass_dir = tempfile::Builder::new()
        .prefix("codepilotx-github-")
        .tempdir()
        .map_err(|error| {
            internal_error(format!("Failed to create Git AskPass directory: {error}"))
        })?;
    let askpass_path = askpass_dir.path().join(if cfg!(windows) {
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
        request.target.to_string_lossy().into_owned(),
    ];
    let mut env = minimal_git_environment();
    env.insert(
        "GIT_ASKPASS".to_string(),
        askpass_path.to_string_lossy().into_owned(),
    );
    env.insert("GIT_TERMINAL_PROMPT".to_string(), "0".to_string());
    env.insert("GIT_USERNAME".to_string(), "x-access-token".to_string());
    env.insert("GIT_PASSWORD".to_string(), token.to_string());

    let output = match runner.run(&args, &env, &request.target).await {
        Ok(output) => output,
        Err(error) => {
            cleanup_partial_clone_target(request).await?;
            return Err(internal_error(format!("Failed to spawn git: {error}")));
        }
    };
    if !output.success {
        cleanup_partial_clone_target(request).await?;
        return Err(internal_error(format!(
            "Git clone failed: {}",
            output.stderr
        )));
    }
    Ok(())
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
        "HOME",
        "USERPROFILE",
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

async fn cleanup_partial_clone_target(
    request: &ValidatedCloneRequest,
) -> Result<(), JSONRPCErrorError> {
    match tokio::fs::remove_dir_all(&request.target).await {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(internal_error(format!(
                "Failed to clean partial clone target: {error}"
            )));
        }
    }
    if request.target_existed {
        tokio::fs::create_dir(&request.target)
            .await
            .map_err(|error| {
                internal_error(format!("Failed to restore empty clone target: {error}"))
            })?;
    }
    Ok(())
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
    async fn provider_api_key_write_failure_reaches_rpc_caller() {
        let home = tempfile::tempdir().expect("temp home");
        let keyring = MockKeyringStore::default();
        keyring.set_error(
            "providerApiKeys/zhipu",
            KeyringError::NoStorageAccess(Box::new(std::io::Error::other("denied"))),
        );
        let processor = ProviderAuthRequestProcessor::new_with_keyring(
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
            validate_github_clone_request("git@github.com:owner/repo.git", &valid_target).is_err()
        );
        assert!(
            validate_github_clone_request("https://example.com/owner/repo.git", &valid_target)
                .is_err()
        );
        assert!(
            validate_github_clone_request(
                "https://github.com/owner/repo.git",
                &root.path().join("..").join("repo"),
            )
            .is_err()
        );
    }

    #[derive(Debug, Default)]
    struct FailingGitRunner {
        calls: AtomicUsize,
        askpass_path: StdMutex<Option<PathBuf>>,
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
            *self.askpass_path.lock().expect("askpass lock") = Some(askpass);
            fs::create_dir_all(target.join(".git"))?;
            Ok(GitCloneOutput {
                success: false,
                stderr: "injected clone failure".to_string(),
            })
        }
    }

    #[tokio::test]
    async fn clone_failure_cleans_askpass_and_partial_target() {
        let root = tempfile::tempdir().expect("clone root");
        let target = root.path().join("repo");
        let request = validate_github_clone_request("https://github.com/owner/repo.git", &target)
            .expect("valid clone request");
        let runner = FailingGitRunner::default();

        let error = clone_with_github_token(&request, "sentinel-github-token", &runner)
            .await
            .expect_err("injected clone must fail");

        assert!(error.message.contains("injected clone failure"));
        assert_eq!(runner.calls.load(Ordering::SeqCst), 1);
        assert!(!target.exists(), "partial clone target must be removed");
        let askpass = runner
            .askpass_path
            .lock()
            .expect("askpass lock")
            .clone()
            .expect("captured askpass");
        assert!(!askpass.exists(), "temporary askpass must be removed");
    }
}
