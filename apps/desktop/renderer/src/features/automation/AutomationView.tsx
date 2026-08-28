import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlarmClock, CalendarClock, CheckCircle2, ChevronDown, FileSearch, LoaderCircle, MoreHorizontal, Pause, Play, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { Automation, AutomationRun } from '@codepilotx/shared/automation'
import { Button } from '../../components/ui/Button.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { PopoverItem } from '../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../components/ui/PopoverMenu.js'
import { SearchInput } from '../../components/ui/SearchInput.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { SkeletonBlock, SkeletonRegion } from '../../components/ui/Skeleton.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { PrimaryPageLayout } from '../layout/primary-page/index.js'
import { WorkspaceHeaderItem } from '../layout/workspace-header/index.js'
import { composerDraftStore } from '../session/composer/composerDraftStore.js'
import { AutomationDetailPanel } from './AutomationDetailPanel.js'
import {
  AUTOMATION_TEMPLATES,
  automationScheduleSummary,
  defaultAutomationDraft,
  formatAutomationRelativeTime,
  hasActiveAutomationRun,
  isCompletedAutomation,
  type AutomationFilter,
  type AutomationTemplate,
  type AutomationTemplateId,
} from './automationModel.js'
import { useAutomationController } from './useAutomationController.js'

type ConfirmState = { kind: 'delete'; automation: Automation } | { kind: 'discard' } | null
const FILTER_OPTIONS: Array<{ value: AutomationFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '已开启' },
  { value: 'paused', label: '已暂停' },
  { value: 'completed', label: '已完成' },
]

