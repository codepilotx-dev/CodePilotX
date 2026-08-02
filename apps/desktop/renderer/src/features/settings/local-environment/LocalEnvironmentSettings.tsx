import React from 'react'
import { useSearchParams } from 'react-router-dom'
import * as Popover from '@radix-ui/react-popover'
import { Button } from '../../../components/ui/Button.js'
import { buildPopoverSizingStyle } from '../../../components/ui/popoverSizing.js'
import { environmentDomainClient, type EnvironmentReadResult } from '../../../services/desktop-client/environment-domain-client.js'
import { SettingsContentArea } from '../SettingsContentArea.js'
import { SettingsSection } from '../SettingsSection.js'
import { SettingsRow } from '../SettingsRow.js'
import {
  EMPTY_ENVIRONMENT_ACTION,
  buildEnvironmentConfigEdits,
  environmentActionsValue,
  type EnvironmentActionEditorValue,
  type EnvironmentPlatformCommand,
} from './localEnvironmentEditorModel.js'

type Props = { onError: (message: string) => void; onNotice?: (message: string) => void }
type PlatformCommand = EnvironmentPlatformCommand

export const WORKTREE_SETUP_VARIABLES = [
  {
    name: 'CODEPILOTX_SOURCE_TREE_PATH',
    description: '源任务的权威工作区路径',
  },
  {
    name: 'CODEPILOTX_WORKTREE_PATH',
    description: '新托管工作树的路径',
  },
] as const

export function LocalEnvironmentSettings({ onError, onNotice }: Props): React.ReactNode {
  const [params] = useSearchParams()
  const threadId = params.get('threadId') ?? ''
  const client = React.useMemo(() => environmentDomainClient(), [])
  const [source, setSource] = React.useState<EnvironmentReadResult | null>(null)
  const [name, setName] = React.useState('')
  const [setup, setSetup] = React.useState<PlatformCommand>({ script: '' })
  const [cleanup, setCleanup] = React.useState<PlatformCommand>({ script: '' })
  const [actions, setActions] = React.useState<EnvironmentActionEditorValue[]>([])
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    if (!threadId) return
    const result = await client.readEnvironment(threadId)
    setSource(result)
    setName(stringValue(result.config.name))
    setSetup(commandValue(result.config.setup))
    setCleanup(commandValue(result.config.cleanup))
    setActions(environmentActionsValue(result.config.actions))
  }, [client, threadId])

  React.useEffect(() => { void load().catch(cause => onError(message(cause))) }, [load, onError])

  const save = async () => {
    if (!source) return
    setSaving(true)
    try {
      const edits = buildEnvironmentConfigEdits({
        original: source.config,
        name,
        setup,
        cleanup,
        actions,
      })
      await client.updateEnvironment({ threadId, expectedRevision: source.revision, edits })
      await load()
      onNotice?.('环境配置已保存；脚本执行信任已撤销，请重新确认。')
    } catch (cause) { onError(message(cause)) } finally { setSaving(false) }
  }

  const updateTrust = async (decision: 'allow' | 'revoke') => {
    if (!source) return
    setSaving(true)
    try {
      await client.updateEnvironment({
        threadId,
        expectedRevision: source.revision,
        trust: { configHash: source.configHash, decision },
      })
      await load()
      onNotice?.(decision === 'allow' ? '已允许执行当前配置版本。' : '已撤销环境脚本执行信任。')
    } catch (cause) { onError(message(cause)) } finally { setSaving(false) }
  }

  if (!threadId) return <SettingsContentArea><SettingsSection title="Local environment" description="请从任务页打开环境设置。"><p className="settings-empty-copy">缺少 threadId，无法确定配置发现范围。</p></SettingsSection></SettingsContentArea>
  if (!source) return <SettingsContentArea><p className="settings-empty-copy">正在读取环境配置…</p></SettingsContentArea>

  return (
    <SettingsContentArea>
      <SettingsSection
        title="Local environment"
        description={`${source.filePath}。按 key-path 保存，文件中的注释和未知键由 Agent 保留。`}
        actions={<Button loading={saving} onClick={() => void save()}>保存</Button>}
      >
        <SettingsRow title="名称" control={<input className="confirmation-dialog-input" value={name} onChange={event => setName(event.target.value)} />} />
        <div className="tw:flex tw:items-center tw:justify-between tw:gap-3 tw:p-3">
          <div>
            <strong>Setup</strong>
            <p className="tw:m-0 tw:text-xs tw:text-app-text-soft">
              创建托管工作树时在新工作树目录下运行。
            </p>
          </div>
          <SetupVariablesPopover />
        </div>
        <CommandRows label="Setup" value={setup} onChange={setSetup} />
        <CommandRows label="Cleanup" value={cleanup} onChange={setCleanup} />
        <div className="tw:grid tw:gap-2 tw:p-3">
          <div className="tw:flex tw:items-center tw:justify-between tw:gap-3">
            <div><strong>Actions</strong><p className="tw:text-xs tw:text-app-text-soft">每个 Action 可提供默认命令和三平台覆盖。</p></div>
            <Button disabled={saving} onClick={() => setActions(current => [...current, { ...EMPTY_ENVIRONMENT_ACTION }])}>添加 Action</Button>
          </div>
          {actions.map((action, index) => (
            <article className="settings-card tw:grid tw:gap-2 tw:p-3" key={index}>
              <div className="tw:grid tw:grid-cols-2 tw:gap-2">
                {(['name', 'icon', 'command', 'windows', 'macos', 'linux'] as const).map(field => (
                  <label className={field === 'command' ? 'tw:col-span-2 tw:grid tw:gap-1' : 'tw:grid tw:gap-1'} key={field}>
                    <span className="tw:text-xs tw:text-app-text-soft">{actionFieldLabel[field]}</span>
                    <input
                      className="confirmation-dialog-input"
                      value={action[field]}
                      onChange={event => setActions(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: event.target.value } : item))}
                    />
                  </label>
                ))}
              </div>
              <div className="tw:flex tw:justify-end"><Button disabled={saving} tone="danger" onClick={() => setActions(current => current.filter((_, itemIndex) => itemIndex !== index))}>删除 Action</Button></div>
            </article>
          ))}
          {actions.length === 0 ? <p className="settings-empty-copy">暂无 Action。</p> : null}
        </div>
      </SettingsSection>
      <SettingsSection title="执行信任" description="配置 hash 改变后必须重新确认；信任记录不保存脚本文本。">
        <SettingsRow
          title={source.executionTrusted ? '当前配置已信任' : '当前配置未信任'}
          control={source.executionTrusted
            ? <Button disabled={saving} onClick={() => void updateTrust('revoke')}>撤销信任</Button>
            : <Button disabled={saving} onClick={() => void updateTrust('allow')}>允许执行当前版本</Button>}
        />
      </SettingsSection>
    </SettingsContentArea>
  )
}

