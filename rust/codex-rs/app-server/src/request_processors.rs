use crate::bespoke_event_handling::apply_bespoke_event_handling;
use crate::bespoke_event_handling::maybe_emit_hook_prompt_item_completed;
use crate::command_exec::CommandExecManager;
use crate::command_exec::StartCommandExecParams;
use crate::config_manager::ConfigManager;
use crate::error_code::INPUT_TOO_LARGE_ERROR_CODE;
use crate::error_code::invalid_params;
use crate::models::supported_models;
use crate::outgoing_message::ConnectionId;
use crate::outgoing_message::ConnectionRequestId;
use crate::outgoing_message::OutgoingMessageSender;
use crate::outgoing_message::RequestContext;
use crate::outgoing_message::ThreadScopedOutgoingMessageSender;
use crate::skills_watcher::SkillsWatcher;
use crate::thread_status::ThreadWatchManager;
use crate::thread_status::resolve_thread_status;
use chrono::Duration as ChronoDuration;
use chrono::SecondsFormat;
use codepilotx_analytics::AnalyticsEventsClient;
use codepilotx_analytics::AnalyticsJsonRpcError;
use codepilotx_analytics::InputError;
use codepilotx_analytics::TurnSteerRequestError;
use codepilotx_app_server_protocol::Account;
use codepilotx_app_server_protocol::AccountLoginCompletedNotification;
use codepilotx_app_server_protocol::AccountTokenUsageDailyBucket;
use codepilotx_app_server_protocol::AccountTokenUsageSummary;
use codepilotx_app_server_protocol::AccountUpdatedNotification;
use codepilotx_app_server_protocol::AddCreditsNudgeCreditType;
use codepilotx_app_server_protocol::AddCreditsNudgeEmailStatus;
use codepilotx_app_server_protocol::AdditionalContextEntry;
use codepilotx_app_server_protocol::AdditionalContextKind;
use codepilotx_app_server_protocol::AppInfo;
use codepilotx_app_server_protocol::AppListUpdatedNotification;
use codepilotx_app_server_protocol::AppSummary;
use codepilotx_app_server_protocol::AppTemplateSummary;
use codepilotx_app_server_protocol::AppTemplateUnavailableReason;
use codepilotx_app_server_protocol::AppsListParams;
use codepilotx_app_server_protocol::AppsListResponse;
use codepilotx_app_server_protocol::AskForApproval;
use codepilotx_app_server_protocol::AuthMode;
use codepilotx_app_server_protocol::CancelLoginAccountParams;
use codepilotx_app_server_protocol::CancelLoginAccountResponse;
use codepilotx_app_server_protocol::CancelLoginAccountStatus;
use codepilotx_app_server_protocol::ClientInfo;
use codepilotx_app_server_protocol::ClientRequest;
use codepilotx_app_server_protocol::ClientResponsePayload;
use codepilotx_app_server_protocol::CodexErrorInfo;
use codepilotx_app_server_protocol::CollaborationModeListParams;
use codepilotx_app_server_protocol::CollaborationModeListResponse;
use codepilotx_app_server_protocol::CommandExecParams;
use codepilotx_app_server_protocol::CommandExecResizeParams;
use codepilotx_app_server_protocol::CommandExecTerminateParams;
use codepilotx_app_server_protocol::CommandExecWriteParams;
use codepilotx_app_server_protocol::ConfigWarningNotification;
use codepilotx_app_server_protocol::ConsumeAccountRateLimitResetCreditOutcome;
use codepilotx_app_server_protocol::ConsumeAccountRateLimitResetCreditParams;
use codepilotx_app_server_protocol::ConsumeAccountRateLimitResetCreditResponse;
use codepilotx_app_server_protocol::ConversationGitInfo;
use codepilotx_app_server_protocol::ConversationSummary;
use codepilotx_app_server_protocol::DynamicToolFunctionSpec;
use codepilotx_app_server_protocol::DynamicToolNamespaceTool;
use codepilotx_app_server_protocol::DynamicToolSpec;
use codepilotx_app_server_protocol::EnvironmentAddParams;
use codepilotx_app_server_protocol::EnvironmentAddResponse;
use codepilotx_app_server_protocol::ExperimentalFeature as ApiExperimentalFeature;
use codepilotx_app_server_protocol::ExperimentalFeatureListParams;
use codepilotx_app_server_protocol::ExperimentalFeatureListResponse;
use codepilotx_app_server_protocol::ExperimentalFeatureStage as ApiExperimentalFeatureStage;
use codepilotx_app_server_protocol::FeedbackUploadParams;
use codepilotx_app_server_protocol::FeedbackUploadResponse;
use codepilotx_app_server_protocol::GetAccountParams;
use codepilotx_app_server_protocol::GetAccountRateLimitsResponse;
use codepilotx_app_server_protocol::GetAccountResponse;
use codepilotx_app_server_protocol::GetAccountTokenUsageResponse;
use codepilotx_app_server_protocol::GetAuthStatusParams;
use codepilotx_app_server_protocol::GetAuthStatusResponse;
use codepilotx_app_server_protocol::GetConversationSummaryParams;
use codepilotx_app_server_protocol::GetConversationSummaryResponse;
use codepilotx_app_server_protocol::GitDiffToRemoteParams;
use codepilotx_app_server_protocol::GitDiffToRemoteResponse;
use codepilotx_app_server_protocol::GitInfo as ApiGitInfo;
use codepilotx_app_server_protocol::HookMetadata;
use codepilotx_app_server_protocol::HooksListParams;
use codepilotx_app_server_protocol::HooksListResponse;
use codepilotx_app_server_protocol::InitializeParams;
use codepilotx_app_server_protocol::InitializeResponse;
use codepilotx_app_server_protocol::JSONRPCErrorError;
use codepilotx_app_server_protocol::ListMcpServerStatusParams;
use codepilotx_app_server_protocol::ListMcpServerStatusResponse;
use codepilotx_app_server_protocol::LoginAccountParams;
use codepilotx_app_server_protocol::LoginAccountResponse;
use codepilotx_app_server_protocol::LoginApiKeyParams;
use codepilotx_app_server_protocol::LogoutAccountResponse;
use codepilotx_app_server_protocol::MarketplaceAddParams;
use codepilotx_app_server_protocol::MarketplaceAddResponse;
use codepilotx_app_server_protocol::MarketplaceInterface;
use codepilotx_app_server_protocol::MarketplaceRemoveParams;
use codepilotx_app_server_protocol::MarketplaceRemoveResponse;
use codepilotx_app_server_protocol::MarketplaceUpgradeErrorInfo;
use codepilotx_app_server_protocol::MarketplaceUpgradeParams;
use codepilotx_app_server_protocol::MarketplaceUpgradeResponse;
use codepilotx_app_server_protocol::McpResourceReadParams;
use codepilotx_app_server_protocol::McpResourceReadResponse;
use codepilotx_app_server_protocol::McpServerOauthLoginCompletedNotification;
use codepilotx_app_server_protocol::McpServerOauthLoginParams;
use codepilotx_app_server_protocol::McpServerOauthLoginResponse;
use codepilotx_app_server_protocol::McpServerRefreshResponse;
use codepilotx_app_server_protocol::McpServerStatus;
use codepilotx_app_server_protocol::McpServerStatusDetail;
use codepilotx_app_server_protocol::McpServerToolCallParams;
use codepilotx_app_server_protocol::McpServerToolCallResponse;
use codepilotx_app_server_protocol::MemoryResetResponse;
use codepilotx_app_server_protocol::MockExperimentalMethodParams;
use codepilotx_app_server_protocol::MockExperimentalMethodResponse;
use codepilotx_app_server_protocol::ModelListParams;
use codepilotx_app_server_protocol::ModelListResponse;
use codepilotx_app_server_protocol::PermissionProfileListParams;
use codepilotx_app_server_protocol::PermissionProfileListResponse;
use codepilotx_app_server_protocol::PermissionProfileSummary;
use codepilotx_app_server_protocol::PluginDetail;
use codepilotx_app_server_protocol::PluginInstallParams;
use codepilotx_app_server_protocol::PluginInstallResponse;
use codepilotx_app_server_protocol::PluginInstalledParams;
use codepilotx_app_server_protocol::PluginInstalledResponse;
use codepilotx_app_server_protocol::PluginInterface;
use codepilotx_app_server_protocol::PluginListMarketplaceKind;
use codepilotx_app_server_protocol::PluginListParams;
use codepilotx_app_server_protocol::PluginListResponse;
use codepilotx_app_server_protocol::PluginMarketplaceEntry;
use codepilotx_app_server_protocol::PluginReadParams;
use codepilotx_app_server_protocol::PluginReadResponse;
use codepilotx_app_server_protocol::PluginShareCheckoutParams;
use codepilotx_app_server_protocol::PluginShareCheckoutResponse;
use codepilotx_app_server_protocol::PluginShareContext;
use codepilotx_app_server_protocol::PluginShareDeleteParams;
use codepilotx_app_server_protocol::PluginShareDeleteResponse;
use codepilotx_app_server_protocol::PluginShareDiscoverability;
use codepilotx_app_server_protocol::PluginShareListItem;
use codepilotx_app_server_protocol::PluginShareListParams;
use codepilotx_app_server_protocol::PluginShareListResponse;
use codepilotx_app_server_protocol::PluginSharePrincipal;
use codepilotx_app_server_protocol::PluginSharePrincipalType;
use codepilotx_app_server_protocol::PluginShareSaveParams;
use codepilotx_app_server_protocol::PluginShareSaveResponse;
use codepilotx_app_server_protocol::PluginShareTarget;
use codepilotx_app_server_protocol::PluginShareUpdateDiscoverability;
use codepilotx_app_server_protocol::PluginShareUpdateTargetsParams;
use codepilotx_app_server_protocol::PluginShareUpdateTargetsResponse;
use codepilotx_app_server_protocol::PluginSkillReadParams;
use codepilotx_app_server_protocol::PluginSkillReadResponse;
use codepilotx_app_server_protocol::PluginSource;
use codepilotx_app_server_protocol::PluginSummary;
use codepilotx_app_server_protocol::PluginUninstallParams;
use codepilotx_app_server_protocol::PluginUninstallResponse;
use codepilotx_app_server_protocol::RateLimitResetCreditsSummary;
use codepilotx_app_server_protocol::RequestId;
use codepilotx_app_server_protocol::ReviewDelivery as ApiReviewDelivery;
use codepilotx_app_server_protocol::ReviewStartParams;
use codepilotx_app_server_protocol::ReviewStartResponse;
use codepilotx_app_server_protocol::ReviewTarget as ApiReviewTarget;
use codepilotx_app_server_protocol::SandboxMode;
use codepilotx_app_server_protocol::SendAddCreditsNudgeEmailParams;
use codepilotx_app_server_protocol::SendAddCreditsNudgeEmailResponse;
use codepilotx_app_server_protocol::ServerNotification;
use codepilotx_app_server_protocol::ServerRequestResolvedNotification;
use codepilotx_app_server_protocol::SkillSummary;
use codepilotx_app_server_protocol::SkillsConfigWriteParams;
use codepilotx_app_server_protocol::SkillsConfigWriteResponse;
use codepilotx_app_server_protocol::SkillsExtraRootsSetParams;
use codepilotx_app_server_protocol::SkillsExtraRootsSetResponse;
use codepilotx_app_server_protocol::SkillsListParams;
use codepilotx_app_server_protocol::SkillsListResponse;
use codepilotx_app_server_protocol::SortDirection;
use codepilotx_app_server_protocol::Thread;
use codepilotx_app_server_protocol::ThreadApproveGuardianDeniedActionParams;
use codepilotx_app_server_protocol::ThreadApproveGuardianDeniedActionResponse;
use codepilotx_app_server_protocol::ThreadArchiveParams;
use codepilotx_app_server_protocol::ThreadArchiveResponse;
use codepilotx_app_server_protocol::ThreadArchivedNotification;
use codepilotx_app_server_protocol::ThreadBackgroundTerminal;
use codepilotx_app_server_protocol::ThreadBackgroundTerminalsCleanParams;
use codepilotx_app_server_protocol::ThreadBackgroundTerminalsCleanResponse;
use codepilotx_app_server_protocol::ThreadBackgroundTerminalsListParams;
use codepilotx_app_server_protocol::ThreadBackgroundTerminalsListResponse;
use codepilotx_app_server_protocol::ThreadBackgroundTerminalsTerminateParams;
use codepilotx_app_server_protocol::ThreadBackgroundTerminalsTerminateResponse;
use codepilotx_app_server_protocol::ThreadClosedNotification;
use codepilotx_app_server_protocol::ThreadCompactStartParams;
use codepilotx_app_server_protocol::ThreadCompactStartResponse;
use codepilotx_app_server_protocol::ThreadDecrementElicitationParams;
use codepilotx_app_server_protocol::ThreadDecrementElicitationResponse;
use codepilotx_app_server_protocol::ThreadDeleteParams;
use codepilotx_app_server_protocol::ThreadDeleteResponse;
use codepilotx_app_server_protocol::ThreadDeletedNotification;
use codepilotx_app_server_protocol::ThreadForkParams;
use codepilotx_app_server_protocol::ThreadForkResponse;
use codepilotx_app_server_protocol::ThreadGoal;
use codepilotx_app_server_protocol::ThreadGoalClearParams;
use codepilotx_app_server_protocol::ThreadGoalClearResponse;
use codepilotx_app_server_protocol::ThreadGoalClearedNotification;
use codepilotx_app_server_protocol::ThreadGoalGetParams;
use codepilotx_app_server_protocol::ThreadGoalGetResponse;
use codepilotx_app_server_protocol::ThreadGoalSetParams;
use codepilotx_app_server_protocol::ThreadGoalSetResponse;
use codepilotx_app_server_protocol::ThreadGoalStatus;
use codepilotx_app_server_protocol::ThreadGoalUpdatedNotification;
use codepilotx_app_server_protocol::ThreadHistoryBuilder;
use codepilotx_app_server_protocol::ThreadIncrementElicitationParams;
use codepilotx_app_server_protocol::ThreadIncrementElicitationResponse;
use codepilotx_app_server_protocol::ThreadInjectItemsParams;
use codepilotx_app_server_protocol::ThreadInjectItemsResponse;
use codepilotx_app_server_protocol::ThreadItem;
use codepilotx_app_server_protocol::ThreadListCwdFilter;
use codepilotx_app_server_protocol::ThreadListParams;
use codepilotx_app_server_protocol::ThreadListResponse;
use codepilotx_app_server_protocol::ThreadLoadedListParams;
use codepilotx_app_server_protocol::ThreadLoadedListResponse;
use codepilotx_app_server_protocol::ThreadMemoryModeSetParams;
use codepilotx_app_server_protocol::ThreadMemoryModeSetResponse;
use codepilotx_app_server_protocol::ThreadMetadataGitInfoUpdateParams;
use codepilotx_app_server_protocol::ThreadMetadataUpdateParams;
use codepilotx_app_server_protocol::ThreadMetadataUpdateResponse;
use codepilotx_app_server_protocol::ThreadNameUpdatedNotification;
use codepilotx_app_server_protocol::ThreadReadParams;
use codepilotx_app_server_protocol::ThreadReadResponse;
use codepilotx_app_server_protocol::ThreadRealtimeAppendAudioParams;
use codepilotx_app_server_protocol::ThreadRealtimeAppendAudioResponse;
use codepilotx_app_server_protocol::ThreadRealtimeAppendSpeechParams;
use codepilotx_app_server_protocol::ThreadRealtimeAppendSpeechResponse;
use codepilotx_app_server_protocol::ThreadRealtimeAppendTextParams;
use codepilotx_app_server_protocol::ThreadRealtimeAppendTextResponse;
use codepilotx_app_server_protocol::ThreadRealtimeListVoicesResponse;
use codepilotx_app_server_protocol::ThreadRealtimeStartParams;
use codepilotx_app_server_protocol::ThreadRealtimeStartResponse;
use codepilotx_app_server_protocol::ThreadRealtimeStartTransport;
use codepilotx_app_server_protocol::ThreadRealtimeStopParams;
use codepilotx_app_server_protocol::ThreadRealtimeStopResponse;
use codepilotx_app_server_protocol::ThreadResumeInitialTurnsPageParams;
use codepilotx_app_server_protocol::ThreadResumeParams;
use codepilotx_app_server_protocol::ThreadResumeResponse;
use codepilotx_app_server_protocol::ThreadRollbackParams;
use codepilotx_app_server_protocol::ThreadSearchParams;
use codepilotx_app_server_protocol::ThreadSearchResponse;
use codepilotx_app_server_protocol::ThreadSearchResult;
use codepilotx_app_server_protocol::ThreadSetNameParams;
use codepilotx_app_server_protocol::ThreadSetNameResponse;
use codepilotx_app_server_protocol::ThreadSettings;
use codepilotx_app_server_protocol::ThreadSettingsUpdateParams;
use codepilotx_app_server_protocol::ThreadSettingsUpdateResponse;
use codepilotx_app_server_protocol::ThreadShellCommandParams;
use codepilotx_app_server_protocol::ThreadShellCommandResponse;
use codepilotx_app_server_protocol::ThreadSortKey;
use codepilotx_app_server_protocol::ThreadSourceKind;
use codepilotx_app_server_protocol::ThreadStartParams;
use codepilotx_app_server_protocol::ThreadStartResponse;
use codepilotx_app_server_protocol::ThreadStartedNotification;
use codepilotx_app_server_protocol::ThreadStatus;
use codepilotx_app_server_protocol::ThreadTurnsItemsListParams;
use codepilotx_app_server_protocol::ThreadTurnsListParams;
use codepilotx_app_server_protocol::ThreadTurnsListResponse;
use codepilotx_app_server_protocol::ThreadUnarchiveParams;
use codepilotx_app_server_protocol::ThreadUnarchiveResponse;
use codepilotx_app_server_protocol::ThreadUnarchivedNotification;
use codepilotx_app_server_protocol::ThreadUnsubscribeParams;
use codepilotx_app_server_protocol::ThreadUnsubscribeResponse;
use codepilotx_app_server_protocol::ThreadUnsubscribeStatus;
use codepilotx_app_server_protocol::Turn;
use codepilotx_app_server_protocol::TurnEnvironmentParams;
use codepilotx_app_server_protocol::TurnError;
use codepilotx_app_server_protocol::TurnInterruptParams;
use codepilotx_app_server_protocol::TurnInterruptResponse;
use codepilotx_app_server_protocol::TurnItemsView;
use codepilotx_app_server_protocol::TurnStartParams;
use codepilotx_app_server_protocol::TurnStartResponse;
use codepilotx_app_server_protocol::TurnStatus;
use codepilotx_app_server_protocol::TurnSteerParams;
use codepilotx_app_server_protocol::TurnSteerResponse;
use codepilotx_app_server_protocol::UserInput as V2UserInput;
use codepilotx_app_server_protocol::WindowsSandboxReadiness;
use codepilotx_app_server_protocol::WindowsSandboxReadinessResponse;
use codepilotx_app_server_protocol::WindowsSandboxSetupCompletedNotification;
use codepilotx_app_server_protocol::WindowsSandboxSetupMode;
use codepilotx_app_server_protocol::WindowsSandboxSetupStartParams;
use codepilotx_app_server_protocol::WindowsSandboxSetupStartResponse;
use codepilotx_arg0::Arg0DispatchPaths;
use codepilotx_backend_client::AddCreditsNudgeCreditType as BackendAddCreditsNudgeCreditType;
use codepilotx_backend_client::Client as BackendClient;
use codepilotx_backend_client::ConsumeRateLimitResetCreditCode as BackendConsumeRateLimitResetCreditCode;
use codepilotx_backend_client::TokenUsageProfile;
use codepilotx_chatgpt::connectors;
use codepilotx_chatgpt::workspace_settings;
use codepilotx_config::CloudConfigBundleLoadError;
use codepilotx_config::CloudConfigBundleLoadErrorCode;
use codepilotx_config::ConfigLayerStack;
use codepilotx_config::loader::project_trust_key;
use codepilotx_config::types::McpServerTransportConfig;
use codepilotx_core::CodexThread;
use codepilotx_core::CodexThreadSettingsOverrides;
use codepilotx_core::ForkSnapshot;
use codepilotx_core::McpManager;
use codepilotx_core::NewThread;
#[cfg(test)]
use codepilotx_core::SessionMeta;
use codepilotx_core::StartThreadOptions;
use codepilotx_core::SteerInputError;
use codepilotx_core::ThreadConfigSnapshot;
use codepilotx_core::ThreadManager;
use codepilotx_core::config::Config;
use codepilotx_core::config::ConfigOverrides;
use codepilotx_core::config::NetworkProxyAuditMetadata;
use codepilotx_core::config::edit::ConfigEdit;
use codepilotx_core::config::edit::ConfigEditsBuilder;
use codepilotx_core::connectors::AccessibleConnectorsStatus;
use codepilotx_core::exec::ExecCapturePolicy;
use codepilotx_core::exec::ExecExpiration;
use codepilotx_core::exec::ExecParams;
use codepilotx_core::exec_env::create_env;
use codepilotx_core::path_utils;
#[cfg(test)]
use codepilotx_core::read_head_for_summary;
use codepilotx_core::sandboxing::SandboxPermissions;
use codepilotx_core::windows_sandbox::WindowsSandboxLevelExt;
use codepilotx_core::windows_sandbox::WindowsSandboxSetupMode as CoreWindowsSandboxSetupMode;
use codepilotx_core::windows_sandbox::WindowsSandboxSetupRequest;
use codepilotx_core::windows_sandbox::sandbox_setup_is_complete;
use codepilotx_core_plugins::PluginInstallError as CorePluginInstallError;
use codepilotx_core_plugins::PluginInstallRequest;
use codepilotx_core_plugins::PluginReadRequest;
use codepilotx_core_plugins::PluginUninstallError as CorePluginUninstallError;
use codepilotx_core_plugins::PluginsManager;
use codepilotx_core_plugins::loader::load_plugin_apps;
use codepilotx_core_plugins::loader::load_plugin_mcp_servers;
use codepilotx_core_plugins::loader::plugin_telemetry_metadata_from_root;
use codepilotx_core_plugins::manifest::PluginManifestInterface;
use codepilotx_core_plugins::marketplace::MarketplaceError;
use codepilotx_core_plugins::marketplace::MarketplacePluginSource;
use codepilotx_core_plugins::marketplace_add::MarketplaceAddError;
use codepilotx_core_plugins::marketplace_add::MarketplaceAddRequest;
use codepilotx_core_plugins::marketplace_add::add_marketplace as add_marketplace_to_codepilotx_home;
use codepilotx_core_plugins::marketplace_remove::MarketplaceRemoveError;
use codepilotx_core_plugins::marketplace_remove::MarketplaceRemoveRequest as CoreMarketplaceRemoveRequest;
use codepilotx_core_plugins::marketplace_remove::remove_marketplace;
use codepilotx_core_plugins::remote::RemoteMarketplace;
use codepilotx_core_plugins::remote::RemoteMarketplaceSource;
use codepilotx_core_plugins::remote::RemotePluginCatalogError;
use codepilotx_core_plugins::remote::RemotePluginDetail as RemoteCatalogPluginDetail;
use codepilotx_core_plugins::remote::RemotePluginServiceConfig;
use codepilotx_core_plugins::remote::RemotePluginShareContext as RemoteCatalogPluginShareContext;
use codepilotx_core_plugins::remote::RemotePluginShareSummary as RemoteCatalogPluginShareSummary;
use codepilotx_core_plugins::remote::RemotePluginSummary as RemoteCatalogPluginSummary;
use codepilotx_exec_server::EnvironmentManager;
use codepilotx_exec_server::LOCAL_ENVIRONMENT_ID;
use codepilotx_exec_server::LOCAL_FS;
use codepilotx_features::FEATURES;
use codepilotx_features::Feature;
use codepilotx_features::Stage;
use codepilotx_feedback::CodexFeedback;
use codepilotx_feedback::FeedbackAttachmentPath;
use codepilotx_feedback::FeedbackUploadOptions;
use codepilotx_git_utils::git_diff_to_remote;
use codepilotx_git_utils::resolve_root_git_project_for_trust;
use codepilotx_login::AuthManager;
use codepilotx_login::CodexAuth;
use codepilotx_login::ServerOptions as LoginServerOptions;
use codepilotx_login::ShutdownHandle;
use codepilotx_login::auth::login_with_chatgpt_auth_tokens;
use codepilotx_login::complete_device_code_login;
use codepilotx_login::login_with_api_key;
use codepilotx_login::oauth_client_id;
use codepilotx_login::request_device_code;
use codepilotx_login::run_login_server;
use codepilotx_mcp::McpRuntimeContext;
use codepilotx_mcp::McpServerStatusSnapshot;
use codepilotx_mcp::McpSnapshotDetail;
use codepilotx_mcp::collect_mcp_server_status_snapshot_with_detail;
use codepilotx_mcp::discover_supported_scopes;
use codepilotx_mcp::read_mcp_resource as read_mcp_resource_without_thread;
use codepilotx_mcp::resolve_oauth_scopes;
use codepilotx_memories_write::clear_memory_roots_contents;
use codepilotx_model_provider::create_model_provider;
use codepilotx_models_manager::collaboration_mode_presets::builtin_collaboration_mode_presets;
use codepilotx_protocol::ThreadId;
use codepilotx_protocol::config_types::CollaborationMode;
use codepilotx_protocol::config_types::ForcedLoginMethod;
use codepilotx_protocol::config_types::Personality;
use codepilotx_protocol::config_types::ReasoningSummary;
use codepilotx_protocol::config_types::TrustLevel;
use codepilotx_protocol::config_types::WindowsSandboxLevel;
use codepilotx_protocol::error::CodexErr;
use codepilotx_protocol::error::Result as CodexResult;
#[cfg(test)]
use codepilotx_protocol::items::TurnItem;
use codepilotx_protocol::models::BUILT_IN_PERMISSION_PROFILE_DANGER_FULL_ACCESS;
use codepilotx_protocol::models::BUILT_IN_PERMISSION_PROFILE_READ_ONLY;
use codepilotx_protocol::models::BUILT_IN_PERMISSION_PROFILE_WORKSPACE;
use codepilotx_protocol::models::ResponseItem;
use codepilotx_protocol::openai_models::ReasoningEffort;
#[cfg(test)]
use codepilotx_protocol::permissions::FileSystemSandboxPolicy;
use codepilotx_protocol::protocol::AgentStatus;
use codepilotx_protocol::protocol::ConversationAudioParams;
use codepilotx_protocol::protocol::ConversationSpeechParams;
use codepilotx_protocol::protocol::ConversationStartParams;
use codepilotx_protocol::protocol::ConversationStartTransport;
use codepilotx_protocol::protocol::ConversationTextParams;
use codepilotx_protocol::protocol::EventMsg;
#[cfg(test)]
use codepilotx_protocol::protocol::GitInfo as CoreGitInfo;
use codepilotx_protocol::protocol::InitialHistory;
use codepilotx_protocol::protocol::McpAuthStatus as CoreMcpAuthStatus;
use codepilotx_protocol::protocol::Op;
use codepilotx_protocol::protocol::RealtimeVoicesList;
use codepilotx_protocol::protocol::ResumedHistory;
use codepilotx_protocol::protocol::ReviewDelivery as CoreReviewDelivery;
use codepilotx_protocol::protocol::ReviewRequest;
use codepilotx_protocol::protocol::ReviewTarget as CoreReviewTarget;
use codepilotx_protocol::protocol::RolloutItem;
use codepilotx_protocol::protocol::SessionConfiguredEvent;
#[cfg(test)]
use codepilotx_protocol::protocol::SessionMetaLine;
use codepilotx_protocol::protocol::TurnEnvironmentSelection;
use codepilotx_protocol::protocol::TurnEnvironmentSelections;
use codepilotx_protocol::protocol::USER_MESSAGE_BEGIN;
use codepilotx_protocol::protocol::W3cTraceContext;
use codepilotx_protocol::user_input::MAX_USER_INPUT_TEXT_CHARS;
use codepilotx_protocol::user_input::UserInput as CoreInputItem;
use codepilotx_rmcp_client::perform_oauth_login_return_url;
use codepilotx_rollout::is_persisted_rollout_item;
use codepilotx_rollout::state_db::StateDbHandle;
use codepilotx_rollout::state_db::reconcile_rollout;
use codepilotx_state::ThreadMetadata;
use codepilotx_state::log_db::LogDbLayer;
use codepilotx_thread_store::ArchiveThreadParams as StoreArchiveThreadParams;
use codepilotx_thread_store::DeleteThreadParams as StoreDeleteThreadParams;
use codepilotx_thread_store::GitInfoPatch as StoreGitInfoPatch;
use codepilotx_thread_store::ListThreadsParams as StoreListThreadsParams;
use codepilotx_thread_store::LocalThreadStore;
use codepilotx_thread_store::ReadThreadByRolloutPathParams as StoreReadThreadByRolloutPathParams;
use codepilotx_thread_store::ReadThreadParams as StoreReadThreadParams;
use codepilotx_thread_store::SearchThreadsParams as StoreSearchThreadsParams;
use codepilotx_thread_store::SortDirection as StoreSortDirection;
use codepilotx_thread_store::StoredThread;
use codepilotx_thread_store::ThreadMetadataPatch as StoreThreadMetadataPatch;
use codepilotx_thread_store::ThreadSortKey as StoreThreadSortKey;
use codepilotx_thread_store::ThreadStore;
use codepilotx_thread_store::ThreadStoreError;
use codepilotx_utils_absolute_path::AbsolutePathBuf;
use codepilotx_utils_pty::DEFAULT_OUTPUT_BYTES_CAP;
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::collections::HashSet;
use std::io::Error as IoError;
use std::path::Path;
use std::path::PathBuf;
use std::result::Result;
use std::sync::Arc;
use std::time::Duration;
use std::time::Instant;
use tokio::sync::Mutex;
use tokio::sync::Semaphore;
use tokio::sync::SemaphorePermit;
use tokio::sync::broadcast;
use tokio::sync::oneshot;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;
use tokio_util::sync::DropGuard;
use tokio_util::task::TaskTracker;
use toml::Value as TomlValue;
use tracing::Instrument;
use tracing::error;
use tracing::info;
use tracing::warn;
use uuid::Uuid;

