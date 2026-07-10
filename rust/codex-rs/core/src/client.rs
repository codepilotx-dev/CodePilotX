//! Session- and turn-scoped helpers for talking to model provider APIs.
//!
//! `ModelClient` is intended to live for the lifetime of a Codex session and holds the stable
//! configuration and state needed to talk to a provider (auth, provider selection, conversation id,
//! and transport fallback state).
//!
//! Per-turn settings (model selection, reasoning controls, telemetry context, and turn metadata)
//! are passed explicitly to streaming and unary methods so that the turn lifetime is visible at the
//! call site.
//!
//! A [`ModelClientSession`] is created per turn and is used to stream one or more Responses API
//! requests during that turn. It caches a Responses WebSocket connection (opened lazily) and stores
//! per-turn state such as the `x-codex-turn-state` token used for sticky routing.
//!
//! WebSocket prewarm is a v2-only `response.create` with `generate=false`; it waits for completion
//! so the next request can reuse the same connection and `previous_response_id`.
//!
//! Turn execution performs prewarm as a best-effort step before the first stream request so the
//! subsequent request can reuse the same connection.
//!
//! ## Retry-Budget Tradeoff
//!
//! WebSocket prewarm is treated as the first websocket connection attempt for a turn. If it
//! fails, normal stream retry/fallback logic handles recovery on the same turn.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::sync::OnceLock;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;

use codepilotx_api::ApiError;
use codepilotx_api::AuthProvider;
use codepilotx_api::CompactClient as ApiCompactClient;
use codepilotx_api::CompactionInput as ApiCompactionInput;
use codepilotx_api::Compression;
use codepilotx_api::MemoriesClient as ApiMemoriesClient;
use codepilotx_api::MemorySummarizeInput as ApiMemorySummarizeInput;
use codepilotx_api::MemorySummarizeOutput as ApiMemorySummarizeOutput;
use codepilotx_api::Provider as ApiProvider;
use codepilotx_api::RawMemory as ApiRawMemory;
use codepilotx_api::RealtimeCallClient as ApiRealtimeCallClient;
use codepilotx_api::RealtimeSessionConfig as ApiRealtimeSessionConfig;
use codepilotx_api::Reasoning;
use codepilotx_api::ReasoningContext;
use codepilotx_api::RequestTelemetry;
use codepilotx_api::ReqwestTransport;
use codepilotx_api::ResponseCreateWsRequest;
use codepilotx_api::ResponsesApiRequest;
use codepilotx_api::ResponsesClient as ApiResponsesClient;
use codepilotx_api::ResponsesOptions as ApiResponsesOptions;
use codepilotx_api::ResponsesWebsocketClient as ApiWebSocketResponsesClient;
use codepilotx_api::ResponsesWebsocketConnection as ApiWebSocketConnection;
use codepilotx_api::ResponsesWsRequest;
use codepilotx_api::SharedAuthProvider;
use codepilotx_api::SseTelemetry;
use codepilotx_api::TransportError;
use codepilotx_api::WebsocketTelemetry;
use codepilotx_api::auth_header_telemetry;
use codepilotx_api::build_session_headers;
use codepilotx_api::create_text_param_for_request;
use codepilotx_api::response_create_client_metadata;
use codepilotx_app_server_protocol::AuthMode;
use codepilotx_login::AuthManager;
use codepilotx_login::CodexAuth;
use codepilotx_login::RefreshTokenError;
use codepilotx_login::UnauthorizedRecovery;
use codepilotx_login::default_client::build_reqwest_client;
use codepilotx_otel::SessionTelemetry;
use codepilotx_otel::current_span_w3c_trace_context;

use codepilotx_protocol::ThreadId;
use codepilotx_protocol::config_types::ReasoningSummary as ReasoningSummaryConfig;
use codepilotx_protocol::config_types::Verbosity as VerbosityConfig;
use codepilotx_protocol::models::ContentItem;
use codepilotx_protocol::models::ResponseItem;
use codepilotx_protocol::openai_models::ModelInfo;
use codepilotx_protocol::openai_models::ReasoningEffort as ReasoningEffortConfig;
use codepilotx_protocol::protocol::InternalSessionSource;
use codepilotx_protocol::protocol::SessionSource;
use codepilotx_protocol::protocol::TokenUsage;
use codepilotx_protocol::protocol::W3cTraceContext;
use codepilotx_rollout_trace::CompactionTraceContext;
use codepilotx_rollout_trace::InferenceTraceAttempt;
use codepilotx_rollout_trace::InferenceTraceContext;
use codepilotx_tools::ToolSpec;
use codepilotx_tools::create_tools_json_for_responses_api;
use eventsource_stream::Event;
use eventsource_stream::EventStreamError;
use eventsource_stream::Eventsource;
use futures::Stream;
use futures::StreamExt;
use http::HeaderMap as ApiHeaderMap;
use http::HeaderName;
use http::HeaderValue;
use http::StatusCode as HttpStatusCode;
use reqwest::StatusCode;
use serde::Deserialize;
use serde::Serialize;
use std::time::Duration;
use std::time::Instant;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio::sync::oneshot::error::TryRecvError;
use tokio_tungstenite::tungstenite::Error;
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;
use tracing::instrument;
use tracing::trace;
use tracing::warn;

use crate::attestation::AttestationContext;
use crate::attestation::AttestationProvider;
use crate::attestation::X_OAI_ATTESTATION_HEADER;
use crate::client_common::Prompt;
use crate::client_common::ResponseEvent;
use crate::client_common::ResponseStream;
use crate::feedback_tags;
use crate::responses_metadata::CodexResponsesMetadata;
use crate::responses_metadata::subagent_header_value;
use crate::util::emit_feedback_auth_recovery_tags;
use codepilotx_api::map_api_error;
use codepilotx_feedback::FeedbackRequestTags;
use codepilotx_feedback::emit_feedback_request_tags_with_auth_env;
use codepilotx_login::auth_env_telemetry::AuthEnvTelemetry;
use codepilotx_login::auth_env_telemetry::collect_auth_env_telemetry;
use codepilotx_model_provider::SharedModelProvider;
use codepilotx_model_provider::create_model_provider;
#[cfg(test)]
use codepilotx_model_provider_info::DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS;
use codepilotx_model_provider_info::ModelProviderInfo;
use codepilotx_model_provider_info::WireApi;
use codepilotx_protocol::error::CodexErr;
use codepilotx_protocol::error::Result;
use codepilotx_response_debug_context::extract_response_debug_context;
use codepilotx_response_debug_context::extract_response_debug_context_from_api_error;
use codepilotx_response_debug_context::telemetry_api_error_message;
use codepilotx_response_debug_context::telemetry_transport_error_message;

pub const OPENAI_BETA_HEADER: &str = "OpenAI-Beta";
pub const X_codepilotx_INSTALLATION_ID_HEADER: &str = "x-codex-installation-id";
pub const X_codepilotx_TURN_STATE_HEADER: &str = "x-codex-turn-state";
pub const X_codepilotx_TURN_METADATA_HEADER: &str = "x-codex-turn-metadata";
pub const X_codepilotx_PARENT_THREAD_ID_HEADER: &str = "x-codex-parent-thread-id";
pub const X_codepilotx_WINDOW_ID_HEADER: &str = "x-codex-window-id";
pub const X_OPENAI_MEMGEN_REQUEST_HEADER: &str = "x-openai-memgen-request";
pub const X_OPENAI_SUBAGENT_HEADER: &str = "x-openai-subagent";
pub const X_RESPONSESAPI_INCLUDE_TIMING_METRICS_HEADER: &str =
    "x-responsesapi-include-timing-metrics";
const X_codepilotx_WS_STREAM_REQUEST_START_MS_CLIENT_METADATA_KEY: &str =
    "x-codex-ws-stream-request-start-ms";
const WS_REQUEST_HEADER_RESPONSES_LITE_CLIENT_METADATA_KEY: &str =
    "ws_request_header_x_openai_internal_codepilotx_responses_lite";
const RESPONSES_WEBSOCKETS_V2_BETA_HEADER_VALUE: &str = "responses_websockets=2026-02-06";
const X_OPENAI_INTERNAL_codepilotx_RESPONSES_LITE_HEADER: &str =
    "x-openai-internal-codex-responses-lite";
const RESPONSES_ENDPOINT: &str = "/responses";
const ANTHROPIC_MESSAGES_ENDPOINT: &str = "/messages";
const CHAT_COMPLETIONS_ENDPOINT: &str = "/chat/completions";
const ANTHROPIC_VERSION_HEADER: &str = "anthropic-version";
const ANTHROPIC_VERSION_VALUE: &str = "2023-06-01";
const RESPONSES_COMPACT_ENDPOINT: &str = "/responses/compact";
// `/responses/compact` is unary, so the timeout covers the full response rather than one idle
// period between stream events.
const COMPACT_REQUEST_TIMEOUT_IDLE_MULTIPLIER: u32 = 4;
const MEMORIES_SUMMARIZE_ENDPOINT: &str = "/memories/trace_summarize";
#[cfg(test)]
pub(crate) const WEBSOCKET_CONNECT_TIMEOUT: Duration =
    Duration::from_millis(DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS);

pub(crate) struct CompactConversationRequestSettings {
    pub(crate) effort: Option<ReasoningEffortConfig>,
    pub(crate) summary: ReasoningSummaryConfig,
    pub(crate) service_tier: Option<String>,
}

/// Session-scoped state shared by all [`ModelClient`] clones.
///
/// This is intentionally kept minimal so `ModelClient` does not need to hold a full `Config`. Most
/// configuration is per turn and is passed explicitly to streaming/unary methods.
#[derive(Debug)]
struct ModelClientState {
    thread_id: ThreadId,
    provider: SharedModelProvider,
    auth_env_telemetry: AuthEnvTelemetry,
    session_source: SessionSource,
    model_verbosity: Option<VerbosityConfig>,
    enable_request_compression: bool,
    include_timing_metrics: bool,
    beta_features_header: Option<String>,
    item_ids_enabled: bool,
    include_attestation: bool,
    attestation_provider: Option<Arc<dyn AttestationProvider>>,
    disable_websockets: AtomicBool,
    cached_websocket_session: StdMutex<WebsocketSession>,
}

/// Resolved API client setup for a single request attempt.
///
/// Keeping this as a single bundle ensures prewarm and normal request paths
/// share the same auth/provider setup flow.
struct CurrentClientSetup {
    auth: Option<CodexAuth>,
    api_provider: ApiProvider,
    api_auth: SharedAuthProvider,
}

