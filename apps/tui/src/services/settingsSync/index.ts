/**
 * Settings sync used the Claude.ai OAuth private API. That auth path is removed
 * from this build, so the public hooks remain as no-op fail-open operations.
 */

let downloadPromise: Promise<boolean> | null = null

export async function uploadUserSettingsInBackground(): Promise<void> {}

/** Test-only: clear the cached download promise between tests. */
export function _resetDownloadPromiseForTesting(): void {
  downloadPromise = null
}

export function downloadUserSettings(): Promise<boolean> {
  if (!downloadPromise) {
    downloadPromise = Promise.resolve(false)
  }
  return downloadPromise
}

export function redownloadUserSettings(): Promise<boolean> {
  downloadPromise = Promise.resolve(false)
  return downloadPromise
}
