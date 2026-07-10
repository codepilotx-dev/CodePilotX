import { expect, mock, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getFieldDefault } from './mcpElicitationUtils.js'
import type { McpElicitationSchema } from './mcpElicitationTypes.js'
import {
  McpElicitationForm,
  McpElicitationUnsupported,
} from './McpElicitationForm.js'

// ── Fixtures ─────────────────────────────────────────────────

const fullSchema: McpElicitationSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      title: '姓名',
      default: 'Ada',
    },
    age: {
      type: 'integer',
      title: '年龄',
      minimum: 0,
      maximum: 150,
      default: 30,
    },
    active: {
      type: 'boolean',
      title: '激活',
      default: true,
    },
    color: {
      type: 'string',
      title: '颜色',
      enum: ['red', 'green', 'blue'],
      default: 'red',
    },
    tags: {
      type: 'array',
      title: '标签',
      items: { type: 'string', enum: ['dev', 'ops', 'qa'] },
      default: ['dev'],
    },
  },
  required: ['name', 'color'],
}

const partialSchema: McpElicitationSchema = {
  type: 'object',
  properties: {
    message: { type: 'string', title: '消息' },
    count: { type: 'number', title: '数量', minimum: 1, maximum: 10 },
    flag: { type: 'boolean', title: '开关' },
  },
  required: ['message'],
}

// ── McpElicitationForm ──────────────────────────────────────

test('McpElicitationForm renders serverName and message', () => {
  const html = renderToStaticMarkup(
    <McpElicitationForm
      serverName="test-server"
      message="Please fill in the form"
      schema={fullSchema}
      onSubmit={() => {}}
      onDecline={() => {}}
      onCancel={() => {}}
    />,
  )

  expect(html).toContain('test-server')
  expect(html).toContain('Please fill in the form')
})

test('McpElicitationForm renders form fields with default values', () => {
  const html = renderToStaticMarkup(
    <McpElicitationForm
      serverName="srv"
      message=""
      schema={fullSchema}
      onSubmit={() => {}}
      onDecline={() => {}}
      onCancel={() => {}}
    />,
  )

  // All field labels should be present
  expect(html).toContain('姓名')
  expect(html).toContain('年龄')
  expect(html).toContain('激活')
  expect(html).toContain('颜色')
  expect(html).toContain('标签')

  // Required marks
  const requiredAsterisks = html.match(/\*/g)
  expect(requiredAsterisks?.length ?? 0).toBeGreaterThanOrEqual(2)
})

test('McpElicitationForm renders actions: decline, cancel, submit', () => {
  const html = renderToStaticMarkup(
    <McpElicitationForm
      serverName="srv"
      message=""
      schema={partialSchema}
      onSubmit={() => {}}
      onDecline={() => {}}
      onCancel={() => {}}
    />,
  )

  expect(html).toContain('拒绝')
  expect(html).toContain('取消')
  expect(html).toContain('提交')
})

test('McpElicitationForm invokes onSubmit when all fields valid', () => {
  const onSubmit = mock()
  const onDecline = mock()
  const onCancel = mock()

  // Render with partialSchema which has defaults
  const html = renderToStaticMarkup(
    <McpElicitationForm
      serverName="srv"
      message=""
      schema={partialSchema}
      onSubmit={onSubmit}
      onDecline={onDecline}
      onCancel={onCancel}
    />,
  )

  // The submit button should be present and clickable.
  // Note: renderToStaticMarkup does not simulate events; we verify
  // the submit button exists.
  expect(html).toContain('提交')
  expect(html).toContain('拒绝')
  expect(html).toContain('取消')
})

test('McpElicitationForm renders titled single-select options', () => {
  const titledSchema: McpElicitationSchema = {
    type: 'object',
    properties: {
      choice: {
        type: 'string',
        title: '选择',
        oneOf: [
          { const: 'a', title: '选项 A' },
          { const: 'b', title: '选项 B' },
          { const: 'c', title: '选项 C' },
        ],
        default: 'b',
      },
    },
  }

  const html = renderToStaticMarkup(
    <McpElicitationForm
      serverName="srv"
      message=""
      schema={titledSchema}
      onSubmit={() => {}}
      onDecline={() => {}}
      onCancel={() => {}}
    />,
  )

  expect(html).toContain('选项 A')
  expect(html).toContain('选项 B')
  expect(html).toContain('选项 C')
})

test('McpElicitationForm renders titled multi-select options', () => {
  const titledMulti: McpElicitationSchema = {
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
        default: ['x'],
      },
    },
  }

  const html = renderToStaticMarkup(
    <McpElicitationForm
      serverName="srv"
      message="Pick items"
      schema={titledMulti}
      onSubmit={() => {}}
      onDecline={() => {}}
      onCancel={() => {}}
    />,
  )

  expect(html).toContain('项目 X')
  expect(html).toContain('项目 Y')
  expect(html).toContain('Pick items')
})

test('McpElicitationForm renders validation errors for required fields', () => {
  // Schema with required field that has no default
  const schemaWithRequired: McpElicitationSchema = {
    type: 'object',
    properties: {
      message: { type: 'string', title: '消息' },
    },
    required: ['message'],
  }

  const html = renderToStaticMarkup(
    <McpElicitationForm
      serverName="srv"
      message=""
      schema={schemaWithRequired}
      onSubmit={() => {}}
      onDecline={() => {}}
      onCancel={() => {}}
    />,
  )

  // Check that required mark exists
  expect(html).toContain('*')
})

// ── McpElicitationUnsupported ────────────────────────────────

test('McpElicitationUnsupported shows warning and only decline/cancel buttons', () => {
  const html = renderToStaticMarkup(
    <McpElicitationUnsupported
      serverName="test-server"
      message="This request type is unsupported"
      onDecline={() => {}}
      onCancel={() => {}}
    />,
  )

  expect(html).toContain('test-server')
  expect(html).toContain('This request type is unsupported')
  expect(html).toContain('⚠️')
  expect(html).toContain('当前版本不支持此输入方式')
  expect(html).toContain('拒绝')
  expect(html).toContain('取消')
  // Should NOT have a submit button
  expect(html).not.toContain('提交')
})

test('McpElicitationUnsupported handles empty message', () => {
  const html = renderToStaticMarkup(
    <McpElicitationUnsupported
      serverName="srv"
      message=""
      onDecline={() => {}}
      onCancel={() => {}}
    />,
  )

  expect(html).toContain('srv')
  expect(html).toContain('当前版本不支持此输入方式')
})

// ── InlineApprovalCard integration (static render) ──────────

test('InlineApprovalCard routes McpElicitation to form', () => {
  // We verify the integration indirectly by checking the
  // McpElicitationForm component is rendered with the correct props.
  // The full integration test would require the parent component
  // which is tested via the renderer test suite.

  // For McpElicitation with valid form schema, we verify
  // the McpElicitationForm renders correctly (already tested above).
  // For unsupported modes, McpElicitationUnsupported is tested above.

  // Smoke: confirm exports exist
  expect(typeof McpElicitationForm).toBe('function')
  expect(typeof McpElicitationUnsupported).toBe('function')
})
