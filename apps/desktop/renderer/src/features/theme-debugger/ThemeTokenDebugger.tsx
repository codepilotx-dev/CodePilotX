import React from 'react'
import { ChevronDown, Plus, RotateCcw, Sliders, Trash2, X } from 'lucide-react'

import '../../styles/lazy/theme-token-debugger.scss'

import { Button } from '../../components/ui/Button.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { Input } from '../../components/ui/Input.js'
import { SettingsDropdown } from '../settings/SettingsDropdown.js'
import {
  CUSTOM_TOKEN_NAME,
  DROPDOWN_COMPONENT_DEFINITION,
  DROPDOWN_CONTRAST_CHECKS,
  HEX_COLOR,
  THEME_COMPONENTS,
  calculateContrastRatio,
  createLiteralRecipe,
  createMixRecipe,
  createReferenceRecipe,
  generateThemeTokenCode,
  getBoundTokenName,
  resolveSlotBinding,
  serializeRecipe,
  validateCustomTokenDeletion,
  validateDraft,
  type RuntimeColorToken,
  type ThemeComponentColorSlot,
  type ThemeTokenDraft,
  type ThemeTokenName,
  type ThemeTokenOperand,
  type ThemeTokenRecipe,
} from './themeTokenDebuggerModel.js'
import {
  applyThemeTokenDraft,
  clearThemeTokenDraft,
  scanRuntimeColorTokens,
} from './themeTokenDebuggerRuntime.js'

const EMPTY_DRAFT: ThemeTokenDraft = { customTokens: {}, overrides: {} }
const DEFAULT_OPTION_VALUE = '__default_recipe__'

function ColorDot({ value }: { value: string }): React.ReactNode {
  return <span className="theme-token-debugger__color-dot" style={{ backgroundColor: value }} />
}

function OperandEditor({
  label,
  operand,
  options,
  onChange,
}: {
  label: string
  operand: ThemeTokenOperand
  options: Array<{ value: string; label: string; detail?: string; icon?: React.ReactNode }>
  onChange: (operand: ThemeTokenOperand) => void
}): React.ReactNode {
  const tokenOptions = options.filter(o => o.value !== DEFAULT_OPTION_VALUE)
  return (
    <fieldset className="theme-token-debugger__operand">
      <legend>{label}</legend>
      <div className="theme-token-debugger__recipe-kind">
        <Button
          color={operand.kind === 'token' ? 'outlineActive' : 'secondary'}
          size="compact"
          type="button"
          onClick={() => onChange({ kind: 'token', token: (tokenOptions[0]?.value ?? '--color-token-bg-primary') as ThemeTokenName })}
        >
          Token
        </Button>
        <Button
          color={operand.kind === 'literal' ? 'outlineActive' : 'secondary'}
          size="compact"
          type="button"
          onClick={() => onChange({ kind: 'literal', color: '#FFFFFF' })}
        >
          固定色
        </Button>
      </div>
      {operand.kind === 'token' ? (
        <SettingsDropdown
          ariaLabel={`${label} Token`}
          options={tokenOptions}
          searchable
          searchPlaceholder="搜索 Token..."
          value={operand.token}
          width="100%"
          onChange={value => onChange({ kind: 'token', token: value as ThemeTokenName })}
        />
      ) : (
        <div className="theme-token-debugger__color-input-row">
          <Input
            aria-label={`${label} 拾色器`}
            className="theme-token-debugger__color-picker"
            type="color"
            value={HEX_COLOR.test(operand.color) ? operand.color : '#FFFFFF'}
            onChange={event => onChange({ kind: 'literal', color: event.target.value.toUpperCase() as `#${string}` })}
          />
          <Input
            aria-label={`${label} 颜色代码`}
            placeholder="#FFFFFF"
            spellCheck={false}
            value={operand.color}
            onChange={event => {
              const val = event.target.value
              onChange({ kind: 'literal', color: (val.startsWith('#') ? val : `#${val}`) as `#${string}` })
            }}
          />
        </div>
      )}
    </fieldset>
  )
}

