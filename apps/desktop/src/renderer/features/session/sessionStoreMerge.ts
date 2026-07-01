import type { DesktopSessionSnapshot } from '../../../shared/types.js'
import type { SessionViewState } from '../../uiTypes.js'
import { dedupeWorkflowEvents } from './workflowEventDedup.js'

export function mergeSessionStoreSnapshotView(
  existingView: SessionViewState | undefined,
  snapshot: DesktopSessionSnapshot,
): SessionViewState {
  const hasHydratedSnapshotContent =
    snapshot.view.messages.length > 0 ||
    snapshot.view.toolLog.length > 0 ||
    (snapshot.events?.length ?? 0) > 0 ||
    (snapshot.workflowEvents?.length ?? 0) > 0

  if (!existingView || hasHydratedSnapshotContent) {
    return {
      ...snapshot.view,
      eventModelVersion: snapshot.eventModelVersion,
      events: snapshot.events ?? [],
      workflowEvents: dedupeWorkflowEvents(snapshot.workflowEvents ?? []),
      contextUsage: snapshot.view.contextUsage ?? null,
      selectedFile: existingView?.selectedFile ?? null,
    }
  }

  return {
    ...existingView,
    pendingPermissions: snapshot.view.pendingPermissions,
    contextUsage: snapshot.view.contextUsage ?? existingView.contextUsage,
  }
}
