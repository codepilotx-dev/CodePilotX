import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { createLspTool, LspManager, lspInputSchema, type LspClient, type LspServerConfig } from "../src/lsp/LspManager"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

class FakeClient implements LspClient {
  initialized = 0
  notifications: Array<{ method: string; params: any }> = []
  requests: Array<{ method: string; params: any }> = []
  result: (method: string, params: any) => unknown = () => []
  async initialize() { this.initialized += 1 }
  notify(method: string, params: unknown) { this.notifications.push({ method, params }) }
  async request(method: string, params: unknown) { this.requests.push({ method, params }); return this.result(method, params) }
  async close() {}
}

const config: LspServerConfig = { id: "test", languages: ["typescript"], extensions: [".ts"], command: ["unused"] }

const setup = async () => {
  const parent = await mkdtemp(join(tmpdir(), "codepilotx-lsp-")); roots.push(parent)
  const rootPath = join(parent, "workspace"); await mkdir(rootPath)
  await writeFile(join(rootPath, "input.ts"), "const value = 1\n", "utf8")
  await writeFile(join(rootPath, "target.ts"), "export const target = 1\n", "utf8")
  const client = new FakeClient()
  const manager = new LspManager([config], { createClient: () => client })
  return { parent, rootPath, client, manager, read: async (filePath: string) => await Bun.file(resolve(rootPath, filePath)).text() }
}

describe("LSP manager", () => {
  test("统一操作映射到协议方法并把 1-based 位置转换为 0-based", async () => {
    const { rootPath, client, manager, read } = await setup()
    client.result = (method) => method === "textDocument/prepareCallHierarchy"
      ? [{ name: "fn", uri: pathToFileURL(join(rootPath, "target.ts")).toString(), range: {}, selectionRange: {} }]
      : []
    const positionOperations = [
      ["goToDefinition", "textDocument/definition"], ["findReferences", "textDocument/references"], ["hover", "textDocument/hover"],
      ["goToImplementation", "textDocument/implementation"], ["prepareCallHierarchy", "textDocument/prepareCallHierarchy"],
      ["incomingCalls", "callHierarchy/incomingCalls"], ["outgoingCalls", "callHierarchy/outgoingCalls"],
    ] as const
    for (const [operation] of positionOperations) await manager.execute({ operation, filePath: "input.ts", line: 2, character: 3 }, { rootPath, read })
    await manager.execute({ operation: "documentSymbol", filePath: "input.ts" }, { rootPath, read })
    await manager.execute({ operation: "workspaceSymbol", query: "value" }, { rootPath, read })
    for (const [, method] of positionOperations) expect(client.requests.some((request) => request.method === method)).toBe(true)
    expect(client.requests.some((request) => request.method === "textDocument/documentSymbol")).toBe(true)
    expect(client.requests.some((request) => request.method === "workspace/symbol")).toBe(true)
    const definition = client.requests.find((request) => request.method === "textDocument/definition")!
    expect(definition.params.position).toEqual({ line: 1, character: 2 })
  })

  test("返回 URI 必须真实位于工作区内并转换为相对 filePath", async () => {
    const { parent, rootPath, client, manager, read } = await setup()
    client.result = () => [{ uri: pathToFileURL(join(rootPath, "target.ts")).toString(), range: { start: {}, end: {} } }]
    expect(await manager.execute({ operation: "goToDefinition", filePath: "input.ts", line: 1, character: 1 }, { rootPath, read })).toEqual([{ filePath: "target.ts", range: { start: {}, end: {} } }])
    const outside = join(parent, "outside.ts"); await writeFile(outside, "secret", "utf8")
    client.result = () => [{ uri: pathToFileURL(outside).toString(), range: {} }]
    await expect(manager.execute({ operation: "goToDefinition", filePath: "input.ts", line: 1, character: 1 }, { rootPath, read })).rejects.toMatchObject({ code: "LSP_URI_OUTSIDE_WORKSPACE" })
  })

  test("didChange/didSave 提供 Write/Edit 接线并维护单调版本", async () => {
    const { rootPath, client, manager } = await setup()
    await manager.didChange({ rootPath, filePath: "input.ts", content: "v1" })
    await manager.didChange({ rootPath, filePath: "input.ts", content: "v2" })
    await manager.didSave({ rootPath, filePath: "input.ts", content: "v3" })
    expect(client.notifications.map((item) => item.method)).toEqual(["textDocument/didOpen", "textDocument/didChange", "textDocument/didChange", "textDocument/didSave"])
    expect(client.notifications.filter((item) => item.method === "textDocument/didChange").map((item) => item.params.textDocument.version)).toEqual([2, 3])
  })

  test("模型契约是单一 LSP discriminated union", () => {
    expect(lspInputSchema.safeParse({ operation: "hover", filePath: "a.ts", line: 0, character: 1 }).success).toBe(false)
    expect(createLspTool({} as never).sdkName).toBe("LSP")
  })
})
