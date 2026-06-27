import { spawnSync } from 'child_process'
import type { StructuredPatchHunk } from 'diff'
import { isEnvTruthy } from './envUtils.js'
import { logForDebugging } from './debug.js'
import { findRustShellRuntimeExecutable } from './rustShellRuntime.js'

type RustDiffEvent =
  | { type: 'completed'; hunks: StructuredPatchHunk[] }
  | { type: 'failed'; message: string }

export function shouldUseRustDiffRuntime(
  ignoreWhitespace: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CODEPILOTX_RUST_DIFF) && !ignoreWhitespace
}

export function tryGetRustPatchFromContents({
  oldContent,
  newContent,
  contextLines,
  ignoreWhitespace,
}: {
  oldContent: string
  newContent: string
  contextLines: number
  ignoreWhitespace: boolean
}): StructuredPatchHunk[] | null {
  if (!shouldUseRustDiffRuntime(ignoreWhitespace)) {
    return null
  }
  const runtimePath = findRustShellRuntimeExecutable()
  if (!runtimePath) {
    return null
  }

  const result = spawnSync(runtimePath, ['diff'], {
    input: JSON.stringify({
      oldContent,
      newContent,
      contextLines,
    }),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 20_000_000,
  })

  if (result.error || result.status !== 0) {
    logForDebugging(
      `Rust diff runtime fallback: ${String(result.error ?? result.stderr)}`,
    )
    return null
  }

  try {
    return parseDiffEvents(result.stdout)
  } catch (error) {
    logForDebugging(`Rust diff runtime fallback: ${String(error)}`)
    return null
  }
}

function parseDiffEvents(stdout: string): StructuredPatchHunk[] {
  for (const line of stdout.trim().split('\n').filter(Boolean)) {
    const event = JSON.parse(line) as RustDiffEvent
    if (event.type === 'completed') {
      return event.hunks
    }
    if (event.type === 'failed') {
      throw new Error(event.message)
    }
  }
  throw new Error('Rust diff runtime did not return a completed event')
}
