import { useEffect, useRef } from 'react'
import { AlertTriangle, Check, Clock3, Play, RotateCcw, X } from 'lucide-react'
import type React from 'react'
import type { AutomationRun } from '@codepilotx/shared/automation'
import { Button } from '../../components/ui/Button.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { Input } from '../../components/ui/Input.js'
import { Select } from '../../components/ui/Select.js'
import { Textarea } from '../../components/ui/Textarea.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import type { AutomationController } from './useAutomationController.js'
import {
  automationScheduleSummary,
  formatAutomationTime,
  type AutomationDraft,
} from './automationModel.js'

type Props = {
  creating: boolean
  controller: AutomationController
  onClose: () => void
  onCreated: (id: string) => void
  onOpenThread: (id: string) => void
}

const SCHEDULE_OPTIONS = [
  { value: 'hourly', label: '每小时' },
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '工作日' },
  { value: 'weekly', label: '每周' },
  { value: 'custom', label: '自定义 RRULE' },
] as const

export function AutomationDetailPanel({
  creating,
  controller,
  onClose,
  onCreated,
  onOpenThread,
}: Props): React.ReactNode {
  const panelRef = useRef<HTMLElement>(null)
  const draft = controller.draft

  useEffect(() => {
    panelRef.current?.focus()
  }, [creating, controller.selected?.id])

  if (!draft) return null
  const update = (patch: Partial<AutomationDraft>): void =>
    controller.setDraft({ ...draft, ...patch })
  const runs = controller.selected
    ? controller.runs.filter(
        run => run.automationId === controller.selected?.id,
      )
    : []

  return (
    <aside
      ref={panelRef}
      className="automation-detail"
      aria-label={creating ? '创建自动化' : '自动化详情'}
      tabIndex={-1}
      onKeyDown={event => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose()
      }}
    >
      <header className="automation-detail-header">
        <div>
          <span className="automation-eyebrow">
            {creating ? '新任务' : '任务设置'}
          </span>
          <h2>{creating ? '创建自动化' : controller.selected?.name}</h2>
        </div>
        <IconButton
          color="ghostSecondary"
          size="toolbar"
          title="关闭详情"
          onClick={onClose}
        >
          <X
            aria-hidden="true"
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        </IconButton>
      </header>

      <div className="automation-detail-scroll">
        <section className="automation-form" aria-label="自动化设置">
          <FormField label="名称">
            <Input
              value={draft.name}
              onChange={event => update({ name: event.currentTarget.value })}
            />
          </FormField>
          <FormField
            label="任务说明"
            hint="每次运行都会把这段内容发送给 Agent。"
          >
            <Textarea
              rows={5}
              value={draft.prompt}
              onChange={event => update({ prompt: event.currentTarget.value })}
            />
          </FormField>
          <div className="automation-form-grid">
            <FormField label="运行方式">
              <Select
                ariaLabel="运行方式"
                value={draft.kind}
                options={[
                  { value: 'standalone', label: '独立任务' },
                  { value: 'thread', label: '续接聊天' },
                ]}
                onValueChange={kind =>
                  update({
                    kind,
                    projectId:
                      kind === 'standalone'
                        ? (draft.projectId ?? controller.projects[0]?.projectId ?? null)
                        : null,
                    targetThreadId:
                      kind === 'thread'
                        ? (draft.targetThreadId ?? controller.sessions[0]?.id ?? null)
                        : null,
                    execution:
                      kind === 'standalone'
                        ? (draft.execution ?? { kind: 'local' })
                        : null,
                  })
                }
              />
            </FormField>
            {draft.kind === 'standalone' ? (
              <FormField label="项目">
                <Select
                  ariaLabel="项目"
                  searchable
                  value={draft.projectId ?? ''}
                  options={controller.projects.flatMap(project =>
                    project.projectId
                      ? [{ value: project.projectId, label: project.name }]
                      : [],
                  )}
                  onValueChange={projectId => update({ projectId: projectId || null })}
                />
              </FormField>
            ) : (
              <FormField label="目标聊天">
                <Select
                  ariaLabel="目标聊天"
                  searchable
                  value={draft.targetThreadId ?? ''}
                  options={controller.sessions.map(session => ({
                    value: session.id,
                    label:
                      session.customTitle ??
                      session.aiTitle ??
                      session.sessionName ??
                      '未命名聊天',
                    detail: session.workspaceName,
                  }))}
                  onValueChange={targetThreadId =>
                    update({ targetThreadId: targetThreadId || null })
                  }
                />
              </FormField>
            )}
          </div>

          {draft.kind === 'standalone' ? (
            <div className="automation-form-grid">
              <FormField label="执行位置">
                <Select
                  ariaLabel="执行位置"
                  value={draft.execution?.kind ?? 'local'}
                  options={[
                    { value: 'local', label: '主工作区' },
                    { value: 'new-worktree', label: '新 Worktree' },
                  ]}
                  onValueChange={kind =>
                    update({
                      execution:
                        kind === 'local'
                          ? { kind }
                          : { kind, branchName: 'main' },
                    })
                  }
                />
              </FormField>
              {draft.execution?.kind === 'new-worktree' ? (
                <FormField label="基础分支">
                  <Input
                    value={draft.execution.branchName}
                    onChange={event =>
                      update({
                        execution: {
                          kind: 'new-worktree',
                          branchName: event.currentTarget.value,
                        },
                      })
                    }
                  />
                </FormField>
              ) : null}
            </div>
          ) : null}

          <div className="automation-form-grid">
            <FormField label="排期">
              <Select
                ariaLabel="排期"
                value={draft.schedule.mode}
                options={SCHEDULE_OPTIONS}
                onValueChange={mode => update({ schedule: defaultSchedule(mode) })}
              />
            </FormField>
            {draft.schedule.mode === 'hourly' ? (
              <FormField label="间隔（分钟）">
                <Input
                  type="number"
                  min={15}
                  value={draft.schedule.intervalMinutes}
                  onChange={event =>
                    update({
                      schedule: {
                        mode: 'hourly',
                        intervalMinutes: Math.max(
                          15,
                          Number(event.currentTarget.value) || 15,
                        ),
                      },
                    })
                  }
                />
              </FormField>
            ) : draft.schedule.mode !== 'custom' ? (
              <FormField label="执行时间">
                <Input
                  type="time"
                  value={draft.schedule.time}
                  onChange={event =>
                    update({
                      schedule: withScheduleTime(
                        draft.schedule,
                        event.currentTarget.value,
                      ),
                    })
                  }
                />
              </FormField>
            ) : null}
          </div>

          {draft.schedule.mode === 'weekly' ? (
            <FormField label="星期">
              <Select
                ariaLabel="每周执行日"
                value={draft.schedule.weekdays[0] ?? 'MO'}
                options={[
                  { value: 'MO', label: '周一' },
                  { value: 'TU', label: '周二' },
                  { value: 'WE', label: '周三' },
                  { value: 'TH', label: '周四' },
                  { value: 'FR', label: '周五' },
                  { value: 'SA', label: '周六' },
                  { value: 'SU', label: '周日' },
                ]}
                onValueChange={weekday =>
                  update({
                    schedule: {
                      mode: 'weekly',
                      weekdays: [weekday],
                      time:
                        draft.schedule.mode === 'weekly'
                          ? draft.schedule.time
                          : '09:00',
                    },
                  })
                }
              />
            </FormField>
          ) : null}

          {draft.schedule.mode === 'custom' ? (
            <FormField
              label="RFC 5545 RRULE"
              hint="例如 FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9"
            >
              <Input
                aria-describedby="automation-rrule-error"
                invalid={Boolean(controller.scheduleError)}
                value={draft.schedule.rrule}
                onChange={event =>
                  update({
                    schedule: {
                      mode: 'custom',
                      rrule: event.currentTarget.value,
                    },
                  })
                }
              />
              {controller.scheduleError ? (
                <span
                  id="automation-rrule-error"
                  className="automation-field-error"
                  role="alert"
                >
                  {controller.scheduleError}
                </span>
              ) : null}
            </FormField>
          ) : null}

          <div className="automation-form-grid">
            <FormField label="时区">
              <Input
                value={draft.timeZone}
                onChange={event => update({ timeZone: event.currentTarget.value })}
              />
            </FormField>
            <FormField label="通知">
              <Select
                ariaLabel="通知策略"
                value={draft.notificationPolicy}
                options={[
                  { value: 'all', label: '全部结果' },
                  { value: 'failures', label: '仅失败' },
                  { value: 'off', label: '关闭' },
                ]}
                onValueChange={notificationPolicy => update({ notificationPolicy })}
              />
            </FormField>
          </div>

          <div className="automation-form-grid">
            <FormField label="推理强度">
              <Select
                ariaLabel="推理强度"
                value={draft.reasoningEffort ?? ''}
                options={[
                  { value: '', label: '模型默认' },
                  { value: 'low', label: '低' },
                  { value: 'medium', label: '中' },
                  { value: 'high', label: '高' },
                  { value: 'xhigh', label: '极高' },
                ]}
                onValueChange={reasoningEffort =>
                  update({ reasoningEffort: reasoningEffort || null })
                }
              />
            </FormField>
            <FormField label="沙箱">
              <Select
                ariaLabel="沙箱权限"
                value={draft.permissionConfig.sandboxMode}
                options={[
                  { value: 'read-only', label: '只读' },
                  { value: 'workspace-write', label: '工作区写入' },
                  { value: 'danger-full-access', label: '完全访问' },
                ]}
                onValueChange={sandboxMode =>
                  update({
                    permissionConfig: {
                      ...draft.permissionConfig,
                      sandboxMode,
                      approvalPolicy: 'never',
                    },
                  })
                }
              />
            </FormField>
          </div>

          {draft.permissionConfig.sandboxMode === 'danger-full-access' ? (
            <div className="automation-risk" role="note">
              <AlertTriangle aria-hidden="true" size={APP_ICON_SIZE} />
              <span>
                任务会在无人值守时获得完全访问权限。请只对可信项目和明确任务使用。
              </span>
            </div>
          ) : null}

          <div className="automation-schedule-preview">
            <Clock3 aria-hidden="true" size={APP_ICON_SIZE} />
            <span>
              {controller.scheduleSummary ??
                automationScheduleSummary(draft.schedule)}
            </span>
          </div>
          {controller.draftError ? (
            <p className="automation-field-error" role="alert">
              {controller.draftError}
            </p>
          ) : null}

          <footer className="automation-form-actions">
            {creating ? (
              <Button
                color="primary"
                disabled={Boolean(controller.draftError)}
                loading={controller.saveState === 'saving'}
                onClick={() =>
                  void controller.create().then(id => {
                    if (id) onCreated(id)
                  })
                }
              >
                创建自动化
              </Button>
            ) : (
              <SaveIndicator controller={controller} />
            )}
          </footer>
        </section>

        {!creating && controller.selected ? (
          <RunHistory
            runs={runs}
            controller={controller}
            onOpenThread={onOpenThread}
          />
        ) : null}
      </div>
    </aside>
  )
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.ReactNode {
  return (
    <label className="automation-field">
      <span className="automation-field-label">{label}</span>
      {children}
      {hint ? <span className="automation-field-hint">{hint}</span> : null}
    </label>
  )
}

