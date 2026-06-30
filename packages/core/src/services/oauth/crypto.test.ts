import { expect, test } from 'bun:test'
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from './crypto.js'

test('generates PKCE code challenge using SHA-256 base64url encoding', () => {
  expect(generateCodeChallenge('abc')).toBe(
    'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0',
  )
})

test('generates url-safe verifier and state values', () => {
  expect(generateCodeVerifier()).toMatch(/^[A-Za-z0-9_-]+$/)
  expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/)
})
