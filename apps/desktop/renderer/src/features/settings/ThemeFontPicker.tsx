import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import { Input } from '../../components/ui/Input.js'
import type {
  DesktopSystemFontFace,
  DesktopThemeFontFace,
} from '../../../shared/types.js'
import {
  isMonospaceFamily,
  listSystemFonts,
} from '../theme/themeSystemFonts.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import {
  DEFAULT_FACE_VALUE,
  LOADING_OPTION_VALUE,
  SYSTEM_DEFAULT_FAMILY_VALUE,
  buildFamilyOptions,
  buildStyleOptions,
  facesOfFamily,
  fontPatchForSelection,
  fontPickerCurrentFamilyLabel,
  fontPickerCurrentFamilyValue,
  selectedStyleValue,
  type FontPickerKind,
  type FontPickerOption,
} from './themeFontPickerModel.js'

type ThemeFontPickerProps = {
  ariaLabel: string
  placeholder: string
  family: string | null
  face: DesktopThemeFontFace | null
  kind: FontPickerKind
  onCommit: (family: string | null, face: DesktopThemeFontFace | null) => void
}

/**
 * Free-text fallback used when the system font enumeration is unavailable or
 * denied. Committing an unchanged family keeps the stored face; editing the
 * family text clears it so a stale face never rides along.
 */
function FontInput({
  ariaLabel,
  placeholder,
  value,
  onCommit,
}: {
  ariaLabel: string
  placeholder: string
  value: string | null
  onCommit: (value: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? '')
  const focusedRef = useRef(false)
  const skipBlurCommitRef = useRef(false)
  const latestValueRef = useRef(value)

  useEffect(() => {
    latestValueRef.current = value
    if (!focusedRef.current) setDraft(value ?? '')
  }, [value])

  const commit = (): void => {
    const next = draft.trim() || null
    setDraft(next ?? '')
    if (next !== latestValueRef.current) {
      latestValueRef.current = next
      // Editing the family text means the old face no longer matches.
      onCommit(next)
    }
  }

  return (
    <Input
      aria-label={ariaLabel}
      className="appearance-font-input"
      placeholder={placeholder}
      value={draft}
      onBlur={() => {
        focusedRef.current = false
        if (skipBlurCommitRef.current) {
          skipBlurCommitRef.current = false
          return
        }
        commit()
      }}
      onChange={event => setDraft(event.target.value)}
      onFocus={() => {
        focusedRef.current = true
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          skipBlurCommitRef.current = true
          setDraft(latestValueRef.current ?? '')
          event.currentTarget.blur()
        }
      }}
    />
  )
}

export function ThemeFontPicker({
  ariaLabel,
  placeholder,
  family,
  face,
  kind,
  onCommit,
}: ThemeFontPickerProps): React.ReactNode {
  const [bridgeAvailable] = useState(
    () =>
      typeof window !== 'undefined'
      && typeof window.codePilotXDesktop?.listSystemFonts === 'function',
  )
  const [fontsState, setFontsState] = useState<
    'idle' | 'loading' | 'ready' | 'unavailable'
  >('idle')
  const [faces, setFaces] = useState<readonly DesktopSystemFontFace[]>([])

  const handleOpenChange = useCallback(
    (open: boolean): void => {
      if (!open || fontsState !== 'idle') return
      setFontsState('loading')
      void listSystemFonts().then(result => {
        if (result.ok) {
          setFaces(result.fonts)
          setFontsState('ready')
        } else {
          // Unsupported API, denied permission, or failed query: the UI
          // degrades to the free-text input without surfacing an error.
          setFontsState('unavailable')
        }
      })
    },
    [fontsState],
  )

  if (!bridgeAvailable || fontsState === 'unavailable') {
    return (
      <FontInput
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        value={family}
        onCommit={next => onCommit(next, null)}
      />
    )
  }

  const currentFamilyValue = fontPickerCurrentFamilyValue(family)
  const currentFamilyLabel = fontPickerCurrentFamilyLabel(family, face)
  const selectedFamilyFaces = family
    ? facesOfFamily(faces, family)
    : []

  const familyOptions: FontPickerOption[] =
    fontsState === 'ready'
      ? buildFamilyOptions({
          faces,
          kind,
          currentFamily: family,
          isMonospace: isMonospaceFamily,
        })
      : [
          {
            value: currentFamilyValue,
            label: currentFamilyLabel,
            disabled: true,
          },
          ...(fontsState === 'loading'
            ? [{
                value: LOADING_OPTION_VALUE,
                label: '正在加载字体…',
                disabled: true,
              }]
            : []),
        ]

  return (
    <div
      aria-busy={fontsState === 'loading'}
      className="appearance-theme-font-row"
    >
      <SettingsDropdown
        ariaLabel={`${ariaLabel}字体家族`}
        options={familyOptions}
        searchPlaceholder="搜索字体…"
        searchable
        triggerClassName="appearance-font-family"
        value={currentFamilyValue}
        width={240}
        maxWidth="min(320px, calc(100vw - 16px))"
        onChange={familyValue => {
          if (fontsState !== 'ready') return
          if (familyValue === family) {
            // Re-selecting the current family keeps the stored face.
            onCommit(family, face)
            return
          }
          const patch = fontPatchForSelection({
            familyValue,
            faceValue: DEFAULT_FACE_VALUE,
            familyFaces: facesOfFamily(faces, familyValue),
            currentFace: null,
          })
          onCommit(patch.family, patch.face)
        }}
        onOpenChange={handleOpenChange}
      />
      {family != null ? (
        <SettingsDropdown
          ariaLabel={`${ariaLabel}字体样式`}
          disabled={
            fontsState === 'ready' && selectedFamilyFaces.length <= 1
          }
          options={buildStyleOptions({
            faces: selectedFamilyFaces,
            currentFace: face,
          })}
          triggerClassName="appearance-font-style"
          value={selectedStyleValue({
            faces: selectedFamilyFaces,
            currentFace: face,
          })}
          width={80}
          onOpenChange={handleOpenChange}
          onChange={faceValue => {
            if (fontsState !== 'ready') return
            const patch = fontPatchForSelection({
              familyValue: family,
              faceValue,
              familyFaces: selectedFamilyFaces,
              currentFace: face,
            })
            onCommit(patch.family, patch.face)
          }}
        />
      ) : null}
    </div>
  )
}
