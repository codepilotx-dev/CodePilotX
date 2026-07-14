import { PubSub, Effect } from "effect"
import type { EventEnvelope } from "../domain"

export class EventHub {
  private readonly pubsub: PubSub.PubSub<EventEnvelope>

  private constructor(pubsub: PubSub.PubSub<EventEnvelope>) {
    this.pubsub = pubsub
  }

  static make = Effect.gen(function* () {
    return new EventHub(yield* PubSub.unbounded<EventEnvelope>())
  })

  publish(event: EventEnvelope) {
    return PubSub.publish(this.pubsub, event)
  }

  subscribe() {
    return PubSub.subscribe(this.pubsub)
  }
}