function SaveIndicator({
  controller,
}: {
  controller: AutomationController
}): React.ReactNode {
  if (controller.saveState === 'saving')
    return (
      <span className="automation-save-state">
        <RotateCcw aria-hidden="true" />
        正在保存…
      </span>
    )
  if (
    controller.saveState === 'failed' ||
    controller.saveState === 'conflict'
  ) {
    return (
      <div className="automation-save-retry">
        <span>
          {controller.saveState === 'conflict'
            ? '已有更新，草稿尚未覆盖。'
            : '保存失败，草稿已保留。'}
        </span>
        <Button color="secondary" size="compact" onClick={controller.retrySave}>
          重试保存
        </Button>
      </div>
    )
  }
  if (controller.saveState === 'saved')
    return (
      <span className="automation-save-state">
        <Check aria-hidden="true" />
        已保存
      </span>
    )
  return <span className="automation-save-state">修改后自动保存</span>
}

function RunHistory({
  runs,
  controller,
  onOpenThread,
}: {
  runs: readonly AutomationRun[]
  controller: AutomationController
  onOpenThread: (id: string) => void
}): React.ReactNode {
  return (
    <section className="automation-runs" aria-labelledby="automation-runs-title">
      <header>
        <div>
          <span className="automation-eyebrow">收件箱</span>
          <h3 id="automation-runs-title">运行记录</h3>
        </div>
        {runs.some(run => !run.readAt) ? (
          <Button
            color="ghostSecondary"
            size="compact"
            onClick={() => void controller.markAllRunsRead()}
          >
            全部标为已读
          </Button>
        ) : null}
      </header>
      {runs.length ? (
        <ol>
          {runs.map(run => (
            <li
              key={run.id}
              data-status={run.status}
              data-unread={!run.readAt || undefined}
            >
              <button
                type="button"
                disabled={!run.threadId}
                onClick={() => {
                  if (run.threadId) onOpenThread(run.threadId)
                  if (!run.readAt) void controller.markRunRead(run.id)
                }}
              >
                <span className="automation-run-status">
                  <span className="automation-status-dot" />
                  {runStatusLabel(run.status)}
                </span>
                <span className="automation-run-trigger">
                  {runTriggerLabel(run.trigger)}
                </span>
                <time>
                  {formatAutomationTime(
                    run.completedAt ?? run.startedAt ?? run.createdAt,
                  )}
                </time>
                {run.status === 'running' || run.status === 'queued' ? (
                  <Play aria-hidden="true" size={APP_ICON_SIZE} />
                ) : null}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="automation-runs-empty">首次运行后，结果会显示在这里。</p>
      )}
    </section>
  )
}

function defaultSchedule(
  mode: (typeof SCHEDULE_OPTIONS)[number]['value'],
): AutomationDraft['schedule'] {
  if (mode === 'hourly') return { mode, intervalMinutes: 60 }
  if (mode === 'daily') return { mode, time: '09:00' }
  if (mode === 'weekdays') return { mode, time: '09:00' }
  if (mode === 'weekly') return { mode, weekdays: ['MO'], time: '09:00' }
  return { mode, rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0' }
}

function withScheduleTime(
  schedule: AutomationDraft['schedule'],
  time: string,
): AutomationDraft['schedule'] {
  if (schedule.mode === 'daily') return { mode: 'daily', time }
  if (schedule.mode === 'weekdays') return { mode: 'weekdays', time }
  if (schedule.mode === 'weekly')
    return { mode: 'weekly', weekdays: schedule.weekdays, time }
  return schedule
}

function runStatusLabel(status: AutomationRun['status']): string {
  return {
    claimed: '已领取',
    preparing: '准备中',
    queued: '排队中',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    interrupted: '已中断',
  }[status]
}

function runTriggerLabel(trigger: AutomationRun['trigger']): string {
  return {
    scheduled: '计划运行',
    'startup-catch-up': '启动补跑',
    'overlap-catch-up': '重叠补跑',
    manual: '手动运行',
  }[trigger]
}
