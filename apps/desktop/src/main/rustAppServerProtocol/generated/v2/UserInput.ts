// GENERATED CODE! DO NOT MODIFY BY HAND!
// Adapted from codex-rs/app-server-protocol/schema/typescript/v2/UserInput.ts
import type { TextElement } from './TextElement.js'
export type UserInput =
  | { type: 'text'; text: string; text_elements: Array<TextElement> }
  | { type: 'image'; detail?: string; url: string }
  | { type: 'localImage'; detail?: string; path: string }
  | { type: 'skill'; name: string; path: string }
  | { type: 'mention'; name: string; path: string }
  | { type: 'document'; data: string; mediaType: string; name: string }
  | { type: 'audio'; data: string; mediaType: string; name: string }
  | { type: 'video'; data: string; mediaType: string; name: string }
  | { type: 'file'; data: string; mediaType: string; name: string }
  | { type: 'textFile'; text: string; name: string; mediaType: string }
