import type { PermissionConfig } from '@codepilotx/shared/thread'
import type { TaskMode } from '../domain'
import { resolveEffectivePermissionConfig } from '../permission/EffectivePermissionConfig'
import { executionPolicyFromV4 } from '../permission/ExecutionPolicy'

/** Full access is a permission combination, not merely a never approval policy. */
export function hasComputerFullAccess(mode: TaskMode, configured?: PermissionConfig): boolean {
  if (mode !== 'chat' || !configured) return false
  const effective = executionPolicyFromV4(resolveEffectivePermissionConfig(mode, configured))
  return effective.fileAccess === 'full-access' && effective.approvalPolicy === 'never'
}
