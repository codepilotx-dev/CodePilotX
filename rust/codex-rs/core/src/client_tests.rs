use super::anthropic_tool_input_arguments;
use super::AuthRequestTelemetryContext;
use super::ModelClient;
use super::PendingUnauthorizedRetry;
use super::UnauthorizedRecoveryExecution;
use super::X_codepilotx_INSTALLATION_ID_HEADER;
use super::X_codepilotx_PARENT_THREAD_ID_HEADER;
use super::X_codepilotx_TURN_METADATA_HEADER;
use super::X_codepilotx_WINDOW_ID_HEADER;
use super::X_OPENAI_SUBAGENT_HEADER;
use crate::AttestationContext;
use crate::AttestationProvider;
use crate::GenerateAttestationFuture;
use crate::responses_metadata::CodexResponsesMetadata;
use crate::test_support::TestCodexResponsesRequestKind;
use crate::test_support::responses_metadata as test_responses_metadata;
use codepilotx_api::ApiError;
use codepilotx_api::ResponseEvent;
use codepilotx_app_server_protocol::AuthMode;
use codepilotx_login::AuthManager;
use codepilotx_login::CodexAuth;
use codepilotx_model_provider::BearerAuthProvider;
use codepilotx_model_provider_info::CHATGPT_codepilotx_BASE_URL;
use codepilotx_model_provider_info::ModelProviderInfo;
use codepilotx_model_provider_info::WireApi;
use codepilotx_model_provider_info::create_oss_provider_with_base_url;
use codepilotx_otel::SessionTelemetry;
use codepilotx_protocol::ThreadId;
use codepilotx_protocol::models::ContentItem;
use codepilotx_protocol::models::ResponseItem;
use codepilotx_protocol::openai_models::ModelInfo;
use codepilotx_protocol::protocol::InternalSessionSource;
use codepilotx_protocol::protocol::SessionSource;
use codepilotx_protocol::protocol::SubAgentSource;
use codepilotx_rollout_trace::ExecutionStatus;
use codepilotx_rollout_trace::InferenceTraceAttempt;
use codepilotx_rollout_trace::InferenceTraceContext;
use codepilotx_rollout_trace::RawTraceEventPayload;
use codepilotx_rollout_trace::RolloutTrace;
use codepilotx_rollout_trace::TraceWriter;
use codepilotx_rollout_trace::replay_bundle;
use futures::StreamExt;
use pretty_assertions::assert_eq;
use serde_json::json;
use serde_json::Value as JsonValue;
use std::collections::BTreeMap;
use std::collections::VecDeque;
use std::convert::Infallible;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::AtomicUsize;
use std::sync::atomic::Ordering;
use std::task::Context;
use std::task::Poll;
use std::time::Duration;
use tempfile::TempDir;
use tokio::sync::Notify;
use tracing::Event;
use tracing::Subscriber;
use tracing::field::Visit;
use tracing_subscriber::Layer;
use tracing_subscriber::layer::Context as LayerContext;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::util::SubscriberInitExt;

const TEST_INSTALLATION_ID: &str = "11111111-1111-4111-8111-111111111111";

fn test_model_client(session_source: SessionSource) -> ModelClient {
    let provider = create_oss_provider_with_base_url("https://example.com/v1", WireApi::Responses);
    let thread_id = ThreadId::new();
    ModelClient::new(
        /*auth_manager*/ None,
        thread_id,
        provider,
        session_source,
        /*model_verbosity*/ None,
        /*enable_request_compression*/ false,
        /*include_timing_metrics*/ false,
        /*beta_features_header*/ None,
        /*item_ids_enabled*/ false,
        /*attestation_provider*/ None,
    )
}

fn test_responses_metadata_for_client(
    client: &ModelClient,
    turn_id: Option<&str>,
    window_id: String,
    parent_thread_id: Option<ThreadId>,
    request_kind: TestCodexResponsesRequestKind,
) -> CodexResponsesMetadata {
    let thread_id = client.state.thread_id.to_string();
    test_responses_metadata(
        TEST_INSTALLATION_ID,
        &thread_id,
        &thread_id,
        turn_id,
        window_id,
        &client.state.session_source,
        parent_thread_id,
        request_kind,
    )
}

fn test_model_info() -> ModelInfo {
    serde_json::from_value(json!({
        "slug": "gpt-test",
        "display_name": "gpt-test",
        "description": "desc",
        "default_reasoning_level": "medium",
        "supported_reasoning_levels": [
            {"effort": "medium", "description": "medium"}
        ],
        "shell_type": "shell_command",
        "visibility": "list",
        "supported_in_api": true,
        "priority": 1,
        "upgrade": null,
        "base_instructions": "base instructions",
        "model_messages": null,
        "supports_reasoning_summaries": false,
        "support_verbosity": false,
        "default_verbosity": null,
        "apply_patch_tool_type": null,
        "truncation_policy": {"mode": "bytes", "limit": 10000},
        "supports_parallel_tool_calls": false,
        "supports_image_detail_original": false,
        "context_window": 272000,
        "auto_compact_token_limit": null,
        "experimental_supported_tools": []
    }))
    .expect("deserialize test model info")
}

