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
    const planning = runtime.dependencies.taskboardPlanning
    const contextService = runtime.dependencies.taskContext
    const actor = { kind: "user" as const, sourceThreadId: null }
    switch (method) {
      case "taskboard/context/read": return contextService.read(params.taskId, params)
      case "taskboard/context/update": {
        const result = contextService.publish({ ...params, sourceKind: "user" })
        await contextService.broadcast(result.event)
        if (result.rollupEvent) await contextService.broadcast(result.rollupEvent)
        return { snapshot: result.snapshot }
      }
      case "taskboard/context/ai-preview": return { proposal: await runtime.dependencies.taskContextSummary.preview(params.taskId) }
      case "taskboard/context/ai-apply": {
        const result = contextService.applyProposal(params.proposalId)
        await contextService.broadcast(result.event)
        if (result.rollupEvent) await contextService.broadcast(result.rollupEvent)
        return { proposal: result.proposal, snapshot: result.snapshot }
      }
      case "taskboard/context/ai-discard": return { proposal: contextService.discardProposal(params.proposalId) }
      case "taskboard/context/promotion-status": return { promotion: contextService.promotionStatus(params.taskId) }
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
      case "taskboard/workflow/list": return service.listWorkflow(params)
      case "taskboard/workflow/read": return { task: service.readWorkflow(params.taskId) }
      case "taskboard/workflow/create": return { task: await service.createWorkflow(params) }
      case "taskboard/workflow/update": return { task: await service.updateWorkflow(params) }
      case "taskboard/workflow/move": return { task: await service.moveWorkflow(params) }
      case "taskboard/workflow/transition": return { task: await service.transitionWorkflow(params) }
      case "taskboard/workflow/mark-read": return { task: await service.markWorkflowRead(params) }
      case "taskboard/workflow/thread-candidates": return service.listWorkflowThreadCandidates(params)
      case "taskboard/workflow/find-by-thread": return service.findWorkflowByThread(params)
      case "taskboard/workflow/link-threads": return { task: await service.linkWorkflowThreads(params) }
      case "taskboard/workflow/start": return { operation: await runtime.dependencies.taskboardStart.startWorkflow(params) }
      case "taskboard/planning/roots": return planning.roots(params)
      case "taskboard/planning/read": return planning.read(params.taskId)
      case "taskboard/planning/apply": return planning.apply(params)
      case "taskboard/planning/step/update": return planning.updateStep(params)
      case "taskboard/planning/step/promote": return planning.promoteStep(params)
      case "taskboard/planning/item/reorder": return planning.reorder(params)
      case "taskboard/planning/child/reparent": return planning.reparent(params)
      case "taskboard/planning/dependencies/set": return planning.setDependencies(params)
      case "taskboard/planning/blocker/create": return planning.createBlocker(params)
      case "taskboard/planning/blocker/resolve": return planning.resolveBlocker(params)
      case "taskboard/planning/attention/mark-read": return planning.markRead(params)
      case "taskboard/planning/archive-tree": return planning.archiveTree(params)
      case "taskboard/planning/restore-tree": return planning.restoreTree(params)
      case "taskboard/planning/delete-tree": return planning.deleteTree(params)
      default: return undefined
    }
  },
} as const satisfies RpcHandlerGroup
