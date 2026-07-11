# 附件上传能力重构计划

## 概览

将桌面端附件上传从 Anthropic `ContentBlockParam` 格式迁移到中立 `Attachment` 协议模型，覆盖图片/PDF/音频/视频/文本/二进制附件。

---

## WP1: 协议层 (Protocol/Schema)

### 1.1 定义中立 Attachment 类型
**新建**: `packages/core/src/attachments/types.ts`
```typescript
export type AttachmentKind = 'image' | 'document' | 'audio' | 'video' | 'text' | 'binary'

export type Attachment = {
  kind: AttachmentKind
  name: string
  path: string
  mediaType: string
  sizeBytes: number
  /** Base64 content — populated for image/document/video/audio/binary */
  contentBase64?: string
  /** Text content — populated for text attachments */
  textContent?: string
}
```
- 剥离 `DesktopComposerAttachment` 中的 UI 字段 (`id`, `status`, `error`, `previewDataUrl`, `truncated`)
- 核心运行时与 IPC 传输使用此中立类型

### 1.2 统一协议契约
- **修改**: `packages/core/src/appServer/protocol.ts` — `JsonRpcTurnStartParams.input` 扩展为接受 `string | ContentBlockParam[] | { text: string; attachments: Attachment[] }`，兼容新旧两套协议
- **修改**: 桌面端 `DesktopUserMessageContent` (types.ts:88) 从 `string | ContentBlockParam[]` 改为 `{ text: string; attachments: Attachment[] }`

---

## WP2: Desktop 发送链路 (Desktop Main/UI)

### 2.1 更新运行时接口
- **修改**: `apps/desktop/src/main/agentRuntime.ts` — `runUserTurn` 签名改为接收 `{ text: string; attachments: Attachment[] }` 替代 `DesktopUserMessageContent`
- **修改**: `apps/desktop/src/main/agentSession.ts` — `sendUserMessage` 适配新签名

### 2.2 更新主进程发送入口
- **修改**: `apps/desktop/src/main/index.ts` — `sendUserMessage()` 不再调用 `buildDesktopUserMessageContent()`，而是剥离 UI 字段后直接传递附件数据

### 2.3 RustSidecarRuntime 附件转换
- **修改**: `apps/desktop/src/main/rustSidecarRuntime.ts` — `runUserTurn` 方法：
  - **移除** text-only guard (line 410-412)
  - 图片附件 → 转换为 `UserInput.Image` (data URL)
  - 文本附件 → 转换为 `UserInput.Text` (内嵌文本内容)
  - Document/Audio/Video/Binary → **明确抛出错误** "Unsupported attachment type for this runtime"

  转换映射:
  ```
  Attachment.kind='image' → { type: 'image', url: dataUrl, detail: 'auto' }
  Attachment.kind='text'  → { type: 'text', text: textContent, text_elements: [] }
  Attachment.kind='document' | 'audio' | 'video' | 'binary' → throw Error
  ```

### 2.4 清理旧代码
- **移除/重写**: `apps/desktop/src/shared/desktopUserMessage.ts` — `buildDesktopUserMessageContent` 不再需要；保留 `hasBlockingComposerAttachmentErrors` 和 `desktopUserMessageInputToPreviewText`
- **修改**: `apps/desktop/src/shared/desktopApiSchema.ts` — `sendUserMessage` 参数 schema 适配新结构

### 2.5 UI/能力门控（Renderer）
- **修改**: `apps/desktop/src/renderer/` — 在 Composer 提交前检查 `modelMetadata.modalities.input` 是否包含附件类型
  - 图片：检查 `modalities.input` 包含 `'image'`
  - PDF/文档：检查 `'document'`
  - 其他类型：检查笼统支持或直接阻止
- 阻止时在 renderer 显示中文错误提示

---

## WP3: Rust 协议扩展 (Rust App-Server)

### 3.1 扩展 Core UserInput
**修改**: `rust/codex-rs/protocol/src/user_input.rs`
- 新增 `Document { data: String, media_type: String, name: String }` — PDF base64
- 新增 `Audio { data: String, media_type: String, name: String }`
- 新增 `Video { data: String, media_type: String, name: String }`
- 新增 `File { data: String, media_type: String, name: String }` — 通用二进制
- 新增 `TextFile { text: String, name: String, media_type: String }`

