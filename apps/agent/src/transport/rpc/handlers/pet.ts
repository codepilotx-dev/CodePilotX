import {
  PetInstallParamsSchema,
  PetInstallPreviewParamsSchema,
  PetRemoveParamsSchema,
  type RpcMethod,
} from "@codepilotx/agent-protocol"
import { Schema } from "effect"
import type { RpcRouter } from "../RpcRouter"
import type { RpcRouterContext } from "../request-context"
import type { RpcHandlerGroup } from "./types"

const decodePreview = Schema.decodeUnknownSync(PetInstallPreviewParamsSchema)
const decodeInstall = Schema.decodeUnknownSync(PetInstallParamsSchema)
const decodeRemove = Schema.decodeUnknownSync(PetRemoveParamsSchema)

export const petHandlers = {
  name: "pet",
  methods: ["pet/list", "pet/install/preview", "pet/install", "pet/remove"],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ): Promise<unknown> {
    const pets = runtime.dependencies.pets
    switch (method) {
      case "pet/list":
        return { pets: await pets.list() }
      case "pet/install/preview":
        return pets.preview(decodePreview(rawParams).url)
      case "pet/install":
        return { pet: await pets.install(decodeInstall(rawParams).url) }
      case "pet/remove": {
        const { id } = decodeRemove(rawParams)
        await pets.remove(id)
        return { id, removed: true }
      }
      default:
        return undefined
    }
  },
} as const satisfies RpcHandlerGroup
