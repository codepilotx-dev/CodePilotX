import React, { isValidElement, Suspense, type ReactElement } from 'react'
import { expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import type { RightDockPanelContext } from './rightDockTools.js'
import {
  createRightDockPanelRenderers,
  rightDockPanelRenderers,
  type RightDockPanelLoaders,
} from './rightDockPanelRenderers.js'

test('keeps every right dock tool mapped', () => {
  expect(Object.keys(rightDockPanelRenderers).sort()).toEqual([
    'browser',
    'dialogDebug',
    'files',
    'performanceDiagnostics',
    'plan',
    'review',
    'sideChat',
    'terminal',
    'toolProbe',
  ])
})

test('does not load a closed heavy panel and renders selected review with fallback and props', () => {
  let reviewLoads = 0
  const never = new Promise<never>(() => {})
  const loaders = {
    review: () => {
      reviewLoads += 1
      return never
    },
    browser: () => never,
    toolProbe: () => never,
    dialogDebug: () => never,
    performanceDiagnostics: () => never,
  } as unknown as RightDockPanelLoaders
  const fallback = <span>加载审查</span>
  const renderers = createRightDockPanelRenderers(loaders, fallback)

  expect(reviewLoads).toBe(0)

  const context = {
    review: { activeSessionId: 'session-1' },
    flags: { debugMode: true },
  } as RightDockPanelContext
  const panel = renderers.review(context)

  expect(isValidElement(panel)).toBe(true)
  const suspense = panel as ReactElement<{
    fallback: React.ReactNode
    children: ReactElement<Record<string, unknown>>
  }>
  expect(suspense.type).toBe(Suspense)
  expect(suspense.props.fallback).toBe(fallback)
  expect(suspense.props.children.props.activeSessionId).toBe('session-1')
  expect(suspense.props.children.props.debugMode).toBe(true)
  expect(reviewLoads).toBe(0)

  expect(renderToString(panel)).toContain('加载审查')
  expect(reviewLoads).toBe(1)
})

test('browser renderer shows an accessible loading state without loading the panel when state is null', () => {
  let browserLoads = 0
  const never = new Promise<never>(() => {})
  const loaders = {
    review: () => never,
    browser: () => { browserLoads += 1; return never },
    toolProbe: () => never,
    dialogDebug: () => never,
    performanceDiagnostics: () => never,
  } as unknown as RightDockPanelLoaders
  const renderers = createRightDockPanelRenderers(loaders)
  const panel = renderers.browser({ browser: { state: null } } as RightDockPanelContext)

  expect(renderToString(panel)).toContain('浏览器正在启动')
  expect(browserLoads).toBe(0)
})

test('browser renderer loads the panel and forwards state after it arrives', () => {
  let browserLoads = 0
  const never = new Promise<never>(() => {})
  const loaders = {
    review: () => never,
    browser: () => { browserLoads += 1; return never },
    toolProbe: () => never,
    dialogDebug: () => never,
    performanceDiagnostics: () => never,
  } as unknown as RightDockPanelLoaders
  const renderers = createRightDockPanelRenderers(loaders, <span>加载浏览器</span>)
  const state = { open: true, url: 'https://example.com' }
  const panel = renderers.browser({ browser: { state } } as RightDockPanelContext) as ReactElement<{ children: ReactElement<Record<string, unknown>> }>

  expect(panel.props.children.props.state).toBe(state)
  expect(renderToString(panel)).toContain('加载浏览器')
  expect(browserLoads).toBe(1)
})
