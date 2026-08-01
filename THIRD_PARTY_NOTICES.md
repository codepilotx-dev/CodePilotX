# Third-Party Notices

CodePilotX includes source adapted from the OpenCode project. The copied model
schema and project directory storage semantics originated from version
1.17.13; the JSONC parsing and key-path patching approach was adapted from
version 1.18.9. These portions are licensed under the MIT License. See
`third_party/opencode/LICENSE`.

Additional JavaScript dependencies retain the license terms distributed in
their respective packages.

CodePilotX includes the `@codepilotx/pi-agent-core` workspace fork of
pi-agent-core 0.82.1
under the MIT License. The fork preserves upstream attribution and contains
CodePilotX changes for dynamic tool execution, deferred activation and session
recovery. See `packages/pi-agent-core/LICENSE`.

CodePilotX uses Marked, Shiki, KaTeX, and Mermaid to render Markdown, syntax
highlighting, mathematical notation, and diagrams. These packages retain the
license notices distributed with their respective npm packages. Marked, Shiki,
and KaTeX are licensed under the MIT License; Mermaid is licensed under the
MIT License with its bundled third-party notices.

CodePilotX includes monochrome React components and file/folder associations
derived from Material Icon Theme 5.37.0 under the MIT License. See
`packages/material-icon-theme/LICENSE` and
`packages/material-icon-theme/UPSTREAM.md`.
