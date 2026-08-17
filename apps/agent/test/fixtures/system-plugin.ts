/**
 * 测试用 System 插件 bundle（自包含：不依赖任何外部包，贴近
 * "System 插件是自包含 bundle" 约束；defineSystemPlugin 内联等价实现）。
 */

export default {
  id: "acme.system",
  version: "1.0.0",
  displayName: "测试 System 插件",
  description: "System Profile loader 测试",
  provides: ["codepilotx.permission-policy@1"],
  requires: {},
  register: (context: {
    add: (disposer: () => void | Promise<void>) => void
    log: (entry: { level: string; message: string }) => void
    registerProvider: (key: string, instance: unknown) => void
  }) => {
    const marker = (process.env.CPX_SYSTEM_MARKER as string | undefined) ?? "default"
    if (marker === "throw") {
      throw new Error("fixture: register failed")
    }
    context.registerProvider("codepilotx.permission-policy@1", {
      describe: () => ({ name: `fixture-permission-${marker}` }),
    })
    context.add(async () => {
      context.log({ level: "info", message: `dispose-add-${marker}` })
    })
    return async () => {
      context.log({ level: "info", message: `dispose-returned-${marker}` })
    }
  },
}
