/**
 * @codepilotx/plugin-sdk —— CodePilotX 两层插件平台唯一公共 SDK。
 *
 * 只导出稳定子路径内容；禁止全仓 barrel。消费者应使用包级入口或
 * package.json exports 声明的子路径（./manifest、./wire 等）。
 */

export * from "./errors"
export * from "./engine"
export * from "./json-schema"
export * from "./manifest"
export * from "./contributions"
export * from "./permissions"
export * from "./services"
export * from "./schema"
export * from "./wire"
export * from "./pack"
