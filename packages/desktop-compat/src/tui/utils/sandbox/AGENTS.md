# AGENTS.md

## Scope
Applies to sandbox integration under `utils/sandbox/`.

## Conventions
- Sandbox adapters enforce filesystem, network, and process isolation. Treat
  the adapter contract as a security boundary.
- Do not bypass sandbox checks to simplify a feature. Add narrowly scoped
  helpers in this directory instead.
- Preserve the existing adapter and UI utility split. UI hints belong in
  `sandbox-ui-utils.ts`; enforcement belongs in `sandbox-adapter.ts`.
- Be cross-platform. Verify macOS, Linux, and Windows behavior before
  changing adapter detection or capability reporting.
- Sandbox settings and policy live in `utils/settings/`. Keep sandbox state
  isolated from settings loading so failures cannot silently disable
  enforcement.

## Validation
- After any adapter change, verify both enabled and disabled sandbox paths
  and confirm the UI surfaces the new capability accurately.
- Confirm that failures in the adapter surface as visible errors rather than
  silently downgrading to a less restrictive mode.