#[cfg(test)]
use codepilotx_app_server_protocol::ServerRequest;

mod account_processor;
mod apps_processor;
mod catalog_processor;
mod command_exec_processor;
mod config_processor;
mod environment_processor;
mod external_agent_config_processor;
mod external_agent_session_import;
mod feedback_doctor_report;
mod feedback_processor;
mod fs_processor;
mod git_processor;
mod initialize_processor;
mod marketplace_processor;
mod mcp_processor;
mod plugins;
mod process_exec_processor;
mod provider_auth_processor;
mod remote_control_processor;
mod search;
mod thread_processor;
mod token_usage_replay;
mod turn_processor;
mod windows_sandbox_processor;

pub(crate) use account_processor::AccountRequestProcessor;
pub(crate) use apps_processor::AppsRequestProcessor;
pub(crate) use catalog_processor::CatalogRequestProcessor;
pub(crate) use command_exec_processor::CommandExecRequestProcessor;
pub(crate) use config_processor::ConfigRequestProcessor;
pub(crate) use environment_processor::EnvironmentRequestProcessor;
pub(crate) use external_agent_config_processor::ExternalAgentConfigRequestProcessor;
pub(crate) use external_agent_config_processor::ExternalAgentConfigRequestProcessorArgs;
pub(crate) use feedback_processor::FeedbackRequestProcessor;
pub(crate) use fs_processor::FsRequestProcessor;
pub(crate) use git_processor::GitRequestProcessor;
pub(crate) use initialize_processor::InitializeRequestProcessor;
pub(crate) use marketplace_processor::MarketplaceRequestProcessor;
pub(crate) use mcp_processor::McpRequestProcessor;
pub(crate) use plugins::PluginRequestProcessor;
pub(crate) use process_exec_processor::ProcessExecRequestProcessor;
pub(crate) use remote_control_processor::RemoteControlRequestProcessor;
pub(crate) use search::SearchRequestProcessor;
pub(crate) use thread_goal_processor::ThreadGoalRequestProcessor;
pub(crate) use thread_processor::ThreadRequestProcessor;
pub(crate) use turn_processor::TurnRequestProcessor;
pub(crate) use windows_sandbox_processor::WindowsSandboxRequestProcessor;

