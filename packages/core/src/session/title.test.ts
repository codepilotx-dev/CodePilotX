import { expect, test } from 'bun:test'
import { generateSessionTitle } from './title.js'

test('session title facade exposes title generation entrypoint', () => {
  expect(typeof generateSessionTitle).toBe('function')
})
