import { describe, expect, test } from 'bun:test'
import {
  resolveSessionMessageDelivery,
} from '../src/features/session/state/sessionActions.js'

describe('session message delivery', () => {
  test('steers active turns and starts idle threads by default', () => {
    expect(resolveSessionMessageDelivery('running', 'default')).toBe('steer')
    expect(resolveSessionMessageDelivery('waiting', undefined)).toBe('steer')
    expect(resolveSessionMessageDelivery('idle', 'default')).toBe('start')
  })

  test('keeps Ctrl+Enter follow-ups explicit in every session state', () => {
    expect(resolveSessionMessageDelivery('running', 'follow-up')).toBe(
      'follow-up',
    )
    expect(resolveSessionMessageDelivery('idle', 'follow-up')).toBe(
      'follow-up',
    )
  })
})
