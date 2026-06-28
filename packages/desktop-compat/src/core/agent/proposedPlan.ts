const OPEN_TAG = '<proposed_plan>'
const CLOSE_TAG = '</proposed_plan>'

export type ProposedPlanParseResult = {
  visibleText: string
  planText: string | null
  hasOpenPlan: boolean
  isComplete: boolean
}

export function extractLatestProposedPlanText(text: string): string | null {
  let latest: string | null = null
  let searchFrom = 0

  while (searchFrom < text.length) {
    const openIndex = text.indexOf(OPEN_TAG, searchFrom)
    if (openIndex === -1) break

    const planStart = openIndex + OPEN_TAG.length
    const closeIndex = text.indexOf(CLOSE_TAG, planStart)
    if (closeIndex === -1) break

    latest = trimPlanText(text.slice(planStart, closeIndex))
    searchFrom = closeIndex + CLOSE_TAG.length
  }

  return latest
}

export function stripProposedPlanBlocks(text: string): string {
  let output = ''
  let searchFrom = 0

  while (searchFrom < text.length) {
    const openIndex = text.indexOf(OPEN_TAG, searchFrom)
    if (openIndex === -1) {
      output += text.slice(searchFrom)
      break
    }

    output += text.slice(searchFrom, openIndex)
    const closeIndex = text.indexOf(CLOSE_TAG, openIndex + OPEN_TAG.length)
    if (closeIndex === -1) break

    searchFrom = closeIndex + CLOSE_TAG.length
  }

  return trimVisibleText(output)
}

export function parseProposedPlanText(text: string): ProposedPlanParseResult {
  const latestCompletePlan = extractLatestProposedPlanText(text)
  const lastOpenIndex = text.lastIndexOf(OPEN_TAG)
  const lastCloseIndex = text.lastIndexOf(CLOSE_TAG)
  const hasOpenPlan = lastOpenIndex !== -1 && lastOpenIndex > lastCloseIndex

  if (hasOpenPlan) {
    return {
      visibleText: trimVisibleText(text.slice(0, lastOpenIndex)),
      planText: trimPlanText(text.slice(lastOpenIndex + OPEN_TAG.length)),
      hasOpenPlan: true,
      isComplete: false,
    }
  }

  return {
    visibleText: stripProposedPlanBlocks(text),
    planText: latestCompletePlan,
    hasOpenPlan: false,
    isComplete: latestCompletePlan !== null,
  }
}

function trimPlanText(text: string): string {
  return text.replace(/^\s+|\s+$/g, '')
}

function trimVisibleText(text: string): string {
  return text.replace(/(?:[ \t]*\r?\n){2,}/g, '\n').trim()
}
