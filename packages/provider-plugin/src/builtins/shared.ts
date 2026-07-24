export interface BuiltinFetch {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export interface BuiltinClock {
  readonly now: () => number
  readonly sleep: (milliseconds: number) => Promise<void>
}

export const defaultBuiltinClock: BuiltinClock = {
  now: Date.now,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}

export const baseURL = (value: string) => value.replace(/\/+$/, "")

export async function requestJSON<A>(
  fetch: BuiltinFetch,
  url: string,
  init: RequestInit,
  operation: string,
): Promise<A> {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`${operation} failed: ${response.status}`)
  return response.json() as Promise<A>
}