export function AutomationView(): React.ReactNode {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('automationId')
  const creating = params.get('automationMode') === 'create'
  const controller = useAutomationController(selectedId)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [rowMenuId, setRowMenuId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const defaultModel = useMemo(() => {
    const session = controller.sessions.find(item => item.providerID && item.model)
    return { providerID: session?.providerID ?? 'openai', id: session?.model ?? 'gpt-5' } as Automation['model']
  }, [controller.sessions])
  const visibleSuggestions = useMemo(() => {
    if (controller.filter !== 'all') return []
    const needle = controller.query.trim().toLocaleLowerCase()
    return AUTOMATION_TEMPLATES.filter(
      template =>
        !controller.automations.some(
          automation =>
            automation.name === template.name &&
            automation.prompt === template.prompt,
        ),
    ).filter(template => {
      if (!needle) return true
      return [
        template.name,
        template.description,
        template.prompt,
        automationScheduleSummary(template.schedule),
      ]
        .join('\n')
        .toLocaleLowerCase()
        .includes(needle)
    })
  }, [controller.automations, controller.filter, controller.query])
  const showInitialEmpty =
    controller.filter === 'all' &&
    controller.query.trim() === '' &&
    controller.automations.length === 0

  useEffect(() => {
    if (!creating || controller.draft || controller.loading) return
    controller.beginCreate(defaultAutomationDraft({
      projectId: controller.projects[0]?.projectId ?? null,
      model: defaultModel,
    }))
  }, [controller, creating, defaultModel])

  function rememberFocus(): void {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  function restoreFocus(): void {
    const target = returnFocusRef.current
    returnFocusRef.current = null
    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus()
    })
  }
  function openCreate(template?: AutomationTemplateId): void {
    rememberFocus()
    controller.beginCreate(defaultAutomationDraft({
      projectId: controller.projects[0]?.projectId ?? null,
      model: defaultModel,
      template,
    }))
    setParams(current => {
      const next = new URLSearchParams(current)
      next.delete('automationId')
      next.set('automationMode', 'create')
      return next
    })
  }
  function createThroughChat(): void {
    composerDraftStore.prefillTextIfEmpty(
      'home',
      '请先向我说明本地自动化的运行边界，然后依次询问任务内容、执行频率、执行位置和无人值守权限。等我确认后，请使用 automation.create 创建任务，并返回任务 ID 和可打开的自动化详情入口。',
    )
    navigate('/new')
  }
  function selectAutomation(id: string): void {
    if (shouldConfirmDiscard(controller.saveState, controller.draftError)) {
      setConfirm({ kind: 'discard' })
      return
    }
    rememberFocus()
    setParams(current => {
      const next = new URLSearchParams(current)
      next.delete('automationMode')
      next.set('automationId', id)
      return next
    })
  }
  function closeDetail(force = false): void {
    if (!force && shouldConfirmDiscard(controller.saveState, controller.draftError)) {
      setConfirm({ kind: 'discard' })
      return
    }
    controller.cancelDraft()
    setParams(current => {
      const next = new URLSearchParams(current)
      next.delete('automationMode')
      next.delete('automationId')
      return next
    })
    restoreFocus()
  }

  return (
    <>
      <WorkspaceHeaderItem align="end" id="automation.actions" order={100} slot="right">
        <PopoverMenu
          align="end"
          open={createMenuOpen}
          width="15rem"
          onOpenChange={setCreateMenuOpen}
          trigger={(
            <Button color="primary">
              <Plus aria-hidden="true" size={APP_ICON_SIZE} />
              <span>创建</span>
              <ChevronDown aria-hidden="true" size={APP_ICON_SIZE} />
            </Button>
          )}
        >
          <PopoverItem icon={<Plus />} onClick={() => openCreate()}>手动设置</PopoverItem>
          <PopoverItem icon={<Sparkles />} onClick={createThroughChat}>通过聊天创建</PopoverItem>
        </PopoverMenu>
      </WorkspaceHeaderItem>

      <PrimaryPageLayout
        className={creating || controller.selected ? 'automation-primary-page automation-primary-page--detail' : 'automation-primary-page'}
        title="已安排的任务"
        description="让 CodePilotX 在你工作时按计划处理项目任务。"
        bodyClassName="automation-view"
        search={(
          <SearchInput
            aria-label="搜索已安排任务"
            placeholder="搜索已安排任务"
            value={controller.query}
            onChange={controller.setQuery}
          />
        )}
        navigation={(
          <div className="automation-page-navigation">
            <SegmentedControl<AutomationFilter>
              ariaLabel="筛选自动化"
              getPanelId={value => `automation-${value}-panel`}
              getTabId={value => `automation-${value}-tab`}
              value={controller.filter}
              options={FILTER_OPTIONS}
              semantics="tabs"
              onChange={controller.setFilter}
            />
            {controller.unreadCount ? (
              <Button color="ghostSecondary" size="compact" onClick={() => void controller.markAllRunsRead()}>
                全部标为已读
              </Button>
            ) : null}
          </div>
        )}
      >
        {controller.supported === false ? (
          <StatePanel title="当前 Agent 不支持自动化" description="更新并重启 Agent 后，即可创建本地计划任务。" />
        ) : controller.error && !controller.automations.length ? (
          <StatePanel
            title="无法载入自动化"
            description={controller.error}
            action={<Button color="secondary" onClick={() => void controller.refresh()}>重试</Button>}
          />
        ) : (
          <div className="automation-page-stage" data-detail-open={creating || Boolean(controller.selected) || undefined}>
            <main
              className="automation-page-content"
              id={`automation-${controller.filter}-panel`}
              role="tabpanel"
              aria-labelledby={`automation-${controller.filter}-tab`}
            >
              {controller.loading ? (
                <SkeletonRegion className="automation-loading" label="正在载入自动化">
                  <SkeletonBlock /><SkeletonBlock /><SkeletonBlock />
                </SkeletonRegion>
              ) : (
                <>
                  {showInitialEmpty ? <AutomationEmptyState /> : null}
                  {controller.filteredAutomations.length ? (
                    <ul className="automation-list" aria-label="自动化列表">
                      {controller.filteredAutomations.map(item => (
                        <AutomationRow
                          key={item.id}
                          automation={item}
                          selected={item.id === selectedId}
                          runs={controller.runs.filter(run => run.automationId === item.id)}
                          targetLabel={controller.targetLabel(item)}
                          menuOpen={rowMenuId === item.id}
                          onMenuOpenChange={open => setRowMenuId(open ? item.id : null)}
                          onSelect={() => selectAutomation(item.id)}
                          onRun={() => void controller.runNow(item.id)}
                          onPause={() => void controller.setPaused(item, item.status !== 'paused')}
                          onDelete={() => setConfirm({ kind: 'delete', automation: item })}
                        />
                      ))}
                    </ul>
                  ) : null}
                  {visibleSuggestions.length ? (
                    <AutomationSuggestions
                      divided={controller.filteredAutomations.length > 0}
                      suggestions={visibleSuggestions}
                      onCreate={openCreate}
                    />
                  ) : null}
                  {!showInitialEmpty && !controller.filteredAutomations.length && !visibleSuggestions.length ? (
                    <div className="automation-filter-empty" role="status">未找到已安排任务</div>
                  ) : null}
                </>
              )}
            </main>
            {(creating || controller.selected) && controller.draft ? (
              <AutomationDetailPanel
                creating={creating}
                controller={controller}
                onClose={() => closeDetail()}
                onCreated={id => setParams({ automationId: id })}
                onOpenThread={id => navigate(`/threads/${encodeURIComponent(id)}`)}
              />
            ) : null}
          </div>
        )}
      </PrimaryPageLayout>

      <ConfirmationDialog
        open={confirm?.kind === 'delete'}
        title="删除自动化？"
        description="未来的计划运行会停止；已经开始的运行不会被强制中断，历史记录仍会保留。"
        actionLabel="删除"
        tone="danger"
        onCancel={() => setConfirm(null)}
        onAction={() => {
          if (confirm?.kind !== 'delete') return
          void controller.remove(confirm.automation).then(() => {
            setConfirm(null)
            if (selectedId === confirm.automation.id) closeDetail(true)
          })
        }}
      />
      <ConfirmationDialog
        open={confirm?.kind === 'discard'}
        title="丢弃未保存的修改？"
        description="当前草稿无效或保存失败，离开后这些修改会丢失。"
        actionLabel="丢弃修改"
        tone="danger"
        onCancel={() => setConfirm(null)}
        onAction={() => {
          setConfirm(null)
          closeDetail(true)
        }}
      />
    </>
  )
}