use crate::error_code::internal_error;
use crate::error_code::invalid_request;
use crate::filters::compute_source_filters;
use crate::filters::source_kind_matches;
use crate::thread_state::ConnectionCapabilities;
use crate::thread_state::ThreadListenerCommand;
use crate::thread_state::ThreadState;
use crate::thread_state::ThreadStateManager;
use token_usage_replay::latest_token_usage_turn_id_from_rollout_items;
use token_usage_replay::send_thread_token_usage_update_to_connection;

fn resolve_request_cwd(cwd: Option<PathBuf>) -> Result<Option<AbsolutePathBuf>, JSONRPCErrorError> {
    cwd.map(|cwd| {
        AbsolutePathBuf::relative_to_current_dir(path_utils::normalize_for_native_workdir(cwd))
            .map_err(|err| invalid_request(format!("invalid cwd: {err}")))
    })
    .transpose()
}

fn resolve_turn_environment_selections(
    thread_manager: &ThreadManager,
    environments: Option<Vec<TurnEnvironmentParams>>,
) -> Result<Option<Vec<TurnEnvironmentSelection>>, JSONRPCErrorError> {
    let Some(environments) = environments else {
        return Ok(None);
    };
    let mut selections = Vec::with_capacity(environments.len());
    for environment in environments {
        let environment_id = environment.environment_id;
        let cwd = environment
            .cwd
            .to_inferred_path_uri()
            .ok_or_else(|| {
                invalid_request(format!(
                    "invalid cwd for environment `{environment_id}`: path `{}` does not use absolute POSIX or Windows path syntax",
                    environment.cwd
                ))
            })?;
        selections.push(TurnEnvironmentSelection {
            environment_id,
            cwd,
        });
    }
    thread_manager
        .validate_environment_selections(&selections)
        .map_err(environment_selection_error)?;
    Ok(Some(selections))
}

