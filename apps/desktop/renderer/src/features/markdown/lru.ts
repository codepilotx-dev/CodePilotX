export class LruCache<Key, Value> {
  readonly #capacity: number
  readonly #entries = new Map<Key, Value>()

  constructor(capacity: number) {
    this.#capacity = Math.max(1, Math.floor(capacity))
  }

  get(key: Key): Value | undefined {
    const value = this.#entries.get(key)
    if (value === undefined) return undefined
    this.#entries.delete(key)
    this.#entries.set(key, value)
    return value
  }

  set(key: Key, value: Value): void {
    this.#entries.delete(key)
    this.#entries.set(key, value)
    while (this.#entries.size > this.#capacity) {
      const oldestKey = this.#entries.keys().next().value as Key | undefined
      if (oldestKey === undefined) break
      this.#entries.delete(oldestKey)
    }
  }

  clear(): void {
    this.#entries.clear()
  }

  get size(): number {
    return this.#entries.size
  }
}
