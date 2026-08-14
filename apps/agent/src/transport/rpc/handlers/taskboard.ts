import { TaskboardRpcMethods, type RpcMethod } from "@codepilotx/agent-protocol"
import { Schema } from "effect"
import type { RpcRouter } from "../RpcRouter"
import type { RpcRouterContext } from "../request-context"
import type { RpcHandlerGroup } from "./types"

const methods = Object.keys(TaskboardRpcMethods) as Array<keyof typeof TaskboardRpcMethods>

const decode = (method: keyof typeof TaskboardRpcMethods, raw: unknown) =>
  Schema.decodeUnknownSync(TaskboardRpcMethods[method].params as any)(raw) as any

export const taskboardHandlers = {
  name: "taskboard",
  methods,
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown, _context: RpcRouterContext) {
    if (!(method in TaskboardRpcMethods)) return undefined
    const params = decode(method as keyof typeof TaskboardRpcMethods, rawParams)
    const service = runtime.dependencies.taskboard
    const actor = { kind: "user" as const, sourceThreadId: null }
    switch (method) {
      case "taskboard/task/list": return service.list(params)
      case "taskboard/task/read": return { task: service.read(params.taskId) }
      case "taskboard/task/create": return { task: await service.create({ ...params, actor }) }
      case "taskboard/task/update": return { task: await service.update({ ...params, actor }) }
      case "taskboard/task/move": return { task: await service.move({ ...params, actor }) }
      case "taskboard/task/archive": return { task: await service.archive({ ...params, actor }) }
      case "taskboard/task/restore": return { task: await service.restore({ ...params, actor }) }
      case "taskboard/task/delete": return service.delete({ ...params, actor })
      case "taskboard/thread/link": return { task: await service.linkThread({ ...params, actor }) }
      case "taskboard/thread/unlink": return { task: await service.unlinkThread({ ...params, actor }) }
      case "taskboard/thread/set-primary": return { task: await service.setPrimaryThread({ ...params, actor }) }
      case "taskboard/comment/create": return service.createComment({ ...params, actor })
      case "taskboard/comment/update": return service.updateComment({ ...params, actor })
      case "taskboard/comment/delete": return service.deleteComment({ ...params, actor })
      case "taskboard/label/list": return service.listLabels(params.projectId)
      case "taskboard/label/create": return service.createLabel({ ...params, actor })
      case "taskboard/label/update": return service.updateLabel({ ...params, actor })
      case "taskboard/label/delete": return service.deleteLabel({ ...params, actor })
      case "taskboard/task/start": return { operation: await runtime.dependencies.taskboardStart.start(params) }
      case "taskboard/task/start/status": return runtime.dependencies.taskboardStart.status(params)
      case "taskboard/task/start/retry-setup": return { operation: await runtime.dependencies.taskboardStart.retrySetup(params) }
      case "taskboard/task/start/continue-without-setup": return { operation: await runtime.dependencies.taskboardStart.continueWithoutSetup(params) }
      default: return undefined
    }
  },
} as const satisfies RpcHandlerGroup