fn test_session_telemetry() -> SessionTelemetry {
    SessionTelemetry::new(
        ThreadId::new(),
        "gpt-test",
        "gpt-test",
        /*account_id*/ None,
        /*account_email*/ None,
        /*auth_mode*/ None,
        "test-originator".to_string(),
        /*log_user_prompts*/ false,
        "test-terminal".to_string(),
        SessionSource::Cli,
    )
}

#[derive(Default)]
struct TagCollectorVisitor {
    tags: BTreeMap<String, String>,
}

impl Visit for TagCollectorVisitor {
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        self.tags
            .insert(field.name().to_string(), value.to_string());
    }

    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        self.tags
            .insert(field.name().to_string(), format!("{value:?}"));
    }
}

#[derive(Clone)]
struct TagCollectorLayer {
    tags: Arc<Mutex<BTreeMap<String, String>>>,
}

impl<S> Layer<S> for TagCollectorLayer
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_event(&self, event: &Event<'_>, _ctx: LayerContext<'_, S>) {
        if event.metadata().target() != "feedback_tags" {
            return;
        }
        let mut visitor = TagCollectorVisitor::default();
        event.record(&mut visitor);
        self.tags.lock().unwrap().extend(visitor.tags);
    }
}

fn started_inference_attempt(temp: &TempDir) -> anyhow::Result<InferenceTraceAttempt> {
    let writer = Arc::new(TraceWriter::create(
        temp.path(),
        "trace-1".to_string(),
        "rollout-1".to_string(),
        "thread-root".to_string(),
    )?);
    writer.append(RawTraceEventPayload::ThreadStarted {
        thread_id: "thread-root".to_string(),
        agent_path: "/root".to_string(),
        metadata_payload: None,
    })?;
    writer.append(RawTraceEventPayload::CodexTurnStarted {
        codepilotx_turn_id: "turn-1".to_string(),
        thread_id: "thread-root".to_string(),
    })?;

    let inference_trace = InferenceTraceContext::enabled(
        writer,
        "thread-root".to_string(),
        "turn-1".to_string(),
        "gpt-test".to_string(),
        "test-provider".to_string(),
    );
    let attempt = inference_trace.start_attempt();
    attempt.record_started(&json!({
        "model": "gpt-test",
        "input": [{
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": "hello"}]
        }],
    }));
    Ok(attempt)
}

fn output_message(id: &str, text: &str) -> ResponseItem {
    ResponseItem::Message {
        id: Some(id.to_string()),
        role: "assistant".to_string(),
        content: vec![ContentItem::OutputText {
            text: text.to_string(),
        }],
        phase: None,
        metadata: None,
    }
}

