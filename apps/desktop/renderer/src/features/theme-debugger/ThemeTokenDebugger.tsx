import React, {
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  Code2,
  Copy,
  Plus,
  RotateCcw,
  Sliders,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'

import '../../styles/lazy/theme-token-debugger.scss'

import { Button } from '../../components/ui/Button.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { Input } from '../../components/ui/Input.js'
import { SettingsDropdown } from '../settings/SettingsDropdown.js'
import { ComponentPreviewHost } from './ThemeComponentPreviews.js'
import {
  CATEGORY_LABELS,
  THEME_COMPONENTS,
  getThemeComponent,
} from './themeComponentRegistry.js'
import {
  CUSTOM_TOKEN_NAME,
  HEX_COLOR,
  calculateContrastRatio,
  createLiteralRecipe,
  createMixRecipe,
  createReferenceRecipe,
  detectTokenType,
  generateThemeTokenCode,
  getBoundTokenName,
  getCssPropertyForType,
  getDefaultLiteralForType,
  getPlaceholderForType,
  isColorValue,
  isValidCssValue,
  resolveSlotBinding,
  serializeRecipe,
  validateCustomTokenDeletion,
  validateDraft,
  type RuntimeToken,
  type ThemeComponentCategory,
  type ThemeComponentDefinition,
  type ThemePropertySlot,
  type ThemeTokenDraft,
  type ThemeTokenName,
  type ThemeTokenOperand,
  type ThemeTokenRecipe,
  type ThemeTokenValueType,
} from './themeTokenDebuggerModel.js'
import {
  applyThemeTokenDraft,
  clearThemeTokenDraft,
  scanRuntimeTokens,
} from './themeTokenDebuggerRuntime.js'

const DEFAULT_OPTION_VALUE = '__default_recipe__'

function ColorDot({ value }: { value: string }): React.ReactNode {
  const isColor = isColorValue(value)
  return (
    <span
      className="theme-token-debugger__color-dot"
      style={{
        background: isColor ? value : 'var(--cpx-sys-color-hover)',
        border: '1px solid var(--cpx-sys-color-border-default)',
      }}
    />
  )
}

function OperandEditor({
  label,
  operand,
  options,
  valueType,
  onChange,
}: {
  label: string
  operand: ThemeTokenOperand
  options: Array<{ value: string; label: string; icon?: React.ReactNode }>
  valueType?: ThemeTokenValueType
  onChange: (operand: ThemeTokenOperand) => void
}): React.ReactNode {
  const resolvedType = valueType ?? 'color'
  return (
    <fieldset className="theme-token-debugger__operand">
      <legend>{label}</legend>
      <div className="theme-token-debugger__field">
        <span>引用现有 Token</span>
        <SettingsDropdown
          ariaLabel={`${label} Token 选择`}
          options={[
            { value: '__none__', label: '（自定义直接值）' },
            ...options,
          ]}
          searchable
          searchPlaceholder="搜索 Token..."
          value={operand.kind === 'token' ? operand.token : '__none__'}
          width="100%"
          onChange={val => {
            if (val === '__none__') {
              onChange({ kind: 'literal', value: getDefaultLiteralForType(resolvedType) })
            } else {
              onChange({ kind: 'token', token: val as ThemeTokenName })
            }
          }}
        />
      </div>

      {operand.kind === 'literal' ? (
        <label className="theme-token-debugger__field">
          <span>固定值 ({resolvedType})</span>
          <div className="theme-token-debugger__color-input-row">
            {resolvedType === 'color' ? (
              <input
                aria-label={`${label} 拾色器`}
                className="theme-token-debugger__color-picker"
                type="color"
                value={HEX_COLOR.test(operand.value) ? operand.value : '#FFFFFF'}
                onChange={event => onChange({ kind: 'literal', value: event.target.value.toUpperCase() })}
              />
            ) : null}
            <Input
              aria-label={`${label} 文本值`}
              placeholder={getPlaceholderForType(resolvedType)}
              value={operand.value}
              onChange={event => onChange({ kind: 'literal', value: event.target.value })}
            />
          </div>
        </label>
      ) : null}
    </fieldset>
  )
}

export function ThemeTokenDebugger(): React.ReactNode {
  const [tokens, setTokens] = useState<RuntimeToken[]>([])
  const [draft, setDraft] = useState<ThemeTokenDraft>(() => ({ customTokens: {}, overrides: {} }))
  const [selectedCategoryId, setSelectedCategoryId] = useState<ThemeComponentCategory | 'all'>('all')
  const [selectedComponentId, setSelectedComponentId] = useState<string>('dropdown')
  const [creatingSlot, setCreatingSlot] = useState<ThemePropertySlot | null>(null)
  const [editingTokenName, setEditingTokenName] = useState<ThemeTokenName | null>(null)
  const [createTokenName, setCreateTokenName] = useState<string>('')
  const [createTokenKind, setCreateTokenKind] = useState<'reference' | 'literal' | 'color-mix'>('reference')
  const [createRefToken, setCreateRefToken] = useState<string>('')
  const [createLiteralVal, setCreateLiteralVal] = useState<string>('#FFFFFF')
  const [createMixFrom, setCreateMixFrom] = useState<ThemeTokenOperand>({
    kind: 'token',
    token: '--cpx-sys-color-surface-under',
  })
  const [createMixTo, setCreateMixTo] = useState<ThemeTokenOperand>({
    kind: 'literal',
    value: '#FFFFFF',
  })
  const [createMixAmount, setCreateMixAmount] = useState<number>(10)
  const [exportScope, setExportScope] = useState<'component' | 'all'>('component')
  const [notice, setNotice] = useState<string | null>(null)
  const [alertMessage, setAlertMessage] = useState<string | null>(null)
  const [libraryQuery, setLibraryQuery] = useState<string>('')
  const [libraryTypeFilter, setLibraryTypeFilter] = useState<ThemeTokenValueType | 'all'>('all')

  const refreshTokens = (): void => {
    setTokens(scanRuntimeTokens())
  }

  useEffect(() => {
    refreshTokens()
    const timer = setTimeout(refreshTokens, 300)
    return () => clearTimeout(timer)
  }, [])

  const tokensByName = useMemo(() => {
    const map = new Map<string, RuntimeToken>()
    for (const t of tokens) map.set(t.name, t)
    for (const [customName, recipe] of Object.entries(draft.customTokens)) {
      if (!map.has(customName)) {
        map.set(customName, {
          name: customName as ThemeTokenName,
          valueType: detectTokenType(customName),
          resolvedValue: serializeRecipe(recipe),
          authoredValue: serializeRecipe(recipe),
          source: 'stylesheet',
          references: 0,
        })
      }
    }
    return map
  }, [tokens, draft.customTokens])

  const knownTokenNames = useMemo(() => new Set(tokensByName.keys()), [tokensByName])

  const error = useMemo(() => {
    return validateDraft(draft, knownTokenNames)
  }, [draft, knownTokenNames])

  useEffect(() => {
    if (error) {
      clearThemeTokenDraft()
      return
    }
    applyThemeTokenDraft(draft)
    return () => {
      clearThemeTokenDraft()
    }
  }, [draft, error])

  const activeComponent: ThemeComponentDefinition = useMemo(() => {
    return getThemeComponent(selectedComponentId) ?? THEME_COMPONENTS[0]
  }, [selectedComponentId])

  const filteredComponents = useMemo(() => {
    if (selectedCategoryId === 'all') return THEME_COMPONENTS
    return THEME_COMPONENTS.filter(c => c.category === selectedCategoryId)
  }, [selectedCategoryId])

  const dropdownOptions = useMemo(() => {
    const defaultOpt = {
      value: DEFAULT_OPTION_VALUE,
      label: '默认配方 (系统预设)',
      icon: <span className="theme-token-debugger__option-dot" style={{ background: 'var(--cpx-sys-color-border-subtle)' }} />,
    }

    const customOpts = Object.keys(draft.customTokens)
      .sort()
      .map(name => {
        const info = tokensByName.get(name)
        const val = info?.resolvedValue ?? `var(${name})`
        return {
          value: name,
          label: `${name} (自定义)`,
          icon: <span className="theme-token-debugger__option-dot" style={{ background: isColorValue(val) ? val : 'var(--cpx-sys-color-border-default)' }} />,
        }
      })

    const systemOpts = tokens.map(token => ({
      value: token.name,
      label: `${token.name} (${token.resolvedValue})`,
      icon: <span className="theme-token-debugger__option-dot" style={{ background: isColorValue(token.resolvedValue) ? token.resolvedValue : 'var(--cpx-sys-color-border-default)' }} />,
    }))

    return [defaultOpt, ...customOpts, ...systemOpts]
  }, [tokens, draft.customTokens, tokensByName])

  const contrastResults = useMemo(() => {
    if (!activeComponent.contrastChecks) return []
    return activeComponent.contrastChecks.map(check => {
      const fgToken = tokensByName.get(check.foregroundToken)
      const bgToken = tokensByName.get(check.backgroundToken)
      const fgColor = fgToken?.resolvedValue
      const bgColor = bgToken?.resolvedValue
      const ratio = calculateContrastRatio(fgColor, bgColor)
      return {
        label: check.label,
        ratio,
        fgColor,
        bgColor,
      }
    })
  }, [activeComponent, tokensByName])

  const handleSlotTokenSelect = (slot: ThemePropertySlot, selectedValue: string): void => {
    setNotice(null)
    setDraft(prev => {
      const nextOverrides = { ...prev.overrides }
      if (selectedValue === DEFAULT_OPTION_VALUE) {
        delete nextOverrides[slot.targetToken]
      } else {
        nextOverrides[slot.targetToken] = createReferenceRecipe(selectedValue as ThemeTokenName)
      }
      return { ...prev, overrides: nextOverrides }
    })
  }

  const handleSlotReset = (slot: ThemePropertySlot): void => {
    setDraft(prev => {
      const nextOverrides = { ...prev.overrides }
      delete nextOverrides[slot.targetToken]
      return { ...prev, overrides: nextOverrides }
    })
    setNotice(`已重置属性「${slot.label}」`)
  }

  const handleOpenCreateForSlot = (slot: ThemePropertySlot): void => {
    setCreatingSlot(slot)
    const prefix = slot.valueType === 'color' ? '--color-token-custom-' : `--${slot.valueType}-token-custom-`
    setCreateTokenName(`${prefix}${slot.id}`)
    setCreateTokenKind(slot.valueType === 'color' ? 'color-mix' : 'reference')
    setCreateLiteralVal(getDefaultLiteralForType(slot.valueType))
    setCreateRefToken(tokens[0]?.name ?? '')
  }

  const handleCreateAndApply = (): void => {
    if (!creatingSlot) return
    const tokenName = createTokenName.trim() as ThemeTokenName
    if (!CUSTOM_TOKEN_NAME.test(tokenName)) {
      setAlertMessage(`Token 名称无效：${tokenName}（必须以 -- 开头，仅包含小写字母、数字和连字符）`)
      return
    }

    let recipe: ThemeTokenRecipe
    if (createTokenKind === 'reference') {
      recipe = createReferenceRecipe(createRefToken as ThemeTokenName)
    } else if (createTokenKind === 'literal') {
      const cssProp = creatingSlot.cssProperty || getCssPropertyForType(creatingSlot.valueType)
      if (!isValidCssValue(cssProp, createLiteralVal, creatingSlot.valueType)) {
        setAlertMessage(`固定值格式无效：${createLiteralVal}（不符合 ${cssProp} 语法）`)
        return
      }
      recipe = createLiteralRecipe(createLiteralVal)
    } else {
      recipe = createMixRecipe(createMixFrom, createMixTo, createMixAmount)
    }

    setDraft(prev => ({
      customTokens: { ...prev.customTokens, [tokenName]: recipe },
      overrides: { ...prev.overrides, [creatingSlot.targetToken]: createReferenceRecipe(tokenName) },
    }))

    setNotice(`已创建自定义 Token "${tokenName}" 并绑定到 ${creatingSlot.label}`)
    setCreatingSlot(null)
  }

  const handleDeleteCustomToken = (tokenName: ThemeTokenName): void => {
    const error = validateCustomTokenDeletion(tokenName, draft)
    if (error) {
      setAlertMessage(error)
      return
    }

    setDraft(prev => {
      const nextCustom = { ...prev.customTokens }
      delete nextCustom[tokenName]
      return { ...prev, customTokens: nextCustom }
    })

    if (editingTokenName === tokenName) {
      setEditingTokenName(null)
    }
    setNotice(`已删除自定义 Token "${tokenName}"`)
  }

  const handleOpenEditToken = (tokenName: ThemeTokenName): void => {
    setEditingTokenName(tokenName)
  }

  const isEditingCustomToken = Boolean(editingTokenName && editingTokenName in draft.customTokens)
  const editingTokenRecipe = editingTokenName
    ? isEditingCustomToken
      ? draft.customTokens[editingTokenName]
      : draft.overrides[editingTokenName] ?? createReferenceRecipe(editingTokenName)
    : null
  const editingTokenInfo = editingTokenName ? tokensByName.get(editingTokenName) : null
  const editingTokenType = editingTokenInfo?.valueType ?? detectTokenType(editingTokenName ?? '')

  const handleEditingTokenRecipeChange = (recipe: ThemeTokenRecipe): void => {
    if (!editingTokenName) return
    setDraft(prev => {
      if (isEditingCustomToken) {
        return { ...prev, customTokens: { ...prev.customTokens, [editingTokenName]: recipe } }
      }
      return { ...prev, overrides: { ...prev.overrides, [editingTokenName]: recipe } }
    })
  }

  const handleEditingTokenReset = (): void => {
    if (!editingTokenName || isEditingCustomToken) return
    setDraft(prev => {
      const nextOverrides = { ...prev.overrides }
      delete nextOverrides[editingTokenName]
      return { ...prev, overrides: nextOverrides }
    })
    setNotice(`已重置 Token "${editingTokenName}" 的全局覆盖`)
  }

  const hasDraftChanges = Object.keys(draft.customTokens).length > 0 || Object.keys(draft.overrides).length > 0

  const inlineTokens = useMemo(() => new Set<string>(), [])

  const filteredLibraryTokens = useMemo(() => {
    return tokens.filter(token => {
      if (libraryTypeFilter !== 'all' && token.valueType !== libraryTypeFilter) return false
      if (libraryQuery) {
        const q = libraryQuery.toLowerCase()
        return token.name.toLowerCase().includes(q) || token.resolvedValue.toLowerCase().includes(q)
      }
      return true
    })
  }, [tokens, libraryTypeFilter, libraryQuery])

  // Group slots by their declared group
  const groupedSlots = useMemo(() => {
    const groups: Array<{ name: string; slots: ThemePropertySlot[] }> = []
    const groupMap = new Map<string, ThemePropertySlot[]>()
    for (const slot of activeComponent.slots) {
      if (!groupMap.has(slot.group)) {
        const list: ThemePropertySlot[] = []
        groupMap.set(slot.group, list)
        groups.push({ name: slot.group, slots: list })
      }
      groupMap.get(slot.group)!.push(slot)
    }
    return groups
  }, [activeComponent])

  return (
    <section aria-label="主题视觉 Token 调试器" className="theme-token-debugger">
      <header className="theme-token-debugger__header">
        <div className="theme-token-debugger__title-wrap">
          <div className="theme-token-debugger__title-row">
            <Sparkles className="theme-token-debugger__title-icon" size={16} />
            <h3>全组件主题视觉 Token 调试工作台</h3>
          </div>
          <p>
            支持所有组件的颜色、边框、阴影、圆角与尺寸属性实时重映射；纯内存运行且与生产完全隔离。
          </p>
        </div>

        <div className="theme-token-debugger__actions">
          {notice ? <span className="theme-token-debugger__notice">{notice}</span> : null}
          <Button
            color="secondary"
            disabled={!hasDraftChanges}
            size="compact"
            type="button"
            onClick={() => {
              setDraft({ customTokens: {}, overrides: {} })
              setEditingTokenName(null)
              setCreatingSlot(null)
              setAlertMessage(null)
              setNotice('已重置所有组件修改')
            }}
          >
            <RotateCcw size={14} /> 全部重置
          </Button>

          <div className="theme-token-debugger__export-group">
            <Button
              color="secondary"
              disabled={Boolean(error) || !hasDraftChanges}
              size="compact"
              title="复制 SCSS / TS 代码"
              type="button"
              onClick={() => {
                const code = generateThemeTokenCode(draft, {
                  format: 'scss',
                  scope: exportScope === 'component' ? activeComponent.id : 'all',
                  selectedComponentSlots: activeComponent.slots,
                })
                void navigator.clipboard
                  .writeText(code)
                  .then(() => setNotice(exportScope === 'component' ? `已复制「${activeComponent.label}」代码` : '已复制全部 Token 代码'))
                  .catch(() => setNotice('复制失败，请检查剪贴板权限'))
              }}
            >
              <Copy size={13} /> 复制代码 ({exportScope === 'component' ? '当前组件' : '全部修改'})
            </Button>
            <Button
              color="secondary"
              size="compact"
              type="button"
              onClick={() => setExportScope(prev => (prev === 'component' ? 'all' : 'component'))}
            >
              <Sliders size={13} /> 切换范围
            </Button>
          </div>
        </div>
      </header>

      {/* Category and Component Navigation */}
      <div className="theme-token-debugger__nav-bar">
        <div className="theme-token-debugger__category-tabs">
          <Button
            color={selectedCategoryId === 'all' ? 'outlineActive' : 'secondary'}
            size="compact"
            type="button"
            onClick={() => setSelectedCategoryId('all')}
          >
            全部类别
          </Button>
          {(['primitives', 'containers', 'layout', 'features'] as ThemeComponentCategory[]).map(cat => (
            <Button
              color={selectedCategoryId === cat ? 'outlineActive' : 'secondary'}
              key={cat}
              size="compact"
              type="button"
              onClick={() => setSelectedCategoryId(cat)}
            >
              {CATEGORY_LABELS[cat]}
            </Button>
          ))}
        </div>

        <div className="theme-token-debugger__component-pills">
          {filteredComponents.map(comp => (
            <Button
              color={selectedComponentId === comp.id ? 'outlineActive' : 'secondary'}
              key={comp.id}
              size="compact"
              type="button"
              onClick={() => {
                setSelectedComponentId(comp.id)
                setCreatingSlot(null)
              }}
            >
              {comp.label}
            </Button>
          ))}
        </div>
      </div>

      {error ? <div className="theme-token-debugger__error-banner" role="alert">{error}</div> : null}
      {alertMessage ? (
        <div className="theme-token-debugger__alert-banner" role="alert">
          <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{alertMessage}</p>
          <Button color="secondary" size="compact" type="button" onClick={() => setAlertMessage(null)}>
            关闭
          </Button>
        </div>
      ) : null}

      <div className="theme-token-debugger__workspace">
        {/* Left Column: Properties Tables */}
        <div className="theme-token-debugger__properties-col">
          {groupedSlots.map(group => (
            <div className="theme-token-debugger__group-card" key={group.name}>
              <div className="theme-token-debugger__group-header">
                <h4>{group.name}</h4>
                <span>{activeComponent.label} 对应视觉槽位及状态绑定</span>
              </div>
              <div className="theme-token-debugger__table">
                {group.slots.map(slot => {
                  const binding = resolveSlotBinding(slot.targetToken, draft, tokens)
                  const boundToken = getBoundTokenName(binding)
                  const targetRuntime = tokensByName.get(slot.targetToken)
                  const boundRuntime = boundToken ? tokensByName.get(boundToken) : undefined
                  const resolvedVal = targetRuntime?.resolvedValue || boundRuntime?.resolvedValue || 'transparent'
                  const isOverridden = slot.targetToken in draft.overrides
                  const selectedValue = boundToken ?? DEFAULT_OPTION_VALUE
                  const editableSourceToken = boundToken ?? slot.targetToken

                  return (
                    <div className="theme-token-debugger__row" data-overridden={isOverridden || undefined} key={slot.id}>
                      <div className="theme-token-debugger__slot-info">
                        <div className="theme-token-debugger__slot-title-row">
                          <span className="theme-token-debugger__slot-label">{slot.label}</span>
                          <span className="theme-token-debugger__type-badge">{slot.valueType}</span>
                        </div>
                        <span className="theme-token-debugger__slot-token" title={slot.targetToken}>
                          {slot.targetToken}
                        </span>
                      </div>

                      <div className="theme-token-debugger__color-preview" title={`解析值: ${resolvedVal}`}>
                        {slot.valueType === 'color' ? (
                          <ColorDot value={resolvedVal} />
                        ) : (
                          <span className="theme-token-debugger__generic-badge">{slot.valueType}</span>
                        )}
                        <span className="theme-token-debugger__color-value">{resolvedVal}</span>
                      </div>

                      <div className="theme-token-debugger__slot-picker">
                        <SettingsDropdown
                          ariaLabel={`${slot.label} Token 选择`}
                          options={dropdownOptions}
                          searchable
                          searchPlaceholder="搜索 Token..."
                          value={selectedValue}
                          width="100%"
                          onChange={value => handleSlotTokenSelect(slot, value)}
                        />
                      </div>

                      <div className="theme-token-debugger__row-actions">
                        <Button
                          color={editingTokenName === editableSourceToken ? 'outlineActive' : 'secondary'}
                          size="compact"
                          title={`编辑 Source Token: ${editableSourceToken}`}
                          type="button"
                          onClick={() => handleOpenEditToken(editableSourceToken)}
                        >
                          <Sliders size={13} /> 编辑
                        </Button>
                        <Button
                          color="secondary"
                          size="compact"
                          title={`新建 Token 并应用到 ${slot.label}`}
                          type="button"
                          onClick={() => handleOpenCreateForSlot(slot)}
                        >
                          <Plus size={13} /> 新建
                        </Button>
                        <IconButton
                          color="secondary"
                          disabled={!isOverridden}
                          size="iconSm"
                          title="重置此属性绑定"
                          type="button"
                          onClick={() => handleSlotReset(slot)}
                        >
                          <RotateCcw size={13} />
                        </IconButton>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Drawer: Create & Apply */}
          {creatingSlot ? (
            <div className="theme-token-debugger__card theme-token-debugger__editor-panel">
              <div className="theme-token-debugger__editor-header">
                <div>
                  <h4>新建 Token 并应用到「{creatingSlot.label}」</h4>
                  <span className="theme-token-debugger__editor-sub">{creatingSlot.targetToken}</span>
                </div>
                <IconButton
                  color="secondary"
                  size="iconSm"
                  title="关闭"
                  type="button"
                  onClick={() => setCreatingSlot(null)}
                >
                  <X size={14} />
                </IconButton>
              </div>

              <div className="theme-token-debugger__form-grid">
                <label className="theme-token-debugger__field">
                  <span>新 Token 名称</span>
                  <Input
                    aria-label="新 Token 名称"
                    spellCheck={false}
                    value={createTokenName}
                    onChange={event => setCreateTokenName(event.target.value.toLowerCase())}
                  />
                </label>

                <div className="theme-token-debugger__field">
                  <span>配方类型</span>
                  <div className="theme-token-debugger__recipe-kind">
                    <Button
                      color={createTokenKind === 'reference' ? 'outlineActive' : 'secondary'}
                      size="compact"
                      type="button"
                      onClick={() => setCreateTokenKind('reference')}
                    >
                      直接引用
                    </Button>
                    <Button
                      color={createTokenKind === 'literal' ? 'outlineActive' : 'secondary'}
                      size="compact"
                      type="button"
                      onClick={() => {
                        setCreateTokenKind('literal')
                        setCreateLiteralVal(getDefaultLiteralForType(creatingSlot.valueType))
                      }}
                    >
                      固定值 (Literal)
                    </Button>
                    {creatingSlot.valueType === 'color' ? (
                      <Button
                        color={createTokenKind === 'color-mix' ? 'outlineActive' : 'secondary'}
                        size="compact"
                        type="button"
                        onClick={() => setCreateTokenKind('color-mix')}
                      >
                        sRGB 混色 (color-mix)
                      </Button>
                    ) : null}
                  </div>
                </div>

                {createTokenKind === 'reference' ? (
                  <div className="theme-token-debugger__field">
                    <span>选择引用的源 Token</span>
                    <SettingsDropdown
                      ariaLabel="选择引用的源 Token"
                      options={dropdownOptions.filter(o => o.value !== DEFAULT_OPTION_VALUE)}
                      searchable
                      searchPlaceholder="搜索 Token..."
                      value={createRefToken}
                      width="100%"
                      onChange={setCreateRefToken}
                    />
                  </div>
                ) : null}

                {createTokenKind === 'literal' ? (
                  <label className="theme-token-debugger__field">
                    <span>固定取值 ({creatingSlot.valueType})</span>
                    <div className="theme-token-debugger__color-input-row">
                      {creatingSlot.valueType === 'color' ? (
                        <input
                          aria-label="拾色器"
                          className="theme-token-debugger__color-picker"
                          type="color"
                          value={HEX_COLOR.test(createLiteralVal) ? createLiteralVal : '#FFFFFF'}
                          onChange={event => setCreateLiteralVal(event.target.value.toUpperCase())}
                        />
                      ) : null}
                      <Input
                        aria-label="固定取值文本"
                        placeholder={getPlaceholderForType(creatingSlot.valueType)}
                        value={createLiteralVal}
                        onChange={event => setCreateLiteralVal(event.target.value)}
                      />
                    </div>
                  </label>
                ) : null}

                {createTokenKind === 'color-mix' ? (
                  <div className="theme-token-debugger__mix-builder">
                    <OperandEditor
                      label="起始颜色 (From)"
                      operand={createMixFrom}
                      options={dropdownOptions.filter(o => o.value !== DEFAULT_OPTION_VALUE)}
                      valueType="color"
                      onChange={setCreateMixFrom}
                    />
                    <OperandEditor
                      label="目标颜色 (To)"
                      operand={createMixTo}
                      options={dropdownOptions.filter(o => o.value !== DEFAULT_OPTION_VALUE)}
                      valueType="color"
                      onChange={setCreateMixTo}
                    />
                    <label className="theme-token-debugger__field">
                      <span>目标比例：{createMixAmount}%</span>
                      <Input
                        aria-label="混色目标比例"
                        max={100}
                        min={0}
                        type="range"
                        value={createMixAmount}
                        onChange={event => setCreateMixAmount(Number(event.target.value))}
                      />
                    </label>
                  </div>
                ) : null}

                <div className="theme-token-debugger__panel-footer">
                  <Button color="secondary" size="compact" type="button" onClick={() => setCreatingSlot(null)}>
                    取消
                  </Button>
                  <Button color="secondary" size="compact" type="button" onClick={handleCreateAndApply}>
                    创建并应用
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Drawer: Source Token Editor */}
          {editingTokenName ? (
            <div className="theme-token-debugger__card theme-token-debugger__editor-panel">
              <div className="theme-token-debugger__editor-header">
                <div>
                  <h4>编辑 Source Token：{editingTokenName}</h4>
                  <div className="theme-token-debugger__token-meta-row">
                    {editingTokenType === 'color' ? (
                      <ColorDot value={editingTokenInfo?.resolvedValue ?? `var(${editingTokenName})`} />
                    ) : null}
                    <span>解析值：{editingTokenInfo?.resolvedValue ?? '自定义 / 动态'}</span>
                    <span>·</span>
                    <span>{editingTokenInfo?.references ?? 0} 处 CSS 引用</span>
                    {isEditingCustomToken ? <span className="theme-token-debugger__badge">自定义 Token</span> : null}
                  </div>
                </div>
                <IconButton
                  color="secondary"
                  size="iconSm"
                  title="关闭"
                  type="button"
                  onClick={() => setEditingTokenName(null)}
                >
                  <X size={14} />
                </IconButton>
              </div>

              {!isEditingCustomToken ? (
                <div className="theme-token-debugger__warning-box">
                  <strong>⚠️ 全局覆盖警告</strong>
                  <p>
                    「{editingTokenName}」是系统 Token（共 {editingTokenInfo?.references ?? 0} 处引用）。
                    在此进行的修改将产生全局临时 override，所有引用此 Token 的组件与页面将实时更新。
                  </p>
                </div>
              ) : null}

              <div className="theme-token-debugger__form-grid">
                <div className="theme-token-debugger__recipe-kind">
                  <Button
                    color={editingTokenRecipe?.kind === 'reference' ? 'outlineActive' : 'secondary'}
                    size="compact"
                    type="button"
                    onClick={() => handleEditingTokenRecipeChange(createReferenceRecipe(tokens[0]?.name ?? '--cpx-sys-color-surface-under'))}
                  >
                    引用 (Reference)
                  </Button>
                  <Button
                    color={editingTokenRecipe?.kind === 'literal' ? 'outlineActive' : 'secondary'}
                    size="compact"
                    type="button"
                    onClick={() => handleEditingTokenRecipeChange(createLiteralRecipe(editingTokenInfo?.resolvedValue || getDefaultLiteralForType(editingTokenType)))}
                  >
                    固定值 (Literal)
                  </Button>
                  {editingTokenType === 'color' ? (
                    <Button
                      color={editingTokenRecipe?.kind === 'color-mix' ? 'outlineActive' : 'secondary'}
                      size="compact"
                      type="button"
                      onClick={() =>
                        handleEditingTokenRecipeChange(
                          createMixRecipe(
                            { kind: 'token', token: '--cpx-sys-color-surface-under' },
                            { kind: 'literal', value: '#FFFFFF' },
                            15,
                          ),
                        )
                      }
                    >
                      混色 (color-mix)
                    </Button>
                  ) : null}
                </div>

                {editingTokenRecipe?.kind === 'reference' ? (
                  <OperandEditor
                    label="引用的源"
                    operand={editingTokenRecipe.source}
                    options={dropdownOptions.filter(o => o.value !== editingTokenName && o.value !== DEFAULT_OPTION_VALUE)}
                    valueType={editingTokenType}
                    onChange={operand => handleEditingTokenRecipeChange({ ...editingTokenRecipe, source: operand })}
                  />
                ) : null}

                {editingTokenRecipe?.kind === 'literal' ? (
                  <label className="theme-token-debugger__field">
                    <span>固定值取值 ({editingTokenType})</span>
                    <div className="theme-token-debugger__color-input-row">
                      {editingTokenType === 'color' ? (
                        <input
                          aria-label="拾色器"
                          className="theme-token-debugger__color-picker"
                          type="color"
                          value={HEX_COLOR.test(editingTokenRecipe.value) ? editingTokenRecipe.value : '#FFFFFF'}
                          onChange={event => handleEditingTokenRecipeChange({ ...editingTokenRecipe, value: event.target.value.toUpperCase() })}
                        />
                      ) : null}
                      <Input
                        aria-label="固定值取值文本"
                        placeholder={getPlaceholderForType(editingTokenType)}
                        value={editingTokenRecipe.value}
                        onChange={event => handleEditingTokenRecipeChange({ ...editingTokenRecipe, value: event.target.value })}
                      />
                    </div>
                  </label>
                ) : null}

                {editingTokenRecipe?.kind === 'color-mix' && editingTokenType === 'color' ? (
                  <div className="theme-token-debugger__mix-builder">
                    <OperandEditor
                      label="起始颜色 (From)"
                      operand={editingTokenRecipe.from}
                      options={dropdownOptions.filter(o => o.value !== editingTokenName)}
                      valueType="color"
                      onChange={operand => handleEditingTokenRecipeChange({ ...editingTokenRecipe, from: operand })}
                    />
                    <OperandEditor
                      label="目标颜色 (To)"
                      operand={editingTokenRecipe.to}
                      options={dropdownOptions.filter(o => o.value !== editingTokenName)}
                      valueType="color"
                      onChange={operand => handleEditingTokenRecipeChange({ ...editingTokenRecipe, to: operand })}
                    />
                    <label className="theme-token-debugger__field">
                      <span>目标比例：{editingTokenRecipe.toAmount}%</span>
                      <Input
                        aria-label="混色目标比例"
                        max={100}
                        min={0}
                        type="range"
                        value={editingTokenRecipe.toAmount}
                        onChange={event =>
                          handleEditingTokenRecipeChange({
                            ...editingTokenRecipe,
                            toAmount: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                ) : null}

                {editingTokenRecipe ? (
                  <div className="theme-token-debugger__code-preview">
                    <code>{`${editingTokenName}: ${serializeRecipe(editingTokenRecipe)};`}</code>
                  </div>
                ) : null}

                <div className="theme-token-debugger__panel-footer">
                  {!isEditingCustomToken && editingTokenName in draft.overrides ? (
                    <Button color="secondary" size="compact" type="button" onClick={handleEditingTokenReset}>
                      <RotateCcw size={13} /> 重置此 Token 全局覆盖
                    </Button>
                  ) : null}
                  {isEditingCustomToken ? (
                    <Button
                      color="secondary"
                      size="compact"
                      type="button"
                      onClick={() => handleDeleteCustomToken(editingTokenName)}
                    >
                      <Trash2 size={13} /> 删除此自定义 Token
                    </Button>
                  ) : null}
                  <Button color="secondary" size="compact" type="button" onClick={() => setEditingTokenName(null)}>
                    完成
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Right Column: Previews & WCAG Contrast */}
        <aside className="theme-token-debugger__preview-col">
          <ComponentPreviewHost componentId={activeComponent.id} />

          {contrastResults.length ? (
            <div className="theme-token-debugger__card">
              <h4>{activeComponent.label} 对比度检查 (WCAG 2.1)</h4>
              <div className="theme-token-debugger__contrast-list">
                {contrastResults.map(check => {
                  const isFail = check.ratio !== null && check.ratio < 4.5
                  return (
                    <div
                      className={`theme-token-debugger__contrast-item ${isFail ? 'theme-token-debugger__contrast-item--fail' : ''}`}
                      key={check.label}
                    >
                      <span className="theme-token-debugger__contrast-label">{check.label}</span>
                      <span className="theme-token-debugger__contrast-ratio">
                        {check.ratio === null ? (
                          '无法计算'
                        ) : (
                          <>
                            {check.ratio.toFixed(2)}:1 {isFail ? '⚠️ 低于 4.5:1' : '✓ 合格'}
                          </>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
        </aside>
      </div>

      {/* Bottom Section: Token Library */}
      <details className="theme-token-debugger__library-section">
        <summary className="theme-token-debugger__library-summary">
          <div className="theme-token-debugger__library-summary-content">
            <h4>全量 Token 库（高级区域）</h4>
            <span className="theme-token-debugger__library-count">
              共 {tokens.length} 个运行时 Token · {Object.keys(draft.customTokens).length} 个自定义 Token
            </span>
          </div>
        </summary>

        <div className="theme-token-debugger__library-body">
          <div className="theme-token-debugger__library-filter-bar">
            <div className="theme-token-debugger__library-search">
              <Input
                aria-label="搜索颜色 Token 库"
                placeholder="搜索 Token 名称或色值 (如 --color-background, --shadow, --radius...)"
                value={libraryQuery}
                onChange={event => setLibraryQuery(event.target.value)}
              />
            </div>
            <div className="theme-token-debugger__type-pills">
              {(['all', 'color', 'shadow', 'radius', 'border', 'dimension', 'typography', 'custom'] as Array<ThemeTokenValueType | 'all'>).map(t => (
                <Button
                  color={libraryTypeFilter === t ? 'outlineActive' : 'secondary'}
                  key={t}
                  size="compact"
                  type="button"
                  onClick={() => setLibraryTypeFilter(t)}
                >
                  {t === 'all' ? '全部类型' : t}
                </Button>
              ))}
            </div>
          </div>

          {Object.keys(draft.customTokens).length ? (
            <div className="theme-token-debugger__library-group">
              <h5>自定义 Token</h5>
              <div className="theme-token-debugger__library-grid">
                {Object.keys(draft.customTokens)
                  .sort()
                  .filter(name => !libraryQuery || name.toLowerCase().includes(libraryQuery.toLowerCase()))
                  .map(name => {
                    const tokenInfo = tokensByName.get(name)
                    const resolved = tokenInfo?.resolvedValue ?? `var(${name})`
                    return (
                      <div className="theme-token-debugger__library-item" key={name}>
                        <ColorDot value={resolved} />
                        <div className="theme-token-debugger__library-item-copy">
                          <span className="theme-token-debugger__library-name">{name}</span>
                          <span className="theme-token-debugger__library-value">{resolved}</span>
                        </div>
                        <div className="theme-token-debugger__library-item-actions">
                          <Button
                            color="secondary"
                            size="compact"
                            type="button"
                            onClick={() => handleOpenEditToken(name as ThemeTokenName)}
                          >
                            编辑
                          </Button>
                          <Button
                            color="secondary"
                            size="compact"
                            type="button"
                            onClick={() => handleDeleteCustomToken(name as ThemeTokenName)}
                          >
                            删除
                          </Button>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          ) : null}

          <div className="theme-token-debugger__library-group">
            <h5>系统 Token</h5>
            <div className="theme-token-debugger__library-grid">
              {filteredLibraryTokens.map(token => (
                <div className="theme-token-debugger__library-item" key={token.name}>
                  {token.valueType === 'color' ? (
                    <ColorDot value={token.resolvedValue} />
                  ) : (
                    <span className="theme-token-debugger__generic-badge">{token.valueType}</span>
                  )}
                  <div className="theme-token-debugger__library-item-copy">
                    <span className="theme-token-debugger__library-name">{token.name}</span>
                    <span className="theme-token-debugger__library-value">
                      {token.resolvedValue} · {token.references} 处引用
                    </span>
                  </div>
                  <div className="theme-token-debugger__library-item-actions">
                    <Button
                      color={editingTokenName === token.name ? 'outlineActive' : 'secondary'}
                      size="compact"
                      type="button"
                      onClick={() => handleOpenEditToken(token.name)}
                    >
                      编辑
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </details>
    </section>
  )
}
