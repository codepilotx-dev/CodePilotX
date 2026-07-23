import type {
  ComposerDocument,
  ComposerDraft,
  ComposerDraftKey,
  ComposerSubmitOutcome,
} from './composerTypes.js'
import { createComposerDocument } from './composerTypes.js'

type CreateClientId = () => string

export class ComposerDraftStore {
  readonly #drafts = new Map<ComposerDraftKey, ComposerDraft>()
  readonly #submitOutcomes = new Map<ComposerDraftKey, ComposerSubmitOutcome>()
  readonly #listeners = new Set<() => void>()
  readonly #createClientId: CreateClientId

  constructor(createClientId: CreateClientId = defaultCreateClientId) {
    this.#createClientId = createClientId
  }

  get(key: ComposerDraftKey): ComposerDraft {
    const existing = this.#drafts.get(key)
    if (existing) return cloneDraft(existing)
    const created = createEmptyComposerDraft(this.#createClientId())
    this.#drafts.set(key, created)
    return cloneDraft(created)
  }

  peek(key: ComposerDraftKey): ComposerDraft | undefined {
    const draft = this.#drafts.get(key)
    return draft ? cloneDraft(draft) : undefined
  }

  set(key: ComposerDraftKey, draft: ComposerDraft): ComposerDraft {
    const next = cloneDraft(draft)
    this.#drafts.set(key, next)
    return cloneDraft(next)
  }

  update(
    key: ComposerDraftKey,
    update: (draft: ComposerDraft) => ComposerDraft,
  ): ComposerDraft {
    return this.set(key, update(this.get(key)))
  }

  /** Move a HOME draft to its newly-created session without changing its id. */
  move(from: ComposerDraftKey, to: ComposerDraftKey): ComposerDraft | undefined {
    const draft = this.#drafts.get(from)
    if (!draft) return undefined
    this.#drafts.delete(from)
    this.#drafts.set(to, draft)
    return cloneDraft(draft)
  }

  clear(key: ComposerDraftKey): ComposerDraft {
    const next = createEmptyComposerDraft(this.#createClientId())
    this.#drafts.set(key, next)
    return cloneDraft(next)
  }

  delete(key: ComposerDraftKey): void {
    this.#drafts.delete(key)
    this.clearSubmitOutcome(key)
  }

  getSubmitOutcome(key: ComposerDraftKey): ComposerSubmitOutcome | null {
    return this.#submitOutcomes.get(key) ?? null
  }

  setSubmitOutcome(key: ComposerDraftKey, outcome: ComposerSubmitOutcome): void {
    this.#submitOutcomes.set(key, outcome)
    this.#emit()
  }

  clearSubmitOutcome(key: ComposerDraftKey): void {
    if (!this.#submitOutcomes.delete(key)) return
    this.#emit()
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #emit(): void {
    for (const listener of this.#listeners) listener()
  }
}

/** Session-memory draft registry shared by every Composer placement. */
export const composerDraftStore = new ComposerDraftStore()

export function createEmptyComposerDraft(clientId: string): ComposerDraft {
  return {
    clientId,
    document: createComposerDocument(),
    attachments: [],
    collaborationMode: 'default',
  }
}

function cloneDocument(document: ComposerDocument): ComposerDocument {
  return {
    text: document.text,
    tokens: document.tokens.map(token => ({ ...token })),
  }
}

export function cloneDraft(draft: ComposerDraft): ComposerDraft {
  return {
    ...draft,
    document: cloneDocument(draft.document),
    attachments: draft.attachments.map(attachment => ({ ...attachment })),
    skillInvocation: draft.skillInvocation
      ? { ...draft.skillInvocation }
      : undefined,
  }
}

function defaultCreateClientId(): string {
  return globalThis.crypto.randomUUID()
}
