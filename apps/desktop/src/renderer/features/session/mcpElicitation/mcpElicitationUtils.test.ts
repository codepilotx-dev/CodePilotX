import { expect, test } from 'bun:test'
import {
  getFieldDefault,
  getSchemaMode,
  parseMcpElicitationSchema,
  validateField,
} from './mcpElicitationUtils.js'

// ── parseMcpElicitationSchema ────────────────────────────────

test('parseMcpElicitationSchema returns null for null/undefined', () => {
  expect(parseMcpElicitationSchema(null)).toBeNull()
  expect(parseMcpElicitationSchema(undefined)).toBeNull()
})

test('parseMcpElicitationSchema returns null for non-object', () => {
  expect(parseMcpElicitationSchema('string')).toBeNull()
  expect(parseMcpElicitationSchema(42)).toBeNull()
  expect(parseMcpElicitationSchema(true)).toBeNull()
})

test('parseMcpElicitationSchema returns null for wrong type', () => {
  expect(parseMcpElicitationSchema({ type: 'string' })).toBeNull()
})

test('parseMcpElicitationSchema returns null when properties is missing', () => {
  expect(parseMcpElicitationSchema({ type: 'object' })).toBeNull()
})

test('parseMcpElicitationSchema parses a valid schema with all field types', () => {
  const raw = {
    type: 'object',
    properties: {
      name: { type: 'string', title: '姓名', default: 'Ada' },
      age: { type: 'integer', title: '年龄', minimum: 0, maximum: 150 },
      active: { type: 'boolean', title: '激活', default: true },
      color: {
        type: 'string',
        title: '颜色',
        enum: ['red', 'green', 'blue'],
        default: 'red',
      },
      tags: {
        type: 'array',
        title: '标签',
        items: { type: 'string', enum: ['a', 'b', 'c'] },
        default: ['a'],
      },
    },
    required: ['name', 'color'],
    $schema: 'https://mcp.example.com/schema',
  }

  const result = parseMcpElicitationSchema(raw)
  expect(result).not.toBeNull()
  expect(result!.type).toBe('object')
  expect(Object.keys(result!.properties)).toEqual([
    'name',
    'age',
    'active',
    'color',
    'tags',
  ])
  expect(result!.required).toEqual(['name', 'color'])
  expect(result!.$schema).toBe('https://mcp.example.com/schema')

  // String field
  const nameField = result!.properties.name
  expect(nameField).toBeDefined()
  expect(nameField!.type).toBe('string')
  expect((nameField as { title: string }).title).toBe('姓名')

  // Number field
  const ageField = result!.properties.age
  expect(ageField!.type).toBe('integer')
  expect((ageField as { minimum: number }).minimum).toBe(0)

  // Boolean field
  const activeField = result!.properties.active
  expect(activeField!.type).toBe('boolean')
  expect((activeField as { default: boolean }).default).toBe(true)
})

test('parseMcpElicitationSchema handles empty properties', () => {
  const result = parseMcpElicitationSchema({
    type: 'object',
    properties: {},
  })
  expect(result).not.toBeNull()
  expect(result!.properties).toEqual({})
})

test('parseMcpElicitationSchema skips unrecognised field schemas', () => {
  const raw = {
    type: 'object',
    properties: {
      valid: { type: 'string' },
      invalid: { type: 'unknown' },
    },
  }
  const result = parseMcpElicitationSchema(raw)
  expect(result).not.toBeNull()
  expect(Object.keys(result!.properties)).toEqual(['valid'])
})

test('parseMcpElicitationSchema parses titled single-select (oneOf)', () => {
  const raw = {
    type: 'object',
    properties: {
      choice: {
        type: 'string',
        title: '选择',
        oneOf: [
          { const: 'a', title: '选项 A' },
          { const: 'b', title: '选项 B' },
        ],
        default: 'a',
      },
    },
  }
  const result = parseMcpElicitationSchema(raw)
  expect(result).not.toBeNull()
  const field = result!.properties.choice
  expect(field).toBeDefined()
  expect(field!.type).toBe('string')
  const sf = field as { oneOf: Array<{ const: string; title: string }> }
  expect(sf.oneOf).toHaveLength(2)
  expect(sf.oneOf[0].const).toBe('a')
  expect(sf.oneOf[0].title).toBe('选项 A')
})

test('parseMcpElicitationSchema parses titled multi-select (items.anyOf)', () => {
  const raw = {
    type: 'object',
    properties: {
      picks: {
        type: 'array',
        title: '多选',
        items: {
          anyOf: [
            { const: 'x', title: '项目 X' },
            { const: 'y', title: '项目 Y' },
          ],
        },
      },
    },
  }
  const result = parseMcpElicitationSchema(raw)
  expect(result).not.toBeNull()
  const field = result!.properties.picks
  expect(field).toBeDefined()
  expect(field!.type).toBe('array')
})

// ── getFieldDefault ─────────────────────────────────────────

test('getFieldDefault returns default for string', () => {
  const result = getFieldDefault({ type: 'string', default: 'hello' })
  expect(result).toBe('hello')
})

test('getFieldDefault returns empty string when no default for string', () => {
  const result = getFieldDefault({ type: 'string' })
  expect(result).toBe('')
})

