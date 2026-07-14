import { describe, expect, test } from "bun:test"
import { stagesForTask } from "../src/orchestration/stages"

describe("固定多 Agent 编排", () => {
  test("工作请求从规划开始，确认后才会进入后续角色", () => {
    expect(stagesForTask("chat", "修复登录表单校验")).toEqual(["planner"])
  })

  test("计划任务只运行规划阶段", () => {
    expect(stagesForTask("plan")).toEqual(["planner"])
  })

  test("普通问候保持为对话，不产生计划", () => {
    expect(stagesForTask("chat", "你好呀")).toEqual(["assistant"])
  })
})
