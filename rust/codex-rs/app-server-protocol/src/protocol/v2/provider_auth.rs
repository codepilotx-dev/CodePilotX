use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use ts_rs::TS;

//  Provider auth status

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderAuthReadStatusParams {
    pub provider_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderAuthReadStatusResponse {
    pub authenticated: bool,
    pub user: Option<ProviderUserInfo>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderUserInfo {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

//  Device-code login

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderAuthStartLoginParams {
    pub provider_id: String,
    /// GitHub OAuth App client ID (required for `github-repositories`).
    pub client_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderAuthStartLoginResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u32,
    pub interval: u32,
}

//  Poll device-code login

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderAuthPollLoginParams {
    pub provider_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderAuthPollLoginResponse {
    pub status: ProviderAuthPollStatus,
    pub auth: Option<ProviderAuthReadStatusResponse>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
pub enum ProviderAuthPollStatus {
    Pending,
    Completed,
    Expired,
    Denied,
}

//  Cancel / logout

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderAuthCancelLoginParams {
    pub provider_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderAuthCancelLoginResponse {}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderAuthLogoutParams {
    pub provider_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderAuthLogoutResponse {}
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderAuthProfileReadParams {
    #[serde(rename = "providerId")]
    #[ts(rename = "providerId")]
    pub provider_id: String,
}
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderAuthProfileReadResponse {
    pub overview: GithubProfileOverview,
}
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderAuthStatusSetParams {
    #[serde(rename = "providerId")]
    #[ts(rename = "providerId")]
    pub provider_id: String,
    pub emoji: String,
    pub message: String,
    #[serde(rename = "limitedAvailability")]
    #[ts(rename = "limitedAvailability")]
    pub limited_availability: bool,
    #[serde(rename = "expiresAt")]
    #[ts(rename = "expiresAt")]
    pub expires_at: Option<String>,
}
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderAuthStatusSetResponse {
    pub status: Option<GithubUserStatus>,
}
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderAuthStatusClearParams {
    #[serde(rename = "providerId")]
    #[ts(rename = "providerId")]
    pub provider_id: String,
}
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderAuthStatusClearResponse {
    pub status: Option<GithubUserStatus>,
}
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GithubUserStatus {
    pub emoji: Option<String>,
    pub message: Option<String>,
    pub indicates_limited_availability: bool,
    pub expires_at: Option<String>,
}
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GithubProfileUser {
    pub login: String,
    #[ts(type = "number")]
    pub id: i64,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub html_url: String,
    pub bio: Option<String>,
    pub company: Option<String>,
    pub location: Option<String>,
    pub website_url: Option<String>,
    pub email: Option<String>,
    #[ts(type = "number")]
    pub followers: i64,
    #[ts(type = "number")]
    pub following: i64,
    #[ts(type = "number")]
    pub repository_count: i64,
    #[ts(type = "number")]
    pub starred_repository_count: i64,
    pub status: Option<GithubUserStatus>,
}
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct GithubProfileLanguage {
    pub name: String,
    pub color: Option<String>,
}
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GithubProfileOrganization {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub url: String,
}
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GithubProfileRepository {
    pub id: String,
    pub name: String,
    pub full_name: String,
    pub url: String,
    pub description: Option<String>,
    pub is_private: bool,
    pub is_fork: bool,
    pub primary_language: Option<GithubProfileLanguage>,
    #[ts(type = "number")]
    pub stargazer_count: i64,
    #[ts(type = "number")]
    pub fork_count: i64,
    pub updated_at: String,
}
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GithubContributionDay {
    pub date: String,
    #[ts(type = "number")]
    pub count: i64,
    pub color: String,
}
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GithubContributionWeek {
    pub days: Vec<GithubContributionDay>,
}
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GithubContributions {
    #[ts(type = "number")]
    pub total_contributions: i64,
    #[ts(type = "number")]
    pub total_commit_contributions: i64,
    #[ts(type = "number")]
    pub total_issue_contributions: i64,
    #[ts(type = "number")]
    pub total_pull_request_contributions: i64,
    #[ts(type = "number")]
    pub total_pull_request_review_contributions: i64,
    #[ts(type = "number")]
    pub restricted_contributions_count: i64,
    pub weeks: Vec<GithubContributionWeek>,
}
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GithubProfileOverview {
    pub user: GithubProfileUser,
    pub organizations: Vec<GithubProfileOrganization>,
    pub pinned_repositories: Vec<GithubProfileRepository>,
    pub popular_repositories: Vec<GithubProfileRepository>,
    pub contributions: GithubContributions,
}

// Provider API keys (secure storage only)

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderApiKeyReadParams {
    pub provider_ids: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderApiKeyReadResponse {
    pub configured_provider_ids: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderApiKeySaveParams {
    pub provider_id: String,
    pub api_key: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderApiKeySaveResponse {}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderApiKeyDeleteParams {
    pub provider_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderApiKeyDeleteResponse {}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderModelListParams {
    pub provider_id: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub default_models: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderModelListResponse {
    pub models: Vec<String>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderBalanceParams {
    pub provider_id: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderBalanceInfo {
    pub currency: String,
    pub total_balance: String,
    pub granted_balance: String,
    pub topped_up_balance: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderBalanceResponse {
    pub is_available: bool,
    pub balances: Vec<ProviderBalanceInfo>,
    pub error: Option<String>,
}

//  Repository listing

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderRepoListParams {
    pub provider_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderRepoListResponse {
    pub repos: Vec<ProviderRepoInfo>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderRepoInfo {
    pub name: String,
    pub full_name: String,
    pub description: Option<String>,
    pub private: bool,
    pub html_url: String,
    pub clone_url: String,
    pub default_branch: String,
}

//  Repository clone

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderRepoCloneParams {
    pub provider_id: String,
    pub repo_url: String,
    pub local_path: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[ts(export_to = "v2/")]
pub struct ProviderRepoCloneResponse {
    pub local_path: String,
}
