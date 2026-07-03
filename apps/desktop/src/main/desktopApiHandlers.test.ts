import { describe, expect, mock, test } from 'bun:test'

// Must be at top level to intercept electron imports before any dynamic import.
mock.module('electron', () => ({
  app: {
    getPath: () => '',
    getAppPath: () => '',
  },
  BrowserWindow: Object.assign(
    mock(() => ({
      loadURL: () => {},
      on: () => {},
      webContents: {
        on: () => {},
        openDevTools: () => {},
        closeDevTools: () => {},
        setWindowOpenHandler: () => {},
        isDestroyed: () => false,
      },
      setMenuBarVisibility: () => {},
      setAutoHideMenuBar: () => {},
      getNormalBounds: () => ({ x: 0, y: 0, width: 1440, height: 920 }),
      isMaximized: () => false,
      isDestroyed: () => false,
      minimize: () => {},
      unmaximize: () => {},
      maximize: () => {},
      close: () => {},
    })),
    { getFocusedWindow: () => null, getAllWindows: () => [] },
  ),
  BrowserView: mock(() => ({})),
  WebContentsView: mock(() => ({})),
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showMessageBox: async () => ({ response: 0 }),
  },
  ipcMain: {
    handle: () => {},
  },
  Menu: {
    buildFromTemplate: (t: unknown) => t,
    setApplicationMenu: () => {},
  },
  safeStorage: {
    encryptString: () => Buffer.from(''),
    decryptString: () => '',
    isEncryptionAvailable: () => false,
  },
  screen: {
    getPrimaryDisplay: () => ({
      id: 1,
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
    getAllDisplays: () => [],
    getDisplayMatching: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  },
  shell: {
    openExternal: () => {},
    openPath: async () => '',
    showItemInFolder: () => {},
    trashItem: async () => {},
  },
}))

describe('desktopApiHandlers debug hard-disable', () => {
  // Increase timeout for first import that triggers electron binary download
  test('openDevTools does not call windowService when debugEnabled is false', async () => {
    const windowServiceOpenDevTools = mock(() => {})
    const deps = buildDependencies({
      debugEnabled: false,
      windowService: {
        ...dummyWindowService,
        openDevTools: windowServiceOpenDevTools,
      },
    })
    const { buildDesktopApiHandlers } = await import('./desktopApiHandlers.js')
    const handlers = buildDesktopApiHandlers(deps)
    await handlers.openDevTools()
    expect(windowServiceOpenDevTools).not.toHaveBeenCalled()
  }, { timeout: 30000 })

  test('openDevTools calls windowService when debugEnabled is true', async () => {
    const windowServiceOpenDevTools = mock(() => {})
    const deps = buildDependencies({
      debugEnabled: true,
      windowService: {
        ...dummyWindowService,
        openDevTools: windowServiceOpenDevTools,
      },
    })
    const { buildDesktopApiHandlers } = await import('./desktopApiHandlers.js')
    const handlers = buildDesktopApiHandlers(deps)
    await handlers.openDevTools()
    expect(windowServiceOpenDevTools).toHaveBeenCalled()
  }, { timeout: 30000 })

  test('runDebugToolProbe throws when debugEnabled is false', async () => {
    const deps = buildDependencies({
      debugEnabled: false,
    })
    const { buildDesktopApiHandlers } = await import('./desktopApiHandlers.js')
    const handlers = buildDesktopApiHandlers(deps)
    await expect(
      handlers.runDebugToolProbe('safe'),
    ).rejects.toThrow('Debug tools are disabled in packaged builds.')
  })

  test('runDebugToolProbe starts probe when debugEnabled is true', async () => {
    const startProbe = mock(() => ({
      controller: new AbortController(),
      runId: 'test-run-1',
    }))
    const runProbe = mock(
      async () =>
        ({
          runId: 'test-run-1',
          mode: 'safe' as const,
          startedAt: '',
          finishedAt: '',
          totalTools: 0,
          passed: 0,
          failed: 0,
          permissionDenied: 0,
          unsupportedProbe: 0,
          skippedByEnvironment: 0,
          items: [],
          logPath: '',
        }) as any,
    )
    const finishProbeRun = mock(() => {})
    const deps = buildDependencies({
      debugEnabled: true,
      debugToolProbeService: {
        ...dummyProbeService,
        startProbe,
        runProbe,
        finishProbeRun,
      },
    })
    const { buildDesktopApiHandlers } = await import('./desktopApiHandlers.js')
    const handlers = buildDesktopApiHandlers(deps)
    const report = await handlers.runDebugToolProbe('safe')
    expect(startProbe).toHaveBeenCalled()
    expect(runProbe).toHaveBeenCalledWith('safe', expect.any(AbortSignal))
    expect(finishProbeRun).toHaveBeenCalledWith('test-run-1')
    expect(report.runId).toBe('test-run-1')
  })

  test('cancelDebugToolProbe does nothing when debugEnabled is false', async () => {
    const cancelRun = mock(() => {})
    const deps = buildDependencies({
      debugEnabled: false,
      debugToolProbeService: {
        ...dummyProbeService,
        cancelRun,
      },
    })
    const { buildDesktopApiHandlers } = await import('./desktopApiHandlers.js')
    const handlers = buildDesktopApiHandlers(deps)
    await handlers.cancelDebugToolProbe('some-run-id')
    expect(cancelRun).not.toHaveBeenCalled()
  })
})

// --- dummy dependencies ---

const dummyWindowService = {
  createWindow: () => {},
  createApplicationMenu: () => {},
  getWindow: () => null,
  hasOpenWindows: () => false,
  emitAgentEvent: () => [],
  emitWorkflowEvent: (e: any) => e,
  emitSessionStoreChange: () => {},
  emitSettingsChange: () => {},
  emitPermissionDecision: () => [],
  readWorkflowEventLog: async () => [],
  sendUiCommand: () => {},
  minimizeWindow: () => {},
  toggleWindowMaximized: () => false,
  closeWindow: () => {},
  isWindowMaximized: () => false,
  newWindow: () => {},
  openDevTools: mock(() => {}),
  closeDevTools: mock(() => {}),
  openSettings: () => {},
  logOut: () => {},
  exitApp: () => {},
}

const dummyBrowserService = {
  getState: async () => ({
    isOpen: false,
    url: '',
    canGoBack: false,
    canGoForward: false,
    title: '',
    isLoading: false,
  }),
  open: async () => {},
  navigate: async () => {},
  reload: async () => {},
  goBack: async () => {},
  goForward: async () => {},
  close: async () => {},
  setBounds: async () => {},
  handleAutomationAction: async () => ({}),
  clearAllowedSites: async () => {},
}

const dummyProbeService = {
  listBuiltinTools: mock(() => ({
    toolNames: [],
    enabled: [],
    hasProbeInput: [],
  })),
  startProbe: mock(() => ({
    controller: new AbortController(),
    runId: 'test-run',
  })),
  runProbe: mock(
    async () =>
      ({
        runId: 'test-run',
        mode: 'safe' as const,
        startedAt: '',
        finishedAt: '',
        totalTools: 0,
        passed: 0,
        failed: 0,
        permissionDenied: 0,
        unsupportedProbe: 0,
        skippedByEnvironment: 0,
        items: [],
        logPath: '',
      }) as any,
  ),
  finishProbeRun: mock(() => {}),
  cancelRun: mock(() => {}),
  cleanup: () => {},
  getWorkspacePath: () => '',
  getLogPath: () => '',
  setPermissionHandler: () => {},
  ensureWorkspace: () => {},
}

function buildDependencies(overrides?: Record<string, any>): any {
  return {
    windowService: dummyWindowService,
    browserService: dummyBrowserService as any,
    debugToolProbeService: dummyProbeService as any,
    debugEnabled: overrides?.debugEnabled ?? true,
    getRuntimeOptions: () => ({
      agentExecutablePath: '',
      configDirectoryPath: '',
      runtimePreference: 'auto' as const,
      runtimeSelectionSource: 'default' as const,
    }),
    getToolchainStatus: async () => ({ ok: true }),
    diagnoseToolchain: async () => ({ ok: true }),
    reinstallToolchain: async () => ({ ok: true }),
    deleteToolchain: async () => ({ ok: true }),
    listBuiltinPlugins: async () => [],
    setBuiltinPluginEnabled: async () => ({ id: '', enabled: false }),
    listSlashCommands: async () => [],
    createSession: async () => ({
      sessionId: '',
      workspace: { path: '', isStandalone: true },
      standalone: true,
    }),
    listSessions: async () => [],
    getSession: async () => ({}),
    getActiveSessionId: async () => null,
    setActiveSession: async () => {},
    updateSessionMetadata: async () => ({}),
    saveSessionReviewComment: async () => ({}),
    resolveSessionReviewComment: async () => ({}),
    deleteSessionReviewComment: async () => ({}),
    setSessionPermissionMode: async () => ({}),
    setSessionPlanModeActive: async () => ({}),
    setSessionLocalRouterMode: async () => ({}),
    sendUserMessage: async () => {},
    respondToPermission: async () => {},
    interruptSession: async () => {},
    disposeSession: async () => {},
    restoreSessionTurnChanges: async () => ({ ok: true }),
    ...overrides,
  }
}
