import { expect, test } from 'bun:test'
import type { ParsedPowerShellCommand } from '../../utils/powershell/parser.js'
import { powershellCommandIsSafe } from './powershellSecurity.js'

function parsedPipeline(
  commands: ParsedPowerShellCommand['statements'][number]['commands'],
): ParsedPowerShellCommand {
  return {
    valid: true,
    errors: [],
    statements: [
      {
        statementType: 'PipelineAst',
        commands,
        redirections: [],
        text: commands.map(command => command.text).join(' | '),
        securityPatterns: {
          hasScriptBlocks: commands.some(command =>
            command.elementTypes?.includes('ScriptBlock'),
          ),
        },
      },
    ],
    variables: [],
    hasStopParsing: false,
    originalCommand: commands.map(command => command.text).join(' | '),
  }
}

test('allows safe script block consumers in a read-only pipeline', () => {
  const parsed = parsedPipeline([
    {
      name: 'Get-ChildItem',
      nameType: 'cmdlet',
      elementType: 'CommandAst',
      args: ['-Path', 'apps/tui/src', '-Recurse'],
      text: 'Get-ChildItem -Path apps/tui/src -Recurse',
      elementTypes: [
        'StringConstant',
        'Parameter',
        'StringConstant',
        'Parameter',
      ],
    },
    {
      name: 'Where-Object',
      nameType: 'cmdlet',
      elementType: 'CommandAst',
      args: ['{ $_.Name -like "*.ts" }'],
      text: 'Where-Object { $_.Name -like "*.ts" }',
      elementTypes: ['StringConstant', 'ScriptBlock'],
    },
    {
      name: 'Select-Object',
      nameType: 'cmdlet',
      elementType: 'CommandAst',
      args: ['-First', '10'],
      text: 'Select-Object -First 10',
      elementTypes: ['StringConstant', 'Parameter', 'StringConstant'],
    },
  ])

  expect(
    powershellCommandIsSafe(parsed.originalCommand, parsed),
  ).toMatchObject({
    behavior: 'passthrough',
  })
})

test('still asks for dangerous script block consumers', () => {
  const parsed = parsedPipeline([
    {
      name: 'Invoke-Command',
      nameType: 'cmdlet',
      elementType: 'CommandAst',
      args: ['{ Get-Process }'],
      text: 'Invoke-Command { Get-Process }',
      elementTypes: ['StringConstant', 'ScriptBlock'],
    },
  ])

  expect(
    powershellCommandIsSafe(parsed.originalCommand, parsed),
  ).toMatchObject({
    behavior: 'ask',
  })
})
