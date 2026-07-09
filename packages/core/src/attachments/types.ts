/**
 * Neutral attachment types used across the protocol and runtime boundary.
 *
 * These types strip UI-only fields from `DesktopComposerAttachment` (id,
 * status, error, previewDataUrl, truncated) and serve as the canonical
 * representation for file attachments in the core protocol.
 *
 * Provider-specific conversion (Anthropic ContentBlockParam, OpenAI
 * image_url, Rust UserInput, etc.) happens at the adapter layer, consuming
 * these types as input.
 */

/** Supported attachment kinds */
export type AttachmentKind =
  | 'image'
  | 'document'
  | 'text'
  | 'audio'
  | 'video'
  | 'binary'

/**
 * A file attachment attached to a user message.
 *
 * - `kind` classifies the file for provider capability gating.
 * - `contentBase64` is populated for binary-readable types (image, document,
 *   audio, video, binary). Absent for oversized files or when the runtime
 *   should read the file from `path` directly.
 * - `textContent` is populated for text-type attachments (read as UTF-8).
 * - `path` is always provided for reference and on-demand reading.
 */
export type Attachment = {
  kind: AttachmentKind
  /** File name (e.g. "screenshot.png") */
  name: string
  /** Absolute file system path */
  path: string
  /** MIME type (e.g. "image/png", "application/pdf") */
  mediaType: string
  /** File size in bytes */
  sizeBytes: number
  /** Base64-encoded content — populated for image, document, audio, video, binary */
  contentBase64?: string
  /** UTF-8 text content — populated for text attachments */
  textContent?: string
}

/**
 * Structured user message that carries optional attachments alongside the
 * text input.  This is the neutral protocol format for sending user turns
 * to the runtime.
 */
export type UserMessage = {
  /** User text input */
  text: string
  /** Optional file attachments */
  attachments?: Attachment[]
  /** Optional skill invocation metadata */
  skillInvocation?: {
    name: string
    args?: string
    skillPath?: string
  }
}
