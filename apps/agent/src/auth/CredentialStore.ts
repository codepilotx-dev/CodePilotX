import { Effect } from "effect"
import { AgentError } from "../domain"

const SERVICE = "com.codepilotx.provider"

export class CredentialStore {
  set(providerID: string, apiKey: string) {
    return Effect.tryPromise({
      try: async () => {
        if (!apiKey.trim()) throw new AgentError("INVALID_CREDENTIAL", "API Key 不能为空", 400)
        await Bun.secrets.set({ service: SERVICE, name: providerID, value: apiKey.trim() })
      },
      catch: (cause) => cause instanceof AgentError ? cause : new AgentError("CREDENTIAL_WRITE_FAILED", "无法写入 Windows Credential Manager", 500, cause),
    })
  }

  get(providerID: string) {
    return Effect.tryPromise({
      try: () => Bun.secrets.get({ service: SERVICE, name: providerID }),
      catch: (cause) => new AgentError("CREDENTIAL_READ_FAILED", "无法读取 Provider 凭据", 500, cause),
    })
  }

  remove(providerID: string) {
    return Effect.tryPromise({
      try: () => Bun.secrets.delete({ service: SERVICE, name: providerID }),
      catch: (cause) => new AgentError("CREDENTIAL_DELETE_FAILED", "无法删除 Provider 凭据", 500, cause),
    })
  }
}
