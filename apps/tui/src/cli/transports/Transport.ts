export interface Transport {
  connect(): Promise<void>
  disconnect(): Promise<void>
  send(message: unknown): Promise<void>
  onMessage(handler: (message: unknown) => void): void
  isConnected(): boolean
}

export interface TransportOptions {
  url?: string
  timeout?: number
  headers?: Record<string, string>
}
