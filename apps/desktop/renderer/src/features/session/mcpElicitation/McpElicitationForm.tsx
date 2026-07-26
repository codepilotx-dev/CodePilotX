import { CornerDownLeft, X } from 'lucide-react'
import React from 'react'
import { Button } from '../../../components/ui/Button.js'
import type {
  McpElicitationBooleanSchema,
  McpElicitationConstOption,
  McpElicitationMultiSelectEnumSchema,
  McpElicitationNumberSchema,
  McpElicitationPrimitiveSchema,
  McpElicitationSchema,
  McpElicitationSingleSelectEnumSchema,
  McpElicitationStringSchema,
} from './mcpElicitationTypes.js'
import { getFieldDefault, validateField } from './mcpElicitationUtils.js'

// ── Props ────────────────────────────────────────────────────

export type McpElicitationFormProps = {
  serverName: string
  message: string
  schema: McpElicitationSchema
  onSubmit: (content: Record<string, unknown>) => void
  onDecline: () => void
  onCancel: () => void
}

// ── Main component ───────────────────────────────────────────

export function McpElicitationForm({
  serverName,
  message,
  schema,
  onSubmit,
  onDecline,
  onCancel,
}: McpElicitationFormProps): React.ReactNode {
  const fieldNames = Object.keys(schema.properties)

  // Initialise values from schema defaults
  const [formValues, setFormValues] = React.useState<
    Record<string, unknown>
  >(() => {
    const initial: Record<string, unknown> = {}
    for (const key of fieldNames) {
      const fieldSchema = schema.properties[key]
      if (fieldSchema) {
        initial[key] = getFieldDefault(fieldSchema)
      }
    }
    return initial
  })

  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [submitted, setSubmitted] = React.useState(false)

  const updateField = (name: string, value: unknown): void => {
    setFormValues((prev) => ({ ...prev, [name]: value }))
    // Clear error on change after first submit attempt
    if (submitted) {
      const fieldSchema = schema.properties[name]
      const isRequired = schema.required?.includes(name) ?? false
      const error = fieldSchema
        ? validateField(fieldSchema, value, isRequired)
        : null
      setErrors((prev) => {
        const next = { ...prev }
        if (error) {
          next[name] = error
        } else {
          delete next[name]
        }
        return next
      })
    }
  }

  const handleSubmit = (): void => {
    setSubmitted(true)
    // Validate all fields
    const newErrors: Record<string, string> = {}
    for (const name of fieldNames) {
      const fieldSchema = schema.properties[name]
      const isRequired = schema.required?.includes(name) ?? false
      if (fieldSchema) {
        const error = validateField(fieldSchema, formValues[name], isRequired)
        if (error) newErrors[name] = error
      }
    }
    setErrors(newErrors)

    if (Object.keys(newErrors).length > 0) return

    // Build content object for accepted elicitation
    const content: Record<string, unknown> = {}
    for (const name of fieldNames) {
      const val = formValues[name]
      // Convert '' to null for number fields so the content doesn't
      // include unset numeric defaults
      if (val === '' || val === null || val === undefined) {
        const fieldSchema = schema.properties[name]
        if (fieldSchema?.type === 'number' || fieldSchema?.type === 'integer') {
          content[name] = null
        } else {
          content[name] = val
        }
      } else {
        content[name] = val
      }
    }
    onSubmit(content)
  }

  const hasErrors = Object.keys(errors).length > 0

  return (
    <section
      className="inline-approval-card workflow-composer-card workflow-composer-card-mcp-form"
      data-variant="mcp-form"
      aria-label="MCP 表单"
    >
      <header className="inline-approval-header">
        <h2>MCP 服务器 &ldquo;{serverName}&rdquo; 请求输入</h2>
      </header>

      {message ? (
        <p className="mcp-form-message">{message}</p>
      ) : null}

      <div className="mcp-form-fields">
        {fieldNames.map((name) => {
          const fieldSchema = schema.properties[name]
          if (!fieldSchema) return null
          const isRequired = schema.required?.includes(name) ?? false
          return (
            <McpFormField
              key={name}
              name={name}
              schema={fieldSchema}
              value={formValues[name]}
              error={submitted ? errors[name] : undefined}
              isRequired={isRequired}
              onChange={(val) => updateField(name, val)}
            />
          )
        })}
      </div>

      {hasErrors && submitted ? (
        <p className="mcp-form-error-summary">
          请修正标红的字段后再提交
        </p>
      ) : null}

      <div className="mcp-form-actions">
        <Button
          tone="danger"
          onClick={onDecline}
        >
          拒绝
        </Button>
        <Button
          onClick={onCancel}
        >
          <X size={14} />
          取消
        </Button>
        <Button
          onClick={handleSubmit}
        >
          提交
          <CornerDownLeft size={14} />
        </Button>
      </div>
    </section>
  )
}

