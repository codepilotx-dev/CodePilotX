export interface FeedbackSurveyResponse {
  rating: number
  feedback: string
  categories: string[]
  submitted: boolean
}

export function shouldShowSurvey(): boolean { return false }
export function getSurveyData(): Record<string, unknown> { return {} }
