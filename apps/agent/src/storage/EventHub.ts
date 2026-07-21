import { PubSub, Effect } from "effect"
import type { EventEnvelope } from "../domain"

export class EventHub {
  private readonly pubsub: PubSub.PubSub<EventEnvelope>
  private readonly listeners = new Set<(event: EventEnvelope) => void>()

  private constructor(pubsub: PubSub.PubSub<EventEnvelope>) {
    this.pubsub = pubsub
  }

  static make = Effect.gen(function* () {
    return new EventHub(yield* PubSub.unbounded<EventEnvelope>())
  })

  publish(event: EventEnvelope) {
    for (const listener of this.listeners) {
      try { listener(event) } catch { /* one SSE consumer must not block publication */ }
    }
    return PubSub.publish(this.pubsub, event)
  }

  subscribe() {
    return PubSub.subscribe(this.pubsub)
  }

  /**
   * Promise/HTTP adapters cannot safely retain an Effect scoped Dequeue for
   * the lifetime of an SSE response. This listener API preserves the same
   * fan-out while making subscription-before-replay ordering explicit.
   */
  listen(listener: (event: EventEnvelope) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
