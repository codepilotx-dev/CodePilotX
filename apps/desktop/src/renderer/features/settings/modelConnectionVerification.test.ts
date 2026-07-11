import { describe, expect, test } from 'bun:test'
import {
  collectAvailableModelIDs,
  getCredentialVerificationLabel,
  getModelVerificationLabel,
  isVerificationRequestCurrent,
} from './modelConnectionVerification.js'

describe('model connection verification presentation', () => {
  test('maps credential configuration and verification states to concise labels', () => {
    expect(getCredentialVerificationLabel('idle', false)).toBe('未配置')
    expect(getCredentialVerificationLabel('idle', true)).toBe('已配置 · 未验证')
    expect(getCredentialVerificationLabel('testing', true)).toBe('验证中')
    expect(getCredentialVerificationLabel('success', true)).toBe('可用')
    expect(getCredentialVerificationLabel('error', true)).toBe('不可用')
  })

  test('maps model verification states and counts to header labels', () => {
    expect(getModelVerificationLabel('idle', 0, 3)).toBe('未验证')
    expect(getModelVerificationLabel('testing', 0, 3)).toBe('验证中')
    expect(getModelVerificationLabel('success', 2, 3)).toBe('可用 2 / 共 3')
    expect(getModelVerificationLabel('error', 0, 3)).toBe('验证失败')
  })

  test('keeps only displayed model IDs returned by verification', () => {
    expect(
      collectAvailableModelIDs(
        ['model-a', 'model-b', 'model-c'],
        ['model-b', 'remote-only', 'model-b'],
      ),
    ).toEqual(new Set(['model-b']))
  })

  test('rejects stale verification responses by request ID or connection context', () => {
    const request = {
      id: 4,
      providerID: 'deepseek',
      baseURL: 'https://api.deepseek.com',
    }

    expect(isVerificationRequestCurrent(request, 4, 'deepseek', 'https://api.deepseek.com')).toBe(true)
    expect(isVerificationRequestCurrent(request, 5, 'deepseek', 'https://api.deepseek.com')).toBe(false)
    expect(isVerificationRequestCurrent(request, 4, 'openai', 'https://api.deepseek.com')).toBe(false)
    expect(isVerificationRequestCurrent(request, 4, 'deepseek', 'https://example.com/v1')).toBe(false)
  })

})