export function ThemeTokenDebugger(): React.ReactNode {
  const [tokens, setTokens] = React.useState<RuntimeColorToken[]>([])
  const [draft, setDraft] = React.useState<ThemeTokenDraft>(EMPTY_DRAFT)
  const [activeComponentId, setActiveComponentId] = React.useState<string>('dropdown')
  const [editingTokenName, setEditingTokenName] = React.useState<string | null>(null)
  const [creatingSlot, setCreatingSlot] = React.useState<ThemeComponentColorSlot | null>(null)
  const [createTokenName, setCreateTokenName] = React.useState<string>('--color-token-')
  const [createMode, setCreateMode] = React.useState<'reference' | 'literal' | 'mix'>('reference')
  const [createRefToken, setCreateRefToken] = React.useState<string>('')
  const [createLiteralColor, setCreateLiteralColor] = React.useState<string>('#FFFFFF')
  const [createMixFrom, setCreateMixFrom] = React.useState<ThemeTokenOperand>({ kind: 'token', token: '--color-token-bg-primary' })
  const [createMixTo, setCreateMixTo] = React.useState<ThemeTokenOperand>({ kind: 'literal', color: '#FFFFFF' })
  const [createMixAmount, setCreateMixAmount] = React.useState<number>(8)
  const [libraryQuery, setLibraryQuery] = React.useState<string>('')
  const [notice, setNotice] = React.useState<string>('')
  const [alertMessage, setAlertMessage] = React.useState<string | null>(null)

  const refresh = React.useCallback(() => setTokens(scanRuntimeColorTokens()), [])

  React.useEffect(() => {
    refresh()
    const observer = new MutationObserver(refresh)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    })
    return () => {
      observer.disconnect()
      clearThemeTokenDraft()
    }
  }, [refresh])

  const knownTokens = React.useMemo(() => new Set<string>(tokens.map(token => token.name)), [tokens])
  const inlineTokens = React.useMemo(
    () => new Set<string>(tokens.filter(token => token.source === 'inline-derived').map(token => token.name)),
    [tokens],
  )
  const tokensByName = React.useMemo(
    () => new Map<string, RuntimeColorToken>(tokens.map(token => [token.name, token])),
    [tokens],
  )

  const error = validateDraft(draft, knownTokens)

  React.useEffect(() => {
    if (error) {
      clearThemeTokenDraft()
    } else {
      applyThemeTokenDraft(draft)
      requestAnimationFrame(refresh)
    }
  }, [draft, error, refresh])

  const activeComponent = React.useMemo(
    () => THEME_COMPONENTS.find(c => c.id === activeComponentId) ?? DROPDOWN_COMPONENT_DEFINITION,
    [activeComponentId],
  )

  const selectableTokens = React.useMemo(() => {
    return [...tokens.map(token => token.name), ...Object.keys(draft.customTokens)]
      .filter((name, index, all) => all.indexOf(name) === index)
      .sort((a, b) => a.localeCompare(b))
  }, [tokens, draft.customTokens])

  const dropdownOptions = React.useMemo(() => {
    const list: Array<{ value: string; label: string; detail?: string; icon?: React.ReactNode }> = [
      {
        value: DEFAULT_OPTION_VALUE,
        label: '默认配方',
        detail: '使用内置默认样式',
        icon: <ColorDot value="transparent" />,
      },
    ]
    for (const name of selectableTokens) {
      const token = tokensByName.get(name)
      const customRecipe = draft.customTokens[name]
      const resolved = token?.resolvedValue ?? (customRecipe ? `var(${name})` : '')
      list.push({
        value: name,
        label: name,
        detail: resolved || undefined,
        icon: <ColorDot value={resolved || 'transparent'} />,
      })
    }
    return list
  }, [selectableTokens, tokensByName, draft.customTokens])

  const handleSlotTokenSelect = (slot: ThemeComponentColorSlot, selectedValue: string): void => {
    if (selectedValue === DEFAULT_OPTION_VALUE) {
      setDraft(current => {
        const nextOverrides = { ...current.overrides }
        delete nextOverrides[slot.targetToken]
        return { ...current, overrides: nextOverrides }
      })
      return
    }
    setDraft(current => ({
      ...current,
      overrides: {
        ...current.overrides,
        [slot.targetToken]: createReferenceRecipe(selectedValue as ThemeTokenName),
      },
    }))
  }

  const handleSlotReset = (slot: ThemeComponentColorSlot): void => {
    setDraft(current => {
      const nextOverrides = { ...current.overrides }
      delete nextOverrides[slot.targetToken]
      return { ...current, overrides: nextOverrides }
    })
  }

  const handleOpenCreateForSlot = (slot: ThemeComponentColorSlot): void => {
    setCreatingSlot(slot)
    const suffix = slot.id.replace(/^(trigger-|surface-)/, '')
    setCreateTokenName(`--color-token-custom-${suffix}`)
    setCreateMode('reference')
    setCreateRefToken(selectableTokens[0] ?? '--color-token-bg-primary')
    setCreateLiteralColor('#FFFFFF')
    setCreateMixFrom({ kind: 'token', token: (selectableTokens[0] ?? '--color-token-bg-primary') as ThemeTokenName })
    setCreateMixTo({ kind: 'literal', color: '#FFFFFF' })
    setCreateMixAmount(8)
    setAlertMessage(null)
  }

  const handleCreateAndApply = (): void => {
    if (!creatingSlot) return
    const name = createTokenName.trim().toLowerCase()
    if (!CUSTOM_TOKEN_NAME.test(name)) {
      setAlertMessage(`Token 名称必须符合 --color-token-* 格式（例如 --color-token-my-color）`)
      return
    }
    if (knownTokens.has(name as ThemeTokenName) || name in draft.customTokens) {
      setAlertMessage(`Token 名称 "${name}" 已存在，请使用其他名称`)
      return
    }

    let recipe: ThemeTokenRecipe
    if (createMode === 'reference') {
      recipe = createReferenceRecipe(createRefToken as ThemeTokenName)
    } else if (createMode === 'literal') {
      const color = (createLiteralColor.startsWith('#') ? createLiteralColor : `#${createLiteralColor}`).toUpperCase()
      if (!HEX_COLOR.test(color)) {
        setAlertMessage('固定颜色必须为 6 位 HEX 格式（如 #FFFFFF）')
        return
      }
      recipe = createLiteralRecipe(color as `#${string}`)
    } else {
      if (createMixFrom.kind === 'literal' && createMixTo.kind === 'literal') {
        setAlertMessage('混色两端均为固定色，请直接使用固定色模式。')
        return
      }
      recipe = createMixRecipe(createMixFrom, createMixTo, createMixAmount)
    }

    setDraft(current => ({
      customTokens: {
        ...current.customTokens,
        [name]: recipe,
      },
      overrides: {
        ...current.overrides,
        [creatingSlot.targetToken]: createReferenceRecipe(name as ThemeTokenName),
      },
    }))
    setCreatingSlot(null)
    setAlertMessage(null)
    setNotice(`已创建并应用 ${name}`)
  }

  const handleOpenEditToken = (tokenName: string): void => {
    setEditingTokenName(tokenName)
    setAlertMessage(null)
  }

  const handleEditingTokenRecipeChange = (nextRecipe: ThemeTokenRecipe): void => {
    if (!editingTokenName) return
    setDraft(current => {
      if (editingTokenName in current.customTokens) {
        return {
          ...current,
          customTokens: { ...current.customTokens, [editingTokenName]: nextRecipe },
        }
      }
      return {
        ...current,
        overrides: { ...current.overrides, [editingTokenName]: nextRecipe },
      }
    })
  }

  const handleEditingTokenReset = (): void => {
    if (!editingTokenName) return
    setDraft(current => {
      const overrides = { ...current.overrides }
      delete overrides[editingTokenName]
      return { ...current, overrides }
    })
  }

  const handleDeleteCustomToken = (tokenName: string): void => {
    const check = validateCustomTokenDeletion(tokenName, draft, THEME_COMPONENTS)
    if (!check.canDelete) {
      setAlertMessage(`无法删除自定义 Token "${tokenName}"，仍被以下属性/Token 引用：\n• ${check.references.join('\n• ')}`)
      return
    }
    setDraft(current => {
      const customTokens = { ...current.customTokens }
      delete customTokens[tokenName]
      return { ...current, customTokens }
    })
    if (editingTokenName === tokenName) {
      setEditingTokenName(null)
    }
    setAlertMessage(null)
    setNotice(`已删除自定义 Token ${tokenName}`)
  }

  // Contrast calculation values
  const tokenValue = (name: string): string | undefined => tokensByName.get(name)?.resolvedValue
  const contrastResults = DROPDOWN_CONTRAST_CHECKS.map(check => ({
    label: check.label,
    ratio: calculateContrastRatio(tokenValue(check.foregroundToken), tokenValue(check.backgroundToken)),
  }))

  const hasDraftChanges = Object.keys(draft.customTokens).length > 0 || Object.keys(draft.overrides).length > 0

  const editingTokenInfo = editingTokenName ? tokensByName.get(editingTokenName) : undefined
  const editingTokenRecipe = editingTokenName
    ? (draft.customTokens[editingTokenName] ?? draft.overrides[editingTokenName])
    : undefined
  const isEditingCustomToken = Boolean(editingTokenName && editingTokenName in draft.customTokens)

  const filteredLibraryTokens = React.useMemo(() => {
    const q = libraryQuery.trim().toLowerCase()
    return tokens.filter(token => !q || `${token.name} ${token.resolvedValue}`.toLowerCase().includes(q))
  }, [tokens, libraryQuery])

  const triggerSlots = activeComponent.slots.filter(slot => slot.group === 'trigger')
  const surfaceSlots = activeComponent.slots.filter(slot => slot.group === 'surface')

  return (
    <section aria-label="主题 Token 调试器" className="theme-token-debugger">
      <header className="theme-token-debugger__header">
        <div className="theme-token-debugger__title-wrap">
          <h3>主题 Token 调试器</h3>
          <p>开发者组件属性 → Token 绑定与调试；改动仅在当前页面有效，刷新后清除。</p>
        </div>
        <div className="theme-token-debugger__actions">
          <Button
            color="secondary"
            disabled={!hasDraftChanges}
            size="compact"
            type="button"
            onClick={() => {
              setDraft(EMPTY_DRAFT)
              setEditingTokenName(null)
              setCreatingSlot(null)
              setAlertMessage(null)
              setNotice('已重置所有修改')
            }}
          >
            <RotateCcw size={14} /> 全部重置
          </Button>
          <Button
            color="secondary"
            disabled={Boolean(error) || !hasDraftChanges}
            size="compact"
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(generateThemeTokenCode(draft, inlineTokens))
                .then(() => setNotice('代码已复制到剪贴板'))
                .catch(() => setNotice('复制失败，请检查剪贴板权限'))
            }}
          >
            复制代码
          </Button>
        </div>
      </header>

      {error ? <div className="theme-token-debugger__error-banner" role="alert">{error}</div> : null}
      {alertMessage ? (
        <div className="theme-token-debugger__alert-banner" role="alert">
          <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{alertMessage}</p>
          <Button color="secondary" size="compact" type="button" onClick={() => setAlertMessage(null)}>
            关闭
          </Button>
        </div>
      ) : null}
      {notice ? <div className="theme-token-debugger__notice" role="status">{notice}</div> : null}

      {/* Component Navigation / Selector */}
      <div className="theme-token-debugger__component-tabs">
        {THEME_COMPONENTS.map(comp => (
          <button
            className="theme-token-debugger__component-tab"
            data-active={comp.id === activeComponentId || undefined}
            key={comp.id}
            type="button"
            onClick={() => setActiveComponentId(comp.id)}
          >
            {comp.label} 属性配置
          </button>
        ))}
      </div>

      <div className="theme-token-debugger__workspace">
        {/* Left Column: Properties Tables */}
        <div className="theme-token-debugger__properties-col">
          {/* Trigger Group */}
          <div className="theme-token-debugger__group-card">
            <div className="theme-token-debugger__group-header">
              <h4>触发器组 (Trigger)</h4>
              <span>控制下拉按钮常态、悬停、展开、禁用及焦点表现</span>
            </div>
            <div className="theme-token-debugger__table">
              {triggerSlots.map(slot => {
                const binding = resolveSlotBinding(slot.targetToken, draft, tokens)
                const boundToken = getBoundTokenName(binding)
                const targetRuntime = tokensByName.get(slot.targetToken)
                const boundRuntime = boundToken ? tokensByName.get(boundToken) : undefined
                const resolvedColor = targetRuntime?.resolvedValue || boundRuntime?.resolvedValue || 'transparent'
                const isOverridden = slot.targetToken in draft.overrides
                const selectedValue = boundToken ?? DEFAULT_OPTION_VALUE
                const editableSourceToken = boundToken ?? slot.targetToken

                return (
                  <div className="theme-token-debugger__row" data-overridden={isOverridden || undefined} key={slot.id}>
                    <div className="theme-token-debugger__slot-info">
                      <span className="theme-token-debugger__slot-label">{slot.label}</span>
                      <span className="theme-token-debugger__slot-token" title={slot.targetToken}>
                        {slot.targetToken.replace('--color-token-dropdown-trigger-', '')}
                      </span>
                    </div>
                    <div className="theme-token-debugger__color-preview" title={`解析颜色: ${resolvedColor}`}>
                      <ColorDot value={resolvedColor} />
                      <span className="theme-token-debugger__color-value">{resolvedColor}</span>
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

          {/* Menu Surface Group */}
          <div className="theme-token-debugger__group-card">
            <div className="theme-token-debugger__group-header">
              <h4>菜单组 (Surface / Menu)</h4>
              <span>控制弹出菜单表面、边框、项悬停、选中、按压及禁用状态</span>
            </div>
            <div className="theme-token-debugger__table">
              {surfaceSlots.map(slot => {
                const binding = resolveSlotBinding(slot.targetToken, draft, tokens)
                const boundToken = getBoundTokenName(binding)
                const targetRuntime = tokensByName.get(slot.targetToken)
                const boundRuntime = boundToken ? tokensByName.get(boundToken) : undefined
                const resolvedColor = targetRuntime?.resolvedValue || boundRuntime?.resolvedValue || 'transparent'
                const isOverridden = slot.targetToken in draft.overrides
                const selectedValue = boundToken ?? DEFAULT_OPTION_VALUE
                const editableSourceToken = boundToken ?? slot.targetToken

                return (
                  <div className="theme-token-debugger__row" data-overridden={isOverridden || undefined} key={slot.id}>
                    <div className="theme-token-debugger__slot-info">
                      <span className="theme-token-debugger__slot-label">{slot.label}</span>
                      <span className="theme-token-debugger__slot-token" title={slot.targetToken}>
                        {slot.targetToken.replace('--color-token-dropdown-', '')}
                      </span>
                    </div>
                    <div className="theme-token-debugger__color-preview" title={`解析颜色: ${resolvedColor}`}>
                      <ColorDot value={resolvedColor} />
                      <span className="theme-token-debugger__color-value">{resolvedColor}</span>
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

          {/* Modal/Drawer: Create & Apply */}
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
                  <span>新 Token 名称 (必须为 --color-token-*)</span>
                  <Input
                    aria-label="新 Token 名称"
                    spellCheck={false}
                    value={createTokenName}
                    onChange={event => setCreateTokenName(event.target.value.toLowerCase())}
                  />
                </label>

                <div className="theme-token-debugger__field">
                  <span>配方模式</span>
                  <div className="theme-token-debugger__recipe-kind">
                    <Button
                      color={createMode === 'reference' ? 'outlineActive' : 'secondary'}
                      size="compact"
                      type="button"
                      onClick={() => setCreateMode('reference')}
                    >
                      引用已有 Token
                    </Button>
                    <Button
                      color={createMode === 'literal' ? 'outlineActive' : 'secondary'}
                      size="compact"
                      type="button"
                      onClick={() => setCreateMode('literal')}
                    >
                      固定色
                    </Button>
                    <Button
                      color={createMode === 'mix' ? 'outlineActive' : 'secondary'}
                      size="compact"
                      type="button"
                      onClick={() => setCreateMode('mix')}
                    >
                      sRGB 混色
                    </Button>
                  </div>
                </div>

                {createMode === 'reference' ? (
                  <div className="theme-token-debugger__field">
                    <span>选择引用的 Token</span>
                    <SettingsDropdown
                      ariaLabel="引用 Token"
                      options={dropdownOptions.filter(o => o.value !== DEFAULT_OPTION_VALUE)}
                      searchable
                      searchPlaceholder="搜索 Token..."
                      value={createRefToken || (selectableTokens[0] ?? '')}
                      width="100%"
                      onChange={value => setCreateRefToken(value)}
                    />
                  </div>
                ) : null}

                {createMode === 'literal' ? (
                  <div className="theme-token-debugger__field">
                    <span>固定颜色值</span>
                    <div className="theme-token-debugger__color-input-row">
                      <Input
                        aria-label="拾色器"
                        className="theme-token-debugger__color-picker"
                        type="color"
                        value={HEX_COLOR.test(createLiteralColor) ? createLiteralColor : '#FFFFFF'}
                        onChange={event => setCreateLiteralColor(event.target.value.toUpperCase())}
                      />
                      <Input
                        aria-label="HEX 颜色"
                        placeholder="#FFFFFF"
                        spellCheck={false}
                        value={createLiteralColor}
                        onChange={event => setCreateLiteralColor(event.target.value)}
                      />
                    </div>
                  </div>
                ) : null}

                {createMode === 'mix' ? (
                  <div className="theme-token-debugger__mix-builder">
                    <OperandEditor
                      label="起始颜色 (From)"
                      operand={createMixFrom}
                      options={dropdownOptions}
                      onChange={setCreateMixFrom}
                    />
                    <OperandEditor
                      label="混入目标颜色 (To)"
                      operand={createMixTo}
                      options={dropdownOptions}
                      onChange={setCreateMixTo}
                    />
                    <label className="theme-token-debugger__field">
                      <span>混入比例：{createMixAmount}%</span>
                      <Input
                        aria-label="混入比例"
                        max={100}
                        min={0}
                        type="range"
                        value={createMixAmount}
                        onChange={event => setCreateMixAmount(Number(event.target.value))}
                      />
                    </label>
                    {createMixFrom.kind === 'literal' && createMixTo.kind === 'literal' ? (
                      <p className="theme-token-debugger__warning">
                        混色两端均为固定色，请直接使用固定色模式。
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="theme-token-debugger__panel-footer">
                  <Button
                    color="primary"
                    disabled={
                      !CUSTOM_TOKEN_NAME.test(createTokenName) ||
                      knownTokens.has(createTokenName as ThemeTokenName) ||
                      createTokenName in draft.customTokens ||
                      (createMode === 'mix' && createMixFrom.kind === 'literal' && createMixTo.kind === 'literal')
                    }
                    size="compact"
                    type="button"
                    onClick={handleCreateAndApply}
                  >
                    创建并绑定至「{creatingSlot.label}」
                  </Button>
                  <Button color="secondary" size="compact" type="button" onClick={() => setCreatingSlot(null)}>
                    取消
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Modal/Drawer: Source Token Editor */}
          {editingTokenName ? (
            <div className="theme-token-debugger__card theme-token-debugger__editor-panel">
              <div className="theme-token-debugger__editor-header">
                <div>
                  <h4>编辑 Source Token：{editingTokenName}</h4>
                  <div className="theme-token-debugger__token-meta-row">
                    <ColorDot value={editingTokenInfo?.resolvedValue ?? `var(${editingTokenName})`} />
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
                    「{editingTokenName}」是系统颜色 Token（共 {editingTokenInfo?.references ?? 0} 处引用）。
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
                    onClick={() => {
                      const fallbackSource = (selectableTokens.find(t => t !== editingTokenName) ?? selectableTokens[0]) as ThemeTokenName
                      handleEditingTokenRecipeChange(createReferenceRecipe(fallbackSource))
                    }}
                  >
                    引用 Token / 固定色
                  </Button>
                  <Button
                    color={editingTokenRecipe?.kind === 'mix' ? 'outlineActive' : 'secondary'}
                    size="compact"
                    type="button"
                    onClick={() => {
                      const fallbackSource = (selectableTokens.find(t => t !== editingTokenName) ?? selectableTokens[0]) as ThemeTokenName
                      handleEditingTokenRecipeChange(
                        createMixRecipe(
                          { kind: 'token', token: fallbackSource },
                          { kind: 'literal', color: '#FFFFFF' },
                          8,
                        ),
                      )
                    }}
                  >
                    sRGB 混色
                  </Button>
                </div>

                {editingTokenRecipe?.kind === 'reference' ? (
                  <OperandEditor
                    label="引用来源"
                    operand={editingTokenRecipe.source}
                    options={dropdownOptions.filter(o => o.value !== editingTokenName)}
                    onChange={operand => handleEditingTokenRecipeChange({ kind: 'reference', source: operand })}
                  />
                ) : null}

                {editingTokenRecipe?.kind === 'mix' ? (
                  <div className="theme-token-debugger__mix-builder">
                    <OperandEditor
                      label="起始颜色 (From)"
                      operand={editingTokenRecipe.from}
                      options={dropdownOptions.filter(o => o.value !== editingTokenName)}
                      onChange={operand => handleEditingTokenRecipeChange({ ...editingTokenRecipe, from: operand })}
                    />
                    <OperandEditor
                      label="目标颜色 (To)"
                      operand={editingTokenRecipe.to}
                      options={dropdownOptions.filter(o => o.value !== editingTokenName)}
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
                ) : (
                  <p className="theme-token-debugger__hint">
                    当前处于系统默认状态。点击上方「引用」或「混色」进行临时覆盖。
                  </p>
                )}

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
          {/* Dropdown Live Preview */}
          <div className="theme-token-debugger__card">
            <h4>Dropdown 实时预览</h4>
            <div className="theme-token-debugger__preview-triggers">
              <div className="theme-token-debugger__preview-subitem">
                <span className="theme-token-debugger__preview-label">常态 Trigger</span>
                <button
                  className="settings-dropdown-trigger"
                  data-theme-component="dropdown-trigger"
                  type="button"
                >
                  <span className="settings-dropdown-trigger-text">模型选择</span>
                  <ChevronDown aria-hidden="true" className="settings-dropdown-trigger-icon" size={14} />
                </button>
              </div>
              <div className="theme-token-debugger__preview-subitem">
                <span className="theme-token-debugger__preview-label">展开 Trigger</span>
                <button
                  className="settings-dropdown-trigger"
                  data-state="open"
                  data-theme-component="dropdown-trigger"
                  type="button"
                >
                  <span className="settings-dropdown-trigger-text">展开状态</span>
                  <ChevronDown aria-hidden="true" className="settings-dropdown-trigger-icon" size={14} />
                </button>
              </div>
              <div className="theme-token-debugger__preview-subitem">
                <span className="theme-token-debugger__preview-label">禁用 Trigger</span>
                <button
                  className="settings-dropdown-trigger"
                  data-theme-component="dropdown-trigger"
                  disabled
                  type="button"
                >
                  <span className="settings-dropdown-trigger-text">禁用状态</span>
                  <ChevronDown aria-hidden="true" className="settings-dropdown-trigger-icon" size={14} />
                </button>
              </div>
            </div>

            <div className="theme-token-debugger__preview-subitem">
              <span className="theme-token-debugger__preview-label">菜单表面 (Menu Surface)</span>
              <div
                className="theme-token-debugger__preview-surface popover-surface"
                data-theme-component="dropdown-surface"
              >
                <button className="settings-dropdown-item" type="button">
                  <div className="settings-dropdown-item-inner">
                    <div className="settings-dropdown-item-copy">
                      <span className="settings-dropdown-item-label">普通菜单项</span>
                    </div>
                  </div>
                </button>
                <button className="settings-dropdown-item" data-highlighted type="button">
                  <div className="settings-dropdown-item-inner">
                    <div className="settings-dropdown-item-copy">
                      <span className="settings-dropdown-item-label">悬停项 (Hover)</span>
                    </div>
                  </div>
                </button>
                <button aria-selected="true" className="settings-dropdown-item" type="button">
                  <div className="settings-dropdown-item-inner">
                    <div className="settings-dropdown-item-copy">
                      <span className="settings-dropdown-item-label">选中项 (Selected)</span>
                    </div>
                  </div>
                </button>
                <button className="settings-dropdown-item" data-pressed type="button">
                  <div className="settings-dropdown-item-inner">
                    <div className="settings-dropdown-item-copy">
                      <span className="settings-dropdown-item-label">按下项 (Pressed)</span>
                    </div>
                  </div>
                </button>
                <button className="settings-dropdown-item" disabled type="button">
                  <div className="settings-dropdown-item-inner">
                    <div className="settings-dropdown-item-copy">
                      <span className="settings-dropdown-item-label">禁用项 (Disabled)</span>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* WCAG Contrast Checks */}
          <div className="theme-token-debugger__card">
            <h4>Dropdown 对比度检查 (WCAG 2.1)</h4>
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
        </aside>
      </div>

      {/* Bottom Section: Token Library (Token 库 - 高级区域) */}
      <details className="theme-token-debugger__library-section">
        <summary className="theme-token-debugger__library-summary">
          <div className="theme-token-debugger__library-summary-content">
            <h4>Token 库（高级区域）</h4>
            <span className="theme-token-debugger__library-count">
              共 {tokens.length} 个运行时颜色 Token · {Object.keys(draft.customTokens).length} 个自定义 Token
            </span>
          </div>
        </summary>

        <div className="theme-token-debugger__library-body">
          <div className="theme-token-debugger__library-search">
            <Input
              aria-label="搜索颜色 Token 库"
              placeholder="搜索 Token 名称或色值 (如 --color-background, #fff, rgb...)"
              value={libraryQuery}
              onChange={event => setLibraryQuery(event.target.value)}
            />
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
                            onClick={() => handleOpenEditToken(name)}
                          >
                            编辑
                          </Button>
                          <Button
                            color="secondary"
                            size="compact"
                            type="button"
                            onClick={() => handleDeleteCustomToken(name)}
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
            <h5>系统颜色 Token</h5>
            <div className="theme-token-debugger__library-grid">
              {filteredLibraryTokens.map(token => (
                <div className="theme-token-debugger__library-item" key={token.name}>
                  <ColorDot value={token.resolvedValue} />
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
