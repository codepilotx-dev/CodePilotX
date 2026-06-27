import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { execSync, spawnSync } from 'node:child_process'

import type {
  DebugToolProbeItem,
  DebugToolProbeItemStatus,
  DebugToolProbeMode,
  DebugToolProbeReport,
} from '../shared/types.js'

export type ProbePermissionHandler = {
  requestPermission(toolName: string, inputSummary: string): Promise<'allow' | 'deny'>
}

const BUILTIN_TOOL_NAMES = [
  'AgentTool',
  'TaskOutput',
  'TaskStop',
  'Bash',
  'Glob',
  'Grep',
  'ExitPlanModeV2',
  'Read',
  'Edit',
  'Write',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
  'AskUserQuestion',
  'Skill',
  'EnterPlanMode',
  'TaskCreate',
  'TaskGet',
  'TaskUpdate',
  'TaskList',
  'LSP',
  'SendMessage',
  'Brief',
  'ListMcpResources',
  'ReadMcpResource',
  'ToolSearch',
  'PowerShell',
  'EnterWorktree',
  'ExitWorktree',
  'Config',
  'Tungsten',
  'Snip',
  'ListPeers',
  'Workflow',
  'Sleep',
  'CronCreate',
  'CronDelete',
  'CronList',
  'RemoteTrigger',
  'Monitor',
  'SendUserFile',
  'PushNotification',
  'SubscribePR',
  'CtxInspect',
  'TerminalCapture',
  'WebBrowser',
  'SuggestBackgroundPR',
  'REPL',
  'TeamCreate',
  'TeamDelete',
  'OverflowTest',
  'VerifyPlanExecution',
  'TestingPermission',
]

type StableToolName =
  | 'Read'
  | 'Write'
  | 'Edit'
  | 'Bash'
  | 'Glob'
  | 'Grep'
  | 'PowerShell'

const STABLE_TOOLS: Set<string> = new Set([
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'PowerShell',
])

const UNSUPPORTED_TOOL_REASONS: Record<string, string> = {
  AgentTool: '需要完整的 agent 运行时会话',
  TaskOutput: '依赖异步任务输出上下文',
  TaskStop: '依赖运行中的任务状态',
  ExitPlanModeV2: '依赖会话的计划模式状态',
  NotebookEdit: '依赖 Jupyter notebook 运行时',
  WebFetch: '依赖外部网络请求',
  WebSearch: '依赖外部网络请求和搜索 API',
  TodoWrite: '依赖会话 todo 状态',
  AskUserQuestion: '依赖交互式 UI 和用户输入',
  Skill: '依赖外部 skill 加载和执行',
  EnterPlanMode: '依赖会话的计划模式状态',
  TaskCreate: '依赖完整的 agent 任务调度系统',
  TaskGet: '依赖完整的 agent 任务调度系统',
  TaskUpdate: '依赖完整的 agent 任务调度系统',
  TaskList: '依赖完整的 agent 任务调度系统',
  LSP: '依赖 LSP 服务器连接',
  SendMessage: '依赖 agent 团队通信会话',
  Brief: '依赖会话消息历史和压缩上下文',
  ListMcpResources: '依赖 MCP 服务器连接',
  ReadMcpResource: '依赖 MCP 服务器连接和资源 URI',
  ToolSearch: '依赖工具搜索索引和会话状态',
  EnterWorktree: '依赖 git worktree 管理',
  ExitWorktree: '依赖 git worktree 管理',
  Config: '依赖 claude 配置系统',
  Tungsten: '依赖外部 Tungsten 服务',
  Snip: '依赖会话历史快照',
  ListPeers: '依赖 UDS 收件箱',
  Workflow: '依赖 workflow 脚本运行时',
  Sleep: '无副作用定时工具，不需要探针',
  CronCreate: '依赖定时任务调度系统',
  CronDelete: '依赖定时任务调度系统',
  CronList: '依赖定时任务调度系统',
  RemoteTrigger: '依赖远程触发端点',
  Monitor: '依赖外部监控服务',
  SendUserFile: '依赖用户文件发送目标',
  PushNotification: '依赖推送通知服务',
  SubscribePR: '依赖 GitHub webhook 订阅',
  CtxInspect: '依赖上下文折叠状态',
  TerminalCapture: '依赖终端面板运行时',
  WebBrowser: '依赖浏览器运行时和外部网络',
  SuggestBackgroundPR: '依赖 GitHub 集成和 PR 上下文',
  REPL: '依赖 REPL 运行时环境',
  TeamCreate: '依赖 agent 团队管理系统',
  TeamDelete: '依赖 agent 团队管理系统',
  OverflowTest: '仅用于溢出测试',
  VerifyPlanExecution: '依赖计划执行验证上下文',
  TestingPermission: '仅用于测试环境的权限验证',
}