test('getFieldDefault returns default for number', () => {
  const result = getFieldDefault({ type: 'number', default: 42 })
  expect(result).toBe(42)
})

test('getFieldDefault returns null when no default for number', () => {
  const result = getFieldDefault({ type: 'number' })
  expect(result).toBeNull()
})

test('getFieldDefault returns default for boolean', () => {
  const result = getFieldDefault({ type: 'boolean', default: true })
  expect(result).toBe(true)
})

test('getFieldDefault returns false when no default for boolean', () => {
  const result = getFieldDefault({ type: 'boolean' })
  expect(result).toBe(false)
})

test('getFieldDefault returns default array for multi-select', () => {
  const result = getFieldDefault({
    type: 'array',
    default: ['a'],
    items: { type: 'string', enum: ['a', 'b'] },
  })
  expect(result).toEqual(['a'])
})

test('getFieldDefault returns empty array when no default for multi-select', () => {
  const result = getFieldDefault({
    type: 'array',
    items: { type: 'string', enum: ['a', 'b'] },
  })
  expect(result).toEqual([])
})

// ── validateField ────────────────────────────────────────────

test('validateField returns error for required empty string', () => {
  const error = validateField({ type: 'string' }, '', true)
  expect(error).toBe('此字段为必填项')
})

test('validateField returns null for required filled string', () => {
  const error = validateField({ type: 'string' }, 'hello', true)
  expect(error).toBeNull()
})

test('validateField checks minLength', () => {
  const error = validateField(
    { type: 'string', minLength: 3 },
    'ab',
    false,
  )
  expect(error).toBe('最少需要 3 个字符')
})

test('validateField checks maxLength', () => {
  const error = validateField(
    { type: 'string', maxLength: 5 },
    'too long',
    false,
  )
  expect(error).toBe('最多 5 个字符')
})

test('validateField returns null for valid string length', () => {
  const error = validateField(
    { type: 'string', minLength: 2, maxLength: 5 },
    'ok',
    false,
  )
  expect(error).toBeNull()
})

test('validateField checks number minimum', () => {
  const error = validateField({ type: 'number', minimum: 10 }, 5, false)
  expect(error).toBe('最小值 10')
})

test('validateField checks number maximum', () => {
  const error = validateField({ type: 'number', maximum: 100 }, 200, false)
  expect(error).toBe('最大值 100')
})

test('validateField checks integer type', () => {
  const error = validateField({ type: 'integer' }, 3.14, false)
  expect(error).toBe('请输入整数')
})

test('validateField returns null for valid number', () => {
  const error = validateField(
    { type: 'number', minimum: 0, maximum: 100 },
    50,
    false,
  )
  expect(error).toBeNull()
})

test('validateField returns null for valid boolean', () => {
  const error = validateField({ type: 'boolean' }, true, false)
  expect(error).toBeNull()
})

test('validateField returns error for boolean required but not set', () => {
  const error = validateField({ type: 'boolean' }, false, true)
  // false is a valid boolean value, so it should pass
  expect(error).toBeNull()
})

test('validateField checks multi-select minItems', () => {
  const error = validateField(
    {
      type: 'array',
      minItems: 2,
      items: { type: 'string', enum: ['a', 'b', 'c'] },
    },
    ['a'],
    false,
  )
  expect(error).toBe('至少选择 2 项')
})

test('validateField checks multi-select maxItems', () => {
  const error = validateField(
    {
      type: 'array',
      maxItems: 1,
      items: { type: 'string', enum: ['a', 'b', 'c'] },
    },
    ['a', 'b'],
    false,
  )
  expect(error).toBe('最多选择 1 项')
})

test('validateField returns null for valid multi-select', () => {
  const error = validateField(
    {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: { type: 'string', enum: ['a', 'b', 'c'] },
    },
    ['a', 'b'],
    false,
  )
  expect(error).toBeNull()
})

test('validateField returns null for non-required empty value', () => {
  const error = validateField({ type: 'string' }, '', false)
  expect(error).toBeNull()
})

// ── getSchemaMode ───────────────────────────────────────────

test('getSchemaMode returns form for valid form schema', () => {
  const mode = getSchemaMode({
    mode: 'form',
    requestedSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
    },
  })
  expect(mode).toBe('form')
})

test('getSchemaMode returns unsupported for openai/form mode', () => {
  const mode = getSchemaMode({
    mode: 'openai/form',
    requestedSchema: { type: 'object' },
  })
  expect(mode).toBe('unsupported')
})

test('getSchemaMode returns unsupported for url mode', () => {
  const mode = getSchemaMode({
    mode: 'url',
    url: 'https://example.com',
    elicitationId: 'abc',
  })
  expect(mode).toBe('unsupported')
})

test('getSchemaMode returns unsupported when mode is missing', () => {
  const mode = getSchemaMode({
    message: 'Hello',
  })
  expect(mode).toBe('unsupported')
})

test('getSchemaMode returns unsupported when schema is invalid', () => {
  const mode = getSchemaMode({
    mode: 'form',
    requestedSchema: { type: 'invalid' },
  })
  expect(mode).toBe('unsupported')
})

test('getSchemaMode returns unsupported for undefined request', () => {
  expect(getSchemaMode(undefined)).toBe('unsupported')
})
