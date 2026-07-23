import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PetService } from "../src/pet/PetService"

const originalFetch = globalThis.fetch
const temporaryDirectories: string[] = []

afterEach(async () => {
  globalThis.fetch = originalFetch
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe("PetService", () => {
  test("previews, installs, lists and serves a v2 package", async () => {
    const root = await temporaryRoot()
    const atlas = fakePng(1536, 2288)
    globalThis.fetch = mockFetch({
      "https://example.com/pets/whale/pet.json": new Response(
        JSON.stringify({
          id: "little-whale",
          displayName: "Little Whale",
          description: "A small task companion",
          spriteVersionNumber: 2,
          spritesheetPath: "spritesheet.png",
        }),
      ),
      "https://example.com/pets/whale/spritesheet.png": new Response(atlas, {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(atlas.byteLength),
        },
      }),
    })
    const service = new PetService(root)

    const preview = await service.preview(
      "https://example.com/pets/whale/pet.json",
    )
    expect(preview.pet).toMatchObject({
      id: "little-whale",
      spriteVersionNumber: 2,
      installed: false,
    })

    const installed = await service.install(
      "https://example.com/pets/whale/pet.json",
    )
    expect(installed.installed).toBe(true)
    expect(await service.list()).toHaveLength(1)
    const asset = await service.spritesheet("little-whale")
    expect(asset.contentType).toBe("image/png")
    expect(asset.bytes.byteLength).toBe(atlas.byteLength)

    await service.remove("little-whale")
    expect(await service.list()).toEqual([])
  })

  test("rejects redirects and atlas dimensions that do not match the version", async () => {
    const root = await temporaryRoot()
    globalThis.fetch = mockFetch({
      "https://example.com/redirect.json": new Response(null, {
        status: 302,
        headers: { Location: "https://example.com/pet.json" },
      }),
    })
    const service = new PetService(root)
    await expect(
      service.preview("https://example.com/redirect.json"),
    ).rejects.toThrow("不允许重定向")

    const atlas = fakePng(1536, 1872)
    globalThis.fetch = mockFetch({
      "https://example.com/pet.json": new Response(
        JSON.stringify({
          id: "wrong-size",
          displayName: "Wrong Size",
          spriteVersionNumber: 2,
          spritesheetPath: "spritesheet.png",
        }),
      ),
      "https://example.com/spritesheet.png": new Response(atlas, {
        headers: { "Content-Type": "image/png" },
      }),
    })
    await expect(
      service.preview("https://example.com/pet.json"),
    ).rejects.toThrow("1536x2288")
  })
})

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "codepilotx-pets-"))
  temporaryDirectories.push(directory)
  return directory
}

function fakePng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function mockFetch(
  responses: Record<string, Response>,
): typeof fetch {
  return (async input => {
    const url = typeof input === "string" ? input : input.toString()
    const response = responses[url]
    if (!response) throw new Error(`Unexpected URL: ${url}`)
    return response.clone()
  }) as typeof fetch
}
