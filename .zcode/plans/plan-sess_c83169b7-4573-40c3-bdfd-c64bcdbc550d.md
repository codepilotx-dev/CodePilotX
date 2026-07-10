# Implementation Plan: DeepSeek Usage Backend Normalization & Context Usage Chip

## Summary

Add token usage parsing for DeepSeek/OpenAI-compatible Chat Completions SSE streams in the Rust sidecar, and wire it through to the Desktop's `context-usage-chip` via the existing `thread/tokenUsage/updated` notification path.

---

## Phase 1: Rust Chat Completions SSE — Parse DeepSeek Usage

### 1a. Add usage deserialization structs
**File:** `rust/codex-rs/core/src/client.rs`

Add private structs after the existing `ChatCompletionChunk` definitions:

```rust
#[derive(Debug, Deserialize)]
struct ChatCompletionUsage {
    prompt_tokens: i64,
    completion_tokens: i64,
    total_tokens: i64,
    #[serde(default)]
    prompt_cache_hit_tokens: Option<i64>,
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
```

### 1b. Add `usage` field to `ChatCompletionChunk`
```rust
#[derive(Debug, Deserialize)]
struct ChatCompletionChunk {
    #[serde(default)]
    choices: Vec<ChatCompletionChoice>,
    #[serde(default)]
    usage: Option<ChatCompletionUsage>,  // NEW
}
```

### 1c. Add conversion function
```rust
fn chat_completion_usage_to_token_usage(usage: &ChatCompletionUsage) -> TokenUsage {
    let cached = usage.prompt_cache_hit_tokens
        .unwrap_or_else(|| usage.prompt_tokens_details.as_ref()
            .map(|d| d.cached_tokens).unwrap_or(0));
    TokenUsage {
        input_tokens: usage.prompt_tokens,
        cached_input_tokens: cached,
        output_tokens: usage.completion_tokens,
        reasoning_output_tokens: usage.completion_tokens_details.as_ref()
            .map(|d| d.reasoning_tokens).unwrap_or(0),
        total_tokens: usage.total_tokens,
    }
}
```

### 1d. Modify `spawn_chat_completions_stream()` to capture usage

**Current behavior:** On `finish_reason`, emits `Completed { token_usage: None }` and `return`s immediately — any subsequent `usage` chunk or `[DONE]` is never read.

**New behavior:**
1. Add `let mut finished = false;` and `let mut captured_usage: Option<TokenUsage> = None;` before the main loop.
2. Each iteration: after parsing chunk, if `chunk.usage` is present, call `chat_completion_usage_to_token_usage()` and store in `captured_usage`.
3. On `finish_reason` (all three branches): keep the flush logic (text/tool calls `OutputItemDone`), then set `finished = true`, `break` from the `for choice` loop (not `return`). The outer loop continues to read remaining chunks.
4. After `finished == true`: skip choice processing (just `continue`), allowing only usage capture in subsequent chunks.
5. On `[DONE]` or stream end: `break` from outer loop.
6. After outer loop: if `started`, emit a single `Completed { token_usage: captured_usage, end_turn: Some(true) }`.

**Edge case:** Stream ends without explicit `finish_reason` → text flush + `Completed { token_usage: captured_usage }` (no change from current behavior except usage may be populated).

### Key Rust test cases
- Normal content chunks → `finish_reason: "stop"` → usage chunk → `[DONE]`
- `finish_reason: "tool_calls"` → tool call flush → usage → `[DONE]`
- No usage chunk (legacy format) → `Completed { token_usage: None }`
- `prompt_cache_hit_tokens` takes priority over `prompt_tokens_details.cached_tokens`
- `completion_tokens_details.reasoning_tokens` maps to `reasoning_output_tokens`

---

## Phase 2: Desktop — New Conversion Helper

**File:** `apps/desktop/src/main/desktopContextUsage.ts`

Add a function that accepts Rust `TokenUsage`-style fields (not DeepSeek raw format) and builds `DesktopContextUsage`:

