type WindowLike = {
  isDestroyed(): boolean
  webContents: {
    isDestroyed(): boolean
    send(channel: string, payload: unknown): void
  }
}

export function createWindowRegistry<TWindow extends WindowLike>() {
  const windows = new Set<TWindow>()

  function prune(): void {
    for (const window of windows) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) {
        windows.delete(window)
      }
    }
  }

  return {
    add(window: TWindow): void {
      windows.add(window)
    },
    delete(window: TWindow): void {
      windows.delete(window)
    },
    all(): TWindow[] {
      prune()
      return [...windows]
    },
    broadcast(channel: string, payload: unknown): void {
      for (const window of this.all()) {
        window.webContents.send(channel, payload)
      }
    },
  }
}