// ── Unsupported-mode fallback card ───────────────────────────

export type McpElicitationUnsupportedProps = {
  serverName: string
  message: string
  onDecline: () => void
  onCancel: () => void
}

export function McpElicitationUnsupported({
  serverName,
  message,
  onDecline,
  onCancel,
}: McpElicitationUnsupportedProps): React.ReactNode {
  return (
    <section
      className="inline-approval-card workflow-composer-card workflow-composer-card-mcp-unsupported"
      data-variant="mcp-unsupported"
      aria-label="不支持的 MCP 请求"
    >
      <header className="inline-approval-header">
        <h2>MCP 服务器 &ldquo;{serverName}&rdquo; 请求输入</h2>
      </header>

      {message ? (
        <p className="mcp-form-message">{message}</p>
      ) : null}

      <div className="mcp-form-unsupported">
        <span className="mcp-form-unsupported-icon" aria-hidden="true">
          ⚠️
        </span>
        <p>当前版本不支持此输入方式。</p>
      </div>

      <div className="mcp-form-actions">
        <Button
          tone="danger"
          onClick={onDecline}
        >
          拒绝
        </Button>
        <Button
          onClick={onCancel}
        >
          <X size={14} />
          取消
        </Button>
      </div>
    </section>
  )
}

// ── Individual form field ────────────────────────────────────

