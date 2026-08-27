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
})
