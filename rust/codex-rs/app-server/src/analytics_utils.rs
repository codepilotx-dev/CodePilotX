use std::sync::Arc;

use codepilotx_analytics::AnalyticsEventsClient;
use codepilotx_core::config::Config;
use codepilotx_login::AuthManager;

pub(crate) fn analytics_events_client_from_config(
    auth_manager: Arc<AuthManager>,
    config: &Config,
) -> AnalyticsEventsClient {
    AnalyticsEventsClient::new(
        auth_manager,
        config.chatgpt_base_url.trim_end_matches('/').to_string(),
        config.analytics_enabled,
    )
}
