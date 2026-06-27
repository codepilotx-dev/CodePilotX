import { expect, test } from 'bun:test'
import {
  assertDesktopApiSchemaCoverage,
  validateDesktopApiArgs,
} from './desktopApiSchema.js'

test('desktop API schema covers every IPC method', () => {
  expect(() => assertDesktopApiSchemaCoverage()).not.toThrow()
})

test('desktop API schema accepts plan permission mode', () => {
  expect(
    validateDesktopApiArgs('setSessionPermissionMode', ['session-1', 'plan']),
  ).toEqual(['session-1', 'plan'])
})
