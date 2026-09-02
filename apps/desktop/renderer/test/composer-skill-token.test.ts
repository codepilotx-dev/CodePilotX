import { describe, expect, test } from 'bun:test'
import {
  composerDocumentFromProseMirrorDocument,
  composerDocumentToProseMirrorDocument,
  composerSchema,
} from '../src/features/session/composer/ComposerEditor.js'
import {
  createComposerDocumentWithSkill,
  skillInvocationFromComposerDocument,
} from '../src/features/session/composer/composerSkillToken.js'

describe('composer skill inline token', () => {
  test('将单个 Skill 序列化为不进入消息文本的 ProseMirror 原子节点', () => {
    const document = createComposerDocumentWithSkill('检查当前改动', {
      name: 'builtin-helper',
      path: 'builtin://builtin-helper/SKILL.md',
    })

    const proseMirrorDocument = composerDocumentToProseMirrorDocument(document)
    const token = proseMirrorDocument.firstChild?.firstChild

    expect(token?.type).toBe(composerSchema.nodes.skill_token)
    expect(token?.isAtom).toBe(true)
    expect(proseMirrorDocument.textContent).toBe('检查当前改动')
    expect(composerDocumentFromProseMirrorDocument(proseMirrorDocument)).toEqual(
      document,
    )
  })

  test('从编辑器文档只解析一个 Skill 调用', () => {
    const document = createComposerDocumentWithSkill('规划登录流程', {
      name: 'builtin-helper',
      path: 'builtin://builtin-helper/SKILL.md',
    })

    expect(skillInvocationFromComposerDocument(document)).toEqual({
      name: 'builtin-helper',
      path: 'builtin://builtin-helper/SKILL.md',
    })
  })

  test('往返保留多个上下文 token 的顺序和正文位置', () => {
    const document = {
      text: '检查这里',
      tokens: [
        {
          id: 'skill-1',
          kind: 'skill' as const,
          name: 'review',
          label: 'review',
          value: 'skills/review',
          from: 0,
          to: 0,
        },
        {
          id: 'thread-1',
          kind: 'thread' as const,
          label: '任务：登录修复',
          value: 'codepilotx://threads/thread-1',
          from: 2,
          to: 2,
        },
        {
          id: 'browser-1',
          kind: 'browser' as const,
          label: '网页：文档',
          value: 'https://example.com/docs',
          from: 2,
          to: 2,
        },
      ],
    }

    const proseMirrorDocument = composerDocumentToProseMirrorDocument(document)
    expect(composerDocumentFromProseMirrorDocument(proseMirrorDocument)).toEqual(document)
  })
})
