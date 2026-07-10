import { expect, test } from 'bun:test'
import { sessionDisplayTitle, sessionViewFallbackTitle } from './uiTypes.js'
import type { SessionListItem, SessionViewState } from './uiTypes.js'

test('sessionDisplayTitle uses hydrated fallback before prompt and workspace', () => {
  const session = {
    sessionName: null,
    customTitle: null,
    aiTitle: null,
    firstPrompt: 'stored prompt',
    workspaceName: 'ClaudeCode',
  } as SessionListItem

  expect(sessionDisplayTitle(session, 'first user message')).toBe(
    'first user message',
  )
})

test('sessionDisplayTitle uses hydrated fallback before default session name', () => {
  const session = {
    sessionName: 'ClaudeCode',
    customTitle: null,
    aiTitle: null,
    firstPrompt: null,
    workspaceName: 'ClaudeCode',
  } as SessionListItem

  expect(sessionDisplayTitle(session, '你可以跟我说说这个项目是做什么的吗')).toBe(
    '你可以跟我说说这个项目是做什么的吗',
  )
})

test('sessionDisplayTitle uses stored first prompt before default session name', () => {
  const session = {
    sessionName: 'ClaudeCode',
    customTitle: null,
    aiTitle: null,
    firstPrompt: '添加中文提交',
    workspaceName: 'ClaudeCode',
  } as SessionListItem

  expect(sessionDisplayTitle(session)).toBe('添加中文提交')
})

test('sessionDisplayTitle keeps custom title before hydrated fallback', () => {
  const session = {
    sessionName: 'ClaudeCode',
    customTitle: '手动命名',
    aiTitle: null,
    firstPrompt: null,
    workspaceName: 'ClaudeCode',
  } as SessionListItem

  expect(sessionDisplayTitle(session, '你可以跟我说说这个项目是做什么的吗')).toBe(
    '手动命名',
  )
})

test('sessionViewFallbackTitle matches conversation title fallback', () => {
  const view = {
    events: [
      { role: 'assistant', content: 'ignored' },
      {
        role: 'user',
        content: '你可以跟我说说这个项目是做什么的吗\n第二行',
      },
    ],
    messages: [],
  } as Pick<SessionViewState, 'events' | 'messages'>

  expect(sessionViewFallbackTitle(view)).toBe(
    '你可以跟我说说这个项目是做什么的吗',
  )
})

test('sessionViewFallbackTitle falls back to user messages', () => {
  const view = {
    events: [],
    messages: [{ role: 'user', text: '查看 README' }],
  } as Pick<SessionViewState, 'events' | 'messages'>

  expect(sessionViewFallbackTitle(view)).toBe('查看 README')
})
