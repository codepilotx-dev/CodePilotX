import { expect, test } from 'bun:test'
import { normalizeProviderError } from './provider.js'

test('normalizeProviderError classifies authentication failures', () => {
  const error = normalizeProviderError(
    Object.assign(new Error('invalid API key'), { status: 401 }),
    'openai',
  )

  expect(error).toMatchObject({
    code: 'authentication_failed',
    providerID: 'openai',
    status: 401,
    retryable: false,
  })
})

test('normalizeProviderError marks transient stream and rate errors retryable', () => {
  expect(normalizeProviderError(new Error('stream EOF')).retryable).toBe(true)
  expect(
    normalizeProviderError(Object.assign(new Error('too many requests'), {
      status: 429,
    })).retryable,
  ).toBe(true)
})

test('normalizeProviderError preserves already normalized errors', () => {
  const normalized = {
    code: 'model_not_found',
    message: 'missing model',
    retryable: false,
  } as const

  expect(normalizeProviderError(normalized)).toBe(normalized)
})