fn resolve_runtime_workspace_roots(workspace_roots: Vec<AbsolutePathBuf>) -> Vec<AbsolutePathBuf> {
    let mut resolved_roots = Vec::new();
    for root in workspace_roots {
        if !resolved_roots.iter().any(|existing| existing == &root) {
            resolved_roots.push(root);
        }
    }
    resolved_roots
}

mod config_errors;
mod request_errors;
mod thread_delete;
mod thread_goal_processor;
mod thread_lifecycle;
mod thread_resume_redaction;
mod thread_summary;

use self::config_errors::*;
use self::request_errors::*;
use self::thread_goal_processor::api_thread_goal_from_state;
use self::thread_lifecycle::*;
use self::thread_resume_redaction::*;
use self::thread_summary::*;

pub(crate) use self::thread_lifecycle::populate_thread_turns_from_history;
pub(crate) use self::thread_processor::thread_from_stored_thread;
#[cfg(test)]
pub(crate) use self::thread_summary::read_summary_from_rollout;
#[cfg(test)]
pub(crate) use self::thread_summary::summary_to_thread;
pub(crate) use self::thread_summary::thread_settings_from_config_snapshot;
pub(crate) use self::thread_summary::thread_settings_from_core_snapshot;

pub(crate) fn build_api_turns_from_rollout_items(items: &[RolloutItem]) -> Vec<Turn> {
    let mut builder = ThreadHistoryBuilder::new();
    for item in items {
        if is_persisted_rollout_item(item) {
            builder.handle_rollout_item(item);
        }
    }
    builder.finish()
}
