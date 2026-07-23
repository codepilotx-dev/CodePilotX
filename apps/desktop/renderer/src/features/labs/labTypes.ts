import type React from 'react'

export type LabCategory =
  | 'assistant'
  | 'artifacts'
  | 'developer'
  | 'shell'
  | 'system'

export type CodexStyleEvidence = {
  confidence: 'confirmed' | 'inferred'
  sourceChunks: string[]
  selectors: string[]
  themeTokens: string[]
  dataAttributes: string[]
  runtimeVariables: string[]
  platformVariants: string[]
}

export type LabDemoDefinition = {
  id: string
  title: string
  description: string
  category: LabCategory
  status: 'visual-prototype'
  load: () => Promise<{ default: React.ComponentType }>
  evidence: CodexStyleEvidence
}
