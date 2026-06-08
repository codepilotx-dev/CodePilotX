import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig, type UserConfig } from 'vite'

const root = resolve(__dirname)
const desktopOutDir = resolve(root, 'dist/desktop')
const external = [
  'electron',
  ...builtinModules,
  ...builtinModules.map(mod => `node:${mod}`),
]

const macroDefines = {
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

const alias = {
  src: resolve(root, 'src'),
  'bun:bundle': resolve(root, 'src/desktop/shims/bunBundle.ts'),
}

const nodeBuild = (
  entry: string,
  outDir: string,
  name: string,
): UserConfig => ({
  resolve: { alias },
  define: macroDefines,
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
})

export default defineConfig([
  nodeBuild('src/desktop/main/index.ts', resolve(desktopOutDir, 'main'), 'index'),
  nodeBuild(
    'src/desktop/preload/index.ts',
    resolve(desktopOutDir, 'preload'),
    'index',
  ),
  {
    root: 'src/desktop/renderer',
    resolve: { alias },
    define: macroDefines,
    build: {
      outDir: resolve(desktopOutDir, 'renderer'),
      emptyOutDir: false,
      target: 'chrome120',
      sourcemap: true,
    },
  },
])