function SetupVariablesPopover(): React.ReactNode {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button>变量</Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          className="popover-surface popover tw:grid tw:gap-3 tw:p-3 tw:text-app-text"
          collisionPadding={8}
          sideOffset={6}
          style={buildPopoverSizingStyle({ width: 320, maxWidth: 'calc(100vw - 2rem)' })}
        >
          <div>
            <strong className="tw:text-sm">设置脚本环境变量</strong>
            <p className="tw:m-0 tw:mt-1 tw:text-xs tw:text-app-text-soft">
              创建托管工作树时由 Agent 注入；这里只显示变量名，不显示路径值。
            </p>
          </div>
          {WORKTREE_SETUP_VARIABLES.map(variable => (
            <EnvironmentVariable {...variable} key={variable.name} />
          ))}
          <Popover.Arrow className="popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function EnvironmentVariable({
  description,
  name,
}: {
  description: string
  name: string
}): React.ReactNode {
  return (
    <div className="tw:grid tw:gap-1">
      <span className="tw:text-xs tw:text-app-text-soft">{description}</span>
      <code className="tw:rounded-md tw:bg-app-canvas tw:px-2 tw:py-1 tw:font-mono tw:text-xs">
        {name}
      </code>
    </div>
  )
}

function CommandRows({ label, value, onChange }: { label: string; value: PlatformCommand; onChange: (value: PlatformCommand) => void }) {
  return <>
    {(['script', 'windows', 'macos', 'linux'] as const).map(field => (
      <SettingsRow
        key={`${label}-${field}`}
        title={`${label} ${field}`}
        control={<textarea className="confirmation-dialog-input tw:min-h-20 tw:min-w-96 tw:font-mono" value={value[field] ?? ''} onChange={event => onChange({ ...value, [field]: event.target.value })} />}
      />
    ))}
  </>
}

function commandValue(value: unknown): PlatformCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { script: '' }
  const record = value as Record<string, unknown>
  return {
    script: stringValue(record.script),
    ...optionalString('windows', record.windows),
    ...optionalString('macos', record.macos),
    ...optionalString('linux', record.linux),
  }
}
function optionalString<K extends string>(key: K, value: unknown): Partial<Record<K, string>> { return typeof value === 'string' ? { [key]: value } as Record<K, string> : {} }
function stringValue(value: unknown) { return typeof value === 'string' ? value : '' }
function message(cause: unknown) { return cause instanceof Error ? cause.message : '环境配置操作失败。' }

const actionFieldLabel: Record<Exclude<keyof EnvironmentActionEditorValue, 'sourceIndex'>, string> = {
  name: '名称',
  icon: '图标',
  command: '默认命令',
  windows: 'Windows 覆盖',
  macos: 'macOS 覆盖',
  linux: 'Linux 覆盖',
}