export class DebugToolProbeService {
  private readonly workspacePath: string
  private readonly logPath: string
  private runningRuns = new Map<string, AbortController>()
  private permissionHandler: ProbePermissionHandler | null = null

  constructor() {
    this.workspacePath = join(tmpdir(), `codex-debug-probe-${Date.now()}`)
    this.logPath = join(this.workspacePath, 'probe.log')
  }

  getWorkspacePath(): string {
    return this.workspacePath
  }

  getLogPath(): string {
    return this.logPath
  }

  setPermissionHandler(handler: ProbePermissionHandler | null): void {
    this.permissionHandler = handler
  }

  ensureWorkspace(): void {
    if (!existsSync(this.workspacePath)) {
      mkdirSync(this.workspacePath, { recursive: true })
    }
    if (!existsSync(this.logPath)) {
      writeFileSync(this.logPath, '', 'utf-8')
    }
  }

  private log(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}\n`
    this.ensureWorkspace()
    writeFileSync(this.logPath, line, { flag: 'a' })
  }

  listBuiltinTools(): { toolNames: string[]; enabled: boolean[]; hasProbeInput: boolean[] } {
    const toolNames = BUILTIN_TOOL_NAMES
    const enabled = toolNames.map(() => true)
    const hasProbeInput = toolNames.map(name => STABLE_TOOLS.has(name))
    return { toolNames, enabled, hasProbeInput }
  }

  async runProbe(mode: DebugToolProbeMode, signal?: AbortSignal): Promise<DebugToolProbeReport> {
    const runId = `probe-${Date.now()}`
    const startedAt = new Date().toISOString()
    const items: DebugToolProbeItem[] = []

    this.log(`Probe run started: runId=${runId} mode=${mode}`)

    const toolNames = BUILTIN_TOOL_NAMES

    let completedTools = 0
    let permissionRequestCount = 0

    for (const toolName of toolNames) {
      if (signal?.aborted) {
        this.log(`Probe cancelled at tool: ${toolName}`)
        return this.buildCancelledReport(runId, mode, startedAt, items, toolNames)
      }

      let status: DebugToolProbeItemStatus
      let reason: string | undefined
      let durationMs: number | undefined
      let permissionRequestId: string | undefined
      let permissionDecision: string | undefined
      let inputSummary: string | undefined
      let error: string | undefined

      if (!STABLE_TOOLS.has(toolName)) {
        status = 'unsupportedProbe'
        reason = UNSUPPORTED_TOOL_REASONS[toolName] ?? '非稳定输入工具'
        this.log(`${toolName}: ${status} - ${reason}`)
      } else if (mode === 'safe') {
        const start = performance.now()
        try {
          this.runStableToolSafe(toolName as StableToolName, signal)
          status = 'passed'
          durationMs = Math.round(performance.now() - start)
          this.log(`${toolName}: passed (${durationMs}ms)`)
        } catch (err) {
          status = 'failed'
          error = err instanceof Error ? err.message : String(err)
          durationMs = Math.round(performance.now() - start)
          this.log(`${toolName}: failed - ${error}`)
        }
      } else {
        inputSummary = this.buildInputSummary(toolName as StableToolName)

        if (this.permissionHandler && mode === 'realManual') {
          permissionRequestCount++
          try {
            const decision = await this.permissionHandler.requestPermission(toolName, inputSummary)
            permissionDecision = decision
            if (decision === 'deny') {
              status = 'permissionDenied'
              this.log(`${toolName}: permission denied`)
            } else {
              const start = performance.now()
              try {
                this.runStableToolReal(toolName as StableToolName, signal)
                status = 'passed'
                durationMs = Math.round(performance.now() - start)
                this.log(`${toolName}: passed (${durationMs}ms)`)
              } catch (err) {
                status = 'failed'
                error = err instanceof Error ? err.message : String(err)
                durationMs = Math.round(performance.now() - start)
                this.log(`${toolName}: failed - ${error}`)
              }
            }
          } catch {
            status = 'permissionDenied'
            permissionDecision = 'timeout'
            this.log(`${toolName}: permission request timed out`)
          }
        } else {
          permissionDecision = 'auto-allowed'
          const start = performance.now()
          try {
            this.runStableToolReal(toolName as StableToolName, signal)
            status = 'passed'
            durationMs = Math.round(performance.now() - start)
            this.log(`${toolName}: passed (${durationMs}ms, auto)`)
          } catch (err) {
            status = 'failed'
            error = err instanceof Error ? err.message : String(err)
            durationMs = Math.round(performance.now() - start)
            this.log(`${toolName}: failed - ${error}`)
          }
        }
      }

      items.push({
        toolName,
        status,
        reason,
        durationMs,
        permissionRequestId,
        permissionDecision,
        inputSummary: mode !== 'safe' ? inputSummary : undefined,
        error,
      })

      completedTools++
    }

    const finishedAt = new Date().toISOString()

    this.log(`Probe run finished: ${runId} completed=${completedTools}`)

    return {
      runId,
      mode,
      startedAt,
      finishedAt,
      totalTools: toolNames.length,
      passed: items.filter(i => i.status === 'passed').length,
      failed: items.filter(i => i.status === 'failed').length,
      permissionDenied: items.filter(i => i.status === 'permissionDenied').length,
      unsupportedProbe: items.filter(i => i.status === 'unsupportedProbe').length,
      skippedByEnvironment: items.filter(i => i.status === 'skippedByEnvironment').length,
      items,
      logPath: this.logPath,
    }
  }

  cancelRun(runId: string): void {
    const controller = this.runningRuns.get(runId)
    if (controller) {
      controller.abort()
      this.runningRuns.delete(runId)
      this.log(`Probe run cancelled: ${runId}`)
    }
  }

  startProbe(mode: DebugToolProbeMode): { controller: AbortController; runId: string } {
    const runId = `probe-${Date.now()}`
    const controller = new AbortController()
    this.runningRuns.set(runId, controller)
    return { controller, runId }
  }

  finishProbeRun(runId: string): void {
    this.runningRuns.delete(runId)
  }

  cleanup(): void {
    try {
      if (existsSync(this.workspacePath)) {
        rmSync(this.workspacePath, { recursive: true, force: true })
      }
    } catch {
      // Cleanup is best-effort
    }
  }

  private runStableToolSafe(
    toolName: StableToolName,
    signal?: AbortSignal,
  ): void {
    if (signal?.aborted) {
      throw new Error('Cancelled')
    }
    this.ensureWorkspace()
    const testFile = join(this.workspacePath, 'probe-test.txt')
    const testContent = 'Hello from debug probe'

    switch (toolName) {
      case 'Read': {
        writeFileSync(testFile, testContent, 'utf-8')
        readFileSync(testFile, 'utf-8')
        break
      }
      case 'Write': {
        writeFileSync(testFile, testContent, 'utf-8')
        break
      }
      case 'Edit': {
        writeFileSync(testFile, 'original content', 'utf-8')
        const current = readFileSync(testFile, 'utf-8')
        writeFileSync(testFile, current + '\nline was edited', 'utf-8')
        readFileSync(testFile, 'utf-8')
        break
      }
      case 'Bash': {
        execSync('echo probe-ok', { cwd: this.workspacePath, timeout: 5000 })
        break
      }
      case 'PowerShell': {
        execSync('powershell.exe -NoProfile -Command "Write-Output probe-ok"', {
          cwd: this.workspacePath,
          timeout: 10000,
        })
        break
      }
      case 'Glob': {
        writeFileSync(testFile, testContent, 'utf-8')
        writeFileSync(join(this.workspacePath, 'probe-2.txt'), testContent, 'utf-8')
        const files = execSync(
          'dir /b *.txt',
          { cwd: this.workspacePath, timeout: 5000, shell: process.env.ComSpec ?? 'cmd.exe' },
        )
          .toString()
          .trim()
        if (!files) throw new Error('Glob returned no files')
        break
      }
      case 'Grep': {
        writeFileSync(testFile, testContent, 'utf-8')
        execSync(
          'findstr /L "Hello" probe-test.txt',
          { cwd: this.workspacePath, timeout: 5000 },
        )
        break
      }
    }
  }

  private runStableToolReal(
    toolName: StableToolName,
    signal?: AbortSignal,
  ): void {
    if (signal?.aborted) {
      throw new Error('Cancelled')
    }
    this.ensureWorkspace()
    const testFile = join(this.workspacePath, 'probe-real-test.txt')
    const testDir = join(this.workspacePath, 'probe-real-dir')

    switch (toolName) {
      case 'Read': {
        writeFileSync(testFile, 'Probe real content: Read test\n', 'utf-8')
        const content = readFileSync(testFile, 'utf-8')
        if (!content.includes('Read test')) throw new Error('Read verification failed')
        break
      }
      case 'Write': {
        writeFileSync(testFile, 'Probe real content: Write test\n', 'utf-8')
        if (!existsSync(testFile)) throw new Error('Write verification failed')
        break
      }
      case 'Edit': {
        writeFileSync(testFile, 'line1\nline2\nline3\n', 'utf-8')
        const current = readFileSync(testFile, 'utf-8')
        writeFileSync(testFile, 'line1\nEDITED\nline3\n', 'utf-8')
        const updated = readFileSync(testFile, 'utf-8')
        if (updated === current) throw new Error('Edit produced no change')
        break
      }
      case 'Bash': {
        const output = execSync('echo probe-real-ok && dir /b', {
          cwd: this.workspacePath,
          timeout: 5000,
        })
          .toString()
          .trim()
        if (!output) throw new Error('Bash produced no output')
        break
      }
      case 'PowerShell': {
        const result = spawnSync(
          'powershell.exe',
          ['-NoProfile', '-Command', 'Write-Output probe-real-ok; exit 0'],
          { cwd: this.workspacePath, timeout: 10000, encoding: 'utf-8' },
        )
        if (result.status !== 0) {
          throw new Error(`PowerShell exited with code ${result.status}: ${result.stderr ?? ''}`)
        }
        if (!result.stdout?.includes('probe-real-ok')) {
          throw new Error('PowerShell output verification failed')
        }
        break
      }
      case 'Glob': {
        writeFileSync(testFile, 'x', 'utf-8')
        writeFileSync(join(this.workspacePath, 'probe-real-extra.json'), '{}', 'utf-8')
        const pngFile = join(this.workspacePath, 'probe-real-icon.png')
        writeFileSync(pngFile, '', 'utf-8')
        const files = execSync('dir /b *.txt', {
          cwd: this.workspacePath,
          timeout: 5000,
        })
          .toString()
          .trim()
        if (!files.includes('probe-real-test.txt')) throw new Error('Glob missed test file')
        break
      }
      case 'Grep': {
        writeFileSync(testFile, 'needle\nhaystack\n', 'utf-8')
        const result = execSync('findstr /L "needle" probe-real-test.txt', {
          cwd: this.workspacePath,
          timeout: 5000,
        })
          .toString()
          .trim()
        if (!result.includes('needle')) throw new Error('Grep missed match')
        break
      }
    }
  }

  private buildInputSummary(toolName: StableToolName): string {
    const filePath = join(this.workspacePath, 'probe-real-test.txt')
    switch (toolName) {
      case 'Read':
        return `Read(filePath="${filePath}")`
      case 'Write':
        return `Write(filePath="${filePath}", content="Probe real content...")`
      case 'Edit':
        return `Edit(filePath="${filePath}", oldString="...", newString="...")`
      case 'Bash':
        return `Bash(command="echo probe-real-ok && dir /b") in ${this.workspacePath}`
      case 'PowerShell':
        return `PowerShell(command="Write-Output probe-real-ok") in ${this.workspacePath}`
      case 'Glob':
        return `Glob(pattern="*.txt") in ${this.workspacePath}`
      case 'Grep':
        return `Grep(pattern="needle", filePath="${filePath}")`
    }
  }

  private buildCancelledReport(
    runId: string,
    mode: DebugToolProbeMode,
    startedAt: string,
    items: DebugToolProbeItem[],
    allToolNames: string[],
  ): DebugToolProbeReport {
    return {
      runId,
      mode,
      startedAt,
      finishedAt: new Date().toISOString(),
      cancelled: true,
      totalTools: allToolNames.length,
      passed: items.filter(i => i.status === 'passed').length,
      failed: items.filter(i => i.status === 'failed').length,
      permissionDenied: items.filter(i => i.status === 'permissionDenied').length,
      unsupportedProbe: items.filter(i => i.status === 'unsupportedProbe').length,
      skippedByEnvironment: items.filter(i => i.status === 'skippedByEnvironment').length,
      items,
      logPath: this.logPath,
    }
  }
}
