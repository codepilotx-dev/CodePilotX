use codepilotx_core::config::Config;
use codepilotx_extension_api::ExtensionFuture;
use codepilotx_extension_api::ExtensionRegistryBuilder;
use codepilotx_extension_api::McpServerContribution;
use codepilotx_extension_api::McpServerContributionContext;
use codepilotx_extension_api::McpServerContributor;
use codepilotx_mcp::codepilotx_APPS_MCP_SERVER_NAME;
use codepilotx_mcp::hosted_plugin_runtime_mcp_server_config;

mod executor_plugin;

struct HostedPluginRuntimeExtension;

impl McpServerContributor<Config> for HostedPluginRuntimeExtension {
    fn id(&self) -> &'static str {
        "hosted_plugin_runtime"
    }

    fn contribute<'a>(
        &'a self,
        context: McpServerContributionContext<'a, Config>,
    ) -> ExtensionFuture<'a, Vec<McpServerContribution>> {
        Box::pin(async move {
            let config = context.config();
            let name = codepilotx_APPS_MCP_SERVER_NAME.to_string();
            if !config.features.enabled(codepilotx_features::Feature::Apps) {
                return vec![McpServerContribution::Remove { name }];
            }

            vec![McpServerContribution::Set {
                name,
                config: Box::new(hosted_plugin_runtime_mcp_server_config(
                    &config.chatgpt_base_url,
                    config.apps_mcp_product_sku.as_deref(),
                )),
            }]
        })
    }
}

pub fn install(builder: &mut ExtensionRegistryBuilder<Config>) {
    builder.mcp_server_contributor(std::sync::Arc::new(HostedPluginRuntimeExtension));
}

/// Installs discovery for MCP servers declared by thread-selected executor plugins.
pub fn install_executor_plugins(
    builder: &mut ExtensionRegistryBuilder<Config>,
    environment_manager: std::sync::Arc<codepilotx_exec_server::EnvironmentManager>,
) {
    builder.mcp_server_contributor(std::sync::Arc::new(
        executor_plugin::SelectedExecutorPluginMcpContributor::new(environment_manager),
    ));
}

/// Seeds the per-thread snapshot used by selected executor plugin MCP discovery.
pub fn initialize_executor_plugin_thread_data(
    thread_init: &mut codepilotx_extension_api::ExtensionDataInit,
) {
    executor_plugin::seed_thread_state(thread_init);
}
