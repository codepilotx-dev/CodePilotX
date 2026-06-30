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

test('desktop API schema validates setSessionLocalRouterMode', () => {
  expect(
    validateDesktopApiArgs('setSessionLocalRouterMode', ['session-1', 'off']),
  ).toEqual(['session-1', 'off'])
  expect(
    validateDesktopApiArgs('setSessionLocalRouterMode', ['session-1', 'pareto-code']),
  ).toEqual(['session-1', 'pareto-code'])
  expect(
    validateDesktopApiArgs('setSessionLocalRouterMode', ['session-1', 'fusion']),
  ).toEqual(['session-1', 'fusion'])
  expect(() =>
    validateDesktopApiArgs('setSessionLocalRouterMode', ['session-1', 'invalid']),
  ).toThrow()
})

test('desktop API schema validates sendUserMessage with localRouterMode', () => {
  expect(
    validateDesktopApiArgs('sendUserMessage', [
      'session-1',
      { text: 'hello' },
      { providerID: 'minimax', localRouterMode: 'pareto-code' },
    ]),
  ).toEqual([
    'session-1',
    { text: 'hello' },
    { providerID: 'minimax', localRouterMode: 'pareto-code' },
  ])
})
