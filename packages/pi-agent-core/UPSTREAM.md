# Upstream provenance

This repository is a CodePilotX-maintained fork of
[`@earendil-works/pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core),
based on version `0.81.0` from the `earendil-works/pi` project.

The initial TypeScript baseline was reconstructed from the UTF-8
`sourcesContent` embedded in the JavaScript source maps distributed with the
`@earendil-works/pi-agent-core@0.81.0` npm artifact. It was subsequently
verified against the upstream Git tag `v0.81.0`, specifically
`packages/agent/src`. Files outside the fork changes are byte-for-byte
equivalent after line-ending normalization. The published npm artifact did not
include the upstream test suite or repository-level build configuration, so
focused fork tests and standalone build configuration are maintained by
CodePilotX.

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
5. Update the baseline version in this document and run the package and Agent
   typechecks, regenerate declarations with `bun run build:types`, then run the
   focused tests and Agent build.

The upstream code and this fork are distributed under the MIT License. See
`LICENSE`.
