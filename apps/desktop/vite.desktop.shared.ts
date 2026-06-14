import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import type { UserConfig } from 'vite'

const root = resolve(__dirname, '../..')
const packageJson = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
) as {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export const desktopOutDir = resolve(root, 'dist/desktop')

export const desktopAlias = {
  '@codepilotx/core': resolve(root, 'packages/core/src'),
  '@codepilotx/tui': resolve(root, 'apps/tui/src'),
  '@codepilotx/desktop': resolve(root, 'apps/desktop/src'),
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
}

function disableBundledFeaturesPlugin() {
  return {
    name: 'desktop-disable-bundled-features',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!id.includes('/apps/tui/src/') && !id.includes('\\apps\\tui\\src\\')) {
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
]

const optionalDesktopFeatureModules = [
  'DiscoverSkillsTool/prompt.js',
]

function isExternalDependency(id: string): boolean {
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
        entry,
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
