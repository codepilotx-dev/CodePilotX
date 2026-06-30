import type * as React from 'react'

export type WizardStepComponent = React.ComponentType<{
  data: Record<string, unknown>
  setData: (data: Record<string, unknown>) => void
  nextStep: () => void
  prevStep: () => void
}>

export interface WizardContextValue {
  currentStep: number
  totalSteps: number
  nextStep: () => void
  prevStep: () => void
  goToStep: (step: number) => void
  data: Record<string, unknown>
  setData: (data: Record<string, unknown>) => void
}

export interface WizardProviderProps {
  children: React.ReactNode
  initialData?: Record<string, unknown>
  onComplete?: (data: Record<string, unknown>) => void
}
