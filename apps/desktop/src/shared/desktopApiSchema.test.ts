import { expect, test } from 'bun:test'
import {
  assertDesktopApiSchemaCoverage,
  validateDesktopApiArgs,
} from './desktopApiSchema.js'

test('desktop API schema covers every IPC method', () => {
  expect(() => assertDesktopApiSchemaCoverage()).not.toThrow()
})

test('desktop API schema separates plan mode from permission mode', () => {
  expect(() =>
    validateDesktopApiArgs('setSessionPermissionMode', ['session-1', 'plan']),
  ).toThrow()
  expect(
    validateDesktopApiArgs('setSessionPlanModeActive', ['session-1', true]),
  ).toEqual(['session-1', true])
})
