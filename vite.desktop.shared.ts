import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import type { UserConfig } from 'vite'

const root = resolve(__dirname)

export const desktopOutDir = resolve(root, 'dist/desktop')

export const desktopAlias = {
  src: resolve(root, 'src'),
  'bun:bundle': resolve(root, 'src/desktop/shims/bunBundle.ts'),
}

export const desktopMacroDefines = {
  'MACRO.VERSION': JSON.stringify('0.0.0-local'),
  'MACRO.BUILD_TIME': JSON.stringify('local'),
  'MACRO.PACKAGE_URL': JSON.stringify('claudecode-local'),
  'MACRO.NATIVE_PACKAGE_URL': JSON.stringify('claudecode-local-native'),
  'MACRO.FEEDBACK_CHANNEL': JSON.stringify('local'),
  'MACRO.ISSUES_EXPLAINER': JSON.stringify('open an issue in the local checkout'),
  'MACRO.VERSION_CHANGELOG': JSON.stringify('Local development build'),
  'process.env.USER_TYPE': JSON.stringify('external'),
  'process.env.NODE_ENV': JSON.stringify('development'),
  'process.env.CLAUDE_CODE_DISABLE_MDM_READ': JSON.stringify('1'),
  'process.env.CLAUDE_CODE_DISABLE_MIN_VERSION_CHECK': JSON.stringify('1'),
}

const external = [
  'electron',
  ...builtinModules,
  ...builtinModules.map(mod => `node:${mod}`),
]

export function nodeDesktopBuild(
  entry: string,
  outDir: string,
  name: string,
): UserConfig {
  return {
    resolve: { alias: desktopAlias },
    define: desktopMacroDefines,
    build: {
      emptyOutDir: false,
      outDir,
      target: 'node22',
      sourcemap: true,
      lib: {
        entry,
        formats: ['es'],
        fileName: () => `${name}.js`,
      },
      rollupOptions: {
        external,
      },
    },
  }
}
