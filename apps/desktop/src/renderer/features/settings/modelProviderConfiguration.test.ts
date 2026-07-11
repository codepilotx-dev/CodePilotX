import { describe, expect, test } from 'bun:test'
import { getConfiguredProviderIDs } from './modelProviderConfiguration.js'

describe('configured model providers', () => {
  test('includes API key providers and an authenticated GitHub Copilot provider', () => {
    const configured = getConfiguredProviderIDs(
      [
        { providerID: 'deepseek', kind: 'deepseek', apiKeyConfigured: true },
        { providerID: 'openai', kind: 'openai', apiKeyConfigured: false },
        {
          providerID: 'github-copilot',
          kind: 'github-copilot',
          apiKeyConfigured: false,
        },
      ],
      true,
    )

    expect(configured).toEqual(new Set(['deepseek', 'github-copilot']))
  })

  test('does not mark GitHub Copilot configured when OAuth is unauthenticated', () => {
    const configured = getConfiguredProviderIDs(
      [
        {
          providerID: 'github-copilot',
          kind: 'github-copilot',
          apiKeyConfigured: false,
        },
      ],
      false,
    )

    expect(configured.size).toBe(0)
  })
})
