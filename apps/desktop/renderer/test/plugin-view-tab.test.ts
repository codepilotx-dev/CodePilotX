import { describe, expect, test } from "bun:test"
import {
  isPluginViewNode,
  validatePluginViewNodes,
} from "../src/features/layout/tabs/PluginViewPane.js"
import {
  applyWorkbenchPanelAction,
  createDefaultWorkbenchTabsState,
} from "../src/features/layout/dock/rightDockState.js"
import type { WorkbenchTabDescriptor } from "../src/features/layout/dock/rightDockState.js"

describe("插件视图声明式节点白名单", () => {
  test("接受全部白名单节点", () => {
    const nodes = [
      { kind: "section", title: "概览", children: [] },
      { kind: "markdown", content: "# 你好" },
      { kind: "status", text: "运行中", tone: "success" },
      { kind: "table", columns: [{ key: "k", label: "键" }], rows: [{ k: "v" }] },
      { kind: "form", actionId: "save", fields: [{ key: "name", label: "名称", control: "string" }] },
      { kind: "actions", items: [{ id: "refresh", label: "刷新" }] },
    ]
    expect(validatePluginViewNodes(nodes)).toHaveLength(6)
  })

  test("拒绝未知节点与嵌套未知节点", () => {
    expect(isPluginViewNode({ kind: "html", content: "<script>" })).toBe(false)
    expect(isPluginViewNode({ kind: "markdown" })).toBe(false)
    expect(isPluginViewNode("markdown")).toBe(false)
    expect(isPluginViewNode(null)).toBe(false)
    const filtered = validatePluginViewNodes([
      { kind: "markdown", content: "ok" },
      { kind: "html", content: "<script>alert(1)</script>" },
      { kind: "iframe", url: "https://evil.example" },
    ])
    expect(filtered).toHaveLength(1)
    // section 内的未知子节点使整个 section 被拒绝
    const sectionWithUnknown = validatePluginViewNodes([
      { kind: "section", title: "s", children: [{ kind: "html", content: "<img onerror=x>" }] },
    ])
    expect(sectionWithUnknown).toHaveLength(0)
  })

  test("空数组合法", () => {
    expect(validatePluginViewNodes([])).toEqual([])
  })
})

describe("plugin-view workbench tab", () => {
  const pluginTab = (instanceId: string): WorkbenchTabDescriptor => ({
    id: `plugin-view:${instanceId}`,
    kind: "plugin-view",
    pluginId: "acme.hello",
    viewId: "hello-view",
    instanceId,
    title: "Hello",
  })

  test("打开/关闭 plugin-view tab 保持状态", () => {
    let state = createDefaultWorkbenchTabsState()
    const tab = pluginTab("instance-1")
    state = applyWorkbenchPanelAction(state, {
      type: "openTab",
      target: "right",
      tab,
    })
    expect(state.right.open).toBe(true)
    expect(state.right.activeTabId).toBe(tab.id)
    expect(state.right.tabIds).toContain(tab.id)
    expect(state.tabsById[tab.id]).toMatchObject({
      kind: "plugin-view",
      pluginId: "acme.hello",
      viewId: "hello-view",
    })
    state = applyWorkbenchPanelAction(state, {
      type: "closeTab",
      target: "right",
      tabId: tab.id,
    })
    expect(state.right.tabIds).not.toContain(tab.id)
    expect(state.tabsById[tab.id]).toBeUndefined()
  })

  test("多个 plugin-view 实例独立共存", () => {
    let state = createDefaultWorkbenchTabsState()
    for (const id of ["a", "b", "c"]) {
      state = applyWorkbenchPanelAction(state, {
        type: "openTab",
        target: "right",
        tab: pluginTab(id),
      })
    }
    expect(state.right.tabIds).toHaveLength(3)
    expect(state.right.activeTabId).toBe("plugin-view:c")
  })
})
