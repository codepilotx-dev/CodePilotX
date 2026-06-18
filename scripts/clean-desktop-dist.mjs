import { existsSync, rmSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')

const targets = [
  resolve(repoRoot, 'dist', 'desktop'),
  resolve(repoRoot, 'dist', 'desktop-agent'),
  resolve(repoRoot, 'release', 'desktop'),
]

function isInsideRoot(target) {
  if (target === repoRoot) {
    return false
  }
  const rel = relative(repoRoot, target)
  if (rel === '' || rel.startsWith('..') || rel === '.') {
    return false
  }
  return true
}

let removed = 0
let skipped = 0
for (const target of targets) {
  if (!isInsideRoot(target)) {
    console.error(`refusing to remove path outside repo root: ${target}`)
    process.exitCode = 1
    continue
  }
  if (!existsSync(target)) {
    skipped += 1
    continue
  }
  console.log(`removing ${target}`)
  rmSync(target, { recursive: true, force: true })
  removed += 1
}

console.log(`cleaned desktop outputs: ${removed} removed, ${skipped} already absent`)
