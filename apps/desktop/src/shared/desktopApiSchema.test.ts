import { describe, expect, test } from 'bun:test'
import {
  DESKTOP_API_ARG_SCHEMAS,
  assertDesktopApiSchemaCoverage,
  validateDesktopApiArgs,
} from './desktopApiSchema.js'
import { DESKTOP_API_METHODS } from './ipcChannels.js'

describe('desktop API argument schemas', () => {
  test('cover every desktop API method exactly once', () => {
    expect(() => assertDesktopApiSchemaCoverage()).not.toThrow()
    expect(Object.keys(DESKTOP_API_ARG_SCHEMAS).sort()).toEqual(
      [...DESKTOP_API_METHODS].sort(),
    )
  })

  test('reject invalid argument shapes', () => {
    expect(() => validateDesktopApiArgs('openWorkspace', [])).toThrow()
    expect(() =>
      validateDesktopApiArgs('setBuiltinPluginEnabled', ['plugin']),
    ).toThrow()
    expect(() =>
      validateDesktopApiArgs('respondToPermission', [
        'session',
        'request',
        { behavior: 'maybe' },
      ]),
    ).toThrow()
  })

  test('preserve valid argument tuples', () => {
    const args = validateDesktopApiArgs('sendUserMessage', [
      'session-id',
      'hello',
      'model-id',
    ])
    expect(args).toEqual(['session-id', 'hello', 'model-id'])
  })
})