function AutomationRow({ automation, selected, runs, targetLabel, menuOpen, onMenuOpenChange, onSelect, onRun, onPause, onDelete }: {
  automation: Automation
  selected: boolean
  runs: readonly AutomationRun[]
  targetLabel: string
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  onSelect: () => void
  onRun: () => void
  onPause: () => void
  onDelete: () => void
}): React.ReactNode {
  const unread = runs.some(run => !run.readAt && ['completed', 'failed', 'interrupted'].includes(run.status))
  const activeRun = hasActiveAutomationRun(automation.id, runs)
  const completed = isCompletedAutomation(automation, runs)
  const rowStatus = activeRun
    ? 'running'
    : automation.status === 'paused'
      ? 'paused'
      : completed
        ? 'completed'
        : 'active'
  return (
    <li data-selected={selected || undefined} data-status={rowStatus}>
      <button className="automation-row" type="button" onClick={onSelect}>
        <span className="automation-row-icon" aria-hidden="true">
          {activeRun ? <LoaderCircle /> : automation.status === 'paused' ? <Pause /> : completed ? <CheckCircle2 /> : <Play />}
        </span>
        <span className="automation-row-content">
          <span className="automation-row-title">
            <strong>{automation.name}</strong>
            {unread ? <span className="automation-unread" aria-label="有未读运行结果" /> : null}
          </span>
          <span className="automation-row-summary">{automationScheduleSummary(automation.schedule)}<span aria-hidden="true"> · </span>{targetLabel}</span>
        </span>
        <span className="automation-row-status">
          {activeRun ? '正在运行' : automation.status === 'paused' ? '已暂停' : completed ? '已完成' : `下次运行 ${formatAutomationRelativeTime(automation.nextRunAt)}`}
        </span>
      </button>
      <PopoverMenu
        align="end"
        open={menuOpen}
        width="12rem"
        onOpenChange={onMenuOpenChange}
        trigger={(
          <IconButton className="automation-row-menu" color="ghostSecondary" size="toolbar" title={`${automation.name} 操作`}>
            <MoreHorizontal aria-hidden="true" size={APP_ICON_SIZE} />
          </IconButton>
        )}
      >
        <PopoverItem icon={<Play />} onClick={onRun}>立即运行</PopoverItem>
        <PopoverItem icon={automation.status === 'paused' ? <Play /> : <Pause />} onClick={onPause}>
          {automation.status === 'paused' ? '恢复' : '暂停'}
        </PopoverItem>
        <PopoverItem icon={<Trash2 />} onClick={onDelete}>删除</PopoverItem>
      </PopoverMenu>
    </li>
  )
}

function AutomationEmptyState(): React.ReactNode {
  return (
    <div className="automation-empty-state" role="status">
      <CalendarClock aria-hidden="true" />
      <h2>暂无已安排任务</h2>
      <p>创建任务后，它们会按状态显示在这里。</p>
    </div>
  )
}

function AutomationSuggestions({ divided, suggestions, onCreate }: {
  divided: boolean
  suggestions: readonly AutomationTemplate[]
  onCreate: (template: AutomationTemplateId) => void
}): React.ReactNode {
  return (
    <section className="automation-suggestions" data-divided={divided || undefined}>
      <h2>建议</h2>
      <ul aria-label="自动化建议">
        {suggestions.map(item => (
          <li key={item.id} data-tone={item.tone}>
            <button type="button" onClick={() => onCreate(item.id)}>
              <span className="automation-suggestion-icon" aria-hidden="true">
                {item.id === 'daily-brief' ? <AlarmClock /> : item.id === 'weekly-review' ? <CalendarClock /> : <FileSearch />}
              </span>
              <span className="automation-suggestion-content">
                <span className="automation-suggestion-title"><strong>{item.name}</strong><span>{automationScheduleSummary(item.schedule)}</span></span>
                <small>{item.description}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function StatePanel({ title, description, action }: { title: string; description: string; action?: React.ReactNode }): React.ReactNode {
  return <div className="automation-state" role="status"><h2>{title}</h2><p>{description}</p>{action}</div>
}

function shouldConfirmDiscard(saveState: string, draftError: string | null): boolean {
  return Boolean(draftError) || saveState === 'failed' || saveState === 'conflict'
}