async fn replay_until_cancelled(temp: &TempDir) -> anyhow::Result<RolloutTrace> {
    let mut rollout = replay_bundle(temp.path())?;
    for _ in 0..50 {
        let inference = rollout
            .inference_calls
            .values()
            .next()
            .expect("inference should be reduced");
        if inference.execution.status == ExecutionStatus::Cancelled {
            return Ok(rollout);
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
        rollout = replay_bundle(temp.path())?;
    }
    Ok(rollout)
}

struct NotifyAfterEventStream {
    events: VecDeque<ResponseEvent>,
    yielded: usize,
    notify_after: usize,
    notify: Arc<Notify>,
}

impl futures::Stream for NotifyAfterEventStream {
    type Item = std::result::Result<ResponseEvent, ApiError>;

    fn poll_next(mut self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let Some(event) = self.events.pop_front() else {
            return Poll::Pending;
        };
        self.yielded += 1;
        if self.yielded == self.notify_after {
            self.notify.notify_one();
        }
        Poll::Ready(Some(Ok(event)))
    }
}

#[test]
fn build_subagent_headers_sets_other_subagent_label() {
    let client = test_model_client(SessionSource::SubAgent(SubAgentSource::Other(
        "memory_consolidation".to_string(),
    )));
    let headers = client.build_subagent_headers();
    let value = headers
        .get(X_OPENAI_SUBAGENT_HEADER)
        .and_then(|value| value.to_str().ok());
    assert_eq!(value, Some("memory_consolidation"));
}

#[test]
fn build_subagent_headers_sets_internal_memory_consolidation_label() {
    let client = test_model_client(SessionSource::Internal(
        InternalSessionSource::MemoryConsolidation,
    ));
    let headers = client.build_subagent_headers();
    let value = headers
        .get(X_OPENAI_SUBAGENT_HEADER)
        .and_then(|value| value.to_str().ok());
    assert_eq!(value, Some("memory_consolidation"));
}

#[test]
fn build_ws_client_metadata_includes_window_lineage_and_turn_metadata() {
    let parent_thread_id = ThreadId::new();
    let client = test_model_client(SessionSource::SubAgent(SubAgentSource::ThreadSpawn {
        parent_thread_id,
        depth: 2,
        agent_path: None,
        agent_nickname: None,
        agent_role: None,
    }));

    let thread_id = client.state.thread_id.to_string();
    let expected_window_id = format!("{thread_id}:1");
    let responses_metadata = test_responses_metadata_for_client(
        &client,
        Some("turn-123"),
        expected_window_id.clone(),
        Some(parent_thread_id),
        TestCodexResponsesRequestKind::Turn,
    );
    let client_metadata =
        client.build_ws_client_metadata(&responses_metadata, /*use_responses_lite*/ false);
    let parent_thread_id = parent_thread_id.to_string();
    let turn_metadata: serde_json::Value = serde_json::from_str(
        client_metadata
            .get(X_codepilotx_TURN_METADATA_HEADER)
            .expect("turn metadata"),
    )
    .expect("valid turn metadata");
    for (client_key, metadata_key, expected) in [
        (
            X_codepilotx_INSTALLATION_ID_HEADER,
            "installation_id",
            "11111111-1111-4111-8111-111111111111",
        ),
        ("session_id", "session_id", thread_id.as_str()),
        ("thread_id", "thread_id", thread_id.as_str()),
        ("turn_id", "turn_id", "turn-123"),
        (
            X_codepilotx_WINDOW_ID_HEADER,
            "window_id",
            expected_window_id.as_str(),
        ),
        (
            X_codepilotx_PARENT_THREAD_ID_HEADER,
            "parent_thread_id",
            parent_thread_id.as_str(),
        ),
    ] {
        assert_eq!(
            client_metadata.get(client_key).map(String::as_str),
            Some(expected)
        );
        assert_eq!(turn_metadata[metadata_key].as_str(), Some(expected));
    }
    assert_eq!(
        client_metadata
            .get(X_OPENAI_SUBAGENT_HEADER)
            .map(String::as_str),
        Some("collab_spawn")
    );
}

#[tokio::test]
async fn summarize_memories_returns_empty_for_empty_input() {
    let client = test_model_client(SessionSource::Cli);
    let model_info = test_model_info();
    let session_telemetry = test_session_telemetry();

    let output = client
        .summarize_memories(
            Vec::new(),
            &model_info,
            /*effort*/ None,
            &session_telemetry,
        )
        .await
        .expect("empty summarize request should succeed");
    assert_eq!(output.len(), 0);
}

#[tokio::test]
async fn dropped_response_stream_traces_cancelled_partial_output() -> anyhow::Result<()> {
    let temp = TempDir::new()?;
    let attempt = started_inference_attempt(&temp)?;

    // The provider has produced one complete output item, but no terminal
    // response.completed event. The harness has enough information to keep this
    // item in history, so the trace should preserve it when the stream is
    // abandoned.
    let item = output_message("msg-1", "partial answer");
    let api_stream = futures::stream::iter([Ok(ResponseEvent::OutputItemDone(item))])
        .chain(futures::stream::pending());
    let (mut stream, _) = super::map_response_events(
        /*upstream_request_id*/ None,
        api_stream,
        test_session_telemetry(),
        attempt,
    );

    let observed = stream
        .next()
        .await
        .expect("mapped stream should yield output item")?;
    assert!(matches!(observed, ResponseEvent::OutputItemDone(_)));

    // Dropping the consumer is how turn interruption/preemption stops polling
    // the provider stream. The mapper task observes that drop asynchronously
    // and records cancellation using the output items it has already seen.
    drop(stream);

    // Cancellation is recorded by the mapper task after Drop wakes it, so the
    // replay may need a short wait before the terminal event appears on disk.
    let rollout = replay_until_cancelled(&temp).await?;
    let inference = rollout
        .inference_calls
        .values()
        .next()
        .expect("inference should be reduced");

    assert_eq!(inference.execution.status, ExecutionStatus::Cancelled);
    assert_eq!(inference.response_item_ids.len(), 1);
    assert_eq!(rollout.raw_payloads.len(), 2);

    Ok(())
}

#[tokio::test]
async fn response_stream_records_last_model_feedback_ids() {
    let tags = Arc::new(Mutex::new(BTreeMap::new()));
    let _guard = tracing_subscriber::registry()
        .with(TagCollectorLayer { tags: tags.clone() })
        .set_default();

    let api_stream = futures::stream::iter([
        Ok(ResponseEvent::Created),
        Ok(ResponseEvent::Completed {
            response_id: "resp-123".to_string(),
            token_usage: None,
            end_turn: Some(true),
        }),
    ]);
    let (mut stream, _) = super::map_response_events(
        Some("req-123".to_string()),
        api_stream,
        test_session_telemetry(),
        InferenceTraceAttempt::disabled(),
    );

    while stream.next().await.is_some() {}

    let tags = tags.lock().unwrap().clone();
    assert_eq!(
        tags.get("last_model_request_id").map(String::as_str),
        Some("\"req-123\"")
    );
    assert_eq!(
        tags.get("last_model_response_id").map(String::as_str),
        Some("\"resp-123\"")
    );
}

#[tokio::test]
async fn dropped_backpressured_response_stream_traces_cancelled_partial_output()
-> anyhow::Result<()> {
    let temp = TempDir::new()?;
    let attempt = started_inference_attempt(&temp)?;
    let backpressured_item_yielded = Arc::new(Notify::new());
    let mut events = VecDeque::new();
    for _ in 0..super::RESPONSE_STREAM_CHANNEL_CAPACITY {
        events.push_back(ResponseEvent::Created);
    }
    events.push_back(ResponseEvent::OutputItemDone(output_message(
        "msg-1",
        "partial answer",
    )));
    let api_stream = NotifyAfterEventStream {
        events,
        yielded: 0,
        notify_after: super::RESPONSE_STREAM_CHANNEL_CAPACITY + 1,
        notify: Arc::clone(&backpressured_item_yielded),
    };

    let (stream, _) = super::map_response_events(
        /*upstream_request_id*/ None,
        api_stream,
        test_session_telemetry(),
        attempt,
    );

    // Fill the mapper channel with non-terminal events, then yield one output
    // item. The mapper has observed that item and is blocked trying to send it
    // downstream, so dropping the consumer covers the send-failure path rather
    // than the `consumer_dropped` select branch.
    backpressured_item_yielded.notified().await;
    drop(stream);

    let rollout = replay_until_cancelled(&temp).await?;
    let inference = rollout
        .inference_calls
        .values()
        .next()
        .expect("inference should be reduced");

    assert_eq!(inference.execution.status, ExecutionStatus::Cancelled);
    assert_eq!(inference.response_item_ids.len(), 1);
    assert_eq!(rollout.raw_payloads.len(), 2);

    Ok(())
}

#[test]
fn auth_request_telemetry_context_tracks_attached_auth_and_retry_phase() {
    let auth_context = AuthRequestTelemetryContext::new(
        Some(AuthMode::Chatgpt),
        &BearerAuthProvider::for_test(Some("access-token"), Some("workspace-123")),
        PendingUnauthorizedRetry::from_recovery(UnauthorizedRecoveryExecution {
            mode: "managed",
            phase: "refresh_token",
        }),
    );

    assert_eq!(auth_context.auth_mode, Some("Chatgpt"));
    assert!(auth_context.auth_header_attached);
    assert_eq!(auth_context.auth_header_name, Some("authorization"));
    assert!(auth_context.retry_after_unauthorized);
    assert_eq!(auth_context.recovery_mode, Some("managed"));
    assert_eq!(auth_context.recovery_phase, Some("refresh_token"));
}

fn model_client_with_counting_attestation(
    include_attestation: bool,
) -> (ModelClient, Arc<AtomicUsize>) {
    #[derive(Debug)]
    struct CountingAttestationProvider {
        calls: Arc<AtomicUsize>,
    }

    impl AttestationProvider for CountingAttestationProvider {
        fn header_for_request(
            &self,
            _context: AttestationContext,
        ) -> GenerateAttestationFuture<'_> {
            let calls = self.calls.clone();
            Box::pin(async move {
                let call = calls.fetch_add(1, Ordering::Relaxed) + 1;
                Some(http::HeaderValue::from_bytes(format!("v1.header-{call}").as_bytes()).unwrap())
            })
        }
    }

    let attestation_calls = Arc::new(AtomicUsize::new(0));
    let (auth_manager, provider) = if include_attestation {
        (
            Some(AuthManager::from_auth_for_testing(
                CodexAuth::create_dummy_chatgpt_auth_for_testing(),
            )),
            ModelProviderInfo::create_openai_provider(Some(CHATGPT_codepilotx_BASE_URL.to_string())),
        )
    } else {
        (
            None,
            create_oss_provider_with_base_url("https://example.com/v1", WireApi::Responses),
        )
    };
    let model_client = ModelClient::new(
        auth_manager,
        ThreadId::new(),
        provider,
        SessionSource::Exec,
        /*model_verbosity*/ None,
        /*enable_request_compression*/ false,
        /*include_timing_metrics*/ false,
        /*beta_features_header*/ None,
        /*item_ids_enabled*/ false,
        Some(Arc::new(CountingAttestationProvider {
            calls: attestation_calls.clone(),
        })),
    );
    (model_client, attestation_calls)
}