```typescript
export function buildDesktopContextUsageFromRustTokenUsage(params: {
  model: string
  provider?: string | null
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}): DesktopContextUsage | null
```

**Mapping rules:**  
| Rust field → | DesktopContextUsage field |
|---|---|
| `inputTokens` | `inputTokens` |
| `outputTokens` | `outputTokens` |
| `cachedInputTokens` | `promptCacheHitTokens`, `cacheReadInputTokens` |
| `max(0, inputTokens - cachedInputTokens)` | `promptCacheMissTokens` |
| `reasoningOutputTokens` | `reasoningTokens` |
| computed: `inputTokens + outputTokens` | `usedTokens` |
| computed: `getContextWindowForModel(model, provider)` | `contextWindow` |

`cacheCreationInputTokens = 0` (not provided by Rust protocol).

All-zero check: return `null` if all core fields are 0 (prevents empty first events).

### Tests in `desktopContextUsage.test.ts`
- Basic mapping: `{ inputTokens: 100, cachedInputTokens: 30, outputTokens: 50, reasoningOutputTokens: 10, totalTokens: 150 }`
- Verifies `promptCacheHitTokens = 30`, `promptCacheMissTokens = 70`, `reasoningTokens = 10`, `usedTokens = 150`
- Zero-case returns `null`
- `usedPercent` / `remainingPercent` computed correctly

---

## Phase 3: Desktop — Handle `thread/tokenUsage/updated` Notification

### 3a. Update `handleServerNotification` signature
**File:** `apps/desktop/src/main/rustAppServerWorkflowAdapter.ts`

Add optional `notificationContext` parameter:
```typescript
export function handleServerNotification(
  method: string, params: unknown,
  emit: (event: DesktopAgentEvent) => void,
  state: RustAppServerWorkflowState,
  sessionId: string,
  notificationContext?: { model?: string; providerID?: string },  // NEW
): void
```

### 3b. Add switch case
```typescript
case 'thread/tokenUsage/updated': {
  const p = params as Record<string, unknown> | null
  if (!p) break
  const tu = p.tokenUsage as Record<string, unknown> | null
  if (!tu) break
  const last = tu.last as Record<string, unknown> | null
  if (!last) break

  const model = notificationContext?.model ?? 'unknown'
  const providerID = notificationContext?.providerID

  const usage = buildDesktopContextUsageFromRustTokenUsage({
    model,
    provider: providerID,
    inputTokens: Number(last.inputTokens ?? 0),
    cachedInputTokens: Number(last.cachedInputTokens ?? 0),
    outputTokens: Number(last.outputTokens ?? 0),
    reasoningOutputTokens: Number(last.reasoningOutputTokens ?? 0),
    totalTokens: Number(last.totalTokens ?? 0),
  })

  if (usage) {
    emit({ type: 'context_usage', sessionId, usage })
    desktopDebug('rust_adapter_context_usage', { usage })
  }
  break
}
```

### 3c. Update call site
**File:** `apps/desktop/src/main/rustSidecarRuntime.ts`

In `handleNotification()` (around line 887), pass model/provider:
```typescript
handleServerNotification(
  method, params,
  (event: DesktopAgentEvent) => { /* existing handler */ },
  this.workflowState,
  this.context.sessionId,
  { model: this.context.model, providerID: this.context.providerID },  // NEW
)
```

### Tests in `rustAppServerWorkflowAdapter.test.ts`
- Feed `thread/tokenUsage/updated` with known `last` values
- Assert `context_usage` event is emitted (not silently dropped)
- Assert `promptCacheHitTokens`, `promptCacheMissTokens`, `usedTokens`, `usedPercent` correct
- Assert notification context (model/provider) flows through

---

## Verification

```bash
# Rust tests
cargo test -p codex-core -- --test client_usage_parsing

# Desktop tests  
bun test apps/desktop/src/main/desktopContextUsage.test.ts apps/desktop/src/main/rustAppServerWorkflowAdapter.test.ts

# No CSS changes, so desktop:css:check is NOT needed
```
