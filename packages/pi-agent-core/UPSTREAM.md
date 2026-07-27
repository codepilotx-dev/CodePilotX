# Upstream provenance

This repository is a CodePilotX-maintained fork of
[`@earendil-works/pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core),
based on version `0.82.1` from the `earendil-works/pi` project.

The TypeScript baseline was synchronized from the upstream Git tag `v0.82.1`
on 2026-07-27, specifically `packages/agent/src`, `packages/agent/README.md`,
and the repository `LICENSE`. The tag resolves to commit
`b4f293684bba718d59cc1157679bcf6157b3a7f5`; the Git tree checksum for
`packages/agent/src` is `a5828df21c0bcecc9de28d65a6faa0ae589e2cf7`.
Files outside the fork changes are byte-for-byte equivalent after line-ending
normalization. Focused fork tests and standalone build configuration are
maintained by CodePilotX.

CodePilotX carries these changes as the private workspace package
`@codepilotx/pi-agent-core`. It is not published to a package registry. The
fork adds dynamic tool-execution mode resolution, deferred tool discovery and
activation, structured/progress-compatible tool results, and durable active
tool restoration in `AgentHarness`.

## Manual upstream update

1. Fetch the desired tag from `https://github.com/earendil-works/pi.git`.
2. Compare its `packages/agent/src` tree with this package's `src` tree.
3. Merge unchanged upstream files first, then resolve CodePilotX changes in
   `agent-loop.ts`, `harness/agent-harness.ts`, `harness/types.ts`, `types.ts`,
   `index.ts`, and `harness/deferred-tool-catalog.ts` manually.
4. Preserve dynamic execution-mode resolution, structured/progress results,
   deferred activation, and `activeToolNames` session restoration.
5. Record the exact upstream tag commit, the `packages/agent/src` Git tree
   checksum, and the import date in this document.
6. Run the package and Agent typechecks, regenerate declarations with
   `bun run build:types`, then run the focused tests and Agent build.

The upstream code and this fork are distributed under the MIT License. See
`LICENSE`.