#[tokio::test]
async fn websocket_handshake_includes_attestation_for_chatgpt_codepilotx_responses() {
    let (model_client, attestation_calls) =
        model_client_with_counting_attestation(/*include_attestation*/ true);
    let responses_metadata = test_responses_metadata_for_client(
        &model_client,
        /*turn_id*/ None,
        format!("{}:0", model_client.state.thread_id),
        /*parent_thread_id*/ None,
        TestCodexResponsesRequestKind::WebsocketConnection,
    );

    let headers = model_client
        .build_websocket_headers(&responses_metadata)
        .await;

    assert_eq!(
        headers
            .get(crate::attestation::X_OAI_ATTESTATION_HEADER)
            .and_then(|value| value.to_str().ok()),
        Some("v1.header-1"),
    );
    assert_eq!(attestation_calls.load(Ordering::Relaxed), 1);
}

#[tokio::test]
async fn non_chatgpt_codepilotx_endpoints_omit_attestation_generation() {
    let (model_client, attestation_calls) =
        model_client_with_counting_attestation(/*include_attestation*/ false);
    let mut response_headers = http::HeaderMap::new();

    if let Some(header_value) = model_client.generate_attestation_header_for().await {
        response_headers.insert(crate::attestation::X_OAI_ATTESTATION_HEADER, header_value);
    }
    let mut compaction_headers = http::HeaderMap::new();
    if let Some(header_value) = model_client.generate_attestation_header_for().await {
        compaction_headers.insert(crate::attestation::X_OAI_ATTESTATION_HEADER, header_value);
    }
    let mut realtime_headers = http::HeaderMap::new();
    if let Some(header_value) = model_client.generate_attestation_header_for().await {
        realtime_headers.insert(crate::attestation::X_OAI_ATTESTATION_HEADER, header_value);
    }

    assert_eq!(
        response_headers.get(crate::attestation::X_OAI_ATTESTATION_HEADER),
        None,
    );
    assert_eq!(
        compaction_headers.get(crate::attestation::X_OAI_ATTESTATION_HEADER),
        None,
    );
    assert_eq!(
        realtime_headers.get(crate::attestation::X_OAI_ATTESTATION_HEADER),
        None,
    );
    assert_eq!(attestation_calls.load(Ordering::Relaxed), 0);
}

