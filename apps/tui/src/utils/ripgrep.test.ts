import { expect, test } from 'bun:test'
import {
  getRipgrepStatus,
  resetRipgrepConfigCache,
} from './ripgrep.js'

test('resetRipgrepConfigCache lets desktop runtime switch away from cached builtin ripgrep', () => {
  const original = process.env.USE_BUILTIN_RIPGREP
  const originalPath = process.env.CODEPILOTX_RIPGREP_PATH
  try {
    process.env.USE_BUILTIN_RIPGREP = '1'
    delete process.env.CODEPILOTX_RIPGREP_PATH
    resetRipgrepConfigCache()
    const builtinStatus = getRipgrepStatus()

    process.env.USE_BUILTIN_RIPGREP = '0'
    process.env.CODEPILOTX_RIPGREP_PATH = process.execPath
    const cachedStatus = getRipgrepStatus()

    resetRipgrepConfigCache()
    const refreshedStatus = getRipgrepStatus()

    expect(cachedStatus.path).toBe(builtinStatus.path)
    expect(refreshedStatus.mode).toBe('system')
    expect(refreshedStatus.path).toBe(process.execPath)
  } finally {
    if (original === undefined) {
      delete process.env.USE_BUILTIN_RIPGREP
    } else {
      process.env.USE_BUILTIN_RIPGREP = original
    }
    if (originalPath === undefined) {
      delete process.env.CODEPILOTX_RIPGREP_PATH
    } else {
      process.env.CODEPILOTX_RIPGREP_PATH = originalPath
    }
    resetRipgrepConfigCache()
  }
})
