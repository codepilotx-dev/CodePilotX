import type { AgentDatabase } from "../database/AgentDatabase"
import { approvalCancelledPayload } from "../events/interaction-event-payloads"

export type InterruptedRunRecoveryStore = Pick<
  AgentDatabase,
  | "getAgentTurnCheckpoint"
  | "interruptForSideEffectRecovery"
  | "queueSideEffectRecovery"
  | "deleteAgentTurnCheckpoint"
>

export const recoverInterruptedRuns = (database: AgentDatabase) => {
  const timestamp = Date.now()
  const invalidApprovals = database.sqlite.query(`
    SELECT r.id, r.thread_id, r.turn_id, r.agent_id, r.tool_call_id
    FROM approval_requests AS r
    LEFT JOIN approval_checkpoints AS c ON c.approval_id = r.id
    WHERE r.status = 'preparing' OR (r.status = 'pending'
      AND (
        c.approval_id IS NULL OR c.version <> 1
        OR json_type(c.payload, '$.runState') <> 'text'
        OR json_type(c.payload, '$.interruption') IS NULL
      ))
  `).all() as Array<{ id: string; thread_id: string; turn_id: string; agent_id: string; tool_call_id: string }>
  database.sqlite.transaction(() => {
    const safelyRecoverableApprovals = database.sqlite.query(`
      SELECT r.id, r.thread_id, r.turn_id, r.agent_id
      FROM approval_requests AS r
      JOIN turns AS t ON t.id = r.turn_id AND t.status = 'running'
      WHERE r.status IN ('resolved', 'claimed') AND (
        r.reply = 'deny'
        OR EXISTS (SELECT 1 FROM tool_calls AS tc WHERE tc.id = r.tool_call_id AND tc.status = 'completed')
        OR NOT EXISTS (SELECT 1 FROM tool_calls AS tc WHERE tc.id = r.tool_call_id)
      )
    `).all() as Array<{ id: string; thread_id: string; turn_id: string; agent_id: string }>
    for (const approval of safelyRecoverableApprovals) {
      database.sqlite.query("UPDATE approval_requests SET status = 'resolved' WHERE id = ? AND status = 'claimed'").run(approval.id)
      database.sqlite.query("UPDATE turns SET status = 'queued', finished_at = NULL, updated_at = ? WHERE id = ? AND status = 'running'").run(timestamp, approval.turn_id)
      database.sqlite.query("UPDATE agent_executions SET status = 'queued', error = NULL, updated_at = ? WHERE id = ? AND status = 'running'").run(timestamp, approval.agent_id)
      database.insertEvent(approval.thread_id, approval.turn_id, "agent/upserted", { agent: database.getAgentExecution(approval.agent_id) })
    }
    const ambiguousApprovals = database.sqlite.query(`
      SELECT r.id, r.thread_id, r.turn_id, r.agent_id, r.tool_call_id
      FROM approval_requests AS r
      JOIN tool_calls AS tc ON tc.id = r.tool_call_id
      JOIN turns AS t ON t.id = r.turn_id AND t.status = 'running'
      WHERE r.status = 'claimed' AND r.reply = 'allow' AND tc.status IN ('running', 'error', 'interrupted')
    `).all() as Array<{ id: string; thread_id: string; turn_id: string; agent_id: string; tool_call_id: string }>
    for (const approval of ambiguousApprovals) {
      database.sqlite.query("UPDATE approval_requests SET status = 'cancelled', resolved_at = ? WHERE id = ?").run(timestamp, approval.id)
      database.insertEvent(
        approval.thread_id,
        approval.turn_id,
        "approval/cancelled",
        approvalCancelledPayload(
          approval.id,
          "审批后的工具执行结果不确定，已按 fail-closed 中断",
          timestamp,
        ),
      )
    }
    const resumableQuestions = database.sqlite.query(`
      SELECT q.id, q.thread_id, q.turn_id, q.agent_id
      FROM question_requests AS q
      JOIN turns AS t ON t.id = q.turn_id AND t.status = 'running'
      WHERE q.status IN ('resolved', 'resuming')
    `).all() as Array<{ id: string; thread_id: string; turn_id: string; agent_id: string }>
    for (const question of resumableQuestions) {
      database.sqlite.query("UPDATE question_requests SET status = 'resolved' WHERE id = ? AND status = 'resuming'").run(question.id)
      database.sqlite.query("UPDATE turns SET status = 'queued', finished_at = NULL, updated_at = ? WHERE id = ? AND status = 'running'").run(timestamp, question.turn_id)
      database.sqlite.query("UPDATE agent_executions SET status = 'queued', error = NULL, updated_at = ? WHERE id = ? AND status = 'running'").run(timestamp, question.agent_id)
      database.insertEvent(question.thread_id, question.turn_id, "agent/upserted", { agent: database.getAgentExecution(question.agent_id) })
    }
    for (const approval of invalidApprovals) {
      database.insertEvent(
        approval.thread_id,
        approval.turn_id,
        "approval/cancelled",
        approvalCancelledPayload(
          approval.id,
          "审批缺少完整且可恢复的 SDK checkpoint，已安全取消",
          timestamp,
        ),
      )
    }
    database.sqlite.query(`UPDATE approval_requests SET status = 'cancelled', resolved_at = ? WHERE status = 'preparing' OR id IN (SELECT r.id FROM approval_requests AS r LEFT JOIN approval_checkpoints AS c ON c.approval_id = r.id WHERE r.status = 'pending' AND (c.approval_id IS NULL OR c.version <> 1 OR json_type(c.payload, '$.runState') <> 'text' OR json_type(c.payload, '$.interruption') IS NULL))`).run(timestamp)
    const interruptedTurns = database.sqlite.query(`
      SELECT id, thread_id, root_agent_id
      FROM turns
      WHERE status = 'running'
        OR (status = 'waiting_permission' AND NOT EXISTS (SELECT 1 FROM approval_requests AS r JOIN approval_checkpoints AS c ON c.approval_id = r.id WHERE r.turn_id = turns.id AND r.status = 'pending' AND c.version = 1 AND json_type(c.payload, '$.runState') = 'text' AND json_type(c.payload, '$.interruption') IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM hook_trust_waiters AS w JOIN hook_trust_requests AS h ON h.id = w.request_id JOIN agent_checkpoints AS c ON c.turn_id = w.turn_id AND c.state = 'waiting_hook_trust' WHERE w.turn_id = turns.id AND h.status = 'pending'))
        OR (status = 'waiting_question' AND NOT EXISTS (SELECT 1 FROM question_requests AS q LEFT JOIN agent_checkpoints AS c ON c.turn_id = q.turn_id AND c.state = 'waiting_question' WHERE q.turn_id = turns.id AND q.status = 'pending' AND (c.turn_id IS NOT NULL OR json_extract(q.payload, '$.checkpoint.state') IS NOT NULL)))
    `).all() as Array<{ id: string; thread_id: string; root_agent_id: string }>
    const interruptedItems = database.sqlite.query(`SELECT id FROM items WHERE status IN ('pending', 'running') AND type <> 'subagent' AND NOT (type = 'question' AND id IN (SELECT id FROM question_requests WHERE status = 'pending' AND (json_extract(payload, '$.checkpoint.state') IS NOT NULL OR turn_id IN (SELECT turn_id FROM agent_checkpoints WHERE state = 'waiting_question'))))`).all() as Array<{ id: string }>
    database.sqlite.query(`UPDATE turns SET status = 'interrupted', finished_at = ?, updated_at = ? WHERE status = 'running' OR (status = 'waiting_permission' AND NOT EXISTS (SELECT 1 FROM approval_requests AS r JOIN approval_checkpoints AS c ON c.approval_id = r.id WHERE r.turn_id = turns.id AND r.status = 'pending' AND c.version = 1 AND json_type(c.payload, '$.runState') = 'text' AND json_type(c.payload, '$.interruption') IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM hook_trust_waiters AS w JOIN hook_trust_requests AS h ON h.id = w.request_id JOIN agent_checkpoints AS c ON c.turn_id = w.turn_id AND c.state = 'waiting_hook_trust' WHERE w.turn_id = turns.id AND h.status = 'pending')) OR (status = 'waiting_question' AND NOT EXISTS (SELECT 1 FROM question_requests AS q LEFT JOIN agent_checkpoints AS c ON c.turn_id = q.turn_id AND c.state = 'waiting_question' WHERE q.turn_id = turns.id AND q.status = 'pending' AND (c.turn_id IS NOT NULL OR json_extract(q.payload, '$.checkpoint.state') IS NOT NULL)))`).run(timestamp, timestamp)
    database.sqlite.query(`UPDATE agent_executions SET status = 'interrupted', updated_at = ? WHERE status = 'running' OR (status = 'waiting_permission' AND turn_id IN (SELECT id FROM turns WHERE status = 'interrupted')) OR (status = 'waiting_question' AND turn_id IN (SELECT id FROM turns WHERE status = 'interrupted'))`).run(timestamp)
    database.sqlite.query(`UPDATE items SET status = 'interrupted', updated_at = ? WHERE status IN ('pending', 'running') AND type <> 'subagent' AND NOT (type = 'question' AND id IN (SELECT id FROM question_requests WHERE status = 'pending' AND (json_extract(payload, '$.checkpoint.state') IS NOT NULL OR turn_id IN (SELECT turn_id FROM agent_checkpoints WHERE state = 'waiting_question'))))`).run(timestamp)
    database.sqlite.query(`UPDATE question_requests SET status = 'cancelled', resolved_at = ? WHERE status = 'pending' AND turn_id IN (SELECT id FROM turns WHERE status <> 'waiting_question')`).run(timestamp)
    database.sqlite.query(`UPDATE subagent_runs SET status = 'queued', queue_reason = NULL, updated_at = ? WHERE status = 'waiting_permission' AND id IN (SELECT a.subagent_run_id FROM agent_executions AS a JOIN turns AS t ON t.id = a.turn_id WHERE t.status = 'queued' AND a.status = 'queued' AND a.subagent_run_id IS NOT NULL)`).run(timestamp)
    database.sqlite.query(`UPDATE subagent_tasks SET status = 'queued', updated_at = ? WHERE current_run_id IN (SELECT id FROM subagent_runs WHERE status = 'queued')`).run(timestamp)
    database.sqlite.query(`UPDATE items SET status = 'pending', data = json_set(data, '$.status', 'queued', '$.queueReason', NULL), updated_at = ? WHERE type = 'subagent' AND json_extract(data, '$.runId') IN (SELECT id FROM subagent_runs WHERE status = 'queued')`).run(timestamp)
    database.sqlite.query(`UPDATE subagent_runs SET status = 'interrupted', error = COALESCE(error, 'Agent 重启时运行被中断'), finished_at = ?, updated_at = ? WHERE status IN ('preparing', 'running', 'steering') OR (status = 'waiting_permission' AND id IN (SELECT a.subagent_run_id FROM agent_executions AS a JOIN turns AS t ON t.id = a.turn_id WHERE t.status = 'interrupted' AND a.subagent_run_id IS NOT NULL))`).run(timestamp, timestamp)
    database.sqlite.query(`UPDATE threads SET queue_pause_reason = 'interrupted', queue_version = queue_version + 1, updated_at = ?
      WHERE kind = 'main' AND EXISTS (SELECT 1 FROM turns AS q WHERE q.thread_id = threads.id AND q.status = 'queued')
        AND EXISTS (SELECT 1 FROM turns AS stopped WHERE stopped.thread_id = threads.id AND stopped.status = 'interrupted' AND stopped.finished_at = ?)`
    ).run(timestamp, timestamp)
    database.sqlite.query(`UPDATE subagent_tasks SET status = 'interrupted', updated_at = ? WHERE current_run_id IN (SELECT id FROM subagent_runs WHERE status = 'interrupted')`).run(timestamp)
    database.sqlite.query(`UPDATE items SET status = 'interrupted', data = json_set(data, '$.status', 'interrupted', '$.queueReason', NULL), updated_at = ? WHERE type = 'subagent' AND json_extract(data, '$.runId') IN (SELECT id FROM subagent_runs WHERE status = 'interrupted')`).run(timestamp)
    for (const turn of interruptedTurns) {
      const agent = database.getAgentExecution(turn.root_agent_id)
      if (agent) database.insertEvent(turn.thread_id, turn.id, "agent/upserted", { agent })
      database.insertEvent(turn.thread_id, turn.id, "turn/interrupted", { turnId: turn.id, rootAgentId: turn.root_agent_id, reason: "process-restart", finishedAt: timestamp })
    }
    for (const row of interruptedItems) {
      const item = database.getItem(row.id)
      if (item?.status === "interrupted") {
        const thread = database.sqlite.query("SELECT thread_id FROM items WHERE id = ?").get(row.id) as { thread_id: string } | null
        if (thread) database.insertEvent(thread.thread_id, item.turnID, "item/completed", { item })
      }
    }
    const pausedThreads = database.sqlite.query("SELECT id, queue_version, queue_pause_reason FROM threads WHERE queue_pause_reason = 'interrupted' AND updated_at = ?").all(timestamp) as Array<{ id: string; queue_version: number; queue_pause_reason: string }>
    for (const thread of pausedThreads) {
      database.insertEvent(thread.id, null, "queue/updated", { threadId: thread.id, version: thread.queue_version, pauseReason: thread.queue_pause_reason, action: "paused" })
    }
    database.sqlite.query(`DELETE FROM workspace_writer_leases WHERE run_id NOT IN (SELECT id FROM subagent_runs WHERE status IN ('preparing', 'running', 'steering', 'waiting_question', 'waiting_permission'))`)
    database.sqlite.query(`UPDATE memory_jobs SET status = 'queued', started_at = NULL, updated_at = ? WHERE status = 'running'`).run(timestamp)
    // A process crash after claim is observationally ambiguous: the host
    // command may already have started. Cancel instead of risking a replay.
    database.sqlite.query(`UPDATE sandbox_escalations SET status = 'cancelled', completed_at = ? WHERE status = 'claimed'`).run(timestamp)
  })()
}
