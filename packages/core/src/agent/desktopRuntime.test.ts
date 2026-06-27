import { expect, test } from 'bun:test'
import { UnsupportedCoreFeatureError } from '../errors/unsupported.js'
import { createDesktopHeadlessRuntime } from './desktopRuntime.js'

test('desktop headless runtime facade preserves API with explicit migration error', () => {
  expect(() =>
    createDesktopHeadlessRuntime({
      sessionId: 'session-1',
      workspacePath: '/workspace',
      model: 'model',
      onOutput: () => undefined,
    }),
  ).toThrow(UnsupportedCoreFeatureError)
  expect(() =>
    createDesktopHeadlessRuntime({
      sessionId: 'session-1',
      workspacePath: '/workspace',
      model: 'model',
      onOutput: () => undefined,
    }),
  ).toThrow('desktop headless runtime')
})
