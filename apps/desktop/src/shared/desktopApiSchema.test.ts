import { expect, test } from 'bun:test'
import { assertDesktopApiSchemaCoverage } from './desktopApiSchema.js'

test('desktop API schema covers every IPC method', () => {
  expect(() => assertDesktopApiSchemaCoverage()).not.toThrow()
})
