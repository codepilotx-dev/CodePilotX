import { describe, expect, test } from 'bun:test'
import {
  getApiKeyConnectionSavePlan,
  isConnectionSaveContextCurrent,
} from './modelConnectionSave.js'

describe('API key connection save plan', () => {
  test('saves a newly entered key before saving the connection', () => {
    expect(getApiKeyConnectionSavePlan('  sk-new  ', false)).toEqual({
      kind: 'save-key-and-connection',
      apiKey: 'sk-new',
    })
  })

  test('reuses an existing secure credential when the input is empty', () => {
    expect(getApiKeyConnectionSavePlan('', true)).toEqual({
      kind: 'save-connection',
    })
  })

  test('requires a key when no secure credential exists', () => {
    expect(getApiKeyConnectionSavePlan('   ', false)).toEqual({
      kind: 'missing-credential',
    })
  })

  test('rejects save responses after the connection context or request changes', () => {
    const request = {
      id: 7,
      providerID: 'deepseek',
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    }

    expect(isConnectionSaveContextCurrent(request, 7, request)).toBe(true)
    expect(isConnectionSaveContextCurrent(request, 8, request)).toBe(false)
    expect(
      isConnectionSaveContextCurrent(request, 7, {
        ...request,
        providerID: 'openai',
      }),
    ).toBe(false)
    expect(
      isConnectionSaveContextCurrent(request, 7, {
        ...request,
        baseURL: 'https://example.com/v1',
      }),
    ).toBe(false)
    expect(
      isConnectionSaveContextCurrent(request, 7, {
        ...request,
        model: 'deepseek-reasoner',
      }),
    ).toBe(false)
  })
})
