import type { AdditionalPermissions, ShellInput } from "@codepilotx/shared/thread"
import { isAbsolute, relative, resolve } from "node:path"

export const RISK_CATEGORIES = [
  "destructive",
  "irreversible_change",
  "system_modification",
  "security_control",
  "credential_access",
  "credential_exfiltration",
  "privilege_escalation",
  "persistence",
  "resource_exhaustion",
  "network_access",
  "scope_escape",
  "prompt_injection",
  "obfuscation",
  "unknown_infrastructure",
] as const

export type RiskCategory = typeof RISK_CATEGORIES[number]
export type ShellRiskLevel = "low" | "medium" | "high" | "critical"

export interface ShellReviewInput extends ShellInput {
  taskSummary?: string
  workspaceRoot?: string
}

export interface ShellRiskAnalysis {
  hardDenied: boolean
  risk: ShellRiskLevel
  categories: RiskCategory[]
  requestedScopeValid: boolean
  matchedRules: string[]
  reason: string
}

interface HardRule {
  name: string
  category: RiskCategory
  pattern: RegExp
  reason: string
}

const HARD_RULES: readonly HardRule[] = [
  {
    name: "disk-or-boot-modification",
    category: "destructive",
    pattern: /\b(?:diskpart(?:\.exe)?|format(?:\.(?:com|exe))?\s+(?:[a-z]:|\/|[a-z]:\\)|format-volume\b|clear-disk\b|clear-volume\b|initialize-disk\b|remove-disk\b|remove-partition\b|remove-volume\b|bcdedit(?:\.exe)?\b|bootrec(?:\.exe)?\b)/i,
    reason: "禁止格式化、初始化、删除磁盘分区或修改启动配置",
  },
  {
    name: "root-or-user-tree-wipe",
    category: "destructive",
    pattern: /(?:remove-item|remove-directory|rmdir|rd|del|erase|rm)\b[\s\S]*(?:(?:[a-z]:\\(?:users|windows)?\\?)|%systemdrive%|%userprofile%|\\users\\?$|\\windows\\?$|\$env:(?:systemdrive|userprofile|windir)\b)[\s\S]*(?:-recurse|-rf|\/s\b)|(?:remove-item|remove-directory|rmdir|rd|del|erase|rm)\b[\s\S]*(?:-recurse|-rf|\/s\b)[\s\S]*(?:(?:[a-z]:\\(?:users|windows)?\\?)|%systemdrive%|%userprofile%|\\users\\?$|\\windows\\?$|\$env:(?:systemdrive|userprofile|windir)\b)|\brm\s+-rf\s+\/(?:\s|$)/i,
    reason: "禁止递归清空磁盘根目录、Windows 目录或整个用户目录",
  },
  {
    name: "system-uninstall",
    category: "system_modification",
    pattern: /\b(?:winget|choco(?:latey)?)(?:\.exe)?\s+uninstall\b|\bmsiexec(?:\.exe)?\b[\s\S]*(?:^|\s)\/(?:x|uninstall)\b|\b(?:get-wmiobject|gwmi|wmic)\b[\s\S]*(?:win32_product|product)[\s\S]*(?:\.uninstall|call\s+uninstall)/i,
    reason: "禁止通过系统包管理器或 Windows Installer 卸载程序",
  },
  {
    name: "security-control-disable",
    category: "security_control",
    pattern: /\b(?:set|add)-mppreference\b[\s\S]*-(?:disable|exclusion)|\bnetsh\s+advfirewall\b[\s\S]*\bstate\s+off\b|\bset-netfirewallprofile\b[\s\S]*-enabled\s+\$?false\b|\b(?:reg|reg\.exe)\s+add\b[\s\S]*(?:enablelua|disableantispyware|disablerealtimemonitoring)\b|\bset-(?:item|itemproperty|property)\b[\s\S]*(?:enablelua|disableantispyware|disablerealtimemonitoring)\b|\bauditpol(?:\.exe)?\b[\s\S]*\/clear\b|\bremove-netfirewallrule\b[\s\S]*(?:\*|allprofiles)|\bnetsh\b[\s\S]*\bwfp\b[\s\S]*\bdelete\b/i,
    reason: "禁止关闭 Defender、防火墙、UAC、WFP 或添加安全排除",
  },
  {
    name: "sandbox-policy-tamper",
    category: "security_control",
    pattern: /(?:srt-sandbox|sandbox-runtime-users|codepilotx)[\s\S]*(?:remove|delete|disable|stop|uninstall|modify|alter|write|rename|set)|(?:remove|delete|disable|stop|uninstall|modify|alter|write|rename|set)[\s\S]*(?:srt-sandbox|sandbox-runtime-users|codepilotx)/i,
    reason: "禁止删除或篡改 CodePilotX 审核策略、沙箱账户和过滤规则",
  },
  {
    name: "admin-account-creation",
    category: "privilege_escalation",
    pattern: /\bnet\s+(?:user|localgroup)\b[\s\S]*(?:\/add|administrators)|\b(?:new-localuser|add-localgroupmember)\b[\s\S]*(?:administrator|administrators)|\bnet\s+localgroup\s+administrators\b[\s\S]*\/add\b/i,
    reason: "禁止创建管理员账户或把账户加入管理员组",
  },
  {
    name: "persistence-creation",
    category: "persistence",
    pattern: /\b(?:sc(?:\.exe)?\s+create|new-service|schtasks(?:\.exe)?\s+\/create|new-scheduledtask|register-scheduledtask)\b|(?:reg(?:\.exe)?\s+add|new-(?:item|itemproperty)|set-itemproperty)[\s\S]*\\software\\microsoft\\windows\\currentversion\\run\b/i,
    reason: "禁止创建服务、计划任务或用户启动项等持久化机制",
  },
  {
    name: "backdoor-installation",
    category: "persistence",
    pattern: /\b(?:nc|ncat|netcat)\b[\s\S]*\s-e\s|\b(?:curl|wget|iwr|invoke-webrequest)\b[\s\S]*\|\s*(?:bash|sh|zsh|pwsh|powershell|iex|invoke-expression)\b|\b(?:iex|invoke-expression)\b[\s\S]*(?:downloadstring|downloadfile|new-object\s+net\.webclient)/i,
    reason: "禁止安装反向 Shell、下载后直接执行脚本或后门载荷",
  },
  {
    name: "credential-extraction",
    category: "credential_access",
    pattern: /\b(?:m[i]m[i]k[a]tz|s[e]k[u]rls[a]|p[r]ocd[u]mp(?:\.exe)?\b[\s\S]*\bl[s]ass\b|rundll32(?:\.exe)?\b[\s\S]*comsvcs\.dll|reg(?:\.exe)?\s+save\b[\s\S]*\b(?:sam|security|system)\b|vaultcmd(?:\.exe)?\b[\s\S]*listcreds|keymgr\.dll)\b|\\(?:login data|cookies|local state)\b/i,
    reason: "禁止从系统进程、注册表或浏览器凭据存储提取秘密",
  },
  {
    name: "credential-exfiltration",
    category: "credential_exfiltration",
    pattern: /(?:l[s]ass|m[i]m[i]k[a]tz|s[e]k[u]rls[a]|\\sam\b|\\security\b|login data|cookies|local state|(?:api|access|refresh)[-_]?token|password|secret|credential|\.env)[\s\S]*(?:curl|wget|invoke-webrequest|invoke-restmethod|bitsadmin|certutil|ftp|nc|ncat)|(?:curl|wget|invoke-webrequest|invoke-restmethod|bitsadmin|certutil|ftp|nc|ncat)[\s\S]*(?:l[s]ass|m[i]m[i]k[a]tz|s[e]k[u]rls[a]|\\sam\b|\\security\b|login data|cookies|local state|(?:api|access|refresh)[-_]?token|password|secret|credential|\.env)/i,
    reason: "禁止读取凭据或秘密后通过网络外传",
  },
  {
    name: "resource-exhaustion",
    category: "resource_exhaustion",
    pattern: /:\(\)\s*\{[\s\S]*\|[\s\S]*&[\s\S]*\}|\bfor\s+\/l\s+%\w+\s+in\s*\(0\s*,\s*0\s*,\s*0\)|\bwhile\s*\(\s*\$?true\s*\)[\s\S]*(?:start-process|start-job|fork)|\b(?:start-process|start-job)\b[\s\S]*\b(?:while|for)\b[\s\S]*\b(?:true|0\s*,\s*0\s*,\s*0)\b/i,
    reason: "禁止 Fork bomb、无限创建进程或明确资源耗尽操作",
  },
]

