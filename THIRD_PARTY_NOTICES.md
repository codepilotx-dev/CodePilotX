# Third-Party Notices

CodePilotX includes source adapted from the OpenCode project. The copied model
schema and project directory storage semantics originated from version
1.17.13; the JSONC parsing and key-path patching approach was adapted from
version 1.18.9. These portions are licensed under the MIT License. See
`third_party/opencode/LICENSE`.

Additional JavaScript dependencies retain the license terms distributed in
their respective packages.

CodePilotX uses Microsoft node-pty to provide native pseudoterminal support,
including Windows ConPTY integration. node-pty is licensed under the MIT
License; its license notice is distributed with the packaged dependency.

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

CodePilotX's external open menu ships fixed brand icons for the
third-party applications it detects and can launch. The icons are used
solely to identify an installed application; their presence never
implies endorsement of, affiliation with, or sponsorship by the
trademark owners, and CodePilotX is not affiliated with those vendors.

- The VS Code, VS Code Insiders, Cursor, Windsurf, File Explorer,
  Windows Terminal, and IntelliJ IDEA icons were copied from the Codex
  desktop application's webview assets
  (`src/webview/apps/*.png` of `openai-codex-electron` version
  26.730.61309, unpacked locally from `F:\CodeProject\Codex-unpacked`).
  CodePilotX file names: `vscode.png`, `vscode-insiders.png`,
  `cursor.png`, `windsurf.png`, `file-explorer.png`,
  `microsoft-terminal.png`, `intellij.png`.
- The Visual Studio icon (`visual-studio.png`) was extracted from the
  icon resource of the official Microsoft Visual Studio 2022 Community
  `devenv.exe` binary installed on the packaging machine and was not
  redrawn, recolored, or composited. Visual Studio imagery is subject
  to Microsoft's Visual Studio Image Library terms and the Visual
  Studio product license; see
  https://www.microsoft.com/en-us/download/details.aspx?id=35825.
- The GitHub Desktop icon (`github-desktop.png`) was extracted from the
  production `app/static/logos/prod/icon-logo.ico` of the
  `desktop/desktop` repository at commit
  `e056ef235d0d222c33ffb2f5bac3543c3833d51b` and scaled to 48x48
  without changing its proportions. GitHub logos are used under the
  GitHub Logo Policy:
  https://docs.github.com/en/site-policy/other-site-policies/github-logo-policy.
