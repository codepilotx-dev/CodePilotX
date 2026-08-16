import type { DesktopThemeFontFace } from '../../../shared/types.js'

/**
 * Theme font-face loading tool. A selected local face is registered under a
 * unique alias so the CSS family list can put the alias before the original
 * family; when the face cannot be loaded, CSS falls back to the family
 * automatically without affecting application startup.
 */

export function escapeCssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function themeFontFaceAlias(face: DesktopThemeFontFace): string {
  return `CodePilotX selected ${face.postscriptName}`
}

export function themeFontFaceSource(face: DesktopThemeFontFace): string {
  return (
    `local("${escapeCssString(face.postscriptName)}"), ` +
    `local("${escapeCssString(face.fullName)}")`
  )
}

/**
 * CSS font-family value with the registered alias placed before the original
 * family list. Returns the plain fallback when no face is selected.
 */
export function fontFamilyWithFace(
  face: DesktopThemeFontFace | null | undefined,
  fallback: string,
): string {
  if (!face) return fallback
  return `"${themeFontFaceAlias(face)}", ${fallback}`
}

const registeredFaces = new Map<string, Promise<FontFace | null>>()

export function loadThemeFontFace(
  face: DesktopThemeFontFace,
): Promise<FontFace | null> {
  if (
    typeof document === 'undefined'
    || typeof FontFace !== 'function'
    || !document.fonts
  ) {
    return Promise.resolve(null)
  }
  const alias = themeFontFaceAlias(face)
  const existing = registeredFaces.get(alias)
  if (existing) return existing
  const pending = new FontFace(alias, themeFontFaceSource(face))
    .load()
    .then(fontFace => {
      document.fonts.add(fontFace)
      return fontFace
    })
    .catch(() => null)
  registeredFaces.set(alias, pending)
  return pending
}
