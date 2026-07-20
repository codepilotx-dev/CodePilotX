import { Effect } from "effect"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentError } from "../domain"
import type { EncryptedCredentialRepository } from "../auth/EncryptedCredentialRepository"

const GITHUB_INTEGRATION_ID = "github"
const GITHUB_API = "https://api.github.com"
const GITHUB_GRAPHQL = `${GITHUB_API}/graphql`
const GITHUB_DEVICE_CODE = "https://github.com/login/device/code"
const GITHUB_ACCESS_TOKEN = "https://github.com/login/oauth/access_token"
const GITHUB_SCOPE = "repo read:user"
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024
const DEFAULT_GIT_TIMEOUT_MS = 120_000

type CredentialRepository = Pick<EncryptedCredentialRepository, "get" | "set" | "remove">
type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type GithubUser = {
  login: string
  id: number
  name: string | null
  avatarUrl: string | null
  htmlUrl: string
}

export type GithubAuthStatus = {
  configured: boolean
  authenticated: boolean
  user: GithubUser | null
  error?: string
}

export type GithubLoginStatus = {
  loginId: string | null
  state: "idle" | "starting" | "awaiting_auth" | "completed" | "failed"
  userCode: string | null
  verificationUri: string | null
  expiresAt: string | null
  error: string | null
  auth: GithubAuthStatus | null
  elapsedMs: number
}

export type GithubRepository = {
  id: number
  name: string
  fullName: string
  owner: string
  private: boolean
  fork: boolean
  archived: boolean
  disabled: boolean
  cloneUrl: string
  sshUrl: string
  htmlUrl: string
  description: string | null
  defaultBranch: string
  pushedAt: string | null
  updatedAt: string | null
}

export type GithubPullRequest = {
  id: number
  number: number
  title: string
  body: string | null
  state: string
  draft: boolean
  htmlUrl: string
  base: { ref: string; sha: string }
  head: { ref: string; sha: string }
  additions: number
  deletions: number
  changedFiles: number
  mergeable: boolean | null
}

export type GithubProfileRepository = {
  id: string
  name: string
  fullName: string
  url: string
  description: string | null
  isPrivate: boolean
  isFork: boolean
  primaryLanguage: {
    name: string
    color: string | null
  } | null
  stargazerCount: number
  forkCount: number
  updatedAt: string
}

export type GithubProfileOverview = {
  user: GithubUser & {
    bio: string | null
    company: string | null
    location: string | null
    websiteUrl: string | null
    email: string | null
    followers: number
    following: number
    repositoryCount: number
    starredRepositoryCount: number
    status: {
      emoji: string | null
      message: string | null
      indicatesLimitedAvailability: boolean
      expiresAt: string | null
    } | null
  }
  organizations: Array<{
    login: string
    avatarUrl: string
    url: string
  }>
  pinnedRepositories: GithubProfileRepository[]
  popularRepositories: GithubProfileRepository[]
  contributions: {
    totalContributions: number
    totalCommitContributions: number
    totalIssueContributions: number
    totalPullRequestContributions: number
    totalPullRequestReviewContributions: number
    restrictedContributionsCount: number
    weeks: Array<{
      days: Array<{
        date: string
        count: number
        color: string
      }>
    }>
  }
}

export type GithubWorkspaceStatus = {
  branchName: string | null
  upstream: string | null
  ahead: number
  behind: number
  clean: boolean
  files: Array<{
    path: string
    originalPath?: string
    status: string
    stagedStatus: string
    unstagedStatus: string
    additions: null
    deletions: null
    isUntracked: boolean
  }>
}

type StoredGithubCredential = {
  type: "oauth"
  accessToken: string
  tokenType: string
  scope: string
}

type DeviceAttempt = {
  loginId: string
  clientId: string
  deviceCode: string
  userCode: string
  verificationUri: string
  createdAt: number
  expiresAt: number
  intervalMs: number
  nextPollAt: number
}

type GithubServiceOptions = {
  fetch?: Fetch
  now?: () => number
  getConfiguredClientId?: () => string | null | undefined
  gitTimeoutMs?: number
}

type GitResult = { code: number; stdout: string; stderr: string }

const nonEmpty = (value: string, name: string) => {
  const normalized = value.trim()
  if (!normalized) throw new AgentError("INVALID_REQUEST", `${name} 参数无效`, 400)
  return normalized
}

const encodeForm = (values: Record<string, string>) => new URLSearchParams(values).toString()

const userFromApi = (value: unknown): GithubUser => {
  const input = asRecord(value, "GitHub 用户")
  return {
    login: stringField(input, "login"),
    id: numberField(input, "id"),
    name: nullableStringField(input, "name"),
    avatarUrl: nullableStringField(input, "avatar_url"),
    htmlUrl: stringField(input, "html_url"),
  }
}

