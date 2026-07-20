export type FileIconKind =
  | 'file'
  | 'code'
  | 'typescript'
  | 'react'
  | 'javascript'
  | 'json'
  | 'markdown'
  | 'css'
  | 'html'
  | 'python'
  | 'rust'
  | 'cplusplus'
  | 'java'
  | 'php'
  | 'shell'
  | 'yaml'
  | 'toml'
  | 'database'
  | 'image'
  | 'notebook'
  | 'pdf'
  | 'spreadsheet'
  | 'presentation'
  | 'document'
  | 'archive'
  | 'build'
  | 'skill'

const EXTENSION_KINDS: Readonly<Record<string, FileIconKind>> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'react',
  jsx: 'react',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',
  styl: 'css',
  html: 'html',
  htm: 'html',
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  rs: 'rust',
  c: 'cplusplus',
  h: 'cplusplus',
  cc: 'cplusplus',
  cpp: 'cplusplus',
  cxx: 'cplusplus',
  hpp: 'cplusplus',
  hxx: 'cplusplus',
  m: 'cplusplus',
  mm: 'cplusplus',
  java: 'java',
  kt: 'java',
  kts: 'java',
  groovy: 'java',
  scala: 'java',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'shell',
  psm1: 'shell',
  psd1: 'shell',
  bat: 'shell',
  cmd: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sql: 'database',
  db: 'database',
  sqlite: 'database',
  sqlite3: 'database',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  svg: 'image',
  webp: 'image',
  bmp: 'image',
  ico: 'image',
  avif: 'image',
  tif: 'image',
  tiff: 'image',
  ipynb: 'notebook',
  pdf: 'pdf',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  xlsm: 'spreadsheet',
  csv: 'spreadsheet',
  tsv: 'spreadsheet',
  ods: 'spreadsheet',
  ppt: 'presentation',
  pptx: 'presentation',
  odp: 'presentation',
  key: 'presentation',
  doc: 'document',
  docx: 'document',
  rtf: 'document',
  odt: 'document',
  txt: 'document',
  log: 'document',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
  bz2: 'archive',
  xz: 'archive',
  tgz: 'archive',
  lock: 'build',
}

const BUILD_FILE_NAMES = new Set([
  '.dockerignore',
  '.editorconfig',
  '.env',
  '.eslintignore',
  '.eslintrc',
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  '.prettierignore',
  '.prettierrc',
  'build',
  'build.bazel',
  'build.gradle',
  'build.gradle.kts',
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'cargo.toml',
  'cmakelists.txt',
  'deno.json',
  'deno.jsonc',
  'flake.lock',
  'flake.nix',
  'gemfile',
  'go.mod',
  'go.sum',
  'gradle.properties',
  'makefile',
  'package-lock.json',
  'package.json',
  'pnpm-lock.yaml',
  'podfile',
  'pom.xml',
  'pyproject.toml',
  'requirements.txt',
  'settings.gradle',
  'settings.gradle.kts',
  'workspace',
  'workspace.bazel',
  'yarn.lock',
])

const DOCUMENT_FILE_NAMES = new Set([
  'authors',
  'changelog',
  'copying',
  'license',
  'notice',
  'readme',
])

const SHELL_FILE_NAMES = new Set([
  '.bash_profile',
  '.bashrc',
  '.profile',
  '.zprofile',
  '.zshrc',
])

const BUILD_FILE_PATTERNS = [
  /^dockerfile(?:\..+)?$/u,
  /^(?:gnu)?makefile(?:\..+)?$/u,
  /^(?:js|ts)config(?:\.[^.]+)*\.json$/u,
  /^(?:vite|vitest|webpack|rollup|esbuild|next|astro|eslint|prettier|postcss|tailwind|playwright)\.config\.(?:[cm]?[jt]s)$/u,
  /^\.env(?:\..+)?$/u,
] as const

export function resolveFileIconKind(
  path: string | null | undefined,
): FileIconKind {
  const fileName = basename(path)
  if (!fileName) return 'file'

  const normalizedName = fileName.toLowerCase()
  if (normalizedName === 'skill.md') return 'skill'
  if (
    BUILD_FILE_NAMES.has(normalizedName) ||
    BUILD_FILE_PATTERNS.some(pattern => pattern.test(normalizedName))
  ) {
    return 'build'
  }
  if (SHELL_FILE_NAMES.has(normalizedName)) return 'shell'

  const extensionlessName = normalizedName.replace(
    /\.(?:md|mdx|markdown|txt)$/u,
    '',
  )
  if (DOCUMENT_FILE_NAMES.has(extensionlessName)) {
    return normalizedName === extensionlessName ? 'document' : 'markdown'
  }

  const extension = extensionOf(normalizedName)
  if (!extension) return 'file'
  return EXTENSION_KINDS[extension] ?? 'code'
}

function basename(path: string | null | undefined): string {
  if (!path) return ''
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/u, '')
  return normalized.split('/').pop() ?? ''
}

function extensionOf(fileName: string): string | null {
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === fileName.length - 1) return null
  return fileName.slice(lastDot + 1)
}
