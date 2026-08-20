import type {
  DesktopSystemFontFace,
  DesktopThemeFontFace,
} from '../../../shared/types.js'

/**
 * Pure model for the theme font picker. Keeping the option building and
 * commit mapping here makes system-default, search, face selection, mono
 * filtering, and per-variant persistence testable without a DOM.
 */

export const SYSTEM_DEFAULT_FAMILY_VALUE = '__system_default_family__'
export const DEFAULT_FACE_VALUE = '__default_face__'
export const LOADING_OPTION_VALUE = '__loading_fonts__'

export type FontPickerOption = {
  value: string
  label: string
  detail?: string
  disabled?: boolean
}

export type FontPickerKind = 'ui' | 'code'

export function styleLabel(style: string): string {
  const normalized = style.trim().toLowerCase()
  if (/^(regular|normal)$/.test(normalized)) return '常规'
  if (/^bold\s+italic$/.test(normalized)) return '粗斜体'
  if (normalized === 'bold') return '粗体'
  if (normalized === 'italic') return '斜体'
  if (normalized === 'medium') return '中等'
  if (/^(semi\s*bold|demi\s*bold|semibold)$/.test(normalized)) return '半粗体'
  if (normalized === 'light') return '细体'
  if (normalized === 'thin') return '特细体'
  if (/^(black|heavy)$/.test(normalized)) return '特粗体'
  return style
}

export function isDefaultFaceStyle(style: string): boolean {
  return /^(regular|normal)$/i.test(style.trim())
}

export function facesOfFamily(
  faces: readonly DesktopSystemFontFace[],
  family: string,
): DesktopSystemFontFace[] {
  return faces.filter(face => face.family === family)
}

export function regularFaceOf(
  faces: readonly DesktopSystemFontFace[],
): DesktopSystemFontFace | undefined {
  return faces.find(face => isDefaultFaceStyle(face.style))
}

export function sortedFamilies(
  faces: readonly DesktopSystemFontFace[],
): string[] {
  return [...new Set(faces.map(face => face.family))].sort((left, right) =>
    left.localeCompare(right),
  )
}

export function buildFamilyOptions({
  faces,
  kind,
  currentFamily,
  isMonospace,
}: {
  faces: readonly DesktopSystemFontFace[]
  kind: FontPickerKind
  currentFamily: string | null
  isMonospace: (family: string) => boolean
}): FontPickerOption[] {
  const options: FontPickerOption[] = [
    { value: SYSTEM_DEFAULT_FAMILY_VALUE, label: '系统默认' },
  ]
  const families = sortedFamilies(faces).filter(family =>
    kind === 'ui' || isMonospace(family),
  )
  for (const family of families) {
    options.push({ value: family, label: family })
  }
  // A custom family (CSS list or a font that disappeared from the
  // enumeration) stays visible and selected instead of being silently reset.
  if (
    currentFamily
    && currentFamily !== SYSTEM_DEFAULT_FAMILY_VALUE
    && !families.includes(currentFamily)
  ) {
    options.push({ value: currentFamily, label: currentFamily })
  }
  return options
}

export function buildStyleOptions({
  faces,
  currentFace,
}: {
  faces: readonly DesktopSystemFontFace[]
  currentFace: DesktopThemeFontFace | null
}): FontPickerOption[] {
  const regular = regularFaceOf(faces)
  const regularDisplay = regular
    ? (regular.fullName.trim().toLowerCase() !== regular.family.trim().toLowerCase()
        ? regular.fullName
        : `${regular.family} ${regular.style}`)
    : ''
  const options: FontPickerOption[] = regular
    ? [{
        value: regular.postscriptName,
        label: '常规',
        detail: regularDisplay,
      }]
    : [{ value: DEFAULT_FACE_VALUE, label: '常规' }]
  const seen = new Set<string>()
  if (regular) {
    seen.add(regular.postscriptName)
  }
  for (const face of faces) {
    if (seen.has(face.postscriptName)) continue
    seen.add(face.postscriptName)
    const detail =
      face.fullName.trim().toLowerCase() !== face.family.trim().toLowerCase()
        ? face.fullName
        : `${face.family} ${face.style}`
    options.push({
      value: face.postscriptName,
      label: styleLabel(face.style),
      detail,
    })
  }
  // A stored face that is no longer in the enumeration stays selectable.
  if (
    currentFace
    && !seen.has(currentFace.postscriptName)
    && (!regular || currentFace.postscriptName !== regular.postscriptName)
  ) {
    options.push({
      value: currentFace.postscriptName,
      label: currentFace.fullName,
    })
  }
  return options
}

export function selectedStyleValue({
  faces,
  currentFace,
}: {
  faces: readonly DesktopSystemFontFace[]
  currentFace: DesktopThemeFontFace | null
}): string {
  if (!currentFace) {
    return regularFaceOf(faces)?.postscriptName ?? DEFAULT_FACE_VALUE
  }
  const matching = faces.find(
    face =>
      face.postscriptName === currentFace.postscriptName
      || (currentFace.fullName && face.fullName === currentFace.fullName),
  )
  return matching?.postscriptName ?? currentFace.postscriptName
}

export type FontSelectionPatch = {
  family: string | null
  face: DesktopThemeFontFace | null
}

/**
 * Maps a family + style selection back to the persisted settings. The default
 * face saves family-only (`face: null`); any other face saves the full face.
 */
export function fontPatchForSelection({
  familyValue,
  faceValue,
  familyFaces,
  currentFace,
}: {
  familyValue: string
  faceValue: string
  familyFaces: readonly DesktopSystemFontFace[]
  currentFace: DesktopThemeFontFace | null
}): FontSelectionPatch {
  if (familyValue === SYSTEM_DEFAULT_FAMILY_VALUE) {
    return { family: null, face: null }
  }
  const regular = regularFaceOf(familyFaces)
  if (
    faceValue === DEFAULT_FACE_VALUE
    || (regular && (faceValue === regular.postscriptName || faceValue === regular.fullName))
  ) {
    return { family: familyValue, face: null }
  }
  const selected = familyFaces.find(
    face => face.postscriptName === faceValue || face.fullName === faceValue,
  )
  if (selected) {
    const fullName =
      selected.fullName.trim().toLowerCase() !== selected.family.trim().toLowerCase()
        ? selected.fullName
        : `${selected.family} ${selected.style}`
    return {
      family: familyValue,
      face: {
        family: selected.family,
        fullName,
        postscriptName: selected.postscriptName,
      },
    }
  }
  // Custom face option: preserve the stored face.
  return {
    family: familyValue,
    face: currentFace
      ? {
          family: familyValue,
          fullName: currentFace.fullName,
          postscriptName: currentFace.postscriptName,
        }
      : null,
  }
}

export function fontPickerCurrentFamilyLabel(
  family: string | null,
  face: DesktopThemeFontFace | null,
): string {
  if (family == null) return '系统默认'
  return face?.family ?? family
}

export function fontPickerCurrentFamilyValue(
  family: string | null,
): string {
  return family ?? SYSTEM_DEFAULT_FAMILY_VALUE
}
