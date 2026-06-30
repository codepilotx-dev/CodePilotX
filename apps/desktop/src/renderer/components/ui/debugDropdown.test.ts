import { expect, test } from 'bun:test'
import { preventOutsideDismissWhenDebug } from './debugDropdown.js'

test('preventOutsideDismissWhenDebug prevents dismissal while debug mode is enabled', () => {
  let prevented = false

  preventOutsideDismissWhenDebug(true, {
    preventDefault: () => {
      prevented = true
    },
  })

  expect(prevented).toBe(true)
})

test('preventOutsideDismissWhenDebug leaves dismissal alone while debug mode is disabled', () => {
  let prevented = false

  preventOutsideDismissWhenDebug(false, {
    preventDefault: () => {
      prevented = true
    },
  })

  expect(prevented).toBe(false)
})
