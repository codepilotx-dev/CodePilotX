import { expect, test } from 'bun:test'
import {
  DEFAULT_CODEPILOTX_COLLABORATION_MODE,
  PLAN_CODEPILOTX_COLLABORATION_MODE,
  collaborationModeFromPlanModeActive,
  isPlanCollaborationMode,
  normalizeCodePilotXCollaborationMode,
  planModeActiveFromCollaborationMode,
} from './codepilotxSessionContract.js'

test('normalizes CodePilotX collaboration mode values', () => {
  expect(normalizeCodePilotXCollaborationMode(undefined)).toEqual(
    DEFAULT_CODEPILOTX_COLLABORATION_MODE,
  )
  expect(normalizeCodePilotXCollaborationMode({ mode: 'plan' })).toEqual(
    PLAN_CODEPILOTX_COLLABORATION_MODE,
  )
  expect(normalizeCodePilotXCollaborationMode({ mode: 'default' })).toEqual(
    DEFAULT_CODEPILOTX_COLLABORATION_MODE,
  )
  expect(normalizeCodePilotXCollaborationMode({ mode: 'unknown' })).toEqual(
    DEFAULT_CODEPILOTX_COLLABORATION_MODE,
  )
})

test('derives legacy plan mode boolean from CodePilotX collaboration mode', () => {
  expect(planModeActiveFromCollaborationMode({ mode: 'plan' })).toBe(true)
  expect(planModeActiveFromCollaborationMode({ mode: 'default' })).toBe(false)
  expect(isPlanCollaborationMode({ mode: 'plan' })).toBe(true)
  expect(isPlanCollaborationMode(undefined)).toBe(false)
})

test('creates CodePilotX collaboration mode from legacy plan mode boolean', () => {
  expect(collaborationModeFromPlanModeActive(true)).toEqual(
    PLAN_CODEPILOTX_COLLABORATION_MODE,
  )
  expect(collaborationModeFromPlanModeActive(false)).toEqual(
    DEFAULT_CODEPILOTX_COLLABORATION_MODE,
  )
})
