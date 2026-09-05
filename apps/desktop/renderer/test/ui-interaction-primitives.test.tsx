import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from '../src/components/ui/Button.js'
import { Spinner } from '../src/components/ui/Spinner.js'

describe('loading interaction primitives', () => {
  test('keeps an unlabeled spinner decorative', () => {
    const html = renderToStaticMarkup(<Spinner />)

    expect(html).toContain('class="ui-spinner"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('role="status"')
  })

  test('button loading exposes busy and disabled state once', () => {
    const html = renderToStaticMarkup(<Button loading>保存</Button>)

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('ui-button-spinner')
    expect((html.match(/ui-spinner/g) ?? []).length).toBe(1)
  })
})
