# AGENTS.md

## Scope
Applies to PowerShell parsing and analysis under `utils/powershell/`.

## Conventions
- This directory owns PowerShell-specific parsing, dangerous cmdlet
  detection, and static prefix analysis. Treat the parser as a
  security-sensitive component.
- Preserve the module split: `parser.ts`, `dangerousCmdlets.ts`,
  `staticPrefix.ts`. Add new dangerous cmdlet definitions to
  `dangerousCmdlets.ts` rather than scattering detection across modules.
- Match the existing convention used by the bash parser in `utils/bash/`.
  Cross-shell parity helps classifiers and approval flows stay consistent.
- Do not weaken detection to make a feature pass. New bypass-resistant
  detection belongs in this directory, not in feature code.
- Be cross-platform. Verify behavior on Windows PowerShell, PowerShell
  Core, and the read-only command validation path in `utils/shell/`.

## Validation
- For parser or dangerous-cmdlet changes, include representative inputs
  covering pipelines, script blocks, encodings, and obfuscation attempts.
- Confirm the parser still interoperates with the shell classifier and
  approval flows used by `tools/`.
