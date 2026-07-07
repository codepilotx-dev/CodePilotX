// GENERATED CODE! DO NOT MODIFY BY HAND!
// Adapted from codex-rs/app-server-protocol/schema/typescript/v2/ThreadStatus.ts
export type ThreadStatus =
  | { type: 'notLoaded' }
  | { type: 'idle' }
  | { type: 'systemError' }
  | { type: 'active'; activeFlags: Array<'waitingOnApproval' | 'waitingOnUserInput'> }
