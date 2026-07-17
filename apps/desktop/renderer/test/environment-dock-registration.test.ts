import { describe, expect, test } from 'bun:test'

import {
  reduceEnvironmentDockContentRegistration,
  type EnvironmentDockContentRegistration,
} from '../src/features/session/QuickChatContext.js'

describe('environment dock content registration', () => {
  test('keeps the existing registration when a render republishes the same revision', () => {
    const revision = {}
    const current: EnvironmentDockContentRegistration = {
      content: 'first render',
      revision,
    }
    const republished: EnvironmentDockContentRegistration = {
      content: 'new React node from a parent rerender',
      revision,
    }

    expect(
      reduceEnvironmentDockContentRegistration(current, republished),
    ).toBe(current)
  })

  test('updates for changed data and clears idempotently', () => {
    const current: EnvironmentDockContentRegistration = {
      content: 'old environment',
      revision: {},
    }
    const next: EnvironmentDockContentRegistration = {
      content: 'new environment',
      revision: {},
    }

    expect(reduceEnvironmentDockContentRegistration(current, next)).toBe(next)
    expect(reduceEnvironmentDockContentRegistration(current, null)).toBeNull()
    expect(reduceEnvironmentDockContentRegistration(null, null)).toBeNull()
  })
})
