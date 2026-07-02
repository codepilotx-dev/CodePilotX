import { builtinModules } from 'node:module'
import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const root = process.cwd()
const exts = new Set(['.ts', '.tsx', '.js'])
const ignoredDirs = new Set(['.git', 'dist', 'node_modules', 'stubs'])
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]))

// Packages that must not appear in the dependency tree
const DENY_LIST = new Set([
  'shelljs',
  'child_process',
  'eval',
  'vm2',
])

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(path, files)
    } else if (exts.has(extname(entry.name))) {
      files.push(path)
    }
  }
  return files
}

function packageName(specifier) {
  if (specifier !== specifier.trim() || /[\s()*:,]/.test(specifier)) {
    return null
  }

  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('src/') ||
    specifier.startsWith('bun:') ||
    builtins.has(specifier)
  ) {
    return null
  }

  if (!/^(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(\/[a-z0-9._/-]+)?$/i.test(specifier)) {
    return null
  }

  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]
}

const importPattern =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*(?:const|let|var)\s+[^\n=]+?=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g

const packages = new Map()
let errors = []

for (const file of walk(root)) {
  const text = readFileSync(file, 'utf8')
    .replace(/\/\/# sourceMappingURL=data:application\/json[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  for (const match of text.matchAll(importPattern)) {
    const specifier = match[1] || match[2] || match[3]
    const name = packageName(specifier)
    if (!name) continue

    if (DENY_LIST.has(name)) {
      errors.push(`Denied package "${name}" referenced in ${relative(root, file).replaceAll('\\', '/')}`)
    }

    const record =
      packages.get(name) ?? {
        count: 0,
        specifiers: new Set(),
        files: new Set(),
      }
    record.count += 1
    record.specifiers.add(specifier)
    if (record.files.size < 5) {
      record.files.add(relative(root, file).replaceAll('\\', '/'))
    }
    packages.set(name, record)
  }
}

// Check for packages pinned to "latest" in package.json
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies }
const latestDeps = Object.entries(allDeps)
  .filter(([, version]) => version === 'latest')

if (latestDeps.length > 0) {
  errors.push(
    `${latestDeps.length} dependenc${latestDeps.length === 1 ? 'y' : 'ies'} pinned to "latest": ${latestDeps.map(([name]) => name).join(', ')}`,
  )
}

const output = [...packages.entries()]
  .map(([name, record]) => ({
    name,
    count: record.count,
    specifiers: [...record.specifiers].slice(0, 10),
    files: [...record.files],
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

console.log(JSON.stringify(output, null, 2))

if (errors.length > 0) {
  console.error(`\n\ndeps-audit FAILED with ${errors.length} error(s):`)
  for (const error of errors) {
    console.error(`  - ${error}`)
  }
  process.exit(1)
}
