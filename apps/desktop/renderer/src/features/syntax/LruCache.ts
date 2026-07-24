export class LruCache<Key, Value> {
  readonly #entries = new Map<Key, Value>()

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('LRU capacity must be a positive integer.')
    }
  }

  get size(): number {
    return this.#entries.size
  }

  clear(): void {
    this.#entries.clear()
  }

  get(key: Key): Value | undefined {
    const value = this.#entries.get(key)
    if (value === undefined) return undefined

    this.#entries.delete(key)
    this.#entries.set(key, value)
    return value
  }

  peek(key: Key): Value | undefined {
    return this.#entries.get(key)
  }

  set(key: Key, value: Value): void {
    this.#entries.delete(key)
    this.#entries.set(key, value)

    if (this.#entries.size <= this.capacity) return
    const oldestKey = this.#entries.keys().next().value
    if (oldestKey !== undefined) this.#entries.delete(oldestKey)
  }
}