const repositoryFromApi = (value: unknown): GithubRepository => {
  const input = asRecord(value, "GitHub 仓库")
  const owner = asRecord(input.owner, "GitHub 仓库 owner")
  return {
    id: numberField(input, "id"),
    name: stringField(input, "name"),
    fullName: stringField(input, "full_name"),
    owner: stringField(owner, "login"),
    private: booleanField(input, "private"),
    fork: booleanField(input, "fork"),
    archived: booleanField(input, "archived"),
    disabled: booleanField(input, "disabled"),
    cloneUrl: stringField(input, "clone_url"),
    sshUrl: stringField(input, "ssh_url"),
    htmlUrl: stringField(input, "html_url"),
    description: nullableStringField(input, "description"),
    defaultBranch: stringField(input, "default_branch"),
    pushedAt: nullableStringField(input, "pushed_at"),
    updatedAt: nullableStringField(input, "updated_at"),
  }
}

const pullRequestFromApi = (value: unknown): GithubPullRequest => {
  const input = asRecord(value, "GitHub Pull Request")
  const base = asRecord(input.base, "GitHub Pull Request base")
  const head = asRecord(input.head, "GitHub Pull Request head")
  return {
    id: numberField(input, "id"),
    number: numberField(input, "number"),
    title: stringField(input, "title"),
    body: nullableStringField(input, "body"),
    state: stringField(input, "state"),
    draft: input.draft === true,
    htmlUrl: stringField(input, "html_url"),
    base: { ref: stringField(base, "ref"), sha: stringField(base, "sha") },
    head: { ref: stringField(head, "ref"), sha: stringField(head, "sha") },
    additions: optionalNumberField(input, "additions"),
    deletions: optionalNumberField(input, "deletions"),
    changedFiles: optionalNumberField(input, "changed_files"),
    mergeable: typeof input.mergeable === "boolean" ? input.mergeable : null,
  }
}

const connectionNodes = (value: unknown, name: string): unknown[] => {
  const connection = asRecord(value, name)
  if (!Array.isArray(connection.nodes)) throw new AgentError("GITHUB_RESPONSE_INVALID", `${name} nodes 响应无效`, 502)
  return connection.nodes.filter((node) => node != null)
}

const connectionTotalCount = (value: unknown, name: string) => numberField(asRecord(value, name), "totalCount")

const profileRepositoryFromGraphql = (value: unknown): GithubProfileRepository => {
  const repository = asRecord(value, "GitHub profile repository")
  const language = repository.primaryLanguage == null
    ? null
    : asRecord(repository.primaryLanguage, "GitHub repository language")
  return {
    id: stringField(repository, "id"),
    name: stringField(repository, "name"),
    fullName: stringField(repository, "nameWithOwner"),
    url: stringField(repository, "url"),
    description: nullableStringField(repository, "description"),
    isPrivate: booleanField(repository, "isPrivate"),
    isFork: booleanField(repository, "isFork"),
    primaryLanguage: language
      ? {
        name: stringField(language, "name"),
        color: nullableStringField(language, "color"),
      }
      : null,
    stargazerCount: numberField(repository, "stargazerCount"),
    forkCount: numberField(repository, "forkCount"),
    updatedAt: stringField(repository, "updatedAt"),
  }
}

export class GithubService {
  private readonly fetch: Fetch
  private readonly now: () => number
  private readonly getConfiguredClientId: () => string | null | undefined
  private readonly gitTimeoutMs: number
  private attempt: DeviceAttempt | null = null

