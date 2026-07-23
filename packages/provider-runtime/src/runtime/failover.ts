import type { Credential, Model } from "@codepilotx/model-schema"
import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3GenerateResult, LanguageModelV3StreamPart, LanguageModelV3StreamResult } from "@ai-sdk/provider"
import type { CredentialCandidate, CredentialOutcome, CredentialPoolSource } from "../types"
import { retryableCredentialError } from "./credential-resolution"

function isVisibleStreamPart(part: LanguageModelV3StreamPart): boolean {
  return part.type !== "stream-start" && part.type !== "response-metadata"
}

export function createFailoverLanguage(input: {
  readonly model: Model.Info
  readonly pool: CredentialPoolSource
  readonly createLanguage: (model: Model.Info, candidate?: CredentialCandidate) => Promise<LanguageModelV3>
}): LanguageModelV3 {
    const { model, pool, createLanguage } = input
    const orderedCandidates = async () => {
      const now = Date.now()
      return [...await pool.candidates(model.providerID)]
        .filter((candidate) => candidate.cooldownUntil === undefined || candidate.cooldownUntil <= now)
        .sort((left, right) => Number(right.active) - Number(left.active) || left.priority - right.priority)
    }
    const report = async (candidate: CredentialCandidate, activeCredentialId: Credential.ID | undefined, result: CredentialOutcome["result"], retry?: number) => {
      await Promise.resolve(pool.report({
        providerID: model.providerID,
        credentialId: candidate.credentialId,
        revision: candidate.revision,
        ...(activeCredentialId ? { activeCredentialId } : {}),
        result,
        ...(retry === undefined ? {} : { retryAfterMs: retry }),
        occurredAt: Date.now(),
      })).catch(() => undefined)
    }
    const generate = async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> => {
      const candidates = await orderedCandidates()
      if (candidates.length === 0) return createLanguage(model).then((language) => language.doGenerate(options))
      const activeCredentialId = candidates.find((candidate) => candidate.active)?.credentialId
      let lastError: unknown
      for (const candidate of candidates) {
        try {
          const result = await (await createLanguage(model, candidate)).doGenerate(options)
          await report(candidate, activeCredentialId, "success")
          return result
        } catch (error) {
          const retryable = retryableCredentialError(error, Date.now())
          if (!retryable) throw error
          await report(candidate, activeCredentialId, retryable.result, retryable.retryAfterMs)
          lastError = error
        }
      }
      throw lastError
    }
    const stream = async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> => {
      const candidates = await orderedCandidates()
      if (candidates.length === 0) return (await createLanguage(model)).doStream(options)
      const activeCredentialId = candidates.find((candidate) => candidate.active)?.credentialId
      let index = 0
      let current: { candidate: CredentialCandidate; result: LanguageModelV3StreamResult } | undefined
      let lastError: unknown
      while (index < candidates.length && !current) {
        const candidate = candidates[index++]!
        try {
          current = { candidate, result: await (await createLanguage(model, candidate)).doStream(options) }
        } catch (error) {
          const retryable = retryableCredentialError(error, Date.now())
          if (!retryable) throw error
          await report(candidate, activeCredentialId, retryable.result, retryable.retryAfterMs)
          lastError = error
        }
      }
      if (!current) throw lastError
      const initial = current
      return {
        ...(initial.result.request ? { request: initial.result.request } : {}),
        ...(initial.result.response ? { response: initial.result.response } : {}),
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            void (async () => {
              let attempt: typeof initial | undefined = initial
              let visible = false
              let reportedSuccess = false
              let endedWithError = false
              let buffered: LanguageModelV3StreamPart[] = []
              while (attempt) {
                const reader = attempt.result.stream.getReader()
                let switched = false
                try {
                  while (true) {
                    const item = await reader.read()
                    if (item.done) {
                      if (!reportedSuccess && !endedWithError) await report(attempt.candidate, activeCredentialId, "success")
                      for (const part of buffered) controller.enqueue(part)
                      controller.close()
                      return
                    }
                    const part = item.value
                    const retryable = part.type === "error" ? retryableCredentialError(part.error, Date.now()) : undefined
                    if (retryable) {
                      await report(attempt.candidate, activeCredentialId, retryable.result, retryable.retryAfterMs)
                      if (!visible && index < candidates.length) {
                        await reader.cancel().catch(() => undefined)
                        buffered = []
                        switched = true
                        break
                      }
                    }
                    if (part.type === "error") endedWithError = true
                    if (!visible && !isVisibleStreamPart(part)) {
                      buffered.push(part)
                      continue
                    }
                    if (!visible) {
                      visible = true
                      for (const pending of buffered) controller.enqueue(pending)
                      buffered = []
                    }
                    if (part.type !== "error" && !reportedSuccess) {
                      reportedSuccess = true
                      await report(attempt.candidate, activeCredentialId, "success")
                    }
                    controller.enqueue(part)
                  }
                } catch (error) {
                  const retryable = retryableCredentialError(error, Date.now())
                  if (retryable) await report(attempt.candidate, activeCredentialId, retryable.result, retryable.retryAfterMs)
                  if (!retryable || visible) throw error
                  if (index >= candidates.length) throw error
                  buffered = []
                  switched = true
                } finally {
                  reader.releaseLock()
                }
                if (!switched) return
                attempt = undefined
                while (index < candidates.length && !attempt) {
                  const candidate = candidates[index++]!
                  try {
                    attempt = { candidate, result: await (await createLanguage(model, candidate)).doStream(options) }
                  } catch (error) {
                    const retryable = retryableCredentialError(error, Date.now())
                    if (!retryable) throw error
                    await report(candidate, activeCredentialId, retryable.result, retryable.retryAfterMs)
                    lastError = error
                  }
                }
              }
              throw lastError
            })().catch((error) => controller.error(error))
          },
        }),
      }
    }
    return {
      specificationVersion: "v3",
      provider: String(model.providerID),
      modelId: String(model.api.id),
      supportedUrls: {
        then(onfulfilled, onrejected) {
          return orderedCandidates()
            .then(async (candidates) => await (candidates.length
              ? (await createLanguage(model, candidates[0])).supportedUrls
              : (await createLanguage(model)).supportedUrls))
            .then(onfulfilled, onrejected)
        },
      },
      doGenerate: generate,
      doStream: stream,
    }
}
