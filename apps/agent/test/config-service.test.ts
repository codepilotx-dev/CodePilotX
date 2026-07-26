import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import {
  ConfigService,
  ConfigServiceError,
} from "../src/config/ConfigService"

const roots: string[] = []
const temporaryRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-config-test-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })))
})

describe("ConfigService", () => {
  test("局部写入保留注释、顺序和未知字段，并检查版本冲突", async () => {
    const root = await temporaryRoot()
    const filePath = join(root, "config.toml")
    await writeFile(filePath, [
      "# keep this comment",
      'model = "old"',
      'unknown_future_key = "keep"',
      "",
      "[desktop]",
      "showContextUsage = true # keep inline",
      "",
    ].join("\n"), "utf8")
    const service = new ConfigService(filePath)
    await service.initialize()
    const before = await service.read({ includeLayers: true })
    const version = before.layers?.find((layer) => layer.kind === "user")?.version
    const result = await service.batchWrite({
      edits: [
        { keyPath: ["model"], value: "gpt-5.6" },
        { keyPath: ["desktop", "reviewView"], value: "inline" },
      ],
      expectedVersion: version,
    })
    const source = await readFile(filePath, "utf8")
    expect(source).toContain("# keep this comment")
    expect(source).toContain('unknown_future_key = "keep"')
    expect(source).toContain("showContextUsage = true # keep inline")
    expect(source).toContain('model = "gpt-5.6"')
    expect(source).toContain('reviewView = "inline"')
    await expect(service.writeValue({
      keyPath: ["model"],
      value: "stale",
      expectedVersion: version,
    })).rejects.toMatchObject({
      code: "CONFIG_VERSION_CONFLICT",
    } satisfies Partial<ConfigServiceError>)
    expect(result.version).not.toBe(version)
    await service.dispose()
  })

  test("同一 config.toml 的并发写入会串行合并且不残留临时文件", async () => {
    const root = await temporaryRoot()
    const filePath = join(root, "config.toml")
    await writeFile(filePath, "# keep\n", "utf8")
    const service = new ConfigService(filePath)
    await service.initialize()

    await Promise.all([
      service.writeValue({
        keyPath: ["desktop", "tooling", "nodejs"],
        value: "managed",
      }),
      service.writeValue({
        keyPath: ["desktop", "tooling", "python"],
        value: "system",
      }),
    ])

    const source = await readFile(filePath, "utf8")
    expect(source).toContain("# keep")
    expect(source).toContain('nodejs = "managed"')
    expect(source).toContain('python = "system"')
    expect((await readdir(root)).filter((name) =>
      name.endsWith(".config.tmp"))).toEqual([])
    await service.dispose()
  })

  test("排队的项目写入会在落盘前重新检查最新信任状态", async () => {
    const root = await temporaryRoot()
    const workspace = join(root, "workspace")
    const userConfig = join(root, "data", "config.toml")
    const projectConfig = join(workspace, ".codepilotx", "config.toml")
    await mkdir(join(workspace, ".codepilotx"), { recursive: true })
    await writeFile(projectConfig, "# keep\n", "utf8")
    const service = new ConfigService(userConfig)
    await service.initialize()
    await service.trustUpdate(workspace, "trusted")

    let releaseWrite!: () => void
    const blocker = new Promise<void>((resolveBlocker) => {
      releaseWrite = resolveBlocker
    })
    const queueKey = process.platform === "win32"
      ? resolve(projectConfig).toLowerCase()
      : resolve(projectConfig)
    const writeQueues = (
      service as unknown as { writeQueues: Map<string, Promise<void>> }
    ).writeQueues
    writeQueues.set(queueKey, blocker)

    const pending = service.writeValue({
      keyPath: ["mcp_servers", "fixture", "enabled"],
      value: true,
      filePath: projectConfig,
      cwd: workspace,
    })
    const settled = pending.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    )
    for (
      let attempt = 0;
      attempt < 100 && writeQueues.get(queueKey) === blocker;
      attempt += 1
    ) {
      await Bun.sleep(5)
    }
    if (writeQueues.get(queueKey) === blocker) releaseWrite()
    expect(writeQueues.get(queueKey)).not.toBe(blocker)

    try {
      await service.trustUpdate(workspace, "untrusted")
    } finally {
      releaseWrite()
    }

    expect(await settled).toMatchObject({
      error: {
        code: "CONFIG_PROJECT_UNTRUSTED",
      },
    })
    expect(await readFile(projectConfig, "utf8")).toBe("# keep\n")
    await service.dispose()
  })

  test("可信项目覆盖用户配置，未信任时忽略项目层", async () => {
    const root = await temporaryRoot()
    const userConfig = join(root, "data", "config.toml")
    const workspace = join(root, "workspace")
    await mkdir(join(workspace, ".codepilotx"), { recursive: true })
    await mkdir(join(root, "data"), { recursive: true })
    await writeFile(userConfig, 'model = "user-model"\n', "utf8")
    await writeFile(
      join(workspace, ".codepilotx", "config.toml"),
      'model = "project-model"\n',
      "utf8",
    )
    const service = new ConfigService(userConfig)
    await service.initialize()
    const untrusted = await service.read({ cwd: workspace })
    expect(untrusted.config.model).toBe("user-model")
    expect(untrusted.diagnostics.some((item) =>
      item.code === "CONFIG_PROJECT_UNTRUSTED")).toBe(true)

    await service.trustUpdate(workspace, "trusted")
    const trusted = await service.read({ cwd: workspace })
    expect(trusted.config.model).toBe("project-model")
    expect(trusted.origins.model).toBe("project")
    await service.dispose()
  })

  test("无效外部 TOML 保留 last-known-good 并产生诊断", async () => {
    const root = await temporaryRoot()
    const filePath = join(root, "config.toml")
    await writeFile(filePath, 'model = "valid"\n', "utf8")
    const service = new ConfigService(filePath)
    await service.initialize()
    expect(service.snapshot().model).toBe("valid")
    await writeFile(filePath, "model = [", "utf8")
    const read = await service.read()
    expect(read.config.model).toBe("valid")
    expect(read.diagnostics).toEqual([
      expect.objectContaining({ code: "CONFIG_VALIDATION_ERROR" }),
    ])
    await service.dispose()
  })

  test("项目层拒绝 Desktop，MCP 环境变量引用通过且静态凭据仍被拒绝", async () => {
    const root = await temporaryRoot()
    const filePath = join(root, "config.toml")
    const service = new ConfigService(filePath)
    await service.initialize()
    expect(() => service.validateDocument(
      '[desktop]\nreviewView = "inline"\n',
      "project",
    )).toThrow(ConfigServiceError)
    expect(() => service.validateDocument(
      '[model_providers.openai]\napi_key = "secret"\n',
      "user",
    )).toThrow(ConfigServiceError)
    expect(() => service.validateDocument([
      "[mcp_servers.context7.transport]",
      'type = "http"',
      'url = "https://mcp.context7.com/mcp"',
      'bearerTokenEnvVar = "CONTEXT7_API_KEY"',
      "",
      "[mcp_servers.context7.transport.headerFromEnv]",
      'CONTEXT7_API_KEY = "CONTEXT7_API_KEY"',
      "",
      "[mcp_servers.worker.transport]",
      'type = "stdio"',
      'command = "worker"',
      "",
      "[mcp_servers.worker.transport.envFromHost]",
      'API_KEY = "WORKER_API_KEY"',
      "",
    ].join("\n"), "user")).not.toThrow()
    expect(() => service.validateDocument([
      "[mcp_servers.context7.transport]",
      'type = "http"',
      'url = "https://mcp.context7.com/mcp"',
      "",
      "[mcp_servers.context7.transport.headers]",
      'Authorization = "secret"',
      "",
    ].join("\n"), "user")).toThrow(ConfigServiceError)
    expect(() => service.validateDocument([
      "[mcp_servers.context7.transport]",
      'type = "http"',
      'url = "https://mcp.context7.com/mcp"',
      "",
      "[mcp_servers.context7.transport.headerFromEnv]",
      'Authorization = "not an environment variable"',
      "",
    ].join("\n"), "user")).toThrow(ConfigServiceError)
    await service.dispose()
  })

  test("工作区出现后搬移未解析 MCP，并删除对应迁移 table", async () => {
    const root = await temporaryRoot()
    const workspace = join(root, "workspace")
    const userConfig = join(root, "data", "config.toml")
    const hash = createHash("sha256")
      .update(workspace.toLowerCase())
      .digest("hex")
    await mkdir(join(root, "data"), { recursive: true })
    await mkdir(join(workspace, ".codepilotx"), { recursive: true })
    await writeFile(userConfig, [
      `[migration.unresolved_mcp."${hash}".legacy]`,
      "enabled = true",
      "",
      `[migration.unresolved_mcp."${hash}".legacy.transport]`,
      'type = "http"',
      'url = "https://example.com/mcp"',
      "",
    ].join("\n"), "utf8")
    await writeFile(
      join(workspace, ".codepilotx", "config.toml"),
      'model = "keep"\n',
      "utf8",
    )
    const service = new ConfigService(userConfig)
    await service.initialize()

    await expect(service.resolveUnresolvedMcp(workspace)).resolves.toBe(true)
    const projectSource = await readFile(
      join(workspace, ".codepilotx", "config.toml"),
      "utf8",
    )
    expect(projectSource).toContain('model = "keep"')
    expect(projectSource).toContain("[mcp_servers.legacy]")
    expect(projectSource).toContain('url = "https://example.com/mcp"')
    expect(await readFile(userConfig, "utf8")).not.toContain(hash)
    await expect(service.resolveUnresolvedMcp(workspace)).resolves.toBe(false)
    await service.dispose()
  })
})