  constructor(
    private readonly credentials: CredentialRepository,
    options: GithubServiceOptions = {},
  ) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.now = options.now ?? Date.now
    this.getConfiguredClientId = options.getConfiguredClientId ?? (() => null)
    this.gitTimeoutMs = options.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS
  }

  async authStatus(): Promise<GithubAuthStatus> {
    const configured = Boolean(this.getConfiguredClientId()?.trim() || this.attempt?.clientId)
    const stored = await this.credential()
    if (!stored) return { configured, authenticated: false, user: null }
    try {
      const user = userFromApi(await this.rest("GET", "/user", undefined, stored.accessToken))
      return { configured: true, authenticated: true, user }
    } catch (cause) {
      if (cause instanceof AgentError && cause.status === 401) {
        await Effect.runPromise(this.credentials.remove(GITHUB_INTEGRATION_ID))
        return { configured, authenticated: false, user: null, error: "GitHub 登录已失效，请重新登录。" }
      }
      return {
        configured: true,
        authenticated: true,
        user: null,
        error: cause instanceof Error ? cause.message : "无法连接 GitHub。",
      }
    }
  }

  async startDeviceFlow(clientId?: string): Promise<GithubLoginStatus> {
    const startedAt = this.now()
    const loginId = randomUUID()
    const resolvedClientId = nonEmpty(clientId ?? this.getConfiguredClientId() ?? "", "clientId")
    this.attempt = null
    const response = await this.fetchJson(GITHUB_DEVICE_CODE, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encodeForm({ client_id: resolvedClientId, scope: GITHUB_SCOPE }),
    }, false)
    const body = asRecord(response, "GitHub Device Flow")
    if (typeof body.error === "string") {
      return this.failedLogin(startedAt, oauthErrorMessage(body), loginId)
    }
    const createdAt = this.now()
    const expiresInSeconds = positiveNumberField(body, "expires_in")
    const intervalSeconds = Math.max(1, optionalNumberField(body, "interval") || 5)
    this.attempt = {
      loginId,
      clientId: resolvedClientId,
      deviceCode: stringField(body, "device_code"),
      userCode: stringField(body, "user_code"),
      verificationUri: stringField(body, "verification_uri"),
      createdAt,
      expiresAt: createdAt + expiresInSeconds * 1_000,
      intervalMs: intervalSeconds * 1_000,
      nextPollAt: createdAt + intervalSeconds * 1_000,
    }
    return this.attemptStatus("awaiting_auth", null, null)
  }

  async pollDeviceFlow(loginId: string): Promise<GithubLoginStatus> {
    const attempt = this.attempt
    const expectedLoginId = nonEmpty(loginId, "loginId")
    if (!attempt || attempt.loginId !== expectedLoginId) {
      throw new AgentError("CONFLICT", "GitHub 登录尝试已失效，请重新开始登录。", 409)
    }
    const now = this.now()
    if (now >= attempt.expiresAt) {
      this.attempt = null
      return this.emptyLogin("failed", "GitHub 验证码已过期，请重新登录。", attempt.createdAt, attempt.loginId)
    }
    if (now < attempt.nextPollAt) return this.attemptStatus("awaiting_auth", null, null)
    attempt.nextPollAt = now + attempt.intervalMs
    const response = await this.fetchJson(GITHUB_ACCESS_TOKEN, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encodeForm({
        client_id: attempt.clientId,
        device_code: attempt.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    }, false)
    const body = asRecord(response, "GitHub Device Flow")
    if (typeof body.access_token === "string" && body.access_token) {
      const tokenType = typeof body.token_type === "string" ? body.token_type : "bearer"
      const scope = typeof body.scope === "string" ? body.scope : ""
      const grantedScopes = new Set(scope.split(/[\s,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))
      if (!grantedScopes.has("repo") || !grantedScopes.has("read:user")) {
        const createdAt = attempt.createdAt
        this.attempt = null
        return this.emptyLogin("failed", "GitHub 授权范围不足，需要 repo 和 read:user 权限。", createdAt, attempt.loginId)
      }
      await Effect.runPromise(this.credentials.set({
        integrationID: GITHUB_INTEGRATION_ID,
        methodID: "device-flow",
        label: "GitHub",
        value: {
          type: "oauth",
          accessToken: body.access_token,
          tokenType,
          scope,
        } satisfies StoredGithubCredential,
      }))
      const createdAt = attempt.createdAt
      this.attempt = null
      return {
        ...this.emptyLogin("completed", null, createdAt, attempt.loginId),
        auth: await this.authStatus(),
      }
    }
    const error = typeof body.error === "string" ? body.error : "unknown"
    if (error === "authorization_pending") return this.attemptStatus("awaiting_auth", null, null)
    if (error === "slow_down") {
      attempt.intervalMs += 5_000
      attempt.nextPollAt = now + attempt.intervalMs
      return this.attemptStatus("awaiting_auth", null, null)
    }
    this.attempt = null
    return this.emptyLogin("failed", oauthErrorMessage(body), attempt.createdAt, attempt.loginId)
  }

  async logout(): Promise<GithubAuthStatus> {
    this.attempt = null
    await Effect.runPromise(this.credentials.remove(GITHUB_INTEGRATION_ID))
    return {
      configured: Boolean(this.getConfiguredClientId()?.trim()),
      authenticated: false,
      user: null,
    }
  }

  async profile() {
    return { user: userFromApi(await this.rest("GET", "/user")) }
  }

  async profileOverview(): Promise<{ overview: GithubProfileOverview }> {
    const result = await this.graphql(`
      query CodePilotXProfileOverview {
        viewer {
          login
          databaseId
          name
          avatarUrl
          url
          bio
          company
          location
          websiteUrl
          email
          followers { totalCount }
          following { totalCount }
          repositories { totalCount }
          starredRepositories { totalCount }
          status {
            emoji
            message
            indicatesLimitedAvailability
            expiresAt
          }
          organizations(first: 100) {
            nodes {
              login
              avatarUrl
              url
            }
          }
          pinnedItems(first: 6, types: REPOSITORY) {
            nodes {
              ... on Repository {
                id
                name
                nameWithOwner
                url
                description
                isPrivate
                isFork
                primaryLanguage { name color }
                stargazerCount
                forkCount
                updatedAt
              }
            }
          }
          popularRepositories: repositories(
            first: 6
            ownerAffiliations: OWNER
            orderBy: { field: STARGAZERS, direction: DESC }
          ) {
            nodes {
              id
              name
              nameWithOwner
              url
              description
              isPrivate
              isFork
              primaryLanguage { name color }
              stargazerCount
              forkCount
              updatedAt
            }
          }
          contributionsCollection {
            totalCommitContributions
            totalIssueContributions
            totalPullRequestContributions
            totalPullRequestReviewContributions
            restrictedContributionsCount
            contributionCalendar {
              totalContributions
              weeks {
                contributionDays {
                  date
                  contributionCount
                  color
                }
              }
            }
          }
        }
      }
    `, {})
    const viewer = asRecord(result.viewer, "GitHub Profile viewer")
    const organizations = connectionNodes(viewer.organizations, "GitHub organizations").map((value) => {
      const organization = asRecord(value, "GitHub organization")
      return {
        login: stringField(organization, "login"),
        avatarUrl: stringField(organization, "avatarUrl"),
        url: stringField(organization, "url"),
      }
    })
    const statusValue = viewer.status == null ? null : asRecord(viewer.status, "GitHub user status")
    const contributions = asRecord(viewer.contributionsCollection, "GitHub contributions")
    const calendar = asRecord(contributions.contributionCalendar, "GitHub contribution calendar")
    const weeksValue = calendar.weeks
    if (!Array.isArray(weeksValue)) throw new AgentError("GITHUB_RESPONSE_INVALID", "GitHub contribution weeks 响应无效", 502)

    return {
      overview: {
        user: {
          login: stringField(viewer, "login"),
          id: numberField(viewer, "databaseId"),
          name: nullableStringField(viewer, "name"),
          avatarUrl: nullableStringField(viewer, "avatarUrl"),
          htmlUrl: stringField(viewer, "url"),
          bio: nullableStringField(viewer, "bio"),
          company: nullableStringField(viewer, "company"),
          location: nullableStringField(viewer, "location"),
          websiteUrl: nullableStringField(viewer, "websiteUrl"),
          email: nullableStringField(viewer, "email"),
          followers: connectionTotalCount(viewer.followers, "GitHub followers"),
          following: connectionTotalCount(viewer.following, "GitHub following"),
          repositoryCount: connectionTotalCount(viewer.repositories, "GitHub repositories"),
          starredRepositoryCount: connectionTotalCount(viewer.starredRepositories, "GitHub starred repositories"),
          status: statusValue
            ? {
              emoji: nullableStringField(statusValue, "emoji"),
              message: nullableStringField(statusValue, "message"),
              indicatesLimitedAvailability: booleanField(statusValue, "indicatesLimitedAvailability"),
              expiresAt: nullableStringField(statusValue, "expiresAt"),
            }
            : null,
        },
        organizations,
        pinnedRepositories: connectionNodes(viewer.pinnedItems, "GitHub pinned repositories").map(profileRepositoryFromGraphql),
        popularRepositories: connectionNodes(viewer.popularRepositories, "GitHub popular repositories").map(profileRepositoryFromGraphql),
        contributions: {
          totalContributions: numberField(calendar, "totalContributions"),
          totalCommitContributions: numberField(contributions, "totalCommitContributions"),
          totalIssueContributions: numberField(contributions, "totalIssueContributions"),
          totalPullRequestContributions: numberField(contributions, "totalPullRequestContributions"),
          totalPullRequestReviewContributions: numberField(contributions, "totalPullRequestReviewContributions"),
          restrictedContributionsCount: numberField(contributions, "restrictedContributionsCount"),
          weeks: weeksValue.map((weekValue) => {
            const week = asRecord(weekValue, "GitHub contribution week")
            if (!Array.isArray(week.contributionDays)) throw new AgentError("GITHUB_RESPONSE_INVALID", "GitHub contribution days 响应无效", 502)
            return {
              days: week.contributionDays.map((dayValue) => {
                const day = asRecord(dayValue, "GitHub contribution day")
                return {
                  date: stringField(day, "date"),
                  count: numberField(day, "contributionCount"),
                  color: stringField(day, "color"),
                }
              }),
            }
          }),
        },
      },
    }
  }

  async repositories(): Promise<{ repositories: GithubRepository[] }> {
    const result = await this.rest("GET", "/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&sort=pushed")
    if (!Array.isArray(result)) throw new AgentError("GITHUB_RESPONSE_INVALID", "GitHub 仓库响应无效", 502)
    return { repositories: result.map(repositoryFromApi) }
  }

  async readPullRequest(input: { owner: string; repository: string; number: number }) {
    validateRepositoryInput(input)
    return {
      pullRequest: pullRequestFromApi(await this.rest(
        "GET",
        `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/pulls/${positiveInteger(input.number, "number")}`,
      )),
    }
  }

  async createPullRequest(input: {
    owner: string
    repository: string
    title: string
    head: string
    base: string
    body?: string
    draft?: boolean
  }) {
    validateRepositoryInput(input)
    return {
      pullRequest: pullRequestFromApi(await this.rest(
        "POST",
        `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/pulls`,
        {
          title: nonEmpty(input.title, "title"),
          head: nonEmpty(input.head, "head"),
          base: nonEmpty(input.base, "base"),
          body: input.body ?? "",
          draft: input.draft === true,
        },
      )),
    }
  }

  async createPullRequestForProject(input: {
    workspaceRoot: string
    title: string
    body?: string
    draft?: boolean
  }) {
    const workspaceRoot = nonEmpty(input.workspaceRoot, "workspaceRoot")
    const remote = await this.githubRemote(workspaceRoot, "origin")
    const branch = await this.currentBranch(workspaceRoot)
    const repository = asRecord(await this.rest(
      "GET",
      `/repos/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.repository)}`,
    ), "GitHub repository")
    return this.createPullRequest({
      owner: remote.owner,
      repository: remote.repository,
      title: input.title,
      head: branch,
      base: stringField(repository, "default_branch"),
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(input.draft === undefined ? {} : { draft: input.draft }),
    })
  }

  async createPullRequestComment(input: {
    owner: string
    repository: string
    number: number
    body: string
    path: string
    side: "LEFT" | "RIGHT"
    line: number
    commitId?: string
    startSide?: "LEFT" | "RIGHT"
    startLine?: number
    expectedHeadRevision: string
  }) {
    validateRepositoryInput(input)
    const pullRequest = (await this.readPullRequest({
      owner: input.owner,
      repository: input.repository,
      number: input.number,
    })).pullRequest
    this.assertExpectedHeadRevision(input.expectedHeadRevision, pullRequest.head.sha)
    const commitId = input.commitId?.trim() || pullRequest.head.sha
    const result = asRecord(await this.rest(
      "POST",
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/pulls/${positiveInteger(input.number, "number")}/comments`,
      {
        body: nonEmpty(input.body, "body"),
        path: nonEmpty(input.path, "path"),
        side: input.side,
        line: positiveInteger(input.line, "line"),
        commit_id: commitId,
        ...(input.startSide ? { start_side: input.startSide } : {}),
        ...(input.startLine ? { start_line: positiveInteger(input.startLine, "startLine") } : {}),
      },
    ), "GitHub Pull Request comment")
    return {
      comment: {
        id: numberField(result, "id"),
        nodeId: stringField(result, "node_id"),
        htmlUrl: stringField(result, "html_url"),
        body: stringField(result, "body"),
      },
    }
  }

  async setReviewThreadResolved(input: { threadId: string; resolved?: boolean }) {
    const resolved = input.resolved !== false
    const mutation = resolved
      ? "mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{id isResolved}}}"
      : "mutation($threadId:ID!){unresolveReviewThread(input:{threadId:$threadId}){thread{id isResolved}}}"
    const result = await this.graphql(mutation, { threadId: nonEmpty(input.threadId, "threadId") })
    const root = asRecord(result, "GitHub GraphQL")
    const payload = asRecord(root[resolved ? "resolveReviewThread" : "unresolveReviewThread"], "GitHub Review Thread")
    const thread = asRecord(payload.thread, "GitHub Review Thread")
    return { thread: { id: stringField(thread, "id"), resolved: booleanField(thread, "isResolved") } }
  }

  async submitPullRequestReview(input: {
    owner: string
    repository: string
    number: number
    event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES"
    body?: string
    expectedHeadRevision: string
  }) {
    validateRepositoryInput(input)
    if (input.event !== "APPROVE") nonEmpty(input.body ?? "", "body")
    const pullRequest = (await this.readPullRequest(input)).pullRequest
    this.assertExpectedHeadRevision(input.expectedHeadRevision, pullRequest.head.sha)
    const result = asRecord(await this.rest(
      "POST",
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/pulls/${positiveInteger(input.number, "number")}/reviews`,
      { event: input.event, body: input.body ?? "", commit_id: pullRequest.head.sha },
    ), "GitHub Pull Request review")
    return {
      review: {
        id: numberField(result, "id"),
        state: stringField(result, "state"),
        htmlUrl: stringField(result, "html_url"),
      },
    }
  }

  async preparePullRequestComparison(input: {
    workspaceRoot: string
    owner: string
    repository: string
    number: number
  }): Promise<{ baseSha: string; headSha: string }> {
    const workspaceRoot = nonEmpty(input.workspaceRoot, "workspaceRoot")
    validateRepositoryInput(input)
    const pullRequest = (await this.readPullRequest(input)).pullRequest
    const missing = async (sha: string) => {
      const result = await this.git(workspaceRoot, ["cat-file", "-e", `${sha}^{commit}`])
      return result.code !== 0
    }
    if (await missing(pullRequest.base.sha) || await missing(pullRequest.head.sha)) {
      const credential = await this.requiredCredential()
      const helperRoot = await mkdtemp(join(tmpdir(), "codepilotx-github-askpass-"))
      try {
        const helperPath = await writeAskPassHelper(helperRoot)
        const env = {
          GIT_ASKPASS: helperPath,
          GIT_TERMINAL_PROMPT: "0",
          CODEPILOTX_GITHUB_TOKEN: credential.accessToken,
        }
        const remote = `https://github.com/${input.owner}/${input.repository}.git`
        const baseFetch = await this.git(workspaceRoot, ["fetch", "--no-tags", remote, pullRequest.base.ref], env)
        if (baseFetch.code !== 0) throw new AgentError("GITHUB_API_FAILED", safeGitError(baseFetch.stderr), 409)
        const headFetch = await this.git(workspaceRoot, ["fetch", "--no-tags", remote, `refs/pull/${positiveInteger(input.number, "number")}/head`], env)
        if (headFetch.code !== 0) throw new AgentError("GITHUB_API_FAILED", safeGitError(headFetch.stderr), 409)
      } finally {
        await rm(helperRoot, { recursive: true, force: true }).catch(() => undefined)
      }
    }
    if (await missing(pullRequest.base.sha) || await missing(pullRequest.head.sha)) {
      throw new AgentError("REVIEW_SOURCE_UNAVAILABLE", "无法在本地解析 Pull Request 的提交对象", 409)
    }
    return { baseSha: pullRequest.base.sha, headSha: pullRequest.head.sha }
  }

  async push(input: {
    workspaceRoot: string
    remote?: string
    branch?: string
    setUpstream?: boolean
    forceWithLease?: boolean
  }): Promise<{
    remote: string
    branch: string
    repositoryUrl: string
    status: GithubWorkspaceStatus
  }> {
    const credential = await this.requiredCredential()
    const workspaceRoot = nonEmpty(input.workspaceRoot, "workspaceRoot")
    const remote = input.remote?.trim() || "origin"
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) throw new AgentError("INVALID_REQUEST", "remote 参数无效", 400)
    const repository = await this.githubRemote(workspaceRoot, remote)
    const branch = input.branch?.trim() || (await this.currentBranch(workspaceRoot))
    const branchCheck = await this.git(workspaceRoot, ["check-ref-format", "--branch", branch])
    if (branchCheck.code !== 0) throw new AgentError("INVALID_REQUEST", "branch 参数无效", 400)
    const helperRoot = await mkdtemp(join(tmpdir(), "codepilotx-github-askpass-"))
    try {
      const helperPath = await writeAskPassHelper(helperRoot)
      const result = await this.git(
        workspaceRoot,
        [
          "-c",
          "credential.helper=",
          "-c",
          "credential.useHttpPath=true",
          "-c",
          `remote.${remote}.url=https://x-access-token@github.com/${repository.owner}/${repository.repository}.git`,
          "push",
          ...(input.setUpstream === true ? ["--set-upstream"] : []),
          ...(input.forceWithLease === true ? ["--force-with-lease"] : []),
          remote,
          `refs/heads/${branch}:refs/heads/${branch}`,
        ],
        {
          GIT_ASKPASS: helperPath,
          GIT_TERMINAL_PROMPT: "0",
          CODEPILOTX_GITHUB_TOKEN: credential.accessToken,
        },
      )
      if (result.code !== 0) throw new AgentError("GITHUB_PUSH_FAILED", safeGitError(result.stderr), 409)
      return {
        remote,
        branch,
        repositoryUrl: `https://github.com/${repository.owner}/${repository.repository}`,
        status: await this.workspaceStatus(workspaceRoot),
      }
    } finally {
      await rm(helperRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async workspaceStatus(workspaceRoot: string): Promise<GithubWorkspaceStatus> {
    const result = await this.git(nonEmpty(workspaceRoot, "workspaceRoot"), ["status", "--porcelain=v2", "--branch", "-z"])
    if (result.code !== 0) throw new AgentError("GIT_STATUS_FAILED", safeGitError(result.stderr), 409)
    return parseGitStatus(result.stdout)
  }

  private async githubRemote(workspaceRoot: string, remote: string) {
    const remoteResult = await this.git(workspaceRoot, ["remote", "get-url", remote])
    if (remoteResult.code !== 0) throw new AgentError("GIT_REMOTE_NOT_FOUND", "Git remote 不存在", 404)
    return parseGithubRemote(remoteResult.stdout.trim())
  }

  private async currentBranch(workspaceRoot: string) {
    const result = await this.git(workspaceRoot, ["branch", "--show-current"])
    if (result.code !== 0 || !result.stdout.trim()) throw new AgentError("GIT_BRANCH_REQUIRED", "当前工作区未处于可推送分支", 409)
    return result.stdout.trim()
  }

  private async rest(method: string, path: string, body?: unknown, token?: string) {
    const accessToken = token ?? (await this.requiredCredential()).accessToken
    return this.fetchJson(`${GITHUB_API}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "CodePilotX",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, true)
  }

  private async graphql(query: string, variables: Record<string, unknown>) {
    const accessToken = (await this.requiredCredential()).accessToken
    const result = asRecord(await this.fetchJson(GITHUB_GRAPHQL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "CodePilotX",
      },
      body: JSON.stringify({ query, variables }),
    }, true), "GitHub GraphQL")
    if (Array.isArray(result.errors) && result.errors.length) {
      const first = asRecord(result.errors[0], "GitHub GraphQL error")
      throw new AgentError("GITHUB_GRAPHQL_FAILED", typeof first.message === "string" ? first.message : "GitHub GraphQL 请求失败", 409)
    }
    return asRecord(result.data, "GitHub GraphQL data")
  }

  private async fetchJson(url: string, init: RequestInit, authenticated: boolean): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetch(url, init)
    } catch {
      throw new AgentError("GITHUB_UNAVAILABLE", "无法连接 GitHub，请检查网络后重试。", 503)
    }
    const value = await response.json().catch(() => null) as unknown
    if (!response.ok) {
      const message = githubApiMessage(value, response.status)
      if (response.status === 401) throw new AgentError("GITHUB_AUTH_INVALID", "GitHub 登录已失效，请重新登录。", 401)
      if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
        throw new AgentError("GITHUB_RATE_LIMITED", "GitHub API 请求次数已达上限，请稍后重试。", 429)
      }
      throw new AgentError(authenticated ? "GITHUB_API_FAILED" : "GITHUB_OAUTH_FAILED", message, response.status)
    }
    return value
  }

  private async credential() {
    const stored = await Effect.runPromise(this.credentials.get<StoredGithubCredential>(GITHUB_INTEGRATION_ID))
    if (!stored || stored.value.type !== "oauth" || typeof stored.value.accessToken !== "string" || !stored.value.accessToken) return null
    return stored.value
  }

  private async requiredCredential() {
    const credential = await this.credential()
    if (!credential) throw new AgentError("GITHUB_AUTH_REQUIRED", "请先登录 GitHub。", 401)
    return credential
  }

  private attemptStatus(state: GithubLoginStatus["state"], error: string | null, auth: GithubAuthStatus | null): GithubLoginStatus {
    const attempt = this.attempt
    if (!attempt) return this.emptyLogin(state, error)
    return {
      loginId: attempt.loginId,
      state,
      userCode: attempt.userCode,
      verificationUri: attempt.verificationUri,
      expiresAt: new Date(attempt.expiresAt).toISOString(),
      error,
      auth,
      elapsedMs: Math.max(0, this.now() - attempt.createdAt),
    }
  }

  private emptyLogin(
    state: GithubLoginStatus["state"],
    error: string | null,
    startedAt = this.now(),
    loginId: string | null = null,
  ): GithubLoginStatus {
    return {
      loginId,
      state,
      userCode: null,
      verificationUri: null,
      expiresAt: null,
      error,
      auth: null,
      elapsedMs: Math.max(0, this.now() - startedAt),
    }
  }

  private failedLogin(startedAt: number, error: string, loginId: string) {
    return this.emptyLogin("failed", error, startedAt, loginId)
  }

  private assertExpectedHeadRevision(expectedHeadRevision: string, actualHeadRevision: string): void {
    const expected = nonEmpty(expectedHeadRevision, "expectedHeadRevision")
    if (expected === actualHeadRevision) return
    throw new AgentError(
      "CONFLICT",
      "Pull Request 已更新，请刷新后重试。",
      409,
      { expectedHeadRevision: expected, actualHeadRevision },
    )
  }

  private async git(cwd: string, args: readonly string[], extraEnv: Record<string, string> = {}): Promise<GitResult> {
    const child = Bun.spawn(["git", ...args], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...globalThis.process.env, ...extraEnv },
    })
    const timeout = setTimeout(() => child.kill(), this.gitTimeoutMs)
    try {
      const [stdoutBytes, stderrBytes, code] = await Promise.all([
        readLimited(child.stdout, MAX_GIT_OUTPUT_BYTES, child),
        readLimited(child.stderr, MAX_GIT_OUTPUT_BYTES, child),
        child.exited,
      ])
      return {
        code,
        stdout: decodeUtf8(stdoutBytes),
        stderr: decodeUtf8(stderrBytes),
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

const parseGithubRemote = (value: string) => {
  const scp = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i.exec(value)
  if (scp) return validateGithubRepositorySlug(scp[1]!, stripGitSuffix(scp[2]!))
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AgentError("GITHUB_REMOTE_UNSUPPORTED", "当前 remote 不是 GitHub.com 仓库", 400)
  }
  if (url.hostname.toLowerCase() !== "github.com") throw new AgentError("GITHUB_REMOTE_UNSUPPORTED", "当前 remote 不是 GitHub.com 仓库", 400)
  const parts = url.pathname.replace(/^\/+/, "").split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new AgentError("GITHUB_REMOTE_UNSUPPORTED", "GitHub remote 地址无效", 400)
  return validateGithubRepositorySlug(parts[0], stripGitSuffix(parts[1]))
}

const parseGitStatus = (value: string): GithubWorkspaceStatus => {
  let branchName: string | null = null
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  const files: GithubWorkspaceStatus["files"] = []
  const records = value.split("\0")
  for (let index = 0; index < records.length; index += 1) {
    const entry = records[index]
    if (!entry) continue
    if (entry.startsWith("# branch.head ")) {
      const head = entry.slice("# branch.head ".length)
      branchName = head === "(detached)" ? null : head
      continue
    }
    if (entry.startsWith("# branch.upstream ")) {
      upstream = entry.slice("# branch.upstream ".length) || null
      continue
    }
    if (entry.startsWith("# branch.ab ")) {
      const match = /^\+(\d+) -(\d+)$/.exec(entry.slice("# branch.ab ".length))
      if (match) {
        ahead = Number.parseInt(match[1]!, 10)
        behind = Number.parseInt(match[2]!, 10)
      }
      continue
    }
    if (entry.startsWith("? ")) {
      files.push(statusFile(entry.slice(2), "??", undefined))
      continue
    }
    const ordinary = /^1 ([^ ]+) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/.exec(entry)
    if (ordinary) {
      files.push(statusFile(ordinary[2]!, ordinary[1]!, undefined))
      continue
    }
    const renamed = /^2 ([^ ]+) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/.exec(entry)
    if (renamed) {
      const originalPath = records[index + 1]
      if (originalPath) index += 1
      files.push(statusFile(renamed[2]!, renamed[1]!, originalPath))
      continue
    }
    const unmerged = /^u ([^ ]+) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/.exec(entry)
    if (unmerged) files.push(statusFile(unmerged[2]!, unmerged[1]!, undefined))
  }
  return {
    branchName,
    upstream,
    ahead,
    behind,
    clean: files.length === 0,
    files,
  }
}

const statusFile = (
  path: string,
  rawStatus: string,
  originalPath: string | undefined,
): GithubWorkspaceStatus["files"][number] => {
  const staged = rawStatus[0] === "." || rawStatus[0] === "?" ? "" : rawStatus[0] ?? ""
  const unstaged = rawStatus[1] === "." ? "" : rawStatus[1] ?? ""
  return {
    path,
    ...(originalPath ? { originalPath } : {}),
    status: rawStatus,
    stagedStatus: staged,
    unstagedStatus: unstaged,
    additions: null,
    deletions: null,
    isUntracked: rawStatus === "??",
  }
}

const stripGitSuffix = (value: string) => value.replace(/\.git$/i, "")
const validateGithubRepositorySlug = (owner: string, repository: string) => {
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)
    || !/^[A-Za-z0-9._-]+$/.test(repository)
    || repository === "."
    || repository === ".."
  ) {
    throw new AgentError("GITHUB_REMOTE_UNSUPPORTED", "GitHub remote 地址无效", 400)
  }
  return { owner, repository }
}

const writeAskPassHelper = async (root: string) => {
  if (process.platform === "win32") {
    const path = join(root, "askpass.cmd")
    await writeFile(path, [
      "@echo off",
      "echo %CODEPILOTX_GITHUB_TOKEN%",
    ].join("\r\n"), "utf8")
    return path
  }
  const path = join(root, "askpass.sh")
  await writeFile(path, [
    "#!/bin/sh",
    "printf '%s\\n' \"$CODEPILOTX_GITHUB_TOKEN\"",
  ].join("\n"), { encoding: "utf8", mode: 0o700 })
  return path
}

const readLimited = async (
  stream: ReadableStream<Uint8Array>,
  limit: number,
  process: { kill(signal?: number | NodeJS.Signals): void },
) => {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        process.kill()
        throw new AgentError("GIT_OUTPUT_TOO_LARGE", "Git 输出超过安全上限", 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

const decodeUtf8 = (value: Uint8Array) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value)
  } catch {
    throw new AgentError("GIT_OUTPUT_ENCODING_INVALID", "Git 输出不是有效 UTF-8", 500)
  }
}

const safeGitError = (value: string) => {
  const firstLine = value.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  return firstLine && !/authorization|token|password|credential/i.test(firstLine)
    ? firstLine.slice(0, 500)
    : "GitHub Push 失败，请检查分支权限和仓库设置。"
}

const oauthErrorMessage = (value: Record<string, unknown>) => {
  const error = typeof value.error === "string" ? value.error : ""
  if (error === "authorization_pending") return "等待在 GitHub 完成授权。"
  if (error === "slow_down") return "GitHub 要求降低轮询频率。"
  if (error === "expired_token" || error === "token_expired") return "GitHub 验证码已过期，请重新登录。"
  if (error === "access_denied") return "GitHub 登录已被取消。"
  if (error === "incorrect_client_credentials") return "GitHub OAuth Client ID 无效。"
  if (error === "incorrect_device_code") return "GitHub Device Code 无效，请重新登录。"
  if (error === "device_flow_disabled") return "该 GitHub OAuth App 未启用 Device Flow。"
  return typeof value.error_description === "string" && value.error_description.trim()
    ? value.error_description.trim()
    : "GitHub 登录失败，请稍后重试。"
}

const githubApiMessage = (value: unknown, status: number) => {
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") {
    return value.message.slice(0, 500)
  }
  return `GitHub 请求失败（HTTP ${status}）`
}

const asRecord = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentError("GITHUB_RESPONSE_INVALID", `${name}响应无效`, 502)
  return value as Record<string, unknown>
}

const stringField = (value: Record<string, unknown>, key: string) => {
  if (typeof value[key] !== "string") throw new AgentError("GITHUB_RESPONSE_INVALID", `GitHub 响应缺少 ${key}`, 502)
  return value[key]
}

const nullableStringField = (value: Record<string, unknown>, key: string) => typeof value[key] === "string" ? value[key] : null
const numberField = (value: Record<string, unknown>, key: string) => {
  if (typeof value[key] !== "number" || !Number.isFinite(value[key])) throw new AgentError("GITHUB_RESPONSE_INVALID", `GitHub 响应缺少 ${key}`, 502)
  return value[key]
}
const optionalNumberField = (value: Record<string, unknown>, key: string) => typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] : 0
const positiveNumberField = (value: Record<string, unknown>, key: string) => {
  const result = numberField(value, key)
  if (result <= 0) throw new AgentError("GITHUB_RESPONSE_INVALID", `GitHub 响应 ${key} 无效`, 502)
  return result
}
const booleanField = (value: Record<string, unknown>, key: string) => {
  if (typeof value[key] !== "boolean") throw new AgentError("GITHUB_RESPONSE_INVALID", `GitHub 响应缺少 ${key}`, 502)
  return value[key]
}
const positiveInteger = (value: number, name: string) => {
  if (!Number.isInteger(value) || value <= 0) throw new AgentError("INVALID_REQUEST", `${name} 参数无效`, 400)
  return value
}
const validateRepositoryInput = (input: { owner: string; repository: string }) => {
  nonEmpty(input.owner, "owner")
  nonEmpty(input.repository, "repository")
}

export const __test = {
  parseGithubRemote,
  parseGitStatus,
}