const NETWORK_COMMAND = /\b(?:curl|wget|iwr|invoke-webrequest|invoke-restmethod|bitsadmin|certutil|ftp|ssh|scp|nc|ncat)\b/i
const INFRASTRUCTURE_COMMAND = /\b(?:docker|kubectl|helm|terraform|ansible|ssh|sc(?:\.exe)?|netsh|reg(?:\.exe)?|diskpart)\b/i
const PROMPT_INJECTION = /ignore\s+(?:all\s+)?(?:previous|prior|earlier)\s+instructions?|忽略(?:之前|先前|上面)的指令|bypass\s+(?:the\s+)?(?:review|approval|sandbox)|绕过(?:审核|审批|沙箱)/i
const OBFUSCATED_COMMAND = /\b(?:powershell|pwsh)\b[\s\S]*(?:-enc(?:odedcommand)?\b|-e\s+[a-z0-9+/=]{16,})|\b(?:certutil|mshta|rundll32)\b[\s\S]*(?:javascript:|vbscript:|url\.dll)/i
const IRREVERSIBLE_CHANGE = /\bgit\s+(?:reset\s+--hard|clean\s+-[^\n]*f)|\bgit\s+push\b[\s\S]*--force(?:-with-lease)?\b|\b(?:drop\s+database|drop\s+table)\b|\bterraform\s+destroy\b/i
const WINDOWS_ABSOLUTE_PATH = /(?:^|[\s"'=])([a-z]:[\\/][^\s"'|;&<>]*)/gi

const pathOutsideWorkspace = (workspaceRoot: string, path: string) => {
  const fromRoot = relative(resolve(workspaceRoot), resolve(path))
  return fromRoot.startsWith("..") || isAbsolute(fromRoot)
}

const referencesWorkspaceExternalPath = (input: ShellReviewInput, command: string) => {
  const workspaceRoot = input.workspaceRoot?.trim()
  if (!workspaceRoot) return false
  if (input.cwd && isAbsolute(input.cwd) && pathOutsideWorkspace(workspaceRoot, input.cwd)) return true
  WINDOWS_ABSOLUTE_PATH.lastIndex = 0
  for (const match of command.matchAll(WINDOWS_ABSOLUTE_PATH)) {
    if (match[1] && pathOutsideWorkspace(workspaceRoot, match[1])) return true
  }
  return false
}

const pathIsValid = (path: string) => {
  const value = path.trim()
  if (!value || value.includes("\0") || /[*?]/.test(value)) return false
  if (/^(?:[a-z]:[\\/]?|[\\/]{1,2})$/i.test(value)) return false
  return true
}

const domainIsValid = (domain: string) => {
  const value = domain.trim().toLowerCase()
  if (!value || /[*?\s/\\]/.test(value) || value.includes("\0")) return false
  return value === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value)
}

const validList = (value: unknown, validator: (item: string) => boolean) => value === undefined || Array.isArray(value) && value.every((item) => typeof item === "string" && validator(item))

const requestedScopeValid = (permissions?: AdditionalPermissions) => {
  if (permissions === undefined) return true
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) return false
  const value = permissions as unknown as Record<string, unknown>
  return validList(value.readPaths, pathIsValid) && validList(value.writePaths, pathIsValid) && validList(value.networkDomains, domainIsValid)
}