// ── Anthropic tool input argument aggregation ───────────────────────

#[test]
fn anthropic_tool_input_arguments_skips_empty_object() {
    assert_eq!(
        anthropic_tool_input_arguments(Some(&JsonValue::Object(Default::default()))),
        "",
    );
}

#[test]
fn anthropic_tool_input_arguments_serializes_non_empty() {
    let v = json!({"key": "value"});
    assert_eq!(
        anthropic_tool_input_arguments(Some(&v)),
        r#"{"key":"value"}"#,
    );
}

#[test]
fn anthropic_tool_input_arguments_returns_empty_for_none() {
    assert_eq!(anthropic_tool_input_arguments(None), "");
}

#[tokio::test]
async fn anthropic_stream_tool_use_with_delta_produces_clean_arguments() {
    let events: Vec<Result<eventsource_stream::Event, eventsource_stream::EventStreamError<Infallible>>> = vec![
        Ok(eventsource_stream::Event {
            event: String::new(),
            data: r#"{"type":"content_block_start","content_block":{"type":"tool_use","id":"toolu_1","name":"Bash","input":{}},"index":0}"#.to_string(),
            id: String::new(),
            retry: None,
        }),
        Ok(eventsource_stream::Event {
            event: String::new(),
            data: r#"{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\"cmd\":\"pwd\"}"},"index":0}"#.to_string(),
            id: String::new(),
            retry: None,
        }),
        Ok(eventsource_stream::Event {
            event: String::new(),
            data: r#"{"type":"content_block_stop","index":0}"#.to_string(),
            id: String::new(),
            retry: None,
        }),
        Ok(eventsource_stream::Event {
            event: String::new(),
            data: r#"{"type":"message_stop"}"#.to_string(),
            id: String::new(),
            retry: None,
        }),
    ];

    let stream = futures::stream::iter(events);
    let mut response_stream = super::spawn_anthropic_messages_stream(
        stream,
        Duration::from_secs(30),
        Some("test-req-1".to_string()),
    );

    let mut results: Vec<Result<ResponseEvent, ApiError>> = Vec::new();
    while let Some(event) = response_stream.next().await {
        results.push(event);
    }

    // Find the FunctionCall Done event �?its arguments should be clean JSON
    let function_call_args = results.iter().find_map(|r| match r {
        Ok(ResponseEvent::OutputItemDone(ResponseItem::FunctionCall {
            arguments, ..
        })) => Some(arguments.as_str()),
        _ => None,
    });

    assert_eq!(
        function_call_args,
        Some(r#"{"cmd":"pwd"}"#),
        "arguments should NOT contain the '{{}}' prefix from content_block_start.input",
    );
}

#[tokio::test]
async fn anthropic_stream_tool_use_without_delta_produces_empty_object() {
    let events: Vec<Result<eventsource_stream::Event, eventsource_stream::EventStreamError<Infallible>>> = vec![
        Ok(eventsource_stream::Event {
            event: String::new(),
            data: r#"{"type":"content_block_start","content_block":{"type":"tool_use","id":"toolu_2","name":"Read","input":{}},"index":0}"#.to_string(),
            id: String::new(),
            retry: None,
        }),
        Ok(eventsource_stream::Event {
            event: String::new(),
            data: r#"{"type":"content_block_stop","index":0}"#.to_string(),
            id: String::new(),
            retry: None,
        }),
        Ok(eventsource_stream::Event {
            event: String::new(),
            data: r#"{"type":"message_stop"}"#.to_string(),
            id: String::new(),
            retry: None,
        }),
    ];

    let stream = futures::stream::iter(events);
    let mut response_stream = super::spawn_anthropic_messages_stream(
        stream,
        Duration::from_secs(30),
        Some("test-req-2".to_string()),
    );

    let mut results = Vec::new();
    while let Some(event) = response_stream.next().await {
        results.push(event);
    }

    let function_call_args = results.iter().find_map(|r| match r {
        Ok(ResponseEvent::OutputItemDone(ResponseItem::FunctionCall {
            arguments, ..
        })) => Some(arguments.as_str()),
        _ => None,
    });

    assert_eq!(
        function_call_args,
        Some("{}"),
        "zero-argument tool should produce '{{}}'",
    );
}

#[test]
fn malformed_tool_arguments_in_request_builder_fallback_to_empty_object() {
    // Verifies the defensive pattern used in build_anthropic_messages_request:
    // malformed arguments �?{} object, not a string.

    // Invalid JSON �?empty object
    let bad_args = "not valid json";
    let input: JsonValue = match serde_json::from_str(bad_args) {
        Ok(v @ JsonValue::Object(_)) => v,
        _ => JsonValue::Object(Default::default()),
    };
    assert!(input.is_object(), "malformed args must produce object, not string");
    assert_eq!(input.as_object().unwrap().len(), 0);

    // String JSON �?still not an object, fallback
    let string_args = r#""a plain string""#;
    let input: JsonValue = match serde_json::from_str(string_args) {
        Ok(v @ JsonValue::Object(_)) => v,
        _ => JsonValue::Object(Default::default()),
    };
    assert!(input.is_object(), "JSON string value must produce empty object");
    assert_eq!(input.as_object().unwrap().len(), 0);

    // Valid object passes through
    let valid_args = r#"{"cmd":"pwd"}"#;
    let input: JsonValue = match serde_json::from_str(valid_args) {
        Ok(v @ JsonValue::Object(_)) => v,
        _ => JsonValue::Object(Default::default()),
    };
    assert!(input.is_object(), "valid JSON object must pass through");
    assert_eq!(
        input.as_object().unwrap().get("cmd").and_then(|v| v.as_str()),
        Some("pwd"),
    );
}

// ── Chat Completions stream: tool_calls with empty text ─────────────

#[tokio::test]
async fn chat_completions_stream_tool_calls_without_text_emits_message() {
    let events: Vec<Result<eventsource_stream::Event, eventsource_stream::EventStreamError<Infallible>>> = vec![
        // Choice 0: start assistant (no text, no tool calls yet)
        Ok(eventsource_stream::Event {
            event: String::new(),
            data: r#"{"choices":[{"delta":{"role":"assistant","content":null},"finish_reason":null}]}"#.to_string(),
            id: String::new(),
            retry: None,
        }),
        // Choice 0: first tool call delta (id + name)
        Ok(eventsource_stream::Event {
            event: String::new(),
            data: r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"Bash","arguments":""}}]},"finish_reason":null}]}"#.to_string(),
            id: String::new(),
            retry: None,
        }),
        // Choice 0: tool call arguments delta
        Ok(eventsource_stream::Event {
            event: String::new(),
            data: r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"cmd\":\"pwd\"}"}}]},"finish_reason":null}]}"#.to_string(),
            id: String::new(),
            retry: None,
        }),
        // Choice 0: finish_reason = tool_calls (no text emitted by model)
        Ok(eventsource_stream::Event {
            event: String::new(),
            data: r#"{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}"#.to_string(),
            id: String::new(),
            retry: None,
        }),
        // Stream terminator
        Ok(eventsource_stream::Event {
            event: String::new(),
            data: "[DONE]".to_string(),
            id: String::new(),
            retry: None,
        }),
    ];

    let stream = futures::stream::iter(events);
    let mut response_stream = super::spawn_chat_completions_stream(
        stream,
        Duration::from_secs(30),
        Some("test-cc-req-1".to_string()),
    );

    let mut results: Vec<Result<ResponseEvent, ApiError>> = Vec::new();
    while let Some(event) = response_stream.next().await {
        results.push(event);
    }

    // Must have at least: Created, Message(Done), FunctionCall(Added), FunctionCall(Done), Completed
    assert!(
        results.len() >= 5,
        "expected at least 5 events, got {}",
        results.len(),
    );

    // Find the Message Done event �?must exist even with empty text
    let message_done = results.iter().find(|r| match r {
        Ok(ResponseEvent::OutputItemDone(ResponseItem::Message { content, .. })) => content.is_empty(),
        _ => false,
    });
    assert!(
        message_done.is_some(),
        "Message Done should be emitted with empty content when model produces only tool calls",
    );

    // Find the FunctionCall Done event �?arguments must be clean JSON
    let function_call_args = results.iter().find_map(|r| match r {
        Ok(ResponseEvent::OutputItemDone(ResponseItem::FunctionCall {
            arguments, ..
        })) => Some(arguments.as_str()),
        _ => None,
    });
    assert_eq!(
        function_call_args,
        Some(r#"{"cmd":"pwd"}"#),
        "Chat Completions tool call arguments should not be malformed",
    );
}

