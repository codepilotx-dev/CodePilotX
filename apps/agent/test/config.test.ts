import { describe, expect, test } from "bun:test"
import { join, resolve } from "node:path"
import {
  resolveAgentDataDirectory,
  resolveAgentLogDirectory,
  resolveAgentPetsDirectory,
} from "../src/config/Config"

describe("Agent data directories", () => {
  test("defaults all Agent-owned data to the current user home", () => {
    const userHome = resolve("C:/Users/Example")
    const environment = { CODEX_HOME: resolve("D:/codex-home") }

    expect(resolveAgentDataDirectory(environment, userHome)).toBe(
      join(userHome, ".codepilotx"),
    )
    expect(resolveAgentLogDirectory(environment, userHome)).toBe(
      join(userHome, ".codepilotx", "logs"),
    )
    expect(resolveAgentPetsDirectory(environment, userHome)).toBe(
      join(userHome, ".codepilotx", "pets"),
    )
  })

  test("keeps CodePilotX-specific overrides authoritative", () => {
    const environment = {
      CODEPILOTX_DATA_DIR: resolve("D:/agent-data"),
      CODEPILOTX_LOG_DIR: resolve("D:/agent-logs"),
      CODEPILOTX_PETS_DIR: resolve("D:/agent-pets"),
      CODEX_HOME: resolve("D:/codex-home"),
    }

    expect(resolveAgentDataDirectory(environment)).toBe(
      environment.CODEPILOTX_DATA_DIR,
    )
    expect(resolveAgentLogDirectory(environment)).toBe(
      environment.CODEPILOTX_LOG_DIR,
    )
    expect(resolveAgentPetsDirectory(environment)).toBe(
      environment.CODEPILOTX_PETS_DIR,
    )
  })
})
