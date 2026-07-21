import { describe, expect, test } from "bun:test"
import {
  resolveFileIconName,
  resolveFolderIconName,
} from "../src/resolve"

describe("file icon resolution", () => {
  test("uses filename and parent-directory associations first", () => {
    expect(resolveFileIconName("PACKAGE.JSON")).toBe("nodejs")
    expect(
      resolveFileIconName("graphqlrc", { parentDirectory: ".CONFIG" }),
    ).toBe("graphql")
    expect(resolveFileIconName("src\\BASHLY-STRINGS.YML")).toBe(
      "bashly-strings",
    )
  })

  test("uses the longest compound extension before language", () => {
    expect(
      resolveFileIconName("models.generated.D.TS", { languageId: "json" }),
    ).toBe("typescript-def")
    expect(resolveFileIconName("model.SCHEMA.JSON")).toBe("json_schema")
    expect(
      resolveFileIconName("unknown.extension", { language: "typescript" }),
    ).toBe("typescript")
  })
})

describe("folder icon resolution", () => {
  test("supports Windows paths, expanded folders, and root defaults", () => {
    expect(resolveFolderIconName("C:\\repo\\SRC")).toBe("folder-src")
    expect(
      resolveFolderIconName(".GITHUB\\WORKFLOWS", { expanded: true }),
    ).toBe("folder-gh-workflows-open")
    expect(resolveFolderIconName("repo", { root: true })).toBe("folder-root")
    expect(
      resolveFolderIconName("repo", { root: true, expanded: true }),
    ).toBe("folder-root-open")
  })
})
