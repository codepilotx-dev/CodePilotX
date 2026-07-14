import { describe, expect, test } from "bun:test"
import type { Item } from "../src/domain"
import { ThreadProjection } from "../src/transport/ThreadProjection"
import type { AgentDatabase } from "../src/storage/Database"

describe("活动投影", () => {
  test("透传只读工具命令和输出", () => {
    const projection = new ThreadProjection({} as unknown as AgentDatabase)
    const item: Item = {
      id: "activity-1",
      turnID: "turn-1",
      type: "activity",
      status: "completed",
      data: {
        role: "planner",
        activity: "notice",
        title: "读取文件",
        detail: "README.md",
        commands: [{
          command: "workspace_read README.md",
          output: "# README",
          status: "success",
          truncated: false,
        }],
      },
      createdAt: 1000,
      updatedAt: 1001,
    }

    expect(projection.item(item)).toMatchObject({
      type: "activity",
      title: "读取文件",
      detail: "README.md",
      commands: [{
        command: "workspace_read README.md",
        output: "# README",
        status: "success",
        truncated: false,
      }],
    })
  })

  test("通知携带 Thread 上下文并投影原生 Item", () => {
    const projection = new ThreadProjection({} as unknown as AgentDatabase)
    const projected = projection.notification({
      id: 7,
      threadId: "thread-1",
      turnId: "turn-1",
      method: "item/completed",
      params: {
        item: {
          id: "text-1",
          turnID: "turn-1",
          type: "text",
          status: "completed",
          data: { text: "完成" },
          createdAt: 1000,
          updatedAt: 1001,
        },
      },
      createdAt: 1001,
    })

    expect(projected.notification.params).toMatchObject({
      threadId: "thread-1",
      turnId: "turn-1",
      item: { id: "text-1", turnId: "turn-1", type: "text", text: "完成" },
    })
  })
})
