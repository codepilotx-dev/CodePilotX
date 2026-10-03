import type {
  ComposerDocument,
  ComposerDocumentToken,
  ComposerSkillInvocation,
} from './composerTypes.js'
import { BUILTIN_SKILL_PRESENTATIONS } from '../../plugins/builtinSkillPresentation.js'

/**
 * Skills are represented as one inline atom at the start of the Composer
 * document. The message text intentionally remains token-free so the
 * existing submit wire format stays unchanged.
 */
export function createComposerDocumentWithSkill(
  text: string,
  skillInvocation?: ComposerSkillInvocation | readonly ComposerSkillInvocation[],
): ComposerDocument {
  return {
    text,
    tokens: skillInvocation
      ? (Array.isArray(skillInvocation)
          ? skillInvocation
          : [skillInvocation as ComposerSkillInvocation]
        ).map(createComposerSkillToken)
      : [],
  }
}

export function createComposerSkillToken(skill: ComposerSkillInvocation): ComposerDocumentToken {
  return {
    id: `skill:${skill.name}:${skill.path}`,
    kind: 'skill',
    name: skill.name,
    label: BUILTIN_SKILL_PRESENTATIONS[skill.name]?.label ?? skill.name,
    value: skill.path,
    from: 0,
    to: 0,
  }
}

export function skillInvocationFromComposerToken(
  token: ComposerDocumentToken,
): ComposerSkillInvocation | null {
  const name = token.name ?? token.label
  if (token.kind !== 'skill' || !name || !token.value) return null
  return { name, path: token.value }
}

export function skillInvocationFromComposerDocument(
  document: ComposerDocument,
): ComposerSkillInvocation | null {
  const token = document.tokens.find((candidate) => candidate.kind === 'skill')
  return token ? skillInvocationFromComposerToken(token) : null
}

export function skillInvocationsFromComposerDocument(
  document: ComposerDocument,
): ComposerSkillInvocation[] {
  return document.tokens.flatMap((token) => {
    const skill = skillInvocationFromComposerToken(token)
    return skill ? [skill] : []
  })
}

export function composerDocumentsEqual(left: ComposerDocument, right: ComposerDocument): boolean {
  if (left.text !== right.text || left.tokens.length !== right.tokens.length) {
    return false
  }
  return left.tokens.every((token, index) => {
    const other = right.tokens[index]
    return (
      token.id === other?.id &&
      token.kind === other.kind &&
      token.name === other.name &&
      token.label === other.label &&
      token.value === other.value &&
      token.from === other.from &&
      token.to === other.to
    )
  })
}
