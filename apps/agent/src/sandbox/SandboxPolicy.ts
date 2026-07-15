import { existsSync } from "node:fs"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
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

function pathDirectories() {
  const entries = (process.env.PATH ?? "").split(";").filter(Boolean)
  return entries.filter((entry) => existsSync(entry)).map((entry) => resolve(entry))
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
    join(workspace, ".git", "objects"),
    join(workspace, ".env"),
    join(workspace, ".env.*"),
  ]
}

export function generateSandboxPolicy(options: SandboxPolicyOptions): GeneratedSandboxPolicy {
  const workspace = resolve(options.workspace)
  const sessionTemp = resolve(options.sessionTemp)
  const additional = options.additionalPermissions ?? {}
  const requestedRead = unique((additional.readPaths ?? []).map((path) => expandRequestedPath(workspace, path)))
  const requestedWrite = unique((additional.writePaths ?? []).map((path) => expandRequestedPath(workspace, path)))
  const requestedDomains = [...new Set((additional.networkDomains ?? []).map((domain) => domain.trim().toLowerCase()).filter(Boolean))]
  const protectedRead = unique([options.dataDir, ...userSecretPaths()])
  const protectedWrite = unique([
    options.dataDir,
    ...protectedWorkspacePaths(workspace),
    ...(process.env.APPDATA ? [process.env.APPDATA] : []),
    ...(process.env.ProgramData ? [process.env.ProgramData] : []),
    ...(process.env.ProgramFiles ? [process.env.ProgramFiles] : []),
  ])
  const systemRead = [
    ...(process.env.SystemRoot ? [process.env.SystemRoot] : []),
    ...(process.env.ProgramFiles ? [process.env.ProgramFiles] : []),
    ...pathDirectories().map((path) => dirname(path)),
  ]
  const allowRead = unique([workspace, sessionTemp, ...systemRead, ...requestedRead])
  const allowWrite = unique([workspace, sessionTemp, ...requestedWrite])
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