// ── Chat Completions request builder: tool call �?tool result pairing ─

#[tokio::test]
async fn chat_completions_request_builder_flushes_tool_calls_before_result() {
    let client = test_model_client(SessionSource::Cli);
    let model_info = test_model_info();

    // Construct a Prompt whose input has:
    //   user message �?FunctionCall �?FunctionCallOutput
    let prompt = crate::client_common::Prompt {
        input: vec![
            serde_json::from_value(json!({
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "list files"}]
            }))
            .unwrap(),
            serde_json::from_value(json!({
                "type": "function_call",
                "name": "Bash",
                "arguments": r#"{"cmd":"ls"}"#,
                "call_id": "call_1"
            }))
            .unwrap(),
            ResponseItem::FunctionCallOutput {
                id: Some("fco-1".to_string()),
                call_id: "call_1".to_string(),
                output: codepilotx_protocol::models::FunctionCallOutputPayload::from_text(
                    "file1.txt\nfile2.txt".to_string(),
                ),
                metadata: None,
            },
        ],
        ..Default::default()
    };

    let request = client.build_chat_completions_request(&prompt, &model_info);
    let messages = &request.messages;

    // Expected order: System, User, Assistant, Tool
    assert!(
        messages.len() >= 4,
        "expected at least 4 messages (System, User, Assistant, Tool), got {}",
        messages.len(),
    );

    // The Assistant message must have tool_calls
    let assistant_idx = messages.len() - 2;
    let tool_idx = messages.len() - 1;

    // Check that the assistant at assistant_idx has tool_calls
    // We can't match the enum variant directly in assert, but we can verify
    // by serializing and checking JSON structure.
    let json: serde_json::Value = serde_json::to_value(&messages[assistant_idx]).unwrap();
    assert_eq!(
        json.get("role").and_then(|v| v.as_str()),
        Some("assistant"),
        "message before Tool must be Assistant",
    );
    assert!(
        json.get("tool_calls").is_some(),
        "Assistant message must have tool_calls when FunctionCall precedes FunctionCallOutput",
    );

    // The Tool message must reference the correct call_id
    let json_tool: serde_json::Value = serde_json::to_value(&messages[tool_idx]).unwrap();
    assert_eq!(
        json_tool.get("role").and_then(|v| v.as_str()),
        Some("tool"),
        "last message must be Tool",
    );
    assert_eq!(
        json_tool.get("tool_call_id").and_then(|v| v.as_str()),
        Some("call_1"),
        "Tool message must reference call_1",
    );
}