#[derive(Debug, Serialize)]
struct AnthropicMessagesRequest {
    model: String,
    max_tokens: u32,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<AnthropicTool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct AnthropicTool {
    name: String,
    description: String,
    input_schema: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct AnthropicMessage {
    role: String,
    content: Vec<AnthropicRequestContentBlock>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AnthropicRequestContentBlock {
    Text { text: String },
    ToolUse { id: String, name: String, input: serde_json::Value },
    ToolResult { tool_use_id: String, content: String },
}

#[derive(Debug, Deserialize)]
struct AnthropicStreamEvent {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    message: Option<AnthropicStreamMessage>,
    #[serde(default)]
    content_block: Option<AnthropicStreamContentBlock>,
    #[serde(default)]
    delta: Option<AnthropicStreamDelta>,
    #[serde(default)]
    error: Option<AnthropicStreamError>,
}

#[derive(Debug, Deserialize)]
struct AnthropicStreamMessage {
    id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AnthropicStreamContentBlock {
    #[serde(rename = "type")]
    kind: Option<String>,
    text: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    input: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct AnthropicStreamDelta {
    #[serde(rename = "type")]
    kind: Option<String>,
    text: Option<String>,
    #[serde(default)]
    partial_json: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AnthropicStreamError {
    #[serde(rename = "type")]
    kind: Option<String>,
    message: Option<String>,
}

#[derive(Clone, Copy)]
struct RequestRouteTelemetry {
    endpoint: &'static str,
}

impl RequestRouteTelemetry {
    fn for_endpoint(endpoint: &'static str) -> Self {
        Self { endpoint }
    }
}

//  Chat Completions types 

#[derive(Debug, Serialize)]
struct ChatCompletionsRequest {
    model: String,
    messages: Vec<ChatCompletionRequestMessage>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream_options: Option<ChatCompletionStreamOptions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<ChatCompletionTool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Debug, Serialize)]
struct ChatCompletionStreamOptions {
    include_usage: bool,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum ChatCompletionRequestMessage {
    System { role: String, content: String },
    User { role: String, content: Vec<ChatCompletionUserContentPart> },
    Assistant {
        role: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        content: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_calls: Option<Vec<ChatCompletionRequestToolCall>>,
    },
    Tool { role: String, tool_call_id: String, content: String },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ChatCompletionUserContentPart {
    Text { text: String },
    #[allow(dead_code)]
    ImageUrl { image_url: ChatCompletionImageUrl },
}

#[derive(Debug, Serialize)]
struct ChatCompletionImageUrl {
    url: String,
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequestToolCall {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    function: ChatCompletionRequestFunctionCall,
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequestFunctionCall {
    name: String,
    arguments: String,
}

#[derive(Debug, Serialize)]
struct ChatCompletionTool {
    #[serde(rename = "type")]
    kind: String,
    function: ChatCompletionToolFunction,
}

#[derive(Debug, Serialize)]
struct ChatCompletionToolFunction {
    name: String,
    description: String,
    parameters: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    strict: Option<bool>,
}

//  Chat Completions streaming types 

#[derive(Debug, Deserialize)]
struct ChatCompletionChunk {
    #[serde(default)]
    choices: Vec<ChatCompletionChoice>,
    /// Final usage object (OpenAI-compatible streaming). Populated in the last chunk before `[DONE]`.
    #[serde(default)]
    usage: Option<ChatCompletionUsage>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionChoice {
    #[serde(default)]
    delta: ChatCompletionDelta,
    #[serde(default, rename = "finish_reason")]
    finish_reason: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct ChatCompletionDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    role: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<ChatCompletionDeltaToolCall>>,
}

#[derive(Debug, Default, Deserialize)]
struct ChatCompletionDeltaToolCall {
    #[serde(default)]
    index: i64,
    #[serde(default)]
    id: Option<String>,
    #[serde(rename = "type")]
    #[allow(dead_code)]
    kind: Option<String>,
    #[serde(default)]
    function: Option<ChatCompletionDeltaFunction>,
}

#[derive(Debug, Default, Deserialize)]
struct ChatCompletionDeltaFunction {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
}

/// Usage information carried in an OpenAI-compatible Chat Completions SSE stream.
///
/// DeepSeek (and other OpenAI-compatible providers) include a `usage` object
/// when `stream_options.include_usage` is `true`. In practice the usage may arrive:
/// - On the **same chunk** that carries `finish_reason` (DeepSeek commonly sends it this way).
/// - On a separate trailing chunk with empty `choices` right before `[DONE]`.
/// The stream handler reads both cases via the `chunk.usage` field on every chunk.
#[derive(Debug, Deserialize)]
struct ChatCompletionUsage {
    prompt_tokens: i64,
    completion_tokens: i64,
    total_tokens: i64,
    #[serde(default)]
    prompt_cache_hit_tokens: Option<i64>,
    #[allow(dead_code)]
    #[serde(default)]
    prompt_cache_miss_tokens: Option<i64>,
    #[serde(default)]
    prompt_tokens_details: Option<PromptTokensDetails>,
    #[serde(default)]
    completion_tokens_details: Option<CompletionTokensDetails>,
}

#[derive(Debug, Deserialize)]
struct PromptTokensDetails {
    #[serde(default)]
    cached_tokens: i64,
}

#[derive(Debug, Deserialize)]
struct CompletionTokensDetails {
    #[serde(default)]
    reasoning_tokens: i64,
}

/// Convert OpenAI-compatible `ChatCompletionUsage` into the canonical `TokenUsage`.
fn chat_completion_usage_to_token_usage(usage: &ChatCompletionUsage) -> TokenUsage {
    // Prefer explicit prompt_cache_hit_tokens over input_tokens_details.cached_tokens
    let cached = usage
        .prompt_cache_hit_tokens
        .or_else(|| usage.prompt_tokens_details.as_ref().map(|d| d.cached_tokens))
        .unwrap_or(0);
    let reasoning = usage
        .completion_tokens_details
        .as_ref()
        .map(|d| d.reasoning_tokens)
        .unwrap_or(0);
    TokenUsage {
        input_tokens: usage.prompt_tokens,
        cached_input_tokens: cached,
        output_tokens: usage.completion_tokens,
        reasoning_output_tokens: reasoning,
        total_tokens: usage.total_tokens,
    }
}

/// A session-scoped client for model-provider API calls.
///
/// This holds configuration and state that should be shared across turns within a Codex session
/// (auth, provider selection, thread id, and transport fallback state).
///
/// WebSocket fallback is session-scoped: once a turn activates the HTTP fallback, subsequent turns
/// will also use HTTP for the remainder of the session.
///
/// Turn-scoped settings (model selection, reasoning controls, telemetry context, and turn
/// metadata) are passed explicitly to the relevant methods to keep turn lifetime visible at the
/// call site.
#[derive(Debug, Clone)]
pub struct ModelClient {
    state: Arc<ModelClientState>,
    prompt_cache_key_override: Option<String>,
}

/// A turn-scoped streaming session created from a [`ModelClient`].
///
/// The session establishes a Responses WebSocket connection lazily and reuses it across multiple
/// requests within the turn. It also caches per-turn state:
///
/// - The last full request, so subsequent calls can reuse incremental websocket request payloads
///   only when the current request is an incremental extension of the previous one.
/// - The `x-codex-turn-state` sticky-routing token, which must be replayed for all requests within
///   the same turn.
///
/// Create a fresh `ModelClientSession` for each Codex turn. Reusing it across turns would replay
/// the previous turn's sticky-routing token into the next turn, which violates the client/server
/// contract and can cause routing bugs.
pub struct ModelClientSession {
    client: ModelClient,
    websocket_session: WebsocketSession,
    /// Turn state for sticky routing.
    ///
    /// This is an `OnceLock` that stores the turn state value received from the server
    /// on turn start via the `x-codex-turn-state` response header. Once set, this value
    /// should be sent back to the server in the `x-codex-turn-state` request header for
    /// all subsequent requests within the same turn to maintain sticky routing.
    ///
    /// This is a contract between the client and server: we receive it at turn start,
    /// keep sending it unchanged between turn requests (e.g., for retries, incremental
    /// appends, or continuation requests), and must not send it between different turns.
    turn_state: Arc<OnceLock<String>>,
}

#[derive(Debug, Clone)]
struct LastResponse {
    response_id: String,
    items_added: Vec<ResponseItem>,
}

#[derive(Debug, Default)]
struct WebsocketSession {
    connection: Option<ApiWebSocketConnection>,
    last_request: Option<ResponsesApiRequest>,
    last_response_rx: Option<oneshot::Receiver<LastResponse>>,
    last_response_from_untraced_warmup: bool,
    connection_reused: StdMutex<bool>,
}

// This is intentionally not a `PartialEq` implementation: request equality includes `input` and
// `client_metadata`, while websocket reuse compares the input separately and ignores metadata.
// Keep the destructuring exhaustive so new request fields require an explicit reuse decision.
fn responses_request_properties_match(
    previous: &ResponsesApiRequest,
    current: &ResponsesApiRequest,
) -> bool {
    let ResponsesApiRequest {
        model: previous_model,
        instructions: previous_instructions,
        input: _,
        tools: previous_tools,
        tool_choice: previous_tool_choice,
        parallel_tool_calls: previous_parallel_tool_calls,
        reasoning: previous_reasoning,
        store: previous_store,
        stream: previous_stream,
        include: previous_include,
        service_tier: previous_service_tier,
        prompt_cache_key: previous_prompt_cache_key,
        text: previous_text,
        client_metadata: _,
    } = previous;
    let ResponsesApiRequest {
        model: current_model,
        instructions: current_instructions,
        input: _,
        tools: current_tools,
        tool_choice: current_tool_choice,
        parallel_tool_calls: current_parallel_tool_calls,
        reasoning: current_reasoning,
        store: current_store,
        stream: current_stream,
        include: current_include,
        service_tier: current_service_tier,
        prompt_cache_key: current_prompt_cache_key,
        text: current_text,
        client_metadata: _,
    } = current;

    previous_model == current_model
        && previous_instructions == current_instructions
        && previous_tools == current_tools
        && previous_tool_choice == current_tool_choice
        && previous_parallel_tool_calls == current_parallel_tool_calls
        && previous_reasoning == current_reasoning
        && previous_store == current_store
        && previous_stream == current_stream
        && previous_include == current_include
        && previous_service_tier == current_service_tier
        && previous_prompt_cache_key == current_prompt_cache_key
        && previous_text == current_text
}

impl WebsocketSession {
    fn set_connection_reused(&self, connection_reused: bool) {
        *self
            .connection_reused
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = connection_reused;
    }

    fn connection_reused(&self) -> bool {
        *self
            .connection_reused
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

enum WebsocketStreamOutcome {
    Stream(ResponseStream),
    FallbackToHttp,
}

/// Result of opening a WebRTC Realtime call.
///
/// The SDP answer goes back to the client. The call id and auth headers stay on the server so the
/// ordinary Realtime WebSocket machinery can join the same in-progress call as a sideband
/// controller.
pub(crate) struct RealtimeWebrtcCallStart {
    pub(crate) sdp: String,
    pub(crate) call_id: String,
    pub(crate) sideband_headers: ApiHeaderMap,
}

/// Reuses the API-auth material that created the WebRTC call for the sideband WebSocket join.
///
/// API-key sessions send that API bearer. ChatGPT-auth sessions send their bearer plus account id;
/// transceiver is responsible for accepting that same call-create identity on the direct
/// `api.openai.com` sideband path.
fn sideband_websocket_auth_headers(api_auth: &dyn AuthProvider) -> ApiHeaderMap {
    let mut headers = ApiHeaderMap::new();
    api_auth.add_auth_headers(&mut headers);
    headers
}

impl ModelClient {
    #[allow(clippy::too_many_arguments)]
    /// Creates a new session-scoped `ModelClient`.
    ///
    /// All arguments are expected to be stable for the lifetime of a Codex session. Per-turn values
    /// are passed to [`ModelClientSession::stream`] (and other turn-scoped methods) explicitly.
    pub fn new(
        auth_manager: Option<Arc<AuthManager>>,
        thread_id: ThreadId,
        provider_info: ModelProviderInfo,
        session_source: SessionSource,
        model_verbosity: Option<VerbosityConfig>,
        enable_request_compression: bool,
        include_timing_metrics: bool,
        beta_features_header: Option<String>,
        item_ids_enabled: bool,
        attestation_provider: Option<Arc<dyn AttestationProvider>>,
    ) -> Self {
        let model_provider = create_model_provider(provider_info, auth_manager);
        let codepilotx_api_key_env_enabled = model_provider
            .auth_manager()
            .as_ref()
            .is_some_and(|manager| manager.codepilotx_api_key_env_enabled());
        let auth_env_telemetry =
            collect_auth_env_telemetry(model_provider.info(), codepilotx_api_key_env_enabled);
        let include_attestation = model_provider.supports_attestation();
        Self {
            state: Arc::new(ModelClientState {
                thread_id,
                provider: model_provider,
                auth_env_telemetry,
                session_source,
                model_verbosity,
                enable_request_compression,
                include_timing_metrics,
                beta_features_header,
                item_ids_enabled,
                include_attestation,
                attestation_provider,
                disable_websockets: AtomicBool::new(false),
                cached_websocket_session: StdMutex::new(WebsocketSession::default()),
            }),
            prompt_cache_key_override: None,
        }
    }

    pub(crate) fn with_prompt_cache_key_override(
        mut self,
        prompt_cache_key_override: Option<String>,
    ) -> Self {
        self.prompt_cache_key_override = prompt_cache_key_override;
        self
    }

    fn prompt_cache_key(&self) -> String {
        self.prompt_cache_key_override
            .clone()
            .unwrap_or_else(|| self.state.thread_id.to_string())
    }

    /// Creates a fresh turn-scoped streaming session.
    ///
    /// This constructor does not perform network I/O itself; the session opens a websocket lazily
    /// when the first stream request is issued.
    pub fn new_session(&self) -> ModelClientSession {
        ModelClientSession {
            client: self.clone(),
            websocket_session: self.take_cached_websocket_session(),
            turn_state: Arc::new(OnceLock::new()),
        }
    }

    pub(crate) fn auth_manager(&self) -> Option<Arc<AuthManager>> {
        self.state.provider.auth_manager()
    }

    fn take_cached_websocket_session(&self) -> WebsocketSession {
        let mut cached_websocket_session = self
            .state
            .cached_websocket_session
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        std::mem::take(&mut *cached_websocket_session)
    }

    fn store_cached_websocket_session(&self, websocket_session: WebsocketSession) {
        *self
            .state
            .cached_websocket_session
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = websocket_session;
    }

    pub(crate) fn force_http_fallback(
        &self,
        session_telemetry: &SessionTelemetry,
        _model_info: &ModelInfo,
    ) -> bool {
        let websocket_enabled = self.responses_websocket_enabled();
        let activated =
            websocket_enabled && !self.state.disable_websockets.swap(true, Ordering::Relaxed);
        if activated {
            warn!("falling back to HTTP");
            session_telemetry.counter(
                "codex.transport.fallback_to_http",
                /*inc*/ 1,
                &[("from_wire_api", "responses_websocket")],
            );
        }

        self.store_cached_websocket_session(WebsocketSession::default());
        activated
    }

    /// Compacts the current conversation history using the Compact endpoint.
    ///
    /// This is a unary call (no streaming) that returns a new list of
    /// `ResponseItem`s representing the compacted transcript.
    ///
    /// The model selection and telemetry context are passed explicitly to keep `ModelClient`
    /// session-scoped.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn compact_conversation_history(
        &self,
        prompt: &Prompt,
        model_info: &ModelInfo,
        turn_state: Option<Arc<OnceLock<String>>>,
        settings: CompactConversationRequestSettings,
        session_telemetry: &SessionTelemetry,
        compaction_trace: &CompactionTraceContext,
        responses_metadata: &CodexResponsesMetadata,
    ) -> Result<Vec<ResponseItem>> {
        if prompt.input.is_empty() {
            return Ok(Vec::new());
        }
        let client_setup = self.current_client_setup().await?;
        let transport = ReqwestTransport::new(build_reqwest_client());
        let request_telemetry = Self::build_request_telemetry(
            session_telemetry,
            AuthRequestTelemetryContext::new(
                client_setup.auth.as_ref().map(CodexAuth::auth_mode),
                client_setup.api_auth.as_ref(),
                PendingUnauthorizedRetry::default(),
            ),
            RequestRouteTelemetry::for_endpoint(RESPONSES_COMPACT_ENDPOINT),
            self.state.auth_env_telemetry.clone(),
        );
        let request = self.build_responses_request(
            &client_setup.api_provider,
            prompt,
            model_info,
            settings.effort,
            settings.summary,
            settings.service_tier,
            responses_metadata,
        )?;
        let ResponsesApiRequest {
            model,
            instructions,
            mut input,
            tools,
            parallel_tool_calls,
            reasoning,
            service_tier,
            prompt_cache_key,
            text,
            ..
        } = request;
        self.prepare_response_items_for_request(&mut input, /*store*/ false);
        let payload = ApiCompactionInput {
            model: &model,
            input: &input,
            instructions: &instructions,
            tools,
            parallel_tool_calls,
            reasoning,
            service_tier: service_tier.as_deref(),
            prompt_cache_key: prompt_cache_key.as_deref(),
            text,
        };

        let mut extra_headers = ApiHeaderMap::new();
        if let Ok(header_value) = HeaderValue::from_str(&responses_metadata.installation_id) {
            extra_headers.insert(X_codepilotx_INSTALLATION_ID_HEADER, header_value);
        }
        extra_headers.extend(build_responses_headers(
            self.state.beta_features_header.as_deref(),
            turn_state.as_ref(),
        ));
        extra_headers.extend(self.build_responses_compatibility_headers(responses_metadata));
        extra_headers.extend(build_session_headers(
            Some(responses_metadata.session_id.to_string()),
            Some(responses_metadata.thread_id.to_string()),
        ));
        if let Some(header_value) = self.generate_attestation_header_for().await {
            extra_headers.insert(X_OAI_ATTESTATION_HEADER, header_value);
        }
        add_responses_lite_header(&mut extra_headers, model_info.use_responses_lite);
        let compact_request_timeout = client_setup
            .api_provider
            .stream_idle_timeout
            .saturating_mul(COMPACT_REQUEST_TIMEOUT_IDLE_MULTIPLIER);
        let client =
            ApiCompactClient::new(transport, client_setup.api_provider, client_setup.api_auth)
                .with_telemetry(Some(request_telemetry));
        let trace_attempt = compaction_trace.start_attempt(&payload);
        let result = client
            .compact_input(
                &payload,
                extra_headers,
                compact_request_timeout,
                turn_state.as_deref(),
            )
            .await
            .map_err(map_api_error);
        trace_attempt.record_result(result.as_deref());
        result
    }

    pub(crate) async fn create_realtime_call_with_headers(
        &self,
        sdp: String,
        session_config: ApiRealtimeSessionConfig,
        mut extra_headers: ApiHeaderMap,
        api_provider_override: Option<ApiProvider>,
    ) -> Result<RealtimeWebrtcCallStart> {
        // Create the media call over HTTP first, then retain matching auth so realtime can attach
        // the server-side control WebSocket to the call id from that HTTP response.
        let client_setup = self.current_client_setup().await?;
        if let Some(header_value) = self.generate_attestation_header_for().await {
            extra_headers.insert(X_OAI_ATTESTATION_HEADER, header_value);
        }
        let mut sideband_headers = extra_headers.clone();
        sideband_headers.extend(sideband_websocket_auth_headers(
            client_setup.api_auth.as_ref(),
        ));
        let transport = ReqwestTransport::new(build_reqwest_client());
        let api_provider = api_provider_override.unwrap_or(client_setup.api_provider);
        let response = ApiRealtimeCallClient::new(transport, api_provider, client_setup.api_auth)
            .create_with_session_and_headers(sdp, session_config, extra_headers)
            .await
            .map_err(map_api_error)?;
        Ok(RealtimeWebrtcCallStart {
            sdp: response.sdp,
            call_id: response.call_id,
            sideband_headers,
        })
    }

    /// Builds memory summaries for each provided normalized raw memory.
    ///
    /// This is a unary call (no streaming) to `/v1/memories/trace_summarize`.
    ///
    /// The model selection, reasoning effort, and telemetry context are passed explicitly to keep
    /// `ModelClient` session-scoped.
    pub async fn summarize_memories(
        &self,
        raw_memories: Vec<ApiRawMemory>,
        model_info: &ModelInfo,
        effort: Option<ReasoningEffortConfig>,
        session_telemetry: &SessionTelemetry,
    ) -> Result<Vec<ApiMemorySummarizeOutput>> {
        if raw_memories.is_empty() {
            return Ok(Vec::new());
        }

        let client_setup = self.current_client_setup().await?;
        let transport = ReqwestTransport::new(build_reqwest_client());
        let request_telemetry = Self::build_request_telemetry(
            session_telemetry,
            AuthRequestTelemetryContext::new(
                client_setup.auth.as_ref().map(CodexAuth::auth_mode),
                client_setup.api_auth.as_ref(),
                PendingUnauthorizedRetry::default(),
            ),
            RequestRouteTelemetry::for_endpoint(MEMORIES_SUMMARIZE_ENDPOINT),
            self.state.auth_env_telemetry.clone(),
        );
        let client =
            ApiMemoriesClient::new(transport, client_setup.api_provider, client_setup.api_auth)
                .with_telemetry(Some(request_telemetry));

        let payload = ApiMemorySummarizeInput {
            model: model_info.slug.clone(),
            raw_memories,
            reasoning: effort.map(|effort| Reasoning {
                effort: Some(effort),
                summary: None,
                context: None,
            }),
        };

        client
            .summarize_input(&payload, self.build_subagent_headers())
            .await
            .map_err(map_api_error)
    }

    fn build_subagent_headers(&self) -> ApiHeaderMap {
        let mut extra_headers = ApiHeaderMap::new();
        if let Some(subagent) = subagent_header_value(&self.state.session_source)
            && let Ok(val) = HeaderValue::from_str(&subagent)
        {
            extra_headers.insert(X_OPENAI_SUBAGENT_HEADER, val);
        }
        if matches!(
            self.state.session_source,
            SessionSource::Internal(InternalSessionSource::MemoryConsolidation)
        ) {
            extra_headers.insert(
                X_OPENAI_MEMGEN_REQUEST_HEADER,
                HeaderValue::from_static("true"),
            );
        }
        extra_headers
    }

    fn build_responses_compatibility_headers(
        &self,
        responses_metadata: &CodexResponsesMetadata,
    ) -> ApiHeaderMap {
        let mut extra_headers = responses_metadata.compatibility_headers();
        if matches!(
            self.state.session_source,
            SessionSource::Internal(InternalSessionSource::MemoryConsolidation)
        ) {
            extra_headers.insert(
                X_OPENAI_MEMGEN_REQUEST_HEADER,
                HeaderValue::from_static("true"),
            );
        }
        extra_headers
    }

    fn build_ws_client_metadata(
        &self,
        responses_metadata: &CodexResponsesMetadata,
        use_responses_lite: bool,
    ) -> HashMap<String, String> {
        let mut client_metadata = responses_metadata.client_metadata();
        if use_responses_lite {
            client_metadata.insert(
                WS_REQUEST_HEADER_RESPONSES_LITE_CLIENT_METADATA_KEY.to_string(),
                "true".to_string(),
            );
        }
        client_metadata
    }

    async fn generate_attestation_header_for(&self) -> Option<HeaderValue> {
        if !self.state.include_attestation {
            return None;
        }

        self.state
            .attestation_provider
            .as_ref()?
            .header_for_request(AttestationContext {
                thread_id: self.state.thread_id,
            })
            .await
    }

    /// Builds request telemetry for unary API calls (e.g., Compact endpoint).
    fn build_request_telemetry(
        session_telemetry: &SessionTelemetry,
        auth_context: AuthRequestTelemetryContext,
        request_route_telemetry: RequestRouteTelemetry,
        auth_env_telemetry: AuthEnvTelemetry,
    ) -> Arc<dyn RequestTelemetry> {
        let telemetry = Arc::new(ApiTelemetry::new(
            session_telemetry.clone(),
            auth_context,
            request_route_telemetry,
            auth_env_telemetry,
        ));
        let request_telemetry: Arc<dyn RequestTelemetry> = telemetry;
        request_telemetry
    }

    fn build_reasoning(
        model_info: &ModelInfo,
        effort: Option<ReasoningEffortConfig>,
        summary: ReasoningSummaryConfig,
    ) -> Option<Reasoning> {
        if model_info.supports_reasoning_summaries {
            Some(Reasoning {
                effort: effort.or_else(|| model_info.default_reasoning_level.clone()),
                summary: if summary == ReasoningSummaryConfig::None {
                    None
                } else {
                    Some(summary)
                },
                // When Responses Lite is disabled, omit context so Responses uses the default,
                // which is currently `current_turn`.
                context: model_info
                    .use_responses_lite
                    .then_some(ReasoningContext::AllTurns),
            })
        } else {
            None
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn build_responses_request(
        &self,
        provider: &codepilotx_api::Provider,
        prompt: &Prompt,
        model_info: &ModelInfo,
        effort: Option<ReasoningEffortConfig>,
        summary: ReasoningSummaryConfig,
        service_tier: Option<String>,
        responses_metadata: &CodexResponsesMetadata,
    ) -> Result<ResponsesApiRequest> {
        let instructions = &prompt.base_instructions.text;
        let mut input = prompt.get_formatted_input_for_request(model_info.use_responses_lite);
        if !self.state.provider.info().is_openai() {
            input.iter_mut().for_each(ResponseItem::clear_metadata);
        }
        let tools = create_tools_json_for_responses_api(&prompt.tools)?;
        let reasoning = Self::build_reasoning(model_info, effort, summary);
        let include = if reasoning.is_some() {
            vec!["reasoning.encrypted_content".to_string()]
        } else {
            Vec::new()
        };
        let verbosity = if model_info.support_verbosity {
            self.state.model_verbosity.or(model_info.default_verbosity)
        } else {
            if self.state.model_verbosity.is_some() {
                warn!(
                    "model_verbosity is set but ignored as the model does not support verbosity: {}",
                    model_info.slug
                );
            }
            None
        };
        let text = create_text_param_for_request(
            verbosity,
            &prompt.output_schema,
            prompt.output_schema_strict,
        );
        let prompt_cache_key = Some(self.prompt_cache_key());
        let service_tier = model_info.service_tier_for_request(service_tier);
        let request = ResponsesApiRequest {
            model: model_info.slug.clone(),
            instructions: instructions.clone(),
            input,
            tools,
            tool_choice: "auto".to_string(),
            parallel_tool_calls: prompt.parallel_tool_calls && !model_info.use_responses_lite,
            reasoning,
            store: provider.is_azure_responses_endpoint(),
            stream: true,
            include,
            service_tier,
            prompt_cache_key,
            text,
            client_metadata: Some(responses_metadata.client_metadata()),
        };
        Ok(request)
    }

    fn build_anthropic_messages_request(
        &self,
        prompt: &Prompt,
        model_info: &ModelInfo,
    ) -> AnthropicMessagesRequest {
        let system = if prompt.base_instructions.text.trim().is_empty() {
            None
        } else {
            Some(prompt.base_instructions.text.clone())
        };
        let mut messages: Vec<AnthropicMessage> = Vec::new();
        // Buffer tool results that precede the next user message
        let mut tool_results_buffer: Vec<(String, String)> = Vec::new();
        // Buffer pending tool_use blocks awaiting an assistant anchor.
        // Mirrors the chat-completions pending_tool_calls pattern so that
        // tool_use always appears before tool_result in the final request.
        let mut pending_tool_uses: Vec<(String, String, serde_json::Value)> = Vec::new();

        // Flush pending tool_use blocks: attach to last assistant message if
        // present, otherwise create a new assistant anchor message.
        fn flush_pending_tool_uses(
            messages: &mut Vec<AnthropicMessage>,
            pending: &mut Vec<(String, String, serde_json::Value)>,
        ) {
            if pending.is_empty() {
                return;
            }
            let blocks: Vec<AnthropicRequestContentBlock> = pending
                .drain(..)
                .map(|(id, name, input)| AnthropicRequestContentBlock::ToolUse { id, name, input })
                .collect();
            if let Some(last) = messages.last_mut() {
                if last.role == "assistant" {
                    last.content.extend(blocks);
                    return;
                }
            }
            messages.push(AnthropicMessage {
                role: "assistant".to_string(),
                content: blocks,
            });
        }

        for item in prompt.get_formatted_input_for_request(/*use_responses_lite*/ false) {
            match item {
                ResponseItem::Message { role, content, .. } => {
                    // Flush pending tool uses before this message so tool_use
                    // always has an assistant anchor.
                    flush_pending_tool_uses(&mut messages, &mut pending_tool_uses);

                    if role == "user" {
                        let text = anthropic_text_from_content_items(&content);
                        if text.trim().is_empty() && tool_results_buffer.is_empty() {
                            continue;
                        }
                        let mut content_blocks = Vec::new();
                        // Flush buffered tool results first (Anthropic requires tool_result before text)
                        for (tool_use_id, result_text) in tool_results_buffer.drain(..) {
                            content_blocks.push(AnthropicRequestContentBlock::ToolResult {
                                tool_use_id,
                                content: result_text,
                            });
                        }
                        if !text.trim().is_empty() {
                            content_blocks.push(AnthropicRequestContentBlock::Text { text });
                        }
                        if !content_blocks.is_empty() {
                            messages.push(AnthropicMessage {
                                role: "user".to_string(),
                                content: content_blocks,
                            });
                        }
                    } else if role == "assistant" {
                        let text = anthropic_text_from_content_items(&content);
                        let mut content_blocks = Vec::new();
                        if !text.trim().is_empty() {
                            content_blocks.push(AnthropicRequestContentBlock::Text { text });
                        }
                        messages.push(AnthropicMessage {
                            role: "assistant".to_string(),
                            content: content_blocks,
                        });
                    }
                }
                ResponseItem::FunctionCall { name, arguments, call_id, .. } => {
                    let input = match serde_json::from_str(&arguments) {
                        Ok(v @ serde_json::Value::Object(_)) => v,
                        _ => serde_json::Value::Object(serde_json::Map::new()),
                    };
                    pending_tool_uses.push((call_id, name, input));
                }
                ResponseItem::CustomToolCall { name, input, call_id, .. } => {
                    let input_value = match serde_json::from_str(&input) {
                        Ok(v @ serde_json::Value::Object(_)) => v,
                        _ => serde_json::Value::Object(serde_json::Map::new()),
                    };
                    pending_tool_uses.push((call_id, name, input_value));
                }
                ResponseItem::FunctionCallOutput { call_id, output, .. } => {
                    // Flush pending tool uses before buffering tool result so
                    // tool_use always appears before tool_result.
                    flush_pending_tool_uses(&mut messages, &mut pending_tool_uses);
                    let text = chat_completions_output_text(&output);
                    if !text.trim().is_empty() {
                        tool_results_buffer.push((call_id, text));
                    }
                }
                ResponseItem::CustomToolCallOutput { call_id, output, .. } => {
                    // Flush pending tool uses before buffering tool result so
                    // tool_use always appears before tool_result.
                    flush_pending_tool_uses(&mut messages, &mut pending_tool_uses);
                    let text = chat_completions_output_text(&output);
                    if !text.trim().is_empty() {
                        tool_results_buffer.push((call_id, text));
                    }
                }
                _ => {}
            }
        }

        // Flush remaining pending tool uses
        flush_pending_tool_uses(&mut messages, &mut pending_tool_uses);

        // Flush remaining tool results as a standalone user message
        if !tool_results_buffer.is_empty() {
            let mut content_blocks = Vec::new();
            for (tool_use_id, result_text) in tool_results_buffer.drain(..) {
                content_blocks.push(AnthropicRequestContentBlock::ToolResult {
                    tool_use_id,
                    content: result_text,
                });
            }
            messages.push(AnthropicMessage {
                role: "user".to_string(),
                content: content_blocks,
            });
        }

        if messages.is_empty() {
            messages.push(AnthropicMessage {
                role: "user".to_string(),
                content: vec![AnthropicRequestContentBlock::Text {
                    text: "Continue.".to_string(),
                }],
            });
        }

        // Build tools array
        let tools = if prompt.tools.is_empty() {
            None
        } else {
            Some(build_anthropic_tools(&prompt.tools))
        };

        // Tool choice: auto when tools are present
        let tool_choice = tools.as_ref().map(|_| serde_json::json!({"type": "auto"}));

        AnthropicMessagesRequest {
            model: model_info.slug.clone(),
            max_tokens: 4096,
            stream: true,
            system,
            messages,
            tools,
            tool_choice,
        }
    }

    fn build_chat_completions_request(
        &self,
        prompt: &Prompt,
        model_info: &ModelInfo,
    ) -> ChatCompletionsRequest {
        let mut messages: Vec<ChatCompletionRequestMessage> = Vec::new();

        // System instructions
        let system_text = prompt.base_instructions.text.trim();
        if !system_text.is_empty() {
            messages.push(ChatCompletionRequestMessage::System {
                role: "system".to_string(),
                content: system_text.to_string(),
            });
        }

        // Pending tool calls for the most recent assistant message
        let mut pending_tool_calls: Vec<ChatCompletionRequestToolCall> = Vec::new();

        for item in prompt.get_formatted_input_for_request(/*use_responses_lite*/ false) {
            match item {
                ResponseItem::Message { role, content, .. } => {
                    // Flush any pending tool calls onto an assistant message.
                    // If the last message is already an Assistant, attach them there;
                    // otherwise create an Assistant message to anchor them.
                    if !pending_tool_calls.is_empty() {
                        if let Some(ChatCompletionRequestMessage::Assistant { tool_calls, .. }) =
                            messages.last_mut()
                        {
                            *tool_calls = Some(std::mem::take(&mut pending_tool_calls));
                        } else {
                            messages.push(ChatCompletionRequestMessage::Assistant {
                                role: "assistant".to_string(),
                                content: None,
                                tool_calls: Some(std::mem::take(&mut pending_tool_calls)),
                            });
                        }
                    }

                    if role == "user" {
                        let text = chat_completions_text_from_content_items(&content);
                        if text.trim().is_empty() {
                            continue;
                        }
                        messages.push(ChatCompletionRequestMessage::User {
                            role: "user".to_string(),
                            content: vec![ChatCompletionUserContentPart::Text { text }],
                        });
                    } else if role == "assistant" {
                        let text = chat_completions_text_from_content_items(&content);
                        let content = if text.trim().is_empty() { None } else { Some(text) };
                        messages.push(ChatCompletionRequestMessage::Assistant {
                            role: "assistant".to_string(),
                            content,
                            tool_calls: None,
                        });
                    }
                }
                ResponseItem::FunctionCall { name, arguments, call_id, .. } => {
                    pending_tool_calls.push(ChatCompletionRequestToolCall {
                        id: call_id,
                        kind: "function".to_string(),
                        function: ChatCompletionRequestFunctionCall {
                            name,
                            arguments,
                        },
                    });
                }
                ResponseItem::CustomToolCall { name, input, call_id, .. } => {
                    pending_tool_calls.push(ChatCompletionRequestToolCall {
                        id: call_id,
                        kind: "function".to_string(),
                        function: ChatCompletionRequestFunctionCall {
                            name,
                            arguments: input,
                        },
                    });
                }
                ResponseItem::FunctionCallOutput { call_id, output, .. } => {
                    let text = chat_completions_output_text(&output);
                    if text.trim().is_empty() {
                        continue;
                    }
                    // Ensure pending tool calls are flushed to an Assistant message
                    // before pushing this Tool result, so the provider sees a valid
                    // assistanttool sequence.
                    if !pending_tool_calls.is_empty() {
                        if let Some(ChatCompletionRequestMessage::Assistant { tool_calls, .. }) =
                            messages.last_mut()
                        {
                            *tool_calls = Some(std::mem::take(&mut pending_tool_calls));
                        } else {
                            messages.push(ChatCompletionRequestMessage::Assistant {
                                role: "assistant".to_string(),
                                content: None,
                                tool_calls: Some(std::mem::take(&mut pending_tool_calls)),
                            });
                        }
                    }
                    messages.push(ChatCompletionRequestMessage::Tool {
                        role: "tool".to_string(),
                        tool_call_id: call_id,
                        content: text,
                    });
                }
                ResponseItem::CustomToolCallOutput { call_id, output, .. } => {
                    let text = chat_completions_output_text(&output);
                    if text.trim().is_empty() {
                        continue;
                    }
                    // Same flush logic as FunctionCallOutput above
                    if !pending_tool_calls.is_empty() {
                        if let Some(ChatCompletionRequestMessage::Assistant { tool_calls, .. }) =
                            messages.last_mut()
                        {
                            *tool_calls = Some(std::mem::take(&mut pending_tool_calls));
                        } else {
                            messages.push(ChatCompletionRequestMessage::Assistant {
                                role: "assistant".to_string(),
                                content: None,
                                tool_calls: Some(std::mem::take(&mut pending_tool_calls)),
                            });
                        }
                    }
                    messages.push(ChatCompletionRequestMessage::Tool {
                        role: "tool".to_string(),
                        tool_call_id: call_id,
                        content: text,
                    });
                }
                _ => {}
            }
        }

        // Flush remaining pending tool calls
        if !pending_tool_calls.is_empty() {
            if let Some(ChatCompletionRequestMessage::Assistant { tool_calls, .. }) =
                messages.last_mut()
            {
                *tool_calls = Some(pending_tool_calls);
            } else {
                messages.push(ChatCompletionRequestMessage::Assistant {
                    role: "assistant".to_string(),
                    content: None,
                    tool_calls: Some(pending_tool_calls),
                });
            }
        }

        if messages.is_empty() {
            messages.push(ChatCompletionRequestMessage::User {
                role: "user".to_string(),
                content: vec![ChatCompletionUserContentPart::Text {
                    text: "Continue.".to_string(),
                }],
            });
        }

        // Build tools array
        let tools = if prompt.tools.is_empty() {
            None
        } else {
            Some(build_chat_completions_tools(&prompt.tools))
        };

        // Tool choice: default "auto" when tools are present
        let tool_choice = tools.as_ref().map(|_| serde_json::json!("auto"));

        ChatCompletionsRequest {
            model: model_info.slug.clone(),
            messages,
            stream: true,
            stream_options: Some(ChatCompletionStreamOptions {
                include_usage: true,
            }),
            tools,
            tool_choice,
            max_tokens: Some(4096),
        }
    }

    fn prepare_response_items_for_request(&self, input: &mut [ResponseItem], store: bool) {
        if self.state.item_ids_enabled || store {
            return;
        }

        for item in input {
            item.set_id(/*new_id*/ None);
        }
    }

    /// Returns whether the Responses-over-WebSocket transport is active for this session.
    ///
    /// WebSocket use is controlled by provider capability and session-scoped fallback state.
    pub fn responses_websocket_enabled(&self) -> bool {
        if !self.state.provider.info().supports_websockets
            || self.state.disable_websockets.load(Ordering::Relaxed)
        {
            return false;
        }

        true
    }

    /// Returns auth + provider configuration resolved from the current session auth state.
    ///
    /// This centralizes setup used by both prewarm and normal request paths so they stay in
    /// lockstep when auth/provider resolution changes.
    async fn current_client_setup(&self) -> Result<CurrentClientSetup> {
        let auth = self.state.provider.auth().await;
        let api_provider = self.state.provider.api_provider().await?;
        let api_auth = self.state.provider.api_auth().await?;
        Ok(CurrentClientSetup {
            auth,
            api_provider,
            api_auth,
        })
    }

    /// Opens a websocket connection using the same header and telemetry wiring as normal turns.
    ///
    /// Both startup prewarm and in-turn `needs_new` reconnects call this path so handshake
    /// behavior remains consistent across both flows.
    #[allow(clippy::too_many_arguments)]
    async fn connect_websocket(
        &self,
        session_telemetry: &SessionTelemetry,
        api_provider: codepilotx_api::Provider,
        api_auth: SharedAuthProvider,
        responses_metadata: &CodexResponsesMetadata,
        auth_context: AuthRequestTelemetryContext,
        request_route_telemetry: RequestRouteTelemetry,
    ) -> std::result::Result<ApiWebSocketConnection, ApiError> {
        let headers = self.build_websocket_headers(responses_metadata).await;
        let websocket_telemetry = ModelClientSession::build_websocket_telemetry(
            session_telemetry,
            auth_context,
            request_route_telemetry,
            self.state.auth_env_telemetry.clone(),
        );
        let websocket_connect_timeout = self.state.provider.info().websocket_connect_timeout();
        let start = Instant::now();
        let result = match tokio::time::timeout(
            websocket_connect_timeout,
            ApiWebSocketResponsesClient::new(api_provider, api_auth).connect(
                headers,
                codepilotx_login::default_client::default_headers(),
                /*turn_state*/ None,
                Some(websocket_telemetry),
            ),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(ApiError::Transport(TransportError::Timeout)),
        };
        let error_message = result.as_ref().err().map(telemetry_api_error_message);
        let response_debug = result
            .as_ref()
            .err()
            .map(extract_response_debug_context_from_api_error)
            .unwrap_or_default();
        let status = result.as_ref().err().and_then(api_error_http_status);
        session_telemetry.record_websocket_connect(
            start.elapsed(),
            status,
            error_message.as_deref(),
            auth_context.auth_header_attached,
            auth_context.auth_header_name,
            auth_context.retry_after_unauthorized,
            auth_context.recovery_mode,
            auth_context.recovery_phase,
            request_route_telemetry.endpoint,
            /*connection_reused*/ false,
            response_debug.request_id.as_deref(),
            response_debug.cf_ray.as_deref(),
            response_debug.auth_error.as_deref(),
            response_debug.auth_error_code.as_deref(),
        );
        emit_feedback_request_tags_with_auth_env(
            &FeedbackRequestTags {
                endpoint: request_route_telemetry.endpoint,
                auth_header_attached: auth_context.auth_header_attached,
                auth_header_name: auth_context.auth_header_name,
                auth_mode: auth_context.auth_mode,
                auth_retry_after_unauthorized: Some(auth_context.retry_after_unauthorized),
                auth_recovery_mode: auth_context.recovery_mode,
                auth_recovery_phase: auth_context.recovery_phase,
                auth_connection_reused: Some(false),
                auth_request_id: response_debug.request_id.as_deref(),
                auth_cf_ray: response_debug.cf_ray.as_deref(),
                auth_error: response_debug.auth_error.as_deref(),
                auth_error_code: response_debug.auth_error_code.as_deref(),
                auth_recovery_followup_success: auth_context
                    .retry_after_unauthorized
                    .then_some(result.is_ok()),
                auth_recovery_followup_status: auth_context
                    .retry_after_unauthorized
                    .then_some(status)
                    .flatten(),
            },
            &self.state.auth_env_telemetry,
        );
        result
    }

    /// Builds websocket handshake headers for both prewarm and turn-time reconnect.
    async fn build_websocket_headers(
        &self,
        responses_metadata: &CodexResponsesMetadata,
    ) -> ApiHeaderMap {
        let mut headers = build_responses_headers(
            self.state.beta_features_header.as_deref(),
            /*turn_state*/ None,
        );
        if let Ok(header_value) = HeaderValue::from_str(&responses_metadata.thread_id) {
            headers.insert("x-client-request-id", header_value);
        }
        headers.extend(build_session_headers(
            Some(responses_metadata.session_id.to_string()),
            Some(responses_metadata.thread_id.to_string()),
        ));
        headers.extend(self.build_responses_compatibility_headers(responses_metadata));
        if let Some(header_value) = self.generate_attestation_header_for().await {
            headers.insert(X_OAI_ATTESTATION_HEADER, header_value);
        }
        headers.insert(
            OPENAI_BETA_HEADER,
            HeaderValue::from_static(RESPONSES_WEBSOCKETS_V2_BETA_HEADER_VALUE),
        );
        if self.state.include_timing_metrics {
            headers.insert(
                X_RESPONSESAPI_INCLUDE_TIMING_METRICS_HEADER,
                HeaderValue::from_static("true"),
            );
        }
        headers
    }
}

impl Drop for ModelClientSession {
    fn drop(&mut self) {
        let websocket_session = std::mem::take(&mut self.websocket_session);
        self.client
            .store_cached_websocket_session(websocket_session);
    }
}

impl ModelClientSession {
    pub(crate) fn turn_state(&self) -> Arc<OnceLock<String>> {
        Arc::clone(&self.turn_state)
    }

    fn reset_websocket_session(&mut self) {
        self.websocket_session.connection = None;
        self.websocket_session.last_request = None;
        self.websocket_session.last_response_rx = None;
        self.websocket_session.last_response_from_untraced_warmup = false;
        self.websocket_session
            .set_connection_reused(/*connection_reused*/ false);
    }

    #[allow(clippy::too_many_arguments)]
    /// Builds shared Responses API transport options and request-body options.
    ///
    /// Keeping option construction in one place ensures request-scoped headers are consistent
    /// regardless of transport choice.
    async fn build_responses_options(
        &self,
        responses_metadata: &CodexResponsesMetadata,
        compression: Compression,
        use_responses_lite: bool,
    ) -> ApiResponsesOptions {
        ApiResponsesOptions {
            session_id: Some(responses_metadata.session_id.to_string()),
            thread_id: Some(responses_metadata.thread_id.to_string()),
            session_source: Some(self.client.state.session_source.clone()),
            extra_headers: {
                let mut headers = build_responses_headers(
                    self.client.state.beta_features_header.as_deref(),
                    Some(&self.turn_state),
                );
                headers.extend(
                    self.client
                        .build_responses_compatibility_headers(responses_metadata),
                );
                if let Some(header_value) = self.client.generate_attestation_header_for().await {
                    headers.insert(X_OAI_ATTESTATION_HEADER, header_value);
                }
                add_responses_lite_header(&mut headers, use_responses_lite);
                headers
            },
            compression,
            turn_state: Some(Arc::clone(&self.turn_state)),
        }
    }

    fn get_incremental_items(
        &self,
        request: &ResponsesApiRequest,
        last_response: Option<&LastResponse>,
        allow_empty_delta: bool,
    ) -> Option<Vec<ResponseItem>> {
        // Checks whether the current request is an incremental extension of the previous request.
        // We only reuse an incremental input delta when non-input request fields are unchanged and
        // `input` is a strict
        // extension of the previous known input. Server-returned output items are treated as part
        // of the baseline so we do not resend them.
        let previous_request = self.websocket_session.last_request.as_ref()?;
        if !responses_request_properties_match(previous_request, request) {
            trace!("incremental request failed, websocket reuse properties didn't match");
            return None;
        }

        let Some(after_previous_input) = request
            .input
            .strip_prefix(previous_request.input.as_slice())
        else {
            trace!("incremental request failed, items didn't match");
            return None;
        };
        let mut response_items =
            last_response.map_or_else(Vec::new, |response| response.items_added.clone());
        if !self.client.state.provider.info().is_openai() {
            response_items
                .iter_mut()
                .for_each(ResponseItem::clear_metadata);
        }
        let Some(incremental_items) = after_previous_input.strip_prefix(response_items.as_slice())
        else {
            trace!("incremental request failed, items didn't match");
            return None;
        };
        if !allow_empty_delta && incremental_items.is_empty() {
            return None;
        }
        Some(incremental_items.to_vec())
    }

    fn get_last_response(&mut self) -> Option<LastResponse> {
        self.websocket_session
            .last_response_rx
            .take()
            .and_then(|mut receiver| match receiver.try_recv() {
                Ok(last_response) => Some(last_response),
                Err(TryRecvError::Closed) | Err(TryRecvError::Empty) => None,
            })
    }

    fn prepare_websocket_request(
        &mut self,
        payload: ResponseCreateWsRequest,
        request: &ResponsesApiRequest,
    ) -> (ResponsesWsRequest, bool) {
        let Some(last_response) = self.get_last_response() else {
            return (ResponsesWsRequest::ResponseCreate(payload), false);
        };
        let previous_response_id_from_untraced_warmup =
            self.websocket_session.last_response_from_untraced_warmup;
        let Some(incremental_items) = self.get_incremental_items(
            request,
            Some(&last_response),
            /*allow_empty_delta*/ true,
        ) else {
            return (ResponsesWsRequest::ResponseCreate(payload), false);
        };

        if last_response.response_id.is_empty() {
            trace!("incremental request failed, no previous response id");
            return (ResponsesWsRequest::ResponseCreate(payload), false);
        }

        (
            ResponsesWsRequest::ResponseCreate(ResponseCreateWsRequest {
                previous_response_id: Some(last_response.response_id),
                input: incremental_items,
                ..payload
            }),
            previous_response_id_from_untraced_warmup,
        )
    }

    /// Opportunistically preconnects a websocket for this turn-scoped client session.
    ///
    /// This performs only connection setup; it never sends prompt payloads.
    pub async fn preconnect_websocket(
        &mut self,
        session_telemetry: &SessionTelemetry,
        responses_metadata: &CodexResponsesMetadata,
    ) -> std::result::Result<(), ApiError> {
        if !self.client.responses_websocket_enabled() {
            return Ok(());
        }
        if self.websocket_session.connection.is_some() {
            return Ok(());
        }

        let client_setup = self.client.current_client_setup().await.map_err(|err| {
            ApiError::Stream(format!(
                "failed to build websocket prewarm client setup: {err}"
            ))
        })?;
        let auth_context = AuthRequestTelemetryContext::new(
            client_setup.auth.as_ref().map(CodexAuth::auth_mode),
            client_setup.api_auth.as_ref(),
            PendingUnauthorizedRetry::default(),
        );
        let connection = self
            .client
            .connect_websocket(
                session_telemetry,
                client_setup.api_provider,
                client_setup.api_auth,
                responses_metadata,
                auth_context,
                RequestRouteTelemetry::for_endpoint(RESPONSES_ENDPOINT),
            )
            .await?;
        self.websocket_session.connection = Some(connection);
        self.websocket_session
            .set_connection_reused(/*connection_reused*/ false);
        Ok(())
    }
    /// Returns a websocket connection for this turn.
    #[instrument(
        name = "model_client.websocket_connection",
        level = "info",
        skip_all,
        fields(
            provider = %self.client.state.provider.info().name,
            wire_api = %self.client.state.provider.info().wire_api,
            transport = "responses_websocket",
            api.path = "responses",
            turn.has_metadata_header = params.responses_metadata.has_turn_metadata()
        )
    )]
    async fn websocket_connection(
        &mut self,
        params: WebsocketConnectParams<'_>,
    ) -> std::result::Result<&ApiWebSocketConnection, ApiError> {
        let WebsocketConnectParams {
            session_telemetry,
            api_provider,
            api_auth,
            responses_metadata,
            auth_context,
            request_route_telemetry,
        } = params;
        let needs_new = match self.websocket_session.connection.as_ref() {
            Some(conn) => conn.is_closed().await,
            None => true,
        };

        if needs_new {
            self.websocket_session.last_request = None;
            self.websocket_session.last_response_rx = None;
            self.websocket_session.last_response_from_untraced_warmup = false;
            let new_conn = match self
                .client
                .connect_websocket(
                    session_telemetry,
                    api_provider,
                    api_auth,
                    responses_metadata,
                    auth_context,
                    request_route_telemetry,
                )
                .await
            {
                Ok(new_conn) => new_conn,
                Err(err) => {
                    if matches!(err, ApiError::Transport(TransportError::Timeout)) {
                        self.reset_websocket_session();
                    }
                    return Err(err);
                }
            };
            self.websocket_session.connection = Some(new_conn);
            self.websocket_session
                .set_connection_reused(/*connection_reused*/ false);
        } else {
            self.websocket_session
                .set_connection_reused(/*connection_reused*/ true);
        }

        self.websocket_session
            .connection
            .as_ref()
            .ok_or(ApiError::Stream(
                "websocket connection is unavailable".to_string(),
            ))
    }

    fn responses_request_compression(&self, auth: Option<&CodexAuth>) -> Compression {
        if self.client.state.enable_request_compression
            && auth.is_some_and(CodexAuth::uses_codepilotx_backend)
            && self.client.state.provider.info().is_openai()
        {
            Compression::Zstd
        } else {
            Compression::None
        }
    }

    /// Streams a turn via the OpenAI Responses API.
    ///
    /// Handles reasoning summaries, verbosity, and the `text` controls used for output schemas.
    #[allow(clippy::too_many_arguments)]
    #[instrument(
        name = "model_client.stream_responses_api",
        level = "info",
        skip_all,
        fields(
            model = %model_info.slug,
            wire_api = %self.client.state.provider.info().wire_api,
            transport = "responses_http",
            http.method = "POST",
            api.path = "responses",
            turn.has_metadata_header = responses_metadata.has_turn_metadata()
        )
    )]
    async fn stream_responses_api(
        &self,
        prompt: &Prompt,
        model_info: &ModelInfo,
        session_telemetry: &SessionTelemetry,
        effort: Option<ReasoningEffortConfig>,
        summary: ReasoningSummaryConfig,
        service_tier: Option<String>,
        responses_metadata: &CodexResponsesMetadata,
        inference_trace: &InferenceTraceContext,
    ) -> Result<ResponseStream> {
        let auth_manager = self.client.state.provider.auth_manager();
        let mut auth_recovery = auth_manager
            .as_ref()
            .map(AuthManager::unauthorized_recovery);
        let mut pending_retry = PendingUnauthorizedRetry::default();
        loop {
            let client_setup = self.client.current_client_setup().await?;
            let transport = ReqwestTransport::new(build_reqwest_client());
            let request_auth_context = AuthRequestTelemetryContext::new(
                client_setup.auth.as_ref().map(CodexAuth::auth_mode),
                client_setup.api_auth.as_ref(),
                pending_retry,
            );
            let (request_telemetry, sse_telemetry) = Self::build_streaming_telemetry(
                session_telemetry,
                request_auth_context,
                RequestRouteTelemetry::for_endpoint(RESPONSES_ENDPOINT),
                self.client.state.auth_env_telemetry.clone(),
            );
            let compression = self.responses_request_compression(client_setup.auth.as_ref());
            let mut options = self
                .build_responses_options(
                    responses_metadata,
                    compression,
                    model_info.use_responses_lite,
                )
                .await;

            let mut request = self.client.build_responses_request(
                &client_setup.api_provider,
                prompt,
                model_info,
                effort.clone(),
                summary,
                service_tier.clone(),
                responses_metadata,
            )?;
            let store = request.store;
            self.client
                .prepare_response_items_for_request(&mut request.input, store);
            let inference_trace_attempt = inference_trace.start_attempt();
            inference_trace_attempt.add_request_headers(&mut options.extra_headers);
            inference_trace_attempt.record_started(&request);
            let client = ApiResponsesClient::new(
                transport,
                client_setup.api_provider,
                client_setup.api_auth,
            )
            .with_telemetry(Some(request_telemetry), Some(sse_telemetry));
            let stream_result = client.stream_request(request, options).await;

            match stream_result {
                Ok(stream) => {
                    let (stream, _) = map_response_stream(
                        stream,
                        session_telemetry.clone(),
                        inference_trace_attempt,
                    );
                    return Ok(stream);
                }
                Err(ApiError::Transport(
                    unauthorized_transport @ TransportError::Http { status, .. },
                )) if status == StatusCode::UNAUTHORIZED => {
                    let response_debug_context =
                        extract_response_debug_context(&unauthorized_transport);
                    inference_trace_attempt.record_failed(
                        &unauthorized_transport,
                        response_debug_context.request_id.as_deref(),
                        /*output_items*/ &[],
                    );
                    pending_retry = PendingUnauthorizedRetry::from_recovery(
                        handle_unauthorized(
                            unauthorized_transport,
                            &mut auth_recovery,
                            session_telemetry,
                        )
                        .await?,
                    );
                    continue;
                }
                Err(err) => {
                    let response_debug_context =
                        extract_response_debug_context_from_api_error(&err);
                    let err = map_api_error(err);
                    inference_trace_attempt.record_failed(
                        &err,
                        response_debug_context.request_id.as_deref(),
                        /*output_items*/ &[],
                    );
                    return Err(err);
                }
            }
        }
    }

    /// Streams a turn via the Anthropic Messages API.
    #[instrument(
        name = "model_client.stream_anthropic_messages_api",
        level = "info",
        skip_all,
        fields(
            model = %model_info.slug,
            wire_api = %self.client.state.provider.info().wire_api,
            transport = "anthropic_messages_http",
            http.method = "POST",
            api.path = "messages"
        )
    )]
    async fn stream_anthropic_messages_api(
        &self,
        prompt: &Prompt,
        model_info: &ModelInfo,
        session_telemetry: &SessionTelemetry,
        inference_trace: &InferenceTraceContext,
    ) -> Result<ResponseStream> {
        let client_setup = self.client.current_client_setup().await?;
        let request = self
            .client
            .build_anthropic_messages_request(prompt, model_info);
        let inference_trace_attempt = inference_trace.start_attempt();
        inference_trace_attempt.record_started(&request);

        let stream_result = self
            .send_anthropic_messages_request(&client_setup, &request)
            .await;
        match stream_result {
            Ok(api_stream) => {
                let (stream, _) = map_response_stream(
                    api_stream,
                    session_telemetry.clone(),
                    inference_trace_attempt,
                );
                Ok(stream)
            }
            Err(err) => {
                let response_debug_context = extract_response_debug_context_from_api_error(&err);
                let err = map_api_error(err);
                inference_trace_attempt.record_failed(
                    &err,
                    response_debug_context.request_id.as_deref(),
                    /*output_items*/ &[],
                );
                Err(err)
            }
        }
    }

    async fn send_anthropic_messages_request(
        &self,
        client_setup: &CurrentClientSetup,
        request: &AnthropicMessagesRequest,
    ) -> std::result::Result<codepilotx_api::ResponseStream, ApiError> {
        let url = client_setup
            .api_provider
            .url_for_path(ANTHROPIC_MESSAGES_ENDPOINT);
        let mut headers = client_setup.api_provider.headers.clone();
        client_setup.api_auth.add_auth_headers(&mut headers);
        headers.insert(
            http::header::ACCEPT,
            HeaderValue::from_static("text/event-stream"),
        );
        headers.insert(
            http::header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        headers.insert(
            ANTHROPIC_VERSION_HEADER,
            HeaderValue::from_static(ANTHROPIC_VERSION_VALUE),
        );
        if let Ok(Some(api_key)) = self.client.state.provider.info().api_key()
            && let Ok(value) = HeaderValue::from_str(&api_key)
        {
            headers.insert("x-api-key", value);
        }

        let response = build_reqwest_client()
            .post(url)
            .headers(headers)
            .json(request)
            .send()
            .await
            .map_err(|err| ApiError::Stream(format!("anthropic messages request failed: {err}")))?;

        let status = response.status();
        if !status.is_success() {
            let status = HttpStatusCode::from_u16(status.as_u16())
                .unwrap_or(HttpStatusCode::INTERNAL_SERVER_ERROR);
            let message = response.text().await.unwrap_or_else(|err| err.to_string());
            return Err(ApiError::Api { status, message });
        }

        let upstream_request_id = response
            .headers()
            .get("x-request-id")
            .or_else(|| response.headers().get("request-id"))
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        Ok(spawn_anthropic_messages_stream(
            response.bytes_stream().eventsource(),
            client_setup.api_provider.stream_idle_timeout,
            upstream_request_id,
        ))
    }

    //  Chat Completions API 

    async fn stream_chat_completions_api(
        &self,
        prompt: &Prompt,
        model_info: &ModelInfo,
        session_telemetry: &SessionTelemetry,
        inference_trace: &InferenceTraceContext,
    ) -> Result<ResponseStream> {
        let client_setup = self.client.current_client_setup().await?;
        let request = self
            .client
            .build_chat_completions_request(prompt, model_info);
        let inference_trace_attempt = inference_trace.start_attempt();
        inference_trace_attempt.record_started(&request);

        let stream_result = self
            .send_chat_completions_request(&client_setup, &request)
            .await;
        match stream_result {
            Ok(api_stream) => {
                let (stream, _) = map_response_stream(
                    api_stream,
                    session_telemetry.clone(),
                    inference_trace_attempt,
                );
                Ok(stream)
            }
            Err(err) => {
                let response_debug_context = extract_response_debug_context_from_api_error(&err);
                let err = map_api_error(err);
                inference_trace_attempt.record_failed(
                    &err,
                    response_debug_context.request_id.as_deref(),
                    /*output_items*/ &[],
                );
                Err(err)
            }
        }
    }

    async fn send_chat_completions_request(
        &self,
        client_setup: &CurrentClientSetup,
        request: &ChatCompletionsRequest,
    ) -> std::result::Result<codepilotx_api::ResponseStream, ApiError> {
        let url = client_setup
            .api_provider
            .url_for_path(CHAT_COMPLETIONS_ENDPOINT);
        let mut headers = client_setup.api_provider.headers.clone();
        client_setup.api_auth.add_auth_headers(&mut headers);
        headers.insert(
            http::header::ACCEPT,
            HeaderValue::from_static("text/event-stream"),
        );
        headers.insert(
            http::header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        // DeepSeek-specific: X-User-Id header
        headers.insert(
            HeaderName::from_static("x-user-id"),
            HeaderValue::from_static("codepilotx-cli"),
        );

        let response = build_reqwest_client()
            .post(url)
            .headers(headers)
            .json(request)
            .send()
            .await
            .map_err(|err| ApiError::Stream(format!("chat completions request failed: {err}")))?;

        let status = response.status();
        if !status.is_success() {
            let status = HttpStatusCode::from_u16(status.as_u16())
                .unwrap_or(HttpStatusCode::INTERNAL_SERVER_ERROR);
            let message = response.text().await.unwrap_or_else(|err| err.to_string());
            return Err(ApiError::Api { status, message });
        }

        let upstream_request_id = response
            .headers()
            .get("x-request-id")
            .or_else(|| response.headers().get("request-id"))
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        Ok(spawn_chat_completions_stream(
            response.bytes_stream().eventsource(),
            client_setup.api_provider.stream_idle_timeout,
            upstream_request_id,
        ))
    }

    /// Streams a turn via the Responses API over WebSocket transport.
    #[allow(clippy::too_many_arguments)]
    #[instrument(
        name = "model_client.stream_responses_websocket",
        level = "info",
        skip_all,
        fields(
            model = %model_info.slug,
            wire_api = %self.client.state.provider.info().wire_api,
            transport = "responses_websocket",
            api.path = "responses",
            turn.has_metadata_header = responses_metadata.has_turn_metadata(),
            websocket.warmup = warmup
        )
    )]
    async fn stream_responses_websocket(
        &mut self,
        prompt: &Prompt,
        model_info: &ModelInfo,
        session_telemetry: &SessionTelemetry,
        effort: Option<ReasoningEffortConfig>,
        summary: ReasoningSummaryConfig,
        service_tier: Option<String>,
        responses_metadata: &CodexResponsesMetadata,
        warmup: bool,
        request_trace: Option<W3cTraceContext>,
        inference_trace: &InferenceTraceContext,
    ) -> Result<WebsocketStreamOutcome> {
        let auth_manager = self.client.state.provider.auth_manager();

        let mut auth_recovery = auth_manager
            .as_ref()
            .map(AuthManager::unauthorized_recovery);
        let mut pending_retry = PendingUnauthorizedRetry::default();
        loop {
            let client_setup = self.client.current_client_setup().await?;
            let request_auth_context = AuthRequestTelemetryContext::new(
                client_setup.auth.as_ref().map(CodexAuth::auth_mode),
                client_setup.api_auth.as_ref(),
                pending_retry,
            );
            let request = self.client.build_responses_request(
                &client_setup.api_provider,
                prompt,
                model_info,
                effort.clone(),
                summary,
                service_tier.clone(),
                responses_metadata,
            )?;
            let mut client_metadata = self
                .client
                .build_ws_client_metadata(responses_metadata, model_info.use_responses_lite);
            if let Some(turn_state) = self.turn_state.get() {
                client_metadata.insert(X_codepilotx_TURN_STATE_HEADER.to_string(), turn_state.clone());
            }
            let mut ws_payload = ResponseCreateWsRequest {
                client_metadata: response_create_client_metadata(
                    Some(client_metadata),
                    request_trace.as_ref(),
                ),
                ..ResponseCreateWsRequest::from(&request)
            };
            if warmup {
                ws_payload.generate = Some(false);
            }

            match self
                .websocket_connection(WebsocketConnectParams {
                    session_telemetry,
                    api_provider: client_setup.api_provider,
                    api_auth: client_setup.api_auth,
                    responses_metadata,
                    auth_context: request_auth_context,
                    request_route_telemetry: RequestRouteTelemetry::for_endpoint(
                        RESPONSES_ENDPOINT,
                    ),
                })
                .await
            {
                Ok(_) => {}
                Err(ApiError::Transport(TransportError::Http { status, .. }))
                    if status == StatusCode::UPGRADE_REQUIRED =>
                {
                    return Ok(WebsocketStreamOutcome::FallbackToHttp);
                }
                Err(ApiError::Transport(
                    unauthorized_transport @ TransportError::Http { status, .. },
                )) if status == StatusCode::UNAUTHORIZED => {
                    pending_retry = PendingUnauthorizedRetry::from_recovery(
                        handle_unauthorized(
                            unauthorized_transport,
                            &mut auth_recovery,
                            session_telemetry,
                        )
                        .await?,
                    );
                    continue;
                }
                Err(err) => return Err(map_api_error(err)),
            }

            let (mut ws_request, previous_response_id_from_untraced_warmup) =
                self.prepare_websocket_request(ws_payload, &request);
            let inference_trace_attempt = if warmup {
                // Prewarm sends `generate=false`; it is connection setup, not a
                // model inference attempt that should appear in rollout traces.
                InferenceTraceAttempt::disabled()
            } else {
                inference_trace.start_attempt()
            };
            stamp_ws_stream_request_start_ms(&mut ws_request);
            let ResponsesWsRequest::ResponseCreate(ws_payload) = &mut ws_request;
            let store = ws_payload.store;
            self.client
                .prepare_response_items_for_request(&mut ws_payload.input, store);
            if previous_response_id_from_untraced_warmup {
                // The transport can reuse an untraced warmup response id and omit the
                // already-sent input, but rollout replay needs the logical model-visible
                // request rather than the compressed websocket delta.
                inference_trace_attempt.record_started(&request);
            } else {
                inference_trace_attempt.record_started(&ws_request);
            }
            self.websocket_session.last_request = Some(request);
            self.websocket_session.last_response_from_untraced_warmup = warmup;
            let websocket_connection =
                self.websocket_session.connection.as_ref().ok_or_else(|| {
                    map_api_error(ApiError::Stream(
                        "websocket connection is unavailable".to_string(),
                    ))
                })?;
            let stream_result = websocket_connection
                .stream_request(
                    ws_request,
                    self.websocket_session.connection_reused(),
                    Some(Arc::clone(&self.turn_state)),
                )
                .await
                .map_err(|err| {
                    let response_debug_context =
                        extract_response_debug_context_from_api_error(&err);
                    let err = map_api_error(err);
                    inference_trace_attempt.record_failed(
                        &err,
                        response_debug_context.request_id.as_deref(),
                        /*output_items*/ &[],
                    );
                    err
                })?;
            let (stream, last_request_rx) = map_response_stream(
                stream_result,
                session_telemetry.clone(),
                inference_trace_attempt,
            );
            self.websocket_session.last_response_rx = Some(last_request_rx);
            return Ok(WebsocketStreamOutcome::Stream(stream));
        }
    }

    /// Builds request and SSE telemetry for streaming API calls.
    fn build_streaming_telemetry(
        session_telemetry: &SessionTelemetry,
        auth_context: AuthRequestTelemetryContext,
        request_route_telemetry: RequestRouteTelemetry,
        auth_env_telemetry: AuthEnvTelemetry,
    ) -> (Arc<dyn RequestTelemetry>, Arc<dyn SseTelemetry>) {
        let telemetry = Arc::new(ApiTelemetry::new(
            session_telemetry.clone(),
            auth_context,
            request_route_telemetry,
            auth_env_telemetry,
        ));
        let request_telemetry: Arc<dyn RequestTelemetry> = telemetry.clone();
        let sse_telemetry: Arc<dyn SseTelemetry> = telemetry;
        (request_telemetry, sse_telemetry)
    }

    /// Builds telemetry for the Responses API WebSocket transport.
    fn build_websocket_telemetry(
        session_telemetry: &SessionTelemetry,
        auth_context: AuthRequestTelemetryContext,
        request_route_telemetry: RequestRouteTelemetry,
        auth_env_telemetry: AuthEnvTelemetry,
    ) -> Arc<dyn WebsocketTelemetry> {
        let telemetry = Arc::new(ApiTelemetry::new(
            session_telemetry.clone(),
            auth_context,
            request_route_telemetry,
            auth_env_telemetry,
        ));
        let websocket_telemetry: Arc<dyn WebsocketTelemetry> = telemetry;
        websocket_telemetry
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn prewarm_websocket(
        &mut self,
        prompt: &Prompt,
        model_info: &ModelInfo,
        session_telemetry: &SessionTelemetry,
        effort: Option<ReasoningEffortConfig>,
        summary: ReasoningSummaryConfig,
        service_tier: Option<String>,
        responses_metadata: &CodexResponsesMetadata,
    ) -> Result<()> {
        if !self.client.responses_websocket_enabled() {
            return Ok(());
        }
        if self.websocket_session.last_request.is_some() {
            return Ok(());
        }

        let disabled_trace = InferenceTraceContext::disabled();
        match self
            .stream_responses_websocket(
                prompt,
                model_info,
                session_telemetry,
                effort,
                summary,
                service_tier,
                responses_metadata,
                /*warmup*/ true,
                current_span_w3c_trace_context(),
                &disabled_trace,
            )
            .await
        {
            Ok(WebsocketStreamOutcome::Stream(mut stream)) => {
                // Wait for the v2 warmup request to complete before sending the first turn request.
                while let Some(event) = stream.next().await {
                    match event {
                        Ok(ResponseEvent::Completed { .. }) => break,
                        Err(err) => return Err(err),
                        _ => {}
                    }
                }
                Ok(())
            }
            Ok(WebsocketStreamOutcome::FallbackToHttp) => {
                self.try_switch_fallback_transport(session_telemetry, model_info);
                Ok(())
            }
            Err(err) => Err(err),
        }
    }

    #[allow(clippy::too_many_arguments)]
    /// Streams a single model request within the current turn.
    ///
    /// The caller is responsible for passing per-turn settings explicitly (model selection,
    /// reasoning settings, telemetry context, and turn metadata). This method will prefer the
    /// Responses WebSocket transport when the provider supports it and it remains healthy, and will
    /// fall back to the HTTP Responses API transport otherwise. The trace context may be enabled or
    /// disabled, but is always explicit so transport paths do not need separate trace/no-trace
    /// branches.
    pub async fn stream(
        &mut self,
        prompt: &Prompt,
        model_info: &ModelInfo,
        session_telemetry: &SessionTelemetry,
        effort: Option<ReasoningEffortConfig>,
        summary: ReasoningSummaryConfig,
        service_tier: Option<String>,
        responses_metadata: &CodexResponsesMetadata,
        inference_trace: &InferenceTraceContext,
    ) -> Result<ResponseStream> {
        let wire_api = self.client.state.provider.info().wire_api;
        match wire_api {
            WireApi::Responses => {
                if self.client.responses_websocket_enabled() {
                    let request_trace = current_span_w3c_trace_context();
                    match self
                        .stream_responses_websocket(
                            prompt,
                            model_info,
                            session_telemetry,
                            effort.clone(),
                            summary,
                            service_tier.clone(),
                            responses_metadata,
                            /*warmup*/ false,
                            request_trace,
                            inference_trace,
                        )
                        .await?
                    {
                        WebsocketStreamOutcome::Stream(stream) => return Ok(stream),
                        WebsocketStreamOutcome::FallbackToHttp => {
                            self.try_switch_fallback_transport(session_telemetry, model_info);
                        }
                    }
                }

                self.stream_responses_api(
                    prompt,
                    model_info,
                    session_telemetry,
                    effort,
                    summary,
                    service_tier,
                    responses_metadata,
                    inference_trace,
                )
                .await
            }
            WireApi::AnthropicMessages => {
                self.stream_anthropic_messages_api(
                    prompt,
                    model_info,
                    session_telemetry,
                    inference_trace,
                )
                .await
            }
            WireApi::ChatCompletions => {
                self.stream_chat_completions_api(
                    prompt,
                    model_info,
                    session_telemetry,
                    inference_trace,
                )
                .await
            }
        }
    }

    /// Permanently disables WebSockets for this Codex session and resets WebSocket state.
    ///
    /// This is used after exhausting the provider retry budget, to force subsequent requests onto
    /// the HTTP transport.
    ///
    /// Returns `true` if this call activated fallback, or `false` if fallback was already active.
    pub(crate) fn try_switch_fallback_transport(
        &mut self,
        session_telemetry: &SessionTelemetry,
        model_info: &ModelInfo,
    ) -> bool {
        let activated = self
            .client
            .force_http_fallback(session_telemetry, model_info);
        self.websocket_session = WebsocketSession::default();
        activated
    }
}

/// Stamp a ResponsesWsRequest with the current time.
///
/// Meant to be called just before sending the request over the socket, to capture realistic
/// transport timing.
fn stamp_ws_stream_request_start_ms(request: &mut ResponsesWsRequest) {
    let ResponsesWsRequest::ResponseCreate(payload) = request;
    payload
        .client_metadata
        .get_or_insert_with(HashMap::new)
        .insert(
            X_codepilotx_WS_STREAM_REQUEST_START_MS_CLIENT_METADATA_KEY.to_string(),
            crate::turn_timing::now_unix_timestamp_ms().to_string(),
        );
}

/// Builds the extra headers attached to Responses API requests.
///
/// These headers implement Codex-specific conventions:
///
/// - `x-codex-beta-features`: comma-separated beta feature keys enabled for the session.
/// - `x-codex-turn-state`: sticky routing token captured earlier in the turn.
fn build_responses_headers(
    beta_features_header: Option<&str>,
    turn_state: Option<&Arc<OnceLock<String>>>,
) -> ApiHeaderMap {
    let mut headers = ApiHeaderMap::new();
    if let Some(value) = beta_features_header
        && !value.is_empty()
        && let Ok(header_value) = HeaderValue::from_str(value)
    {
        headers.insert("x-codex-beta-features", header_value);
    }
    if let Some(turn_state) = turn_state
        && let Some(state) = turn_state.get()
        && let Ok(header_value) = HeaderValue::from_str(state)
    {
        headers.insert(X_codepilotx_TURN_STATE_HEADER, header_value);
    }
    headers
}

fn add_responses_lite_header(headers: &mut ApiHeaderMap, use_responses_lite: bool) {
    if use_responses_lite {
        headers.insert(
            X_OPENAI_INTERNAL_codepilotx_RESPONSES_LITE_HEADER,
            HeaderValue::from_static("true"),
        );
    }
}

const RESPONSE_STREAM_CHANNEL_CAPACITY: usize = 1600;
const STREAM_DROPPED_REASON: &str = "response stream dropped before provider terminal event";

fn anthropic_text_from_content_items(content: &[ContentItem]) -> String {
    content
        .iter()
        .filter_map(|item| match item {
            ContentItem::InputText { text } | ContentItem::OutputText { text } => {
                Some(text.as_str())
            }
            ContentItem::InputImage { .. } => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn chat_completions_output_text(output: &codepilotx_protocol::models::FunctionCallOutputPayload) -> String {
    output.body.to_text().unwrap_or_default()
}

fn build_chat_completions_tools(tools: &[ToolSpec]) -> Vec<ChatCompletionTool> {
    tools.iter().filter_map(|tool| {
        match tool {
            ToolSpec::Function(api_tool) => {
                Some(ChatCompletionTool {
                    kind: "function".to_string(),
                    function: ChatCompletionToolFunction {
                        name: api_tool.name.clone(),
                        description: api_tool.description.clone(),
                        parameters: serde_json::to_value(&api_tool.parameters).unwrap_or_default(),
                        strict: Some(api_tool.strict),
                    },
                })
            }
            _ => None,
        }
    }).collect()
}

fn build_anthropic_tools(tools: &[ToolSpec]) -> Vec<AnthropicTool> {
    tools.iter().filter_map(|tool| {
        match tool {
            ToolSpec::Function(api_tool) => {
                Some(AnthropicTool {
                    name: api_tool.name.clone(),
                    description: api_tool.description.clone(),
                    input_schema: serde_json::to_value(&api_tool.parameters).unwrap_or_default(),
                })
            }
            _ => None,
        }
    }).collect()
}

fn chat_completions_text_from_content_items(content: &[ContentItem]) -> String {
    let mut text = String::new();
    for item in content {
        match item {
            ContentItem::OutputText { text: t, .. } => text.push_str(t),
            ContentItem::InputText { text: t } => text.push_str(t),
            _ => {}
        }
    }
    text
}

/// Extract initial tool arguments from an Anthropic `content_block_start` event.
///
/// Anthropic streams typically send `tool_use.input = {}` as a placeholder in
/// `content_block_start`, with the real arguments arriving via
/// `input_json_delta.partial_json`. We skip the empty object so that
/// subsequent delta concatenation produces valid JSON.
///
/// If a provider sends a non-empty object upfront, it is serialized directly.
/// If input is `None`, returns an empty string (no initial seed).
fn anthropic_tool_input_arguments(input: Option<&serde_json::Value>) -> String {
    match input {
        Some(v) if v.is_object() && v.as_object().map_or(false, |o| o.is_empty()) => {
            String::new()
        }
        Some(v) => v.to_string(),
        None => String::new(),
    }
}

fn spawn_anthropic_messages_stream<S, E>(
    event_stream: S,
    idle_timeout: Duration,
    upstream_request_id: Option<String>,
) -> codepilotx_api::ResponseStream
where
    S: Stream<Item = std::result::Result<Event, EventStreamError<E>>> + Send + 'static,
    E: std::fmt::Display + Send + Sync + 'static,
{
    let (tx_event, rx_event) = mpsc::channel::<std::result::Result<ResponseEvent, ApiError>>(
        RESPONSE_STREAM_CHANNEL_CAPACITY,
    );
    let upstream_req_id = upstream_request_id.clone();
    tokio::spawn(async move {
        let mut event_stream = Box::pin(event_stream);
        let mut response_id = upstream_req_id.unwrap_or_else(|| "anthropic-messages".to_string());
        let mut item_id = "anthropic-messages-item".to_string();
        let mut assistant_text = String::new();
        #[allow(unused_assignments)]
        let mut started = false;

        // Tool use accumulation during stream
        #[allow(dead_code)]
        struct PendingToolCall {
            id: String,
            name: String,
            arguments: String,
        }
        let mut pending_tool_calls: Vec<PendingToolCall> = Vec::new();
        // Index within the current content block (0-based sequential)
        let mut current_block_index: i64 = -1;

        // Macro helper for sending events
        macro_rules! send_ev {
            ($event:expr) => {
                if tx_event.send(Ok($event)).await.is_err() { return; }
            };
        }

        // Ensure started + output item added
        macro_rules! ensure_started {
            () => {
                if !started {
                    started = true;
                    send_ev!(ResponseEvent::Created);
                    send_ev!(ResponseEvent::OutputItemAdded(ResponseItem::Message {
                        id: Some(item_id.clone()),
                        role: "assistant".to_string(),
                        content: Vec::new(),
                        phase: None,
                        metadata: None,
                    }));
                }
            };
        }

        // Emit final events: text item + accumulated tool calls + completed
        macro_rules! emit_final {
            () => {
                // Emit final text message
                send_ev!(ResponseEvent::OutputItemDone(ResponseItem::Message {
                    id: Some(item_id.clone()),
                    role: "assistant".to_string(),
                    content: if assistant_text.is_empty() {
                        Vec::new()
                    } else {
                        vec![ContentItem::OutputText {
                            text: std::mem::take(&mut assistant_text),
                        }]
                    },
                    phase: None,
                    metadata: None,
                }));
                // Emit each tool call item
                for tc in &pending_tool_calls {
                    let fc_id = Some(tc.id.clone());
                    // If no deltas arrived (zero-argument tool), output empty object
                    let final_args = if tc.arguments.is_empty() {
                        "{}".to_string()
                    } else {
                        tc.arguments.clone()
                    };
                    send_ev!(ResponseEvent::OutputItemAdded(ResponseItem::FunctionCall {
                        id: fc_id.clone(),
                        name: tc.name.clone(),
                        arguments: final_args.clone(),
                        call_id: tc.id.clone(),
                        namespace: None,
                        metadata: None,
                    }));
                    send_ev!(ResponseEvent::OutputItemDone(ResponseItem::FunctionCall {
                        id: fc_id,
                        name: tc.name.clone(),
                        arguments: final_args,
                        call_id: tc.id.clone(),
                        namespace: None,
                        metadata: None,
                    }));
                }
                pending_tool_calls.clear();
                // Completed
                send_ev!(ResponseEvent::Completed {
                    response_id: response_id.to_string(),
                    token_usage: None,
                    end_turn: Some(true),
                });
            };
        }

        loop {
            let poll = tokio::time::timeout(idle_timeout, event_stream.next()).await;
            let event = match poll {
                Ok(Some(Ok(event))) => event,
                Ok(Some(Err(err))) => {
                    let _ = tx_event
                        .send(Err(ApiError::Stream(format!(
                            "anthropic messages stream error: {err}"
                        ))))
                        .await;
                    return;
                }
                Ok(None) => break,
                Err(_) => {
                    let _ = tx_event
                        .send(Err(ApiError::Stream(
                            "anthropic messages stream timed out".to_string(),
                        )))
                        .await;
                    return;
                }
            };

            let data = event.data.trim();
            if data.is_empty() || data == "[DONE]" {
                continue;
            }

            let parsed: AnthropicStreamEvent = match serde_json::from_str(data) {
                Ok(parsed) => parsed,
                Err(err) => {
                    let _ = tx_event
                        .send(Err(ApiError::Stream(format!(
                            "failed to parse anthropic messages event: {err}"
                        ))))
                        .await;
                    return;
                }
            };

            match parsed.kind.as_str() {
                "message_start" => {
                    if let Some(id) = parsed.message.and_then(|message| message.id) {
                        response_id = id;
                        item_id = format!("{response_id}-message");
                    }
                    ensure_started!();
                }
                "content_block_start" => {
                    current_block_index += 1;
                    let Some(content_block) = parsed.content_block else {
                        continue;
                    };
                    match content_block.kind.as_deref() {
                        Some("text") => {
                            if let Some(text) = content_block.text {
                                ensure_started!();
                                assistant_text.push_str(&text);
                                send_ev!(ResponseEvent::OutputTextDelta(text));
                            }
                        }
                        Some("tool_use") => {
                            let call_id = content_block.id.unwrap_or_else(|| {
                                format!("{}-tool-{}", response_id, current_block_index)
                            });
                            let name = content_block.name.unwrap_or_default();
                            // Skip empty `{}` from content_block_start to avoid
                            // producing invalid JSON when delta is appended later
                            // (reference: opencode-dev approach).
                            let initial_input =
                                anthropic_tool_input_arguments(content_block.input.as_ref());
                            pending_tool_calls.push(PendingToolCall {
                                id: call_id,
                                name,
                                arguments: initial_input,
                            });
                        }
                        _ => {}
                    }
                }
                "content_block_delta" => {
                    let Some(delta) = parsed.delta else {
                        continue;
                    };
                    match delta.kind.as_deref() {
                        Some("text_delta") => {
                            if let Some(text) = delta.text {
                                ensure_started!();
                                assistant_text.push_str(&text);
                                send_ev!(ResponseEvent::OutputTextDelta(text));
                            }
                        }
                        Some("input_json_delta") => {
                            if let Some(partial) = delta.partial_json {
                                if let Some(tc) = pending_tool_calls.last_mut() {
                                    tc.arguments.push_str(&partial);
                                }
                            }
                        }
                        _ => {}
                    }
                }
                "content_block_stop" => {
                    // Content block finished ?tool call aggregation completes on message_stop
                }
                "message_stop" => {
                    ensure_started!();
                    emit_final!();
                    return;
                }
                "error" => {
                    let message = parsed
                        .error
                        .map(|error| match (error.kind, error.message) {
                            (Some(kind), Some(message)) => format!("{kind}: {message}"),
                            (Some(kind), None) => kind,
                            (None, Some(message)) => message,
                            (None, None) => "unknown anthropic stream error".to_string(),
                        })
                        .unwrap_or_else(|| "unknown anthropic stream error".to_string());
                    let _ = tx_event.send(Err(ApiError::Stream(message))).await;
                    return;
                }
                "ping" | "message_delta" => {}
                _ => {}
            }
        }

        if started {
            emit_final!();
        } else {
            let _ = tx_event
                .send(Err(ApiError::Stream(
                    "anthropic messages stream closed before message_start".to_string(),
                )))
                .await;
        }
    });

    codepilotx_api::ResponseStream {
        rx_event,
        upstream_request_id,
    }
}

/// Spawns a background task that parses a Chat Completions SSE stream and emits `ResponseEvent`s.
///
/// Handles the standard OpenAI-compatible Chat Completions streaming format:
/// - `data: {"choices":[{"delta":{"content":"..."},"finish_reason":null}]}`
/// - `data: [DONE]` as stream terminator
///
/// When `stream_options.include_usage` is `true` the provider includes a
/// `usage` object in the last chunk (either alongside `finish_reason` or in
/// a trailing empty-choices chunk). The handler captures this and emits
/// `ResponseEvent::Completed { token_usage: Some(...) }`.
fn spawn_chat_completions_stream<S, E>(
    event_stream: S,
    idle_timeout: Duration,
    upstream_request_id: Option<String>,
) -> codepilotx_api::ResponseStream
where
    S: Stream<Item = std::result::Result<Event, EventStreamError<E>>> + Send + 'static,
    E: std::fmt::Display + Send + Sync + 'static,
{
    let (tx_event, rx_event) = mpsc::channel::<std::result::Result<ResponseEvent, ApiError>>(
        RESPONSE_STREAM_CHANNEL_CAPACITY,
    );
    let upstream_request_id_val = upstream_request_id.clone();
    tokio::spawn(async move {
        let mut event_stream = Box::pin(event_stream);
        let response_id = upstream_request_id_val.unwrap_or_else(|| "chat-completions".to_string());
        let assistant_item_id = format!("{}-assistant", &response_id);
        let mut assistant_text = String::new();
        let mut started = false;
        let mut finished = false;
        let mut captured_usage: Option<TokenUsage> = None;

        // Tool call accumulation: keyed by delta index
        struct PendingToolCall {
            index: i64,
            id: String,
            name: String,
            arguments: String,
        }
        let mut pending_tool_calls: Vec<PendingToolCall> = Vec::new();

        // Macro helper to send events
        macro_rules! send_ev {
            ($event:expr) => {
                if tx_event.send(Ok($event)).await.is_err() { return; }
            };
        }

        loop {
            let poll = tokio::time::timeout(idle_timeout, event_stream.next()).await;
            let event = match poll {
                Ok(Some(Ok(event))) => event,
                Ok(Some(Err(err))) => {
                    let _ = tx_event
                        .send(Err(ApiError::Stream(format!(
                            "chat completions stream error: {err}"
                        ))))
                        .await;
                    return;
                }
                Ok(None) => break,
                Err(_) => {
                    let _ = tx_event
                        .send(Err(ApiError::Stream(
                            "chat completions stream idle timeout".to_string(),
                        )))
                        .await;
                    return;
                }
            };

            // `data: [DONE]`  stream terminator
            if event.data.trim() == "[DONE]" {
                break;
            }

            let Ok(chunk) = serde_json::from_str::<ChatCompletionChunk>(&event.data) else {
                continue;
            };

            // Capture usage from the chunk (may be in the same chunk as finish_reason
            // or in a separate trailing chunk with empty choices).
            if let Some(ref usage) = chunk.usage {
                captured_usage = Some(chat_completion_usage_to_token_usage(usage));
            }

            // If we already saw a finish_reason, skip choice processing and
            // continue reading until [DONE] to capture any trailing usage chunk.
            if finished {
                continue;
            }

            for choice in &chunk.choices {
                // Ensure output item started before first content
                if !started {
                    started = true;
                    send_ev!(ResponseEvent::Created);
                    send_ev!(ResponseEvent::OutputItemAdded(ResponseItem::Message {
                        id: Some(assistant_item_id.clone()),
                        role: "assistant".to_string(),
                        content: Vec::new(),
                        phase: None,
                        metadata: None,
                    }));
                }

                // Handle text content delta
                if let Some(ref text) = choice.delta.content {
                    assistant_text.push_str(text);
                    send_ev!(ResponseEvent::OutputTextDelta(text.clone()));
                }

                // Handle tool call deltas (accumulate by index)
                if let Some(ref tool_calls_delta) = choice.delta.tool_calls {
                    for tc in tool_calls_delta {
                        let existing = pending_tool_calls.iter_mut().find(|p| p.index == tc.index);
                        if let Some(pending) = existing {
                            // Update existing pending tool call
                            if let Some(ref id) = tc.id {
                                pending.id = id.clone();
                            }
                            if let Some(ref func) = tc.function {
                                if let Some(ref name) = func.name {
                                    pending.name.push_str(name);
                                }
                                if let Some(ref args) = func.arguments {
                                    pending.arguments.push_str(args);
                                }
                            }
                        } else {
                            // New tool call index
                            let call_id = tc.id.clone().unwrap_or_else(|| {
                                format!("call-{}-{}", response_id, tc.index)
                            });
                            let (name, args) = tc.function.as_ref().map_or(
                                (String::new(), String::new()),
                                |func| {
                                    let n = func.name.clone().unwrap_or_default();
                                    let a = func.arguments.clone().unwrap_or_default();
                                    (n, a)
                                },
                            );
                            pending_tool_calls.push(PendingToolCall {
                                index: tc.index,
                                id: call_id,
                                name,
                                arguments: args,
                            });
                        }
                    }
                }

                // Handle finish reason
                if let Some(ref finish_reason) = choice.finish_reason {
                    match finish_reason.as_str() {
                        "stop" | "length" => {
                            // Flush text
                            if !assistant_text.is_empty() {
                                send_ev!(ResponseEvent::OutputItemDone(ResponseItem::Message {
                                    id: Some(assistant_item_id.clone()),
                                    role: "assistant".to_string(),
                                    content: vec![ContentItem::OutputText {
                                        text: std::mem::take(&mut assistant_text),
                                    }],
                                    phase: None,
                                    metadata: None,
                                }));
                            }
                            finished = true;
                            break;
                        }
                        "tool_calls" => {
                            // Emit assistant message (always  even with empty text,
                            // so history has a Message to anchor tool_calls to).
                            send_ev!(ResponseEvent::OutputItemDone(ResponseItem::Message {
                                id: Some(assistant_item_id.clone()),
                                role: "assistant".to_string(),
                                content: if assistant_text.is_empty() {
                                    Vec::new()
                                } else {
                                    vec![ContentItem::OutputText {
                                        text: std::mem::take(&mut assistant_text),
                                    }]
                                },
                                phase: None,
                                metadata: None,
                            }));
                            // Emit accumulated tool calls
                            for tc in &pending_tool_calls {
                                let fc_id = Some(tc.id.clone());
                                send_ev!(ResponseEvent::OutputItemAdded(ResponseItem::FunctionCall {
                                    id: fc_id.clone(),
                                    name: tc.name.clone(),
                                    arguments: tc.arguments.clone(),
                                    call_id: tc.id.clone(),
                                    namespace: None,
                                    metadata: None,
                                }));
                                send_ev!(ResponseEvent::OutputItemDone(ResponseItem::FunctionCall {
                                    id: fc_id,
                                    name: tc.name.clone(),
                                    arguments: tc.arguments.clone(),
                                    call_id: tc.id.clone(),
                                    namespace: None,
                                    metadata: None,
                                }));
                            }
                            pending_tool_calls.clear();
                            finished = true;
                            break;
                        }
                        _ => {
                            // Unknown finish reason  treat as stop
                            if !assistant_text.is_empty() {
                                send_ev!(ResponseEvent::OutputItemDone(ResponseItem::Message {
                                    id: Some(assistant_item_id.clone()),
                                    role: "assistant".to_string(),
                                    content: vec![ContentItem::OutputText {
                                        text: std::mem::take(&mut assistant_text),
                                    }],
                                    phase: None,
                                    metadata: None,
                                }));
                            }
                            finished = true;
                            break;
                        }
                    }
                }
            }
        }

        // Stream ended ([DONE] or stream closed)
        if started {
            // If the stream ended without an explicit finish_reason, flush
            // any remaining text before sending Completed.
            if !finished {
                if !assistant_text.is_empty() {
                    send_ev!(ResponseEvent::OutputItemDone(ResponseItem::Message {
                        id: Some(assistant_item_id),
                        role: "assistant".to_string(),
                        content: vec![ContentItem::OutputText {
                            text: assistant_text,
                        }],
                        phase: None,
                        metadata: None,
                    }));
                }
            }
            send_ev!(ResponseEvent::Completed {
                response_id: response_id.clone(),
                token_usage: captured_usage,
                end_turn: Some(true),
            });
        }
    });

    codepilotx_api::ResponseStream {
        rx_event,
        upstream_request_id,
    }
}

fn map_response_stream(
    api_stream: codepilotx_api::ResponseStream,
    session_telemetry: SessionTelemetry,
    inference_trace_attempt: InferenceTraceAttempt,
) -> (ResponseStream, oneshot::Receiver<LastResponse>) {
    let codepilotx_api::ResponseStream {
        rx_event,
        upstream_request_id,
    } = api_stream;
    let api_stream = codepilotx_api::ResponseStream {
        rx_event,
        upstream_request_id: None,
    };
    map_response_events(
        upstream_request_id,
        api_stream,
        session_telemetry,
        inference_trace_attempt,
    )
}

fn map_response_events<S>(
    upstream_request_id: Option<String>,
    api_stream: S,
    session_telemetry: SessionTelemetry,
    inference_trace_attempt: InferenceTraceAttempt,
) -> (ResponseStream, oneshot::Receiver<LastResponse>)
where
    S: futures::Stream<Item = std::result::Result<ResponseEvent, ApiError>>
        + Unpin
        + Send
        + 'static,
{
    let (tx_event, rx_event) =
        mpsc::channel::<Result<ResponseEvent>>(RESPONSE_STREAM_CHANNEL_CAPACITY);
    let (tx_last_response, rx_last_response) = oneshot::channel::<LastResponse>();
    let consumer_dropped = CancellationToken::new();
    let consumer_dropped_for_stream = consumer_dropped.clone();

    tokio::spawn(async move {
        let mut logged_error = false;
        let mut tx_last_response = Some(tx_last_response);
        let mut items_added: Vec<ResponseItem> = Vec::new();
        let mut api_stream = api_stream;
        let upstream_request_id = upstream_request_id.as_deref();
        if let Some(upstream_request_id) = upstream_request_id {
            feedback_tags!(last_model_request_id = upstream_request_id);
        }
        loop {
            let event = tokio::select! {
                _ = consumer_dropped.cancelled() => {
                    inference_trace_attempt.record_cancelled(
                        STREAM_DROPPED_REASON,
                        upstream_request_id,
                        &items_added,
                    );
                    return;
                }
                event = api_stream.next() => event,
            };
            let Some(event) = event else {
                break;
            };
            match event {
                Ok(ResponseEvent::OutputItemDone(item)) => {
                    items_added.push(item.clone());
                    if tx_event
                        .send(Ok(ResponseEvent::OutputItemDone(item)))
                        .await
                        .is_err()
                    {
                        inference_trace_attempt.record_cancelled(
                            STREAM_DROPPED_REASON,
                            upstream_request_id,
                            &items_added,
                        );
                        return;
                    }
                }
                Ok(ResponseEvent::Completed {
                    response_id,
                    token_usage,
                    end_turn,
                }) => {
                    feedback_tags!(last_model_response_id = &response_id);
                    if let Some(usage) = &token_usage {
                        session_telemetry.sse_event_completed(
                            usage.input_tokens,
                            usage.output_tokens,
                            Some(usage.cached_input_tokens),
                            Some(usage.reasoning_output_tokens),
                            usage.total_tokens,
                        );
                    }
                    inference_trace_attempt.record_completed(
                        &response_id,
                        upstream_request_id,
                        &token_usage,
                        &items_added,
                    );
                    if let Some(sender) = tx_last_response.take() {
                        let _ = sender.send(LastResponse {
                            response_id: response_id.clone(),
                            items_added: std::mem::take(&mut items_added),
                        });
                    }
                    if tx_event
                        .send(Ok(ResponseEvent::Completed {
                            response_id,
                            token_usage,
                            end_turn,
                        }))
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
                Ok(event) => {
                    if tx_event.send(Ok(event)).await.is_err() {
                        inference_trace_attempt.record_cancelled(
                            STREAM_DROPPED_REASON,
                            upstream_request_id,
                            &items_added,
                        );
                        return;
                    }
                }
                Err(err) => {
                    let response_debug_context =
                        extract_response_debug_context_from_api_error(&err);
                    let upstream_request_id =
                        upstream_request_id.or(response_debug_context.request_id.as_deref());
                    if let Some(upstream_request_id) = upstream_request_id {
                        feedback_tags!(last_model_request_id = upstream_request_id);
                    }
                    let mapped = map_api_error(err);
                    inference_trace_attempt.record_failed(
                        &mapped,
                        upstream_request_id,
                        &items_added,
                    );
                    if !logged_error {
                        session_telemetry.see_event_completed_failed(&mapped);
                        logged_error = true;
                    }
                    if tx_event.send(Err(mapped)).await.is_err() {
                        return;
                    }
                }
            }
        }
        inference_trace_attempt.record_failed(
            "stream closed before response.completed",
            upstream_request_id,
            &items_added,
        );
    });

    (
        ResponseStream {
            rx_event,
            consumer_dropped: consumer_dropped_for_stream,
        },
        rx_last_response,
    )
}

/// Handles a 401 response by optionally refreshing ChatGPT tokens once.
///
/// When refresh succeeds, the caller should retry the API call; otherwise
/// the mapped `CodexErr` is returned to the caller.
#[derive(Clone, Copy, Debug)]
struct UnauthorizedRecoveryExecution {
    mode: &'static str,
    phase: &'static str,
}

#[derive(Clone, Copy, Debug, Default)]
struct PendingUnauthorizedRetry {
    retry_after_unauthorized: bool,
    recovery_mode: Option<&'static str>,
    recovery_phase: Option<&'static str>,
}

impl PendingUnauthorizedRetry {
    fn from_recovery(recovery: UnauthorizedRecoveryExecution) -> Self {
        Self {
            retry_after_unauthorized: true,
            recovery_mode: Some(recovery.mode),
            recovery_phase: Some(recovery.phase),
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct AuthRequestTelemetryContext {
    auth_mode: Option<&'static str>,
    auth_header_attached: bool,
    auth_header_name: Option<&'static str>,
    retry_after_unauthorized: bool,
    recovery_mode: Option<&'static str>,
    recovery_phase: Option<&'static str>,
}

impl AuthRequestTelemetryContext {
    fn new(
        auth_mode: Option<AuthMode>,
        api_auth: &dyn AuthProvider,
        retry: PendingUnauthorizedRetry,
    ) -> Self {
        let auth_telemetry = auth_header_telemetry(api_auth);
        Self {
            auth_mode: auth_mode.map(|mode| match mode {
                AuthMode::ApiKey | AuthMode::BedrockApiKey => "ApiKey",
                AuthMode::Chatgpt
                | AuthMode::ChatgptAuthTokens
                | AuthMode::AgentIdentity
                | AuthMode::PersonalAccessToken => "Chatgpt",
            }),
            auth_header_attached: auth_telemetry.attached,
            auth_header_name: auth_telemetry.name,
            retry_after_unauthorized: retry.retry_after_unauthorized,
            recovery_mode: retry.recovery_mode,
            recovery_phase: retry.recovery_phase,
        }
    }
}

struct WebsocketConnectParams<'a> {
    session_telemetry: &'a SessionTelemetry,
    api_provider: codepilotx_api::Provider,
    api_auth: SharedAuthProvider,
    responses_metadata: &'a CodexResponsesMetadata,
    auth_context: AuthRequestTelemetryContext,
    request_route_telemetry: RequestRouteTelemetry,
}

async fn handle_unauthorized(
    transport: TransportError,
    auth_recovery: &mut Option<UnauthorizedRecovery>,
    session_telemetry: &SessionTelemetry,
) -> Result<UnauthorizedRecoveryExecution> {
    let debug = extract_response_debug_context(&transport);
    if let Some(recovery) = auth_recovery
        && recovery.has_next()
    {
        let mode = recovery.mode_name();
        let phase = recovery.step_name();
        return match recovery.next().await {
            Ok(step_result) => {
                session_telemetry.record_auth_recovery(
                    mode,
                    phase,
                    "recovery_succeeded",
                    debug.request_id.as_deref(),
                    debug.cf_ray.as_deref(),
                    debug.auth_error.as_deref(),
                    debug.auth_error_code.as_deref(),
                    /*recovery_reason*/ None,
                    step_result.auth_state_changed(),
                );
                emit_feedback_auth_recovery_tags(
                    mode,
                    phase,
                    "recovery_succeeded",
                    debug.request_id.as_deref(),
                    debug.cf_ray.as_deref(),
                    debug.auth_error.as_deref(),
                    debug.auth_error_code.as_deref(),
                );
                Ok(UnauthorizedRecoveryExecution { mode, phase })
            }
            Err(RefreshTokenError::Permanent(failed)) => {
                session_telemetry.record_auth_recovery(
                    mode,
                    phase,
                    "recovery_failed_permanent",
                    debug.request_id.as_deref(),
                    debug.cf_ray.as_deref(),
                    debug.auth_error.as_deref(),
                    debug.auth_error_code.as_deref(),
                    /*recovery_reason*/ None,
                    /*auth_state_changed*/ None,
                );
                emit_feedback_auth_recovery_tags(
                    mode,
                    phase,
                    "recovery_failed_permanent",
                    debug.request_id.as_deref(),
                    debug.cf_ray.as_deref(),
                    debug.auth_error.as_deref(),
                    debug.auth_error_code.as_deref(),
                );
                Err(CodexErr::RefreshTokenFailed(failed))
            }
            Err(RefreshTokenError::Transient(other)) => {
                session_telemetry.record_auth_recovery(
                    mode,
                    phase,
                    "recovery_failed_transient",
                    debug.request_id.as_deref(),
                    debug.cf_ray.as_deref(),
                    debug.auth_error.as_deref(),
                    debug.auth_error_code.as_deref(),
                    /*recovery_reason*/ None,
                    /*auth_state_changed*/ None,
                );
                emit_feedback_auth_recovery_tags(
                    mode,
                    phase,
                    "recovery_failed_transient",
                    debug.request_id.as_deref(),
                    debug.cf_ray.as_deref(),
                    debug.auth_error.as_deref(),
                    debug.auth_error_code.as_deref(),
                );
                Err(CodexErr::Io(other))
            }
        };
    }

    let (mode, phase, recovery_reason) = match auth_recovery.as_ref() {
        Some(recovery) => (
            recovery.mode_name(),
            recovery.step_name(),
            Some(recovery.unavailable_reason()),
        ),
        None => ("none", "none", Some("auth_manager_missing")),
    };
    session_telemetry.record_auth_recovery(
        mode,
        phase,
        "recovery_not_run",
        debug.request_id.as_deref(),
        debug.cf_ray.as_deref(),
        debug.auth_error.as_deref(),
        debug.auth_error_code.as_deref(),
        recovery_reason,
        /*auth_state_changed*/ None,
    );
    emit_feedback_auth_recovery_tags(
        mode,
        phase,
        "recovery_not_run",
        debug.request_id.as_deref(),
        debug.cf_ray.as_deref(),
        debug.auth_error.as_deref(),
        debug.auth_error_code.as_deref(),
    );

    Err(map_api_error(ApiError::Transport(transport)))
}

fn api_error_http_status(error: &ApiError) -> Option<u16> {
    match error {
        ApiError::Transport(TransportError::Http { status, .. }) => Some(status.as_u16()),
        _ => None,
    }
}

struct ApiTelemetry {
    session_telemetry: SessionTelemetry,
    auth_context: AuthRequestTelemetryContext,
    request_route_telemetry: RequestRouteTelemetry,
    auth_env_telemetry: AuthEnvTelemetry,
}

impl ApiTelemetry {
    fn new(
        session_telemetry: SessionTelemetry,
        auth_context: AuthRequestTelemetryContext,
        request_route_telemetry: RequestRouteTelemetry,
        auth_env_telemetry: AuthEnvTelemetry,
    ) -> Self {
        Self {
            session_telemetry,
            auth_context,
            request_route_telemetry,
            auth_env_telemetry,
        }
    }
}

impl RequestTelemetry for ApiTelemetry {
    fn on_request(
        &self,
        attempt: u64,
        status: Option<HttpStatusCode>,
        error: Option<&TransportError>,
        duration: Duration,
    ) {
        let error_message = error.map(telemetry_transport_error_message);
        let status = status.map(|s| s.as_u16());
        let debug = error
            .map(extract_response_debug_context)
            .unwrap_or_default();
        self.session_telemetry.record_api_request(
            attempt,
            status,
            error_message.as_deref(),
            duration,
            self.auth_context.auth_header_attached,
            self.auth_context.auth_header_name,
            self.auth_context.retry_after_unauthorized,
            self.auth_context.recovery_mode,
            self.auth_context.recovery_phase,
            self.request_route_telemetry.endpoint,
            debug.request_id.as_deref(),
            debug.cf_ray.as_deref(),
            debug.auth_error.as_deref(),
            debug.auth_error_code.as_deref(),
        );
        emit_feedback_request_tags_with_auth_env(
            &FeedbackRequestTags {
                endpoint: self.request_route_telemetry.endpoint,
                auth_header_attached: self.auth_context.auth_header_attached,
                auth_header_name: self.auth_context.auth_header_name,
                auth_mode: self.auth_context.auth_mode,
                auth_retry_after_unauthorized: Some(self.auth_context.retry_after_unauthorized),
                auth_recovery_mode: self.auth_context.recovery_mode,
                auth_recovery_phase: self.auth_context.recovery_phase,
                auth_connection_reused: None,
                auth_request_id: debug.request_id.as_deref(),
                auth_cf_ray: debug.cf_ray.as_deref(),
                auth_error: debug.auth_error.as_deref(),
                auth_error_code: debug.auth_error_code.as_deref(),
                auth_recovery_followup_success: self
                    .auth_context
                    .retry_after_unauthorized
                    .then_some(error.is_none()),
                auth_recovery_followup_status: self
                    .auth_context
                    .retry_after_unauthorized
                    .then_some(status)
                    .flatten(),
            },
            &self.auth_env_telemetry,
        );
    }
}

impl SseTelemetry for ApiTelemetry {
    fn on_sse_poll(
        &self,
        result: &std::result::Result<
            Option<std::result::Result<Event, EventStreamError<TransportError>>>,
            tokio::time::error::Elapsed,
        >,
        duration: Duration,
    ) {
        self.session_telemetry.log_sse_event(result, duration);
    }
}

impl WebsocketTelemetry for ApiTelemetry {
    fn on_ws_request(&self, duration: Duration, error: Option<&ApiError>, connection_reused: bool) {
        let error_message = error.map(telemetry_api_error_message);
        let status = error.and_then(api_error_http_status);
        let debug = error
            .map(extract_response_debug_context_from_api_error)
            .unwrap_or_default();
        self.session_telemetry.record_websocket_request(
            duration,
            error_message.as_deref(),
            connection_reused,
        );
        emit_feedback_request_tags_with_auth_env(
            &FeedbackRequestTags {
                endpoint: self.request_route_telemetry.endpoint,
                auth_header_attached: self.auth_context.auth_header_attached,
                auth_header_name: self.auth_context.auth_header_name,
                auth_mode: self.auth_context.auth_mode,
                auth_retry_after_unauthorized: Some(self.auth_context.retry_after_unauthorized),
                auth_recovery_mode: self.auth_context.recovery_mode,
                auth_recovery_phase: self.auth_context.recovery_phase,
                auth_connection_reused: Some(connection_reused),
                auth_request_id: debug.request_id.as_deref(),
                auth_cf_ray: debug.cf_ray.as_deref(),
                auth_error: debug.auth_error.as_deref(),
                auth_error_code: debug.auth_error_code.as_deref(),
                auth_recovery_followup_success: self
                    .auth_context
                    .retry_after_unauthorized
                    .then_some(error.is_none()),
                auth_recovery_followup_status: self
                    .auth_context
                    .retry_after_unauthorized
                    .then_some(status)
                    .flatten(),
            },
            &self.auth_env_telemetry,
        );
    }

    fn on_ws_event(
        &self,
        result: &std::result::Result<Option<std::result::Result<Message, Error>>, ApiError>,
        duration: Duration,
    ) {
        self.session_telemetry
            .record_websocket_event(result, duration);
    }
}

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
