use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

use codepilotx_app_server_protocol::{
    JSONRPCErrorError, ProviderAuthCancelLoginParams, ProviderAuthCancelLoginResponse,
    ProviderAuthLogoutParams, ProviderAuthLogoutResponse, ProviderAuthPollLoginParams,
    ProviderAuthPollLoginResponse, ProviderAuthPollStatus, ProviderAuthReadStatusParams,
    ProviderAuthReadStatusResponse, ProviderAuthStartLoginParams,
    ProviderAuthStartLoginResponse, ProviderRepoCloneParams, ProviderRepoCloneResponse,
    ProviderRepoListParams, ProviderRepoListResponse, ProviderRepoInfo, ProviderUserInfo,
};
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

//  Public processor 

#[derive(Clone)]
pub(crate) struct ProviderAuthRequestProcessor {
    inner: Arc<Mutex<ProviderAuthInner>>,
    config_dir: PathBuf,
}

impl ProviderAuthRequestProcessor {
    pub(crate) fn new(config_dir: PathBuf) -> Self {
        Self {
            inner: Arc::new(Mutex::new(ProviderAuthInner {
                attempts: HashMap::new(),
            })),
            config_dir,
        }
    }

    //  Read status 

    pub(crate) async fn read_status(
        &self,
        params: ProviderAuthReadStatusParams,
    ) -> Result<ProviderAuthReadStatusResponse, JSONRPCErrorError> {
        let stored = self.load_token(&params.provider_id).await;
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
        if params.provider_id != "github-repositories"
            && params.provider_id != "github-copilot"
        {
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
                let stored = self.load_token(&params.provider_id).await;
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
        let token_result =
            github_poll_access_token(&attempt.device_code, client_id).await?;

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
            GithubTokenPollResult::Success { access_token, scope, token_type } => {
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
                self.store_token(&params.provider_id, &stored).await;

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
        let path = self.token_path(&params.provider_id);
        let _ = tokio::fs::remove_file(&path).await;
        Ok(ProviderAuthLogoutResponse {})
    }

    //  List repositories 

    pub(crate) async fn list_repos(
        &self,
        params: ProviderRepoListParams,
    ) -> Result<ProviderRepoListResponse, JSONRPCErrorError> {
        let token = self
            .require_token(&params.provider_id)
            .await?
            .access_token;

        let client = reqwest::Client::new();
        let resp = client
            .get("https://api.github.com/user/repos?per_page=100&sort=updated")
            .header("Accept", "application/vnd.github.v3+json")
            .header("User-Agent", "codepilotx-app-server")
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| {
                internal_error(format!("GitHub API request failed: {e}"))
            })?;

        if !resp.status().is_success() {
            return Err(internal_error(format!(
                "GitHub API returned {}",
                resp.status()
            )));
        }

        let gh_repos: Vec<GithubRepo> = resp.json().await.map_err(|e| {
            internal_error(format!("Failed to parse GitHub response: {e}"))
        })?;

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
        let token = self
            .require_token(&params.provider_id)
            .await?
            .access_token;

        // Use git CLI with a temporary credential helper to avoid exposing
        // the token in the command line or logs.
        let credential_helper = format!("!f() {{ echo \"username=token\"; echo \"password={token}\"; }}; f");

        let output = tokio::process::Command::new("git")
            .args([
                "clone",
                &params.repo_url,
                &params.local_path,
            ])
            .env("GIT_ASKPASS", "echo") // suppresses interactive prompt
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_CREDENTIAL_HELPER", &credential_helper)
            .output()
            .await
            .map_err(|e| internal_error(format!("Failed to spawn git: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(internal_error(format!("Git clone failed: {stderr}")));
        }

        Ok(ProviderRepoCloneResponse {
            local_path: params.local_path,
        })
    }

    //  Copilot token refresh 

    async fn refresh_copilot_token(
        &self,
        github_token: &str,
    ) -> Result<(), JSONRPCErrorError> {
        let client = reqwest::Client::new();
        let resp = client
            .get("https://api.github.com/copilot_internal/v2/token")
            .header("Accept", "application/json")
            .header("User-Agent", "codepilotx-app-server")
            .header("Authorization", format!("Bearer {github_token}"))
            .send()
            .await
            .map_err(|e| {
                internal_error(format!("Copilot token request failed: {e}"))
            })?;

        if !resp.status().is_success() {
            // Copilot token fetch is best-effort during login; user can retry
            return Ok(());
        }

        let copilot_data: serde_json::Value = resp.json().await.map_err(|e| {
            internal_error(format!("Failed to parse Copilot token response: {e}"))
        })?;

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
            self.store_token("github-copilot", &stored).await;
        }

        Ok(())
    }

    //  Token persistence helpers 

    fn token_dir(&self) -> PathBuf {
        self.config_dir.join("provider-auth")
    }

    fn token_path(&self, provider_id: &str) -> PathBuf {
        self.token_dir().join(format!("{provider_id}.json"))
    }

    async fn load_token(&self, provider_id: &str) -> Option<StoredProviderToken> {
        let path = self.token_path(provider_id);
        let data = tokio::fs::read_to_string(&path).await.ok()?;
        serde_json::from_str(&data).ok()
    }

    async fn store_token(
        &self,
        provider_id: &str,
        token: &StoredProviderToken,
    ) {
        let dir = self.token_dir();
        let _ = tokio::fs::create_dir_all(&dir).await;
        let path = self.token_path(provider_id);
        if let Ok(data) = serde_json::to_string_pretty(token) {
            let _ = tokio::fs::write(&path, &data).await;
        }
    }

    async fn require_token(
        &self,
        provider_id: &str,
    ) -> Result<StoredProviderToken, JSONRPCErrorError> {
        self.load_token(provider_id).await.ok_or_else(|| {
            JSONRPCErrorError::invalid_request(format!(
                "Provider '{provider_id}' is not authenticated"
            ))
        })
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
        .form(&[
            ("client_id", client_id),
            ("scope", "repo user"),
        ])
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

    resp.json().await.map_err(|e| {
        internal_error(format!("Failed to parse device code response: {e}"))
    })
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

    let token_resp: GithubAccessTokenResponse = resp.json().await.map_err(|e| {
        internal_error(format!("Failed to parse token response: {e}"))
    })?;

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
                token_type: token_resp.token_type.unwrap_or_else(|| "bearer".to_string()),
            })
        }
    }
}

async fn github_fetch_user(
    access_token: &str,
) -> Result<ProviderUserInfo, JSONRPCErrorError> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/user")
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "codepilotx-app-server")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| internal_error(format!("GitHub user fetch failed: {e}")))?;

    let gh_user: GithubUser = resp.json().await.map_err(|e| {
        internal_error(format!("Failed to parse GitHub user: {e}"))
    })?;

    Ok(ProviderUserInfo {
        login: gh_user.login,
        name: gh_user.name,
        avatar_url: gh_user.avatar_url,
    })
}

//  Helpers 

fn resolve_client_id(
    params: &ProviderAuthStartLoginParams,
) -> Result<String, JSONRPCErrorError> {
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
