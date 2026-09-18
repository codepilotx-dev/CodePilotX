import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SmoothScroll } from '../src/components/ui/SmoothScroll.js'
import {
  ScrollProgress,
  ScrollProgressBar,
  ScrollProgressCircle,
} from '../src/components/ui/ScrollProgress.js'

describe('ScrollProgress component', () => {
  test('renders default top fixed progress bar', () => {
    const html = renderToStaticMarkup(<ScrollProgress />)

    expect(html).toContain('scroll-progress-bar')
    expect(html).toContain('scroll-progress-bar--fixed')
    expect(html).toContain('scroll-progress-bar--top')
    expect(html).toContain('aria-hidden="true"')
  })

  test('renders sticky progress bar when position is sticky', () => {
    const html = renderToStaticMarkup(
      <ScrollProgressBar position="sticky" height={3} className="custom-bar" />,
    )

    expect(html).toContain('scroll-progress-bar')
    expect(html).toContain('scroll-progress-bar--sticky')
    expect(html).toContain('custom-bar')
  })

  test('renders absolute bottom progress bar when fixed is false and position is bottom', () => {
    const html = renderToStaticMarkup(
      <ScrollProgress fixed={false} position="bottom" />,
    )

    expect(html).toContain('scroll-progress-bar')
    expect(html).toContain('scroll-progress-bar--absolute')
    expect(html).toContain('scroll-progress-bar--bottom')
  })

  test('renders circular progress indicator with track and indicator circles', () => {
    const html = renderToStaticMarkup(
      <ScrollProgress variant="circle" size={48} thickness={4} className="custom-circle" />,
    )

    expect(html).toContain('<svg')
    expect(html).toContain('scroll-progress-circle')
    expect(html).toContain('custom-circle')
    expect(html).toContain('scroll-progress-circle__track')
    expect(html).toContain('scroll-progress-circle__indicator')
    expect(html).toContain('width="48"')
    expect(html).toContain('height="48"')
  })

  test('composes seamlessly inside SmoothScroll container', () => {
    const html = renderToStaticMarkup(
      <SmoothScroll root={false}>
        <ScrollProgress position="sticky" height={2} />
        <div>Article content</div>
      </SmoothScroll>,
    )

    expect(html).toContain('scroll-area')
    expect(html).toContain('smooth-scroll')
    expect(html).toContain('scroll-progress-bar')
    expect(html).toContain('scroll-progress-bar--sticky')
    expect(html).toContain('Article content')
  })
})
