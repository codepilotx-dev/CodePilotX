import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import type { UserConfig } from 'vite'

const root = resolve(__dirname, '../..')
type PackageJsonDeps = {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const packageJson = JSON.parse(
  readFileSync(resolve(root, 'apps/desktop/package.json'), 'utf8'),
) as PackageJsonDeps
const compatPackageJson = JSON.parse(
  readFileSync(resolve(root, 'packages/desktop-compat/package.json'), 'utf8'),
) as PackageJsonDeps

export const desktopOutDir = resolve(root, 'apps/desktop/dist')

export const desktopAlias = {
  '@codepilotx/core': resolve(root, 'packages/desktop-compat/src/core'),
  '@codepilotx/tui': resolve(root, 'packages/desktop-compat/src/tui'),
  '@codepilotx/desktop': resolve(root, 'apps/desktop/src'),
  '@codepilotx/codex-app-server-client': resolve(
    root,
    'packages/codex-app-server-client/src',
  ),
  'bun:bundle': resolve(root, 'apps/desktop/src/shims/bunBundle.ts'),
}

export const desktopMacroDefines = {
  'MACRO.VERSION': JSON.stringify('0.0.0-local'),
  'MACRO.BUILD_TIME': JSON.stringify('local'),
  'MACRO.PACKAGE_URL': JSON.stringify('codepilotx-local'),
  'MACRO.NATIVE_PACKAGE_URL': JSON.stringify('codepilotx-local-native'),
  'MACRO.FEEDBACK_CHANNEL': JSON.stringify('local'),
  'MACRO.ISSUES_EXPLAINER': JSON.stringify('open an issue in the local checkout'),
  'MACRO.VERSION_CHANGELOG': JSON.stringify('Local development build'),
  'process.env.USER_TYPE': JSON.stringify('external'),
  'process.env.NODE_ENV': JSON.stringify('development'),
  'process.env.CODEPILOTX_DISABLE_MDM_READ': JSON.stringify('1'),
  'process.env.CODEPILOTX_DISABLE_MIN_VERSION_CHECK': JSON.stringify('1'),
  'process.env.CLAUDE_CODE_DISABLE_MDM_READ': JSON.stringify('1'),
  'process.env.CLAUDE_CODE_DISABLE_MIN_VERSION_CHECK': JSON.stringify('1'),
  'import.meta.env.CODEPILOTX_DESKTOP_BROWSER_DEBUG_PORT': JSON.stringify(
    process.env.CODEPILOTX_DESKTOP_BROWSER_DEBUG_PORT ?? '',
  ),
  'import.meta.env.CLAUDE_CODE_DESKTOP_BROWSER_DEBUG_PORT': JSON.stringify(
    process.env.CLAUDE_CODE_DESKTOP_BROWSER_DEBUG_PORT ?? '',
  ),
}

function disableBundledFeaturesPlugin() {
  return {
    name: 'desktop-disable-bundled-features',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (
        !id.includes('/packages/desktop-compat/src/tui/') &&
        !id.includes('\\packages\\desktop-compat\\src\\tui\\')
      ) {
        return null
      }
      const transformed = code.replace(
        /\bfeature\(\s*(['"`])[^'"`]*\1\s*\)/g,
        'false',
      )
      return transformed === code ? null : { code: transformed, map: null }
    },
  }
}

const external = [
  'electron',
  ...builtinModules,
  ...builtinModules.map(mod => `node:${mod}`),
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.optionalDependencies ?? {}),
  ...Object.keys(packageJson.devDependencies ?? {}),
  ...Object.keys(compatPackageJson.dependencies ?? {}),
  ...Object.keys(compatPackageJson.optionalDependencies ?? {}),
]

const optionalDesktopFeatureModules = [
  'DiscoverSkillsTool/prompt.js',
]

const bundledWorkspaceModules = [
  '@codepilotx/codex-app-server-client',
  '@codepilotx/desktop',
  '@codepilotx/desktop-compat',
  '@codepilotx/core',
  '@codepilotx/tui',
]

function isExternalDependency(id: string): boolean {
  if (
    bundledWorkspaceModules.some(moduleId => {
      if (id === moduleId) return true
      return id.startsWith(`${moduleId}/`)
    })
  ) {
    return false
  }
  if (optionalDesktopFeatureModules.some(moduleId => id.includes(moduleId))) {
    return true
  }
  return external.some(externalId => {
    if (id === externalId) return true
    return id.startsWith(`${externalId}/`)
  })
}

function nodeRequireBanner(formats: ('es' | 'cjs')[]): string | undefined {
  if (formats.length !== 1 || formats[0] !== 'es') {
    return undefined
  }
  return [
    "import { createRequire as __desktopCreateRequire } from 'node:module';",
    'const require = __desktopCreateRequire(import.meta.url);',
  ].join('\n')
}

export function nodeDesktopBuild(
  entry: string,
  outDir: string,
  name: string,
  formats: ('es' | 'cjs')[] = ['es'],
  options: { sourcemap?: boolean } = {},
): UserConfig {
  const sourcemap = options.sourcemap ?? false
  return {
    plugins: [disableBundledFeaturesPlugin()],
    resolve: { alias: desktopAlias },
    define: desktopMacroDefines,
    build: {
      emptyOutDir: false,
      outDir,
      target: 'node22',
      sourcemap,
      lib: {
        entry: resolve(root, entry),
        formats,
        fileName: () => `${name}.js`,
      },
      rollupOptions: {
        external: isExternalDependency,
        output: {
          banner: nodeRequireBanner(formats),
        },
      },
    },
  }
}