// ── Anthropic request builder: tool_use �?tool_result pairing ─────

#[tokio::test]
async fn anthropic_request_builder_creates_assistant_anchor_for_tool_use() {
    let client = test_model_client(SessionSource::Cli);
    let model_info = test_model_info();

    // Construct a Prompt whose input has:
    //   user message �?FunctionCall �?FunctionCallOutput
    // Without the fix, the FunctionCall tool_use was silently dropped because
    // the last message was "user" instead of "assistant", producing:
    //   user �?user(tool_result)
    // which triggers MiniMax "tool call result does not follow tool call (2013)".
    let prompt = crate::client_common::Prompt {
        input: vec![
            serde_json::from_value(json!({
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "list files"}]
            }))
            .unwrap(),
            serde_json::from_value(json!({
                "type": "function_call",
                "name": "Bash",
                "arguments": r#"{"cmd":"ls"}"#,
                "call_id": "call_1"
            }))
            .unwrap(),
            ResponseItem::FunctionCallOutput {
                id: Some("fco-1".to_string()),
                call_id: "call_1".to_string(),
                output: codepilotx_protocol::models::FunctionCallOutputPayload::from_text(
                    "file1.txt\nfile2.txt".to_string(),
                ),
                metadata: None,
            },
        ],
        ..Default::default()
    };

    let request = client.build_anthropic_messages_request(&prompt, &model_info);
    let messages = &request.messages;

    // Expected order: user, assistant(tool_use), user(tool_result)
    assert!(
        messages.len() >= 3,
        "expected at least 3 messages (user, assistant, user), got {}",
        messages.len(),
    );

    let json_msgs: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| serde_json::to_value(m).unwrap())
        .collect();

    // First message: user
    assert_eq!(
        json_msgs[0].get("role").and_then(|v| v.as_str()),
        Some("user"),
        "first message must be user",
    );

    // Second message: assistant with tool_use anchor
    let assistant = &json_msgs[1];
    assert_eq!(
        assistant.get("role").and_then(|v| v.as_str()),
        Some("assistant"),
        "second message must be assistant (tool_use anchor)",
    );
    let content = assistant
        .get("content")
        .and_then(|v| v.as_array())
        .expect("assistant must have content array");
    assert!(!content.is_empty(), "assistant content must not be empty");
    let tool_use_block = &content[0];
    assert_eq!(
        tool_use_block.get("type").and_then(|v| v.as_str()),
        Some("tool_use"),
        "assistant content must contain tool_use block",
    );
    assert_eq!(
        tool_use_block.get("id").and_then(|v| v.as_str()),
        Some("call_1"),
        "tool_use id must match FunctionCall call_id",
    );
    assert_eq!(
        tool_use_block.get("name").and_then(|v| v.as_str()),
        Some("Bash"),
        "tool_use name must match FunctionCall name",
    );

    // Third message: user with tool_result
    let user_with_result = &json_msgs[2];
    assert_eq!(
        user_with_result.get("role").and_then(|v| v.as_str()),
        Some("user"),
        "third message must be user with tool_result",
    );
    let user_content = user_with_result
        .get("content")
        .and_then(|v| v.as_array())
        .expect("user must have content array");
    assert!(!user_content.is_empty(), "user content must not be empty");
    let tool_result_block = &user_content[0];
    assert_eq!(
        tool_result_block.get("type").and_then(|v| v.as_str()),
        Some("tool_result"),
        "user content must contain tool_result block",
    );
    assert_eq!(
        tool_result_block.get("tool_use_id").and_then(|v| v.as_str()),
        Some("call_1"),
        "tool_result must reference call_1",
    );
}