function McpFormField({
  name,
  schema,
  value,
  error,
  isRequired,
  onChange,
}: {
  name: string
  schema: McpElicitationPrimitiveSchema
  value: unknown
  error?: string
  isRequired: boolean
  onChange: (value: unknown) => void
}): React.ReactNode {
  const label = fieldLabel(name, schema)
  const description = fieldDescription(schema)

  return (
    <div
      className={
        error
          ? 'mcp-form-field mcp-form-field-error'
          : 'mcp-form-field'
      }
    >
      <label className="mcp-form-field-label" htmlFor={`mcp-field-${name}`}>
        {label}
        {isRequired ? (
          <span className="mcp-form-required-mark" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      {description ? (
        <p className="mcp-form-field-desc">{description}</p>
      ) : null}

      <FieldInput
        name={name}
        schema={schema}
        value={value}
        onChange={onChange}
      />

      {error ? (
        <p className="mcp-form-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

// ── Field input dispatcher ───────────────────────────────────

function FieldInput({
  name,
  schema,
  value,
  onChange,
}: {
  name: string
  schema: McpElicitationPrimitiveSchema
  value: unknown
  onChange: (value: unknown) => void
}): React.ReactNode {
  switch (schema.type) {
    case 'string':
      return isSingleSelectEnum(schema) ? (
        <SingleSelectField
          name={name}
          schema={schema}
          value={value as string}
          onChange={onChange}
        />
      ) : (
        <TextField
          name={name}
          schema={schema}
          value={value as string}
          onChange={onChange}
        />
      )
    case 'number':
    case 'integer':
      return (
        <NumberField
          name={name}
          schema={schema}
          value={value as number | null}
          onChange={onChange}
        />
      )
    case 'boolean':
      return (
        <BooleanField
          name={name}
          schema={schema}
          value={value as boolean}
          onChange={onChange}
        />
      )
    case 'array':
      return (
        <MultiSelectField
          name={name}
          schema={schema}
          value={value as string[]}
          onChange={onChange}
        />
      )
    default:
      return null
  }
}

function isSingleSelectEnum(
  schema: McpElicitationStringSchema | McpElicitationSingleSelectEnumSchema,
): schema is McpElicitationSingleSelectEnumSchema {
  return Array.isArray((schema as McpElicitationSingleSelectEnumSchema).enum) ||
    Array.isArray((schema as McpElicitationSingleSelectEnumSchema).oneOf)
}

// ── Text field ───────────────────────────────────────────────

function TextField({
  name,
  schema,
  value,
  onChange,
}: {
  name: string
  schema: McpElicitationStringSchema
  value: string
  onChange: (value: unknown) => void
}): React.ReactNode {
  const placeholder = buildPlaceholder(schema)
  return (
    <input
      id={`mcp-field-${name}`}
      className="mcp-form-field-input"
      type="text"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

// ── Number field ─────────────────────────────────────────────

function NumberField({
  name,
  schema,
  value,
  onChange,
}: {
  name: string
  schema: McpElicitationNumberSchema
  value: number | null
  onChange: (value: unknown) => void
}): React.ReactNode {
  const placeholder = buildPlaceholder(schema)
  return (
    <input
      id={`mcp-field-${name}`}
      className="mcp-form-field-input"
      type="number"
      value={value ?? ''}
      placeholder={placeholder}
      step={schema.type === 'integer' ? '1' : undefined}
      onChange={(e) => {
        const raw = e.target.value
        if (raw === '') {
          onChange(null)
        } else {
          onChange(schema.type === 'integer' ? parseInt(raw, 10) : parseFloat(raw))
        }
      }}
    />
  )
}

// ── Boolean (toggle) ─────────────────────────────────────────

function BooleanField({
  name,
  schema,
  value,
  onChange,
}: {
  name: string
  schema: McpElicitationBooleanSchema
  value: boolean
  onChange: (value: unknown) => void
}): React.ReactNode {
  return (
    <button
      id={`mcp-field-${name}`}
      type="button"
      role="switch"
      aria-checked={value}
      className={
        value
          ? 'mcp-form-boolean mcp-form-boolean-on'
          : 'mcp-form-boolean'
      }
      onClick={() => onChange(!value)}
    >
      <span className="mcp-form-boolean-thumb" />
      <span className="mcp-form-boolean-label">
        {value ? '是' : '否'}
      </span>
    </button>
  )
}

// ── Single-select (radio) ────────────────────────────────────

function SingleSelectField({
  name,
  schema,
  value,
  onChange,
}: {
  name: string
  schema: McpElicitationSingleSelectEnumSchema
  value: string
  onChange: (value: unknown) => void
}): React.ReactNode {
  const options = getSelectOptions(schema)
  return (
    <div className="mcp-form-option-group" role="radiogroup">
      {options.map((option) => {
        const isSelected = value === option.value
        return (
          <button
            key={option.value}
            id={isSelected ? `mcp-field-${name}` : undefined}
            type="button"
            role="radio"
            aria-checked={isSelected}
            className={
              isSelected
                ? 'mcp-form-option selected'
                : 'mcp-form-option'
            }
            onClick={() => onChange(option.value)}
          >
            <span className="mcp-form-option-index">
              {option.label[0]?.toUpperCase() ?? '?'}
            </span>
            <span className="mcp-form-option-label">
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ── Multi-select (checkbox) ──────────────────────────────────

function MultiSelectField({
  name,
  schema,
  value,
  onChange,
}: {
  name: string
  schema: McpElicitationMultiSelectEnumSchema
  value: string[]
  onChange: (value: unknown) => void
}): React.ReactNode {
  const options = getMultiSelectOptions(schema)
  const selectedSet = new Set(value ?? [])

  const toggle = (optValue: string): void => {
    const next = new Set(selectedSet)
    if (next.has(optValue)) {
      next.delete(optValue)
    } else {
      next.add(optValue)
    }
    onChange(Array.from(next))
  }

  return (
    <div className="mcp-form-option-group" role="group">
      {options.map((option) => {
        const isSelected = selectedSet.has(option.value)
        return (
          <button
            key={option.value}
            type="button"
            role="checkbox"
            aria-checked={isSelected}
            className={
              isSelected
                ? 'mcp-form-option selected'
                : 'mcp-form-option'
            }
            onClick={() => toggle(option.value)}
          >
            <span className="mcp-form-option-index">
              {isSelected ? '✓' : ''}
            </span>
            <span className="mcp-form-option-label">
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────

function getSelectOptions(
  schema: McpElicitationSingleSelectEnumSchema,
): Array<{ value: string; label: string }> {
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map((opt) => ({
      value: opt.const,
      label: opt.title,
    }))
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((val) => ({
      value: val,
      label: val,
    }))
  }
  return []
}

function getMultiSelectOptions(
  schema: McpElicitationMultiSelectEnumSchema,
): Array<{ value: string; label: string }> {
  if ('anyOf' in schema.items) {
    return schema.items.anyOf.map((opt) => ({
      value: opt.const,
      label: opt.title,
    }))
  }
  if (Array.isArray(schema.items.enum)) {
    return schema.items.enum.map((val) => ({
      value: val,
      label: val,
    }))
  }
  return []
}

function fieldLabel(
  name: string,
  schema: McpElicitationPrimitiveSchema,
): string {
  return schema.title ?? name
}

function fieldDescription(
  schema: McpElicitationPrimitiveSchema,
): string | undefined {
  return schema.description
}

function buildPlaceholder(
  schema: McpElicitationStringSchema | McpElicitationNumberSchema,
): string {
  const parts: string[] = []
  if (schema.type === 'string') {
    const s = schema as McpElicitationStringSchema
    if (s.minLength !== undefined) parts.push(`≥${s.minLength}`)
    if (s.maxLength !== undefined) parts.push(`≤${s.maxLength}`)
  } else {
    const n = schema as McpElicitationNumberSchema
    if (n.minimum !== undefined) parts.push(`≥${n.minimum}`)
    if (n.maximum !== undefined) parts.push(`≤${n.maximum}`)
  }
  return parts.length > 0 ? parts.join(', ') : ''
}
