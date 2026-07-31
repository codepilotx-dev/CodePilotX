import electronUpdater from "electron-updater"
import type { ElectronAutoUpdaterLike } from "./desktop-auto-updater.js"

export function electronAutoUpdater(): ElectronAutoUpdaterLike {
  return electronUpdater.autoUpdater as ElectronAutoUpdaterLike
}