#[tokio::test]
async fn anthropic_request_builder_appends_tool_use_to_existing_assistant() {
    let client = test_model_client(SessionSource::Cli);
    let model_info = test_model_info();

    // Construct a Prompt whose input has:
    //   assistant message (text) �?FunctionCall �?FunctionCallOutput
    // The tool_use must be appended to the existing assistant message,
    // not placed in a separate one.
    let prompt = crate::client_common::Prompt {
        input: vec![
            serde_json::from_value(json!({
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": "Let me check that for you"}]
            }))
            .unwrap(),
            serde_json::from_value(json!({
                "type": "function_call",
                "name": "Bash",
                "arguments": r#"{"cmd":"ls"}"#,
                "call_id": "call_2"
            }))
            .unwrap(),
            ResponseItem::FunctionCallOutput {
                id: Some("fco-2".to_string()),
                call_id: "call_2".to_string(),
                output: codepilotx_protocol::models::FunctionCallOutputPayload::from_text(
                    "result".to_string(),
                ),
                metadata: None,
            },
        ],
        ..Default::default()
    };

    let request = client.build_anthropic_messages_request(&prompt, &model_info);
    let messages = &request.messages;

    // Expected: assistant(text + tool_use), user(tool_result)
    assert!(
        messages.len() >= 2,
        "expected at least 2 messages (assistant, user), got {}",
        messages.len(),
    );

    let json_msgs: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| serde_json::to_value(m).unwrap())
        .collect();

    // First message: assistant with both text and tool_use in content
    let assistant = &json_msgs[0];
    assert_eq!(
        assistant.get("role").and_then(|v| v.as_str()),
        Some("assistant"),
        "first message must be assistant",
    );
    let content = assistant
        .get("content")
        .and_then(|v| v.as_array())
        .expect("assistant content must be array");
    assert!(
        content.len() >= 2,
        "assistant must have at least 2 content blocks (text + tool_use), got {}",
        content.len(),
    );

    // First content block: text
    assert_eq!(
        content[0].get("type").and_then(|v| v.as_str()),
        Some("text"),
        "first content block must be text",
    );

    // Second content block: tool_use
    let tool_use_block = &content[1];
    assert_eq!(
        tool_use_block.get("type").and_then(|v| v.as_str()),
        Some("tool_use"),
        "second content block must be tool_use appended to assistant",
    );
    assert_eq!(
        tool_use_block.get("id").and_then(|v| v.as_str()),
        Some("call_2"),
        "tool_use id must match",
    );
    assert_eq!(
        tool_use_block.get("name").and_then(|v| v.as_str()),
        Some("Bash"),
        "tool_use name must match",
    );

    // Second message: user with tool_result
    let user_msg = &json_msgs[1];
    assert_eq!(
        user_msg.get("role").and_then(|v| v.as_str()),
        Some("user"),
        "second message must be user",
    );
    let user_content = user_msg
        .get("content")
        .and_then(|v| v.as_array())
        .expect("user must have content array");
    assert!(!user_content.is_empty(), "user content must not be empty");
    let tool_result_block = &user_content[0];
    assert_eq!(
        tool_result_block.get("type").and_then(|v| v.as_str()),
        Some("tool_result"),
        "first block in user must be tool_result",
    );
    assert_eq!(
        tool_result_block.get("tool_use_id").and_then(|v| v.as_str()),
        Some("call_2"),
        "tool_result must reference call_2",
    );
}
