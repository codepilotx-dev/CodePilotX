import { existsSync, readdirSync, realpathSync, statSync } from "node:fs"
import { basename, isAbsolute, join, parse, resolve } from "node:path"
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime"
import type { AdditionalPermissions, PermissionConfig } from "@codepilotx/shared/thread"

export interface SandboxPolicyOptions {
  workspace: string
  sessionTemp: string
  dataDir: string
  permissionConfig: PermissionConfig
  additionalPermissions?: AdditionalPermissions
  helperPath?: string | null
}

export interface GeneratedSandboxPolicy {
  config: SandboxRuntimeConfig
  workspace: string
  sessionTemp: string
  protectedRead: string[]
  protectedWrite: string[]
  requestedRead: string[]
  requestedWrite: string[]
  requestedDomains: string[]
}

const SECRET_ENV_NAMES = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AZURE_CLIENT_SECRET",
  "AZURE_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "KUBECONFIG",
  "TF_TOKEN_app_terraform_io",
]

const secretEnvNames = () => [...new Set([
  ...SECRET_ENV_NAMES,
  ...Object.keys(process.env).filter((name) => /(?:^|_)(?:api[_-]?key|token|secret|password|credential|private[_-]?key)(?:$|_)/i.test(name)),
])]

const unique = (values: readonly string[]) => [...new Set(values.map((value) => resolve(value)))]

function expandRequestedPath(workspace: string, value: string) {
  const path = isAbsolute(value) ? resolve(value) : resolve(workspace, value)
  return path
}

const pathKey = (value: string) => process.platform === "win32" ? value.toLowerCase() : value

export function safePathDirectories(input: { path?: string; cwd?: string; userHome?: string; windowsRoot?: string } = {}) {
  const cwd = resolve(input.cwd ?? process.cwd())
  const forbidden = [input.userHome ?? process.env.USERPROFILE ?? process.env.HOME, input.windowsRoot ?? process.env.SystemRoot]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => {
      const absolute = resolve(value)
      try { return [absolute, realpathSync.native(absolute)] } catch { return [absolute] }
    })
  const forbiddenKeys = new Set(forbidden.map(pathKey))
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of (input.path ?? process.env.PATH ?? "").split(";").map((value) => value.trim()).filter(Boolean)) {
    const absolute = isAbsolute(raw) ? resolve(raw) : resolve(cwd, raw)
    if (!existsSync(absolute)) continue
    let canonical: string
    try {
      canonical = realpathSync.native(absolute)
      if (!statSync(canonical).isDirectory()) continue
    } catch { continue }
    const key = pathKey(canonical)
    if (pathKey(parse(canonical).root) === key || forbiddenKeys.has(key) || seen.has(key)) continue
    seen.add(key)
    result.push(canonical)
  }
  return result
}

function userSecretPaths() {
  const profile = process.env.USERPROFILE ?? process.env.HOME
  if (!profile) return []
  return [
    join(profile, ".ssh"),
    join(profile, ".aws"),
    join(profile, ".azure"),
    join(profile, ".config"),
    join(profile, ".npmrc"),
    join(profile, ".git-credentials"),
    join(profile, "AppData", "Local", "Google", "Chrome", "User Data"),
    join(profile, "AppData", "Local", "Microsoft", "Edge", "User Data"),
  ]
}

function protectedWorkspacePaths(workspace: string) {
  return [
    join(workspace, ".git", "config"),
    join(workspace, ".git", "hooks"),
  ]
}

function sensitiveWorkspaceReads(workspace: string) {
  try {
    return readdirSync(workspace, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\.env(?:\..+)?$/i.test(entry.name) && !/^\.env\.(?:example|template)$/i.test(entry.name))
      .map((entry) => join(workspace, entry.name))
  } catch { return [] }
}

// Only an explicit grant for the protected path (or one of its ancestors) may
// remove a deny rule. A grant for one child file must never uncover siblings.
const requestedCovers = (requested: readonly string[], protectedPath: string) => requested.some((value) => value === protectedPath || protectedPath.startsWith(value + "\\"))

export function generateSandboxPolicy(options: SandboxPolicyOptions): GeneratedSandboxPolicy {
  const workspace = resolve(options.workspace)
  const sessionTemp = resolve(options.sessionTemp)
  const additional = options.additionalPermissions ?? {}
  const requestedRead = unique((additional.readPaths ?? []).map((path) => expandRequestedPath(workspace, path)))
  const requestedWrite = unique((additional.writePaths ?? []).map((path) => expandRequestedPath(workspace, path)))
  const requestedDomains = [...new Set((additional.networkDomains ?? []).map((domain) => domain.trim().toLowerCase()).filter(Boolean))]
  const immutableSecretPaths = userSecretPaths().map((path) => resolve(path))
  const protectedRead = unique([options.dataDir, ...immutableSecretPaths, ...sensitiveWorkspaceReads(workspace)]).filter((path) => path === resolve(options.dataDir) || immutableSecretPaths.includes(path) || !requestedCovers(requestedRead, path))
  const protectedWrite = unique([
    ...protectedWorkspacePaths(workspace),
  ]).filter((path) => !requestedCovers(requestedWrite, path)).concat(unique([
    options.dataDir,
    ...(process.env.APPDATA ? [process.env.APPDATA] : []),
    ...(process.env.ProgramData ? [process.env.ProgramData] : []),
    ...(process.env.ProgramFiles ? [process.env.ProgramFiles] : []),
  ]))
  const systemRead = safePathDirectories()
  const allowRead = unique([workspace, sessionTemp, ...systemRead, ...requestedRead])
  const allowWrite = unique([
    sessionTemp,
    ...(options.permissionConfig.sandboxMode === "workspace-write" ? [workspace] : []),
    ...(options.permissionConfig.sandboxMode === "read-only" ? [] : requestedWrite),
  ])
  const base: SandboxRuntimeConfig = {
    filesystem: {
      denyRead: protectedRead,
      allowRead,
      allowWrite,
      denyWrite: protectedWrite,
      allowGitConfig: false,
    },
    network: {
      allowedDomains: requestedDomains,
      deniedDomains: [],
      strictAllowlist: true,
      allowLocalBinding: false,
    },
    credentials: {
      envVars: secretEnvNames().map((name) => ({ name, mode: "deny" as const })),
    },
  }
  if (process.platform === "win32") {
    base.windows = {
      sandboxUser: "srt-sandbox",
      ...(options.helperPath ? { srtWin: { path: resolve(options.helperPath) } } : {}),
    }
  }
  return {
    config: base,
    workspace,
    sessionTemp,
    protectedRead,
    protectedWrite,
    requestedRead,
    requestedWrite,
    requestedDomains,
  }
}

export function shellPathSummary(policy: GeneratedSandboxPolicy) {
  return `workspace=${basename(policy.workspace)}; read=${policy.requestedRead.length}; write=${policy.requestedWrite.length}; network=${policy.requestedDomains.length}`
}
