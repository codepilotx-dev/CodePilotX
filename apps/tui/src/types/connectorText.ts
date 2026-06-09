export type ConnectorTextBlock = {
  type: 'connector_text'
  text?: string
  source?: unknown
}

export function isConnectorTextBlock(value: unknown): value is ConnectorTextBlock {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'type' in value &&
      (value as { type?: unknown }).type === 'connector_text',
  )
}