const addCategory = (categories: RiskCategory[], category: RiskCategory) => {
  if (!categories.includes(category)) categories.push(category)
}

const riskForCategories = (categories: readonly RiskCategory[]): ShellRiskLevel => {
  if (categories.includes("credential_exfiltration") || categories.includes("destructive") || categories.includes("resource_exhaustion")) return "critical"
  if (categories.includes("credential_access") || categories.includes("security_control") || categories.includes("privilege_escalation") || categories.includes("persistence") || categories.includes("irreversible_change") || categories.includes("scope_escape")) return "high"
  if (categories.length > 0) return "medium"
  return "low"
}

export const analyzeShellRisk = (input: ShellReviewInput): ShellRiskAnalysis => {
  const rawCommand = (input as unknown as { command?: unknown }).command
  const command = typeof rawCommand === "string" ? rawCommand.trim() : ""
  const invalidCommand = typeof rawCommand !== "string" || command.length === 0
  const categories: RiskCategory[] = []
  const matchedRules: string[] = []
  const hardMatches = HARD_RULES.filter((rule) => rule.pattern.test(command))

  for (const match of hardMatches) {
    addCategory(categories, match.category)
    matchedRules.push(match.name)
  }
  if (NETWORK_COMMAND.test(command)) addCategory(categories, "network_access")
  if (INFRASTRUCTURE_COMMAND.test(command)) addCategory(categories, "unknown_infrastructure")
  if (PROMPT_INJECTION.test(command)) addCategory(categories, "prompt_injection")
  if (OBFUSCATED_COMMAND.test(command)) addCategory(categories, "obfuscation")
  if (IRREVERSIBLE_CHANGE.test(command)) addCategory(categories, "irreversible_change")
  const workspaceExternal = referencesWorkspaceExternalPath(input, command)
  if (workspaceExternal) addCategory(categories, "scope_escape")

  const scopeValid = requestedScopeValid(input.additionalPermissions)
  if (!scopeValid) addCategory(categories, "scope_escape")

  const hardDenied = invalidCommand || hardMatches.length > 0 || !scopeValid
  const risk = hardDenied ? "critical" : riskForCategories(categories)
  const reason = invalidCommand
    ? "Shell command 缺失或为空，命令已拒绝"
    : hardMatches[0]?.reason
      ?? (!scopeValid ? "申请的额外权限范围无效或过于宽泛" : workspaceExternal ? "命令或 cwd 指向工作区外路径" : categories.length > 0 ? "命令包含需要审核的风险特征" : "未发现静态灾难级特征")

  return {
    hardDenied,
    risk,
    categories,
    requestedScopeValid: scopeValid,
    matchedRules,
    reason,
  }
}
