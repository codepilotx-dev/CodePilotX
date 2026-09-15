import { describe, expect, test } from "bun:test"
import {
  buildThreadDeepLink,
  parseThreadDeepLink,
  resolveThreadReference,
} from "@codepilotx/shared/thread-reference"

describe("thread-reference deep links", () => {
  test("buildThreadDeepLink encodes spaces, slashes and Unicode and round-trips", () => {
    const ids = [
      "plain-id-123",
      "thread with spaces",
      "dir/sub/thread",
      "会话/你好 world",
      "a?b#c&d=100% loaded",
    ]
    for (const id of ids) {
      expect(buildThreadDeepLink(id)).toBe(`codepilotx://threads/${encodeURIComponent(id)}`)
      expect(parseThreadDeepLink(buildThreadDeepLink(id))).toBe(id)
    }
  })

  test("parseThreadDeepLink rejects a wrong or missing scheme", () => {
    const invalid = [
      "http://threads/abc",
      "https://threads/abc",
      "code-pilot://threads/abc",
      "codepilotx:threads/abc",
      "codepilotx:/threads/abc",
      "//threads/abc",
    ]
    for (const link of invalid) {
      expect(parseThreadDeepLink(link)).toBeNull()
    }
  })

  test("parseThreadDeepLink rejects a wrong host", () => {
    const invalid = [
      "codepilotx://chat/abc",
      "codepilotx://thread/abc",
      "codepilotx://threads.example/abc",
      "codepilotx://Threads/abc",
    ]
    for (const link of invalid) {
      expect(parseThreadDeepLink(link)).toBeNull()
    }
  })

  test("parseThreadDeepLink rejects a port, query, hash, username or password", () => {
    const invalid = [
      "codepilotx://threads:8080/abc",
      "codepilotx://threads/abc?tab=open",
      "codepilotx://threads/abc#section",
      "codepilotx://user@threads/abc",
      "codepilotx://user:pass@threads/abc",
    ]
    for (const link of invalid) {
      expect(parseThreadDeepLink(link)).toBeNull()
    }
  })

  test("parseThreadDeepLink rejects an empty id and extra path segments", () => {
    const invalid = [
      "codepilotx://threads",
      "codepilotx://threads/",
      "codepilotx://threads//",
      "codepilotx://threads/abc/def",
      "codepilotx://threads/abc/",
    ]
    for (const link of invalid) {
      expect(parseThreadDeepLink(link)).toBeNull()
    }
  })

  test("resolveThreadReference resolves raw ids and valid deep links to the same id", () => {
    const raw = "thread with spaces/会话 123"
    expect(resolveThreadReference(raw)).toBe(raw)
    expect(resolveThreadReference(buildThreadDeepLink(raw))).toBe(raw)
    expect(resolveThreadReference("plain-id-456")).toBe("plain-id-456")
    expect(resolveThreadReference(buildThreadDeepLink("plain-id-456"))).toBe("plain-id-456")
  })

  test("resolveThreadReference returns null for empty, whitespace and absent values", () => {
    const invalid = ["", " ", "\t\n  ", null, undefined]
    for (const reference of invalid) {
      expect(resolveThreadReference(reference)).toBeNull()
    }
  })

  test("resolveThreadReference returns null for malformed deep links", () => {
    const invalid = [
      "codepilotx://threads/",
      "codepilotx://threads/abc/extra",
      "codepilotx://threads/abc?tab=open",
      "codepilotx://otherhost/abc",
      "http://threads/abc",
    ]
    for (const link of invalid) {
      expect(resolveThreadReference(link)).toBeNull()
    }
  })
})
