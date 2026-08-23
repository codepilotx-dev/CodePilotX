import { describe, expect, test } from 'bun:test'
import { taskboardLinksWithCurrentThread } from '../src/features/taskboard/components/LinkExistingTaskDialog.js'

describe('LinkExistingTaskDialog', () => {
  test('保留已有会话，首个会话为 primary，后续会话为 supporting', () => {
    expect(taskboardLinksWithCurrentThread({ threads: [] }, 'thread:first')).toEqual([
      { threadId: 'thread:first', role: 'primary' },
    ])

    const links = taskboardLinksWithCurrentThread({
      threads: [
        { threadId: 'thread:primary', role: 'primary' },
        { threadId: 'thread:existing', role: 'supporting' },
      ],
    }, 'thread:new')
    expect(links).toEqual([
      { threadId: 'thread:primary', role: 'primary' },
      { threadId: 'thread:existing', role: 'supporting' },
      { threadId: 'thread:new', role: 'supporting' },
    ])
  })

  test('重复关联时保持原角色且不增加重复项', () => {
    expect(taskboardLinksWithCurrentThread({
      threads: [{ threadId: 'thread:current', role: 'supporting' }],
    }, 'thread:current')).toEqual([
      { threadId: 'thread:current', role: 'supporting' },
    ])
  })
})
