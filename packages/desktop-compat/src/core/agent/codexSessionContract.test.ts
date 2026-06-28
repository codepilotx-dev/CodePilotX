import { expect, test } from 'bun:test'
import {
  DEFAULT_CODEX_COLLABORATION_MODE,
  PLAN_CODEX_COLLABORATION_MODE,
  collaborationModeFromPlanModeActive,
  isPlanCollaborationMode,
  normalizeCodexCollaborationMode,
  planModeActiveFromCollaborationMode,
} from './codexSessionContract.js'

test('normalizes Codex collaboration mode values', () => {
  expect(normalizeCodexCollaborationMode(undefined)).toEqual(
    DEFAULT_CODEX_COLLABORATION_MODE,
  )
  expect(normalizeCodexCollaborationMode({ mode: 'plan' })).toEqual(
    PLAN_CODEX_COLLABORATION_MODE,
  )
  expect(normalizeCodexCollaborationMode({ mode: 'default' })).toEqual(
    DEFAULT_CODEX_COLLABORATION_MODE,
  )
  expect(normalizeCodexCollaborationMode({ mode: 'unknown' })).toEqual(
    DEFAULT_CODEX_COLLABORATION_MODE,
  )
})

test('derives legacy plan mode boolean from Codex collaboration mode', () => {
  expect(planModeActiveFromCollaborationMode({ mode: 'plan' })).toBe(true)
  expect(planModeActiveFromCollaborationMode({ mode: 'default' })).toBe(false)
  expect(isPlanCollaborationMode({ mode: 'plan' })).toBe(true)
  expect(isPlanCollaborationMode(undefined)).toBe(false)
})

test('creates Codex collaboration mode from legacy plan mode boolean', () => {
  expect(collaborationModeFromPlanModeActive(true)).toEqual(
    PLAN_CODEX_COLLABORATION_MODE,
  )
  expect(collaborationModeFromPlanModeActive(false)).toEqual(
    DEFAULT_CODEX_COLLABORATION_MODE,
  )
})