### 3.2 扩展 v2 协议 UserInput
**修改**: `rust/codex-rs/app-server-protocol/src/protocol/v2/turn.rs`
- 添加对应变体（序列化为 `type: "document"`/`"audio"`/`"video"`/`"file"`/`"textFile"`）
- 更新 `into_core()`：已支持的类型正常映射，不支持的返回 `Err` 或结构化 unsupported 响应
- 更新 `From<CoreUserInput> for UserInput`

### 3.3 生成 TypeScript 类型
- 重新生成或手动更新 `apps/desktop/src/main/rustAppServerProtocol/generated/v2/UserInput.ts`
- 确保类型与 Rust 端一致

### 3.4 Rust 集成测试
- 为每个新增变体添加序列化/反序列化测试 (`turn.rs` tests 区域)
- 为 `into_core()` 添加 unsupported 变体的错误路径测试

---

## WP4: Provider Adapters (TUI)

### 4.1 OpenAI Compatible (openaiCompatible.ts)
- **修改**: 文档块从静默替换 `'[Document attachment omitted]'` 改为抛出格式化错误
- 保留图片转换 (image → `image_url` data URL)
- 音频/视频/二进制 → 抛出明确 unsupported 错误

### 4.2 MiniMax (minimax.ts)
- 现有 `findUnsupportedMiniMaxInput` 已经对 image/document 硬报错，无需修改
- 添加单测验证错误路径

### 4.3 GitHub Copilot SDK (copilotSdk.ts)
- **修改**: Image/Document 从静默 `'[Image/Document attachment omitted]'` 改为抛出错误
- 添加单测覆盖

### 4.4 Anthropic (claude.ts)
- 保持原生 image/document ContentBlock 支持
- `stripExcessMediaItems` 保留但改善日志，不属本阶段修改

---

## WP5: 测试与验证

### 5.1 单元测试更新
| 测试文件 | 修改内容 |
|----------|----------|
| `apps/desktop/src/main/rustSidecarRuntime.test.ts` | 覆盖图片→UserInput.Image、文本→UserInput.Text、不支持类型错误 |
| `apps/desktop/src/shared/desktopUserMessage.test.ts` | 适配新接口，保留 preview/error 测试 |
| `apps/desktop/src/shared/desktopApiSchema.test.ts` | 适配新 sendUserMessage schema |
| `apps/desktop/src/main/desktopComposerAttachments.test.ts` | 不变（分类/读取逻辑未变） |
| `apps/tui/src/services/api/openaiCompatible.test.ts` | 新增文档/音频/视频阻止测试 |
| `apps/tui/src/services/api/minimax.test.ts` | 新增 image/document 拒绝测试 |
| `apps/tui/src/services/api/copilotSdk.test.ts` | 新增附件阻止测试 |

### 5.2 Rust 测试
- `rust/codex-rs/app-server-protocol/src/protocol/v2/tests.rs`: 新增变体序列化测试
- `rust/codex-rs/app-server-protocol/src/protocol/item_builders_tests.rs`: 如有新构建器则补充
- `rust/codex-rs/core/tests/suite/`: 如有核心处理逻辑则补充

### 5.3 手动验证
- 桌面端选择图片 → 确认成功发送至 Rust sidecar
- 桌面端选择 PDF/音频 → 确认明确错误提示
- 桌面端选择文本文件 → 确认内嵌文本

---

## 实施顺序与依赖

```
WP1 (协议) → WP2 (桌面链路) → WP3 (Rust) 可以并行
                ↓
            WP4 (Provider) 依赖 WP2 基本框架
                ↓
            WP5 (测试) 依赖以上全部
```

实际建议顺序：
1. **WP1** → 先定义中立类型，确保上下游类型统一
2. **WP2** 与 **WP3** 并行开展（TS 侧与 Rust 侧无编译依赖）
3. **WP4** 与 WP2 同步或稍后开展
4. **WP5** 贯穿全程

---

## 关键假设

1. 默认采用"明确阻止"策略：对于不支持的类型不静默降级
2. 图片优先使用 data URL 方式发送 (`UserInput.Image`)，后续可优化为 `LocalImage` 路径方式
3. 第一阶段 Rust 侧只实际支持 Image/Text；Document/Audio/Video/File 在协议中存在但返回 unsupported
4. Provider adapter 修改针对 TUI 路由层（非桌面本地 agent 路径）
5. 提交使用中文 commit，格式 `feat(desktop)：xxx`
