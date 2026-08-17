/** 插件平台桌面 IPC 契约：集中定义 channel、参数与返回类型。 */

export const DESKTOP_PLUGIN_IPC_CHANNELS = {
  pickPluginPackageFile: "desktop-plugin:pick-package-file",
  pickPluginDirectory: "desktop-plugin:pick-directory",
  restartApp: "desktop-plugin:restart-app",
} as const

export type DesktopPluginPackageFilePick = {
  canceled: boolean
  path: string | null
}

export type DesktopPluginDirectoryPick = {
  canceled: boolean
  path: string | null
}

export interface DesktopPluginIpcBridge {
  /** 选择 .cpxplugin 包文件（typed picker；安装入口）。 */
  pickPluginPackageFile(): Promise<DesktopPluginPackageFilePick>
  /** 选择开发目录（typed folder picker；链接入口）。 */
  pickPluginDirectory(): Promise<DesktopPluginDirectoryPick>
  /** 请求重启应用（System Profile applyOnRestart 等场景）。 */
  restartApp(): Promise<void>
}
