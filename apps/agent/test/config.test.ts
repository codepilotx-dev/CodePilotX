import { describe, expect, test } from "bun:test"
import { join, resolve } from "node:path"
import {
  resolveAgentDataDirectory,
  resolveAgentLogDirectory,
  resolveAgentPetsDirectory,
  resolveAgentStorageLayout,
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

  test("derives every managed directory from the selected data root", () => {
    const dataRoot = resolve("D:/CodePilotXData/.codepilotx")
    const layout = resolveAgentStorageLayout(
      { CODEPILOTX_DATA_DIR: dataRoot },
      resolve("C:/Users/Example"),
    )

    expect(layout).toMatchObject({
      dataRoot,
      userConfig: join(dataRoot, "config.json"),
      hooksFile: join(dataRoot, "hooks.json"),
      skillsRoot: join(dataRoot, "skills"),
      attachmentsRoot: join(dataRoot, "attachments"),
      petsRoot: join(dataRoot, "pets"),
      toolingRoot: join(dataRoot, "tooling"),
      workspacesRoot: join(dataRoot, "workspaces"),
      logsRoot: join(dataRoot, "logs"),
    })
  })
})
