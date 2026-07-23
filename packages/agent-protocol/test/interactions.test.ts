import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import {
  ApprovalRequestResultSchema,
  HookTrustRequestResultSchema,
  PlanRequestResultSchema,
  QuestionRequestResultSchema,
  createServerRequestMessage,
  decodeServerRequestMessage,
  ServerRequestResultSchema,
  ServerRequests,
} from "../src/interactions"
import { RpcMethods } from "../src/methods"

const responseBranches = [
  {
    method: "approval/request",
    resultSchema: ApprovalRequestResultSchema,
    response: { kind: "approval", decision: "deny", feedback: "请改用只读命令" },
    invalidResponse: { kind: "approval", decision: "continue" },
  },
  {
    method: "question/request",
    resultSchema: QuestionRequestResultSchema,
    response: {
      kind: "question",
      status: "answered",
      answers: [{ questionId: "question-1", choiceIds: ["choice-1"], text: "details" }],
    },
    invalidResponse: { kind: "question", status: "answered" },
  },
  {
    method: "plan/request",
    resultSchema: PlanRequestResultSchema,
    response: { kind: "plan", decision: "continue" },
    invalidResponse: { kind: "plan", decision: "allow-once" },
  },
  {
    method: "hookTrust/request",
    resultSchema: HookTrustRequestResultSchema,
    response: { kind: "hookTrust", decision: "allow" },
    invalidResponse: { kind: "hookTrust", decision: "continue" },
  },
] as const

describe("server request interactions", () => {
  test("defines exactly the four interaction request kinds", () => {
    expect(Object.keys(ServerRequests).sort()).toEqual(responseBranches.map(({ method }) => method).sort())
  })

  test("keeps each ServerRequest result aligned with interaction/respond", () => {
    const respond = RpcMethods["interaction/respond"]
    const decodeSharedResponse = Schema.decodeUnknownSync(ServerRequestResultSchema)
    const decodeRespondParams = Schema.decodeUnknownSync(respond.params)
    const decodeRespondResult = Schema.decodeUnknownSync(respond.result)

    for (const [index, branch] of responseBranches.entries()) {
      expect(ServerRequests[branch.method].result).toBe(branch.resultSchema)
      expect(Schema.decodeUnknownSync(branch.resultSchema)(branch.response)).toEqual(branch.response)
      expect(decodeSharedResponse(branch.response)).toEqual(branch.response)

      const params = {
        interactionId: `interaction-${index}`,
        expectedVersion: 1,
        response: branch.response,
        operationId: `operation-${index}`,
      }
      const result = {
        interactionId: params.interactionId,
        kind: branch.response.kind,
        state: "resolved" as const,
        version: 2,
        resolvedAt: 10,
        response: branch.response,
      }

      expect(decodeRespondParams(params)).toEqual(params)
      expect(decodeRespondResult(result)).toEqual(result)

      expect(() => Schema.decodeUnknownSync(branch.resultSchema)(branch.invalidResponse)).toThrow()
      expect(() => decodeSharedResponse(branch.invalidResponse)).toThrow()
      expect(() => decodeRespondParams({ ...params, response: branch.invalidResponse })).toThrow()
      expect(() => decodeRespondResult({ ...result, response: branch.invalidResponse })).toThrow()

      for (const otherBranch of responseBranches) {
        if (otherBranch.method === branch.method) continue
        expect(() => Schema.decodeUnknownSync(otherBranch.resultSchema)(branch.response)).toThrow()
      }
    }
  })

  test("uses the persisted interactionId as the JSON-RPC request id", () => {
    const params = {
      kind: "plan" as const,
      interactionId: "interaction-1",
      threadId: "thread-1",
      turnId: "turn-1",
      agentId: "agent-1",
      createdAt: 1,
      version: 1,
      title: "Implementation plan",
      markdown: "1. Implement",
    }
    const message = createServerRequestMessage("plan/request", params)
    expect(message.id).toBe(params.interactionId)
    expect(decodeServerRequestMessage(message)).toEqual(message)
    expect(() => decodeServerRequestMessage({ ...message, id: "different-interaction" })).toThrow()
  })

  test("limits approval feedback to 4000 characters", () => {
    const decode = Schema.decodeUnknownSync(ApprovalRequestResultSchema)
    expect(decode({ kind: "approval", decision: "deny", feedback: "调".repeat(4_000) })).toMatchObject({ decision: "deny" })
    expect(() => decode({ kind: "approval", decision: "deny", feedback: "调".repeat(4_001) })).toThrow()
  })
})
