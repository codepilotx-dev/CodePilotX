import { describe, expect, test } from 'bun:test'
import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  SmoothScroll,
  ScrollTopButton,
  useSmoothScroll,
} from '../src/components/ui/SmoothScroll.js'

function Consumer(): React.ReactNode {
  const { progress, scrollY, velocity, scrollTo } = useSmoothScroll()
  return (
    <div data-testid="consumer">
      <span>{typeof scrollTo === 'function' ? 'has-scrollTo' : 'no-scrollTo'}</span>
      <span>{progress ? 'has-progress' : 'no-progress'}</span>
      <span>{scrollY ? 'has-scrollY' : 'no-scrollY'}</span>
      <span>{velocity ? 'has-velocity' : 'no-velocity'}</span>
    </div>
  )
}

describe('SmoothScroll component & useSmoothScroll hook', () => {
  test('renders contained smooth-scroll container with scroll-area classes', () => {
    const html = renderToStaticMarkup(
      <SmoothScroll root={false} className="test-custom-scroll">
        <p>Content item</p>
      </SmoothScroll>,
    )

    expect(html).toContain('scroll-area')
    expect(html).toContain('smooth-scroll')
    expect(html).toContain('smooth-scroll--contained')
    expect(html).toContain('test-custom-scroll')
    expect(html).toContain('Content item')
  })

  test('renders children directly when root is true for window-level smooth scrolling', () => {
    const html = renderToStaticMarkup(
      <SmoothScroll root={true}>
        <div>Page content</div>
      </SmoothScroll>,
    )

    expect(html).toContain('Page content')
  })

  test('provides smooth scroll context to children consumers', () => {
    const html = renderToStaticMarkup(
      <SmoothScroll root={false}>
        <Consumer />
      </SmoothScroll>,
    )

    expect(html).toContain('has-scrollTo')
    expect(html).toContain('has-progress')
    expect(html).toContain('has-scrollY')
    expect(html).toContain('has-velocity')
  })

  test('falls back gracefully when useSmoothScroll is used outside provider', () => {
    const html = renderToStaticMarkup(<Consumer />)

    expect(html).toContain('has-scrollTo')
    expect(html).toContain('has-progress')
    expect(html).toContain('has-scrollY')
    expect(html).toContain('has-velocity')
  })

  test('renders ScrollTopButton with accessible title and icon button classes', () => {
    const html = renderToStaticMarkup(
      <SmoothScroll root={false}>
        <ScrollTopButton title="回到顶部" />
      </SmoothScroll>,
    )

    expect(html).toContain('scroll-top-button')
    expect(html).toContain('icon-button')
    expect(html).toContain('aria-label="回到顶部"')
    expect(html).toContain('title="回到顶部"')
  })
})
