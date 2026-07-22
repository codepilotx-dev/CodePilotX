# Third-Party Notices

CodePilotX includes source adapted from the OpenCode project, version 1.17.13.
The copied model schema, provider aggregation, provider transforms, and plugin
host code are licensed under the MIT License. See `third_party/opencode/LICENSE`.

CodePilotX distributes a model catalog snapshot derived from models.dev.
The models.dev database is licensed under the MIT License. See
`third_party/models.dev/LICENSE`.

Additional JavaScript dependencies retain the license terms distributed in
their respective packages. The Agent uses `extract-zip` 2.0.1 under the BSD
2-Clause License to unpack validated Node.js and ripgrep ZIP archives.

CodePilotX includes the `@codepilotx/pi-agent-core` workspace fork of
pi-agent-core 0.81.0
under the MIT License. The fork preserves upstream attribution and contains
CodePilotX changes for dynamic tool execution, deferred activation and session
recovery. See `packages/pi-agent-core/LICENSE`.

CodePilotX uses Marked, Shiki, KaTeX, and Mermaid to render Markdown, syntax
highlighting, mathematical notation, and diagrams. These packages retain the
license notices distributed with their respective npm packages. Marked, Shiki,
and KaTeX are licensed under the MIT License; Mermaid is licensed under the
MIT License with its bundled third-party notices.

CodePilotX statically bundles `@jerome-benoit/sap-ai-provider-v2` for SAP AI
Core support under the Apache License 2.0. See
`third_party/sap-ai-provider/LICENSE`.

CodePilotX includes monochrome React components and file/folder associations
derived from Material Icon Theme 5.37.0 under the MIT License. See
`packages/material-icon-theme/LICENSE` and
`packages/material-icon-theme/UPSTREAM.md`.

CodePilotX distributes the precompiled Windows helper from
`@anthropic-ai/sandbox-runtime@0.0.65` under the Apache License 2.0. See
`third_party/sandbox-runtime/LICENSE`.

CodePilotX can download pinned official releases of Node.js 24.18.0, Python
3.14.6, Git for Windows PortableGit 2.55.0.3, and ripgrep 15.2.0 into the
user's `~/.codepilotx/tooling` directory when their tools are first used.
These binaries are not included in CodePilotX installers. Node.js and ripgrep
are distributed under the MIT License; Python is distributed under the Python
Software Foundation License; Git for Windows and its bundled components
retain their respective upstream license terms. CodePilotX verifies every
release archive with a fixed SHA-256 digest before installation.

The TypeScript language server executable is resolved from the workspace or
the configured system environment. It is not one of the four managed workspace
dependencies.
