#!/usr/bin/env python3
"""Trace transitive workspace dependencies for codex-app-server build."""

import re
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)

# ── 1. Read root workspace Cargo.toml to map crate names → directory paths ──
with open("Cargo.toml", "r", encoding="utf-8") as f:
    root_toml = f.read()

# Parse workspace dependency paths from [workspace.dependencies]
# Lines like:  codex-foo = { path = "some/path" }
path_map = {}  # crate_name -> directory path (relative to root)
for m in re.finditer(r'^(\w[\w-]*)\s*=\s*\{\s*path\s*=\s*"([^"]+)"\s*\}', root_toml, re.MULTILINE):
    crate, path = m.group(1), m.group(2)
    path_map[crate] = path

# Also add known member directories from members list for any crates not in workspace.dependencies
# Parse workspace members
members_match = re.search(
    r'^members\s*=\s*\[(.*?)\]',
    root_toml,
    re.DOTALL | re.MULTILINE,
)
members = re.findall(
    r'^\s*"([^"]+)"\s*,?\s*$',
    members_match.group(1) if members_match else "",
    re.MULTILINE,
)
for member in members:
    member_toml = ROOT / member / "Cargo.toml"
    try:
        member_content = member_toml.read_text(encoding="utf-8")
    except FileNotFoundError:
        continue
    package_name = re.search(r'(?m)^name\s*=\s*"([^"]+)"', member_content)
    if package_name:
        path_map.setdefault(package_name.group(1), member)

# Build reverse: directory -> crate name (from workspace.dependencies)
dir_to_crate = {}
for crate, dirpath in path_map.items():
    # Normalize path separators
    dir_normalized = dirpath.replace("\\", "/")
    dir_to_crate[dir_normalized] = crate

print("=== Workspace dependency path map ===", file=sys.stderr)
for crate, dirpath in sorted(path_map.items()):
    print(f"  {crate:50s} -> {dirpath}", file=sys.stderr)

# ── 2. Function to extract workspace deps from a Cargo.toml ──
def get_workspace_deps(cargo_toml_path):
    """Return set of workspace crate dependency names from a Cargo.toml file."""
    deps = set()
    try:
        with open(cargo_toml_path, "r", encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        return deps

    # Match lines like: codex-foo = { workspace = true }
    # Also handle codex-foo = { package = "...", path = "...", workspace = true } pattern
    for m in re.finditer(r'^(codex-[\w-]+)\s*=\s*\{', content, re.MULTILINE):
        deps.add(m.group(1))
    # Also match codex-foo = { workspace = true } and codex-foo = { package = "...", ... }
    for m in re.finditer(r'^(\w[\w-]*)\s*=\s*\{[^}]*workspace\s*=\s*true[^}]*\}', content, re.MULTILINE):
        crate = m.group(1)
        if crate.startswith("codex-") or crate in path_map:
            deps.add(crate)
    # Also match lines with explicit path deps like codex-windows-sandbox = { path = "../windows-sandbox-rs" }
    for m in re.finditer(r'^(\w[\w-]*)\s*=\s*\{[^}]*path\s*=\s*"([^"]+)"[^}]*\}', content, re.MULTILINE):
        crate = m.group(1)
        path_val = m.group(2)
        if crate.startswith("codex-"):
            deps.add(crate)
            # If this path isn't in path_map, add it
            path_norm = os.path.normpath(os.path.join(os.path.dirname(cargo_toml_path), path_val)).replace("\\", "/")
            rel_path = os.path.relpath(path_norm, ROOT).replace("\\", "/")
            if crate not in path_map:
                path_map[crate] = rel_path
                print(f"  [ADDED] {crate:50s} -> {rel_path}", file=sys.stderr)

    # Also find deps from dev-dependencies
    dev_section = re.search(r'\[dev-dependencies\](.*?)(?=\[|$)', content, re.DOTALL)
    if dev_section:
        for m in re.finditer(r'^(codex-[\w-]+)\s*=\s*\{', dev_section.group(1), re.MULTILINE):
            deps.add(m.group(1))

    return deps

# ── 3. Build the transitive closure ──

# Helper: given a crate name, find its Cargo.toml path
def crate_to_toml_path(crate_name):
    if crate_name in path_map:
        return os.path.join(ROOT, path_map[crate_name], "Cargo.toml")
    return None

# Initial set
initial = {
    "codex-app-server",
    "codex-core",
    "codex-app-server-protocol",
    "codex-protocol",
    "codex-model-provider-info",
    "codex-config",
    "codex-state",
    "codex-login",
    "codex-api",
    "codex-client",
    "codex-sandboxing",
    "codex-tools",
    "codex-features",
    "codex-exec-server",
    "codex-shell-command",
    "codex-file-system",
    "codex-hooks",
    "codex-otel",
    "codex-feedback",
    "codex-apply-patch",
    "codex-git-utils",
    # Windows-specific
    "codex-windows-sandbox",
}

also_add = {
    "codex-utils-absolute-path",
    "codex-utils-path-uri",
    "codex-utils-cli",
    "codex-utils-pty",
    "codex-utils-cargo-bin",
    "codex-utils-cache",
    "codex-utils-home-dir",
    "codex-utils-image",
    "codex-utils-output-truncation",
    "codex-utils-path",
    "codex-utils-plugins",
    "codex-utils-string",
    "codex-utils-stream-parser",
    "codex-utils-json-to-toml",
    "codex-model-provider",
    "codex-models-manager",
    "codex-rollout",
    "codex-rmcp-client",
    "codex-thread-store",
    "codex-analytics",
    "codex-core-plugins",
    "codex-extension-api",
    "codex-plugin",
    "codex-home",
    "codex-arg0",
    "codex-cloud-config",
    "codex-external-agent-migration",
    "codex-external-agent-sessions",
    "codex-goal-extension",
    "codex-guardian",
    "codex-skills-extension",
    "codex-mcp",
    "codex-mcp-extension",
    "codex-memories-extension",
    "codex-memories-write",
    "codex-web-search-extension",
    "codex-image-generation-extension",
    "codex-file-search",
    "codex-file-watcher",
    "codex-backend-client",
    "codex-chatgpt",
    "codex-app-server-transport",
    "codex-async-utils",
    "codex-code-mode",
    "codex-connectors",
    "codex-context-fragments",
    "codex-core-skills",
    "codex-execpolicy",
    "codex-install-context",
    "codex-network-proxy",
    "codex-response-debug-context",
    "codex-prompts",
    "codex-rollout-trace",
    "codex-terminal-detection",
    "codex-memories-read",
    "codex-utils-fuzzy-match",
    "codex-utils-template",
    "codex-utils-approval-presets",
    "codex-utils-oss",
    "codex-utils-elapsed",
    "codex-utils-sandbox-summary",
    "codex-utils-sleep-inhibitor",
    "codex-utils-readiness",
    "codex-utils-rustls-provider",
    "codex-secrets",
    "codex-keyring-store",
    "codex-uds",
    "codex-test-binary-support",
    "core_test_support",
    "app_test_support",
    "codex-experimental-api-macros",
}
initial.update(also_add)

# Start with the initial set and expand transitively
all_deps = set(initial)

# Iterate until closure stabilizes
while True:
    new_deps = set()
    for crate in all_deps:
        toml_path = crate_to_toml_path(crate)
        if toml_path and os.path.exists(toml_path):
            ws_deps = get_workspace_deps(toml_path)
            new_deps.update(ws_deps)

    # Also look at core_test_support and app_test_support
    for test_crate in ["core_test_support", "app_test_support"]:
        toml_path = crate_to_toml_path(test_crate)
        if toml_path and os.path.exists(toml_path):
            ws_deps = get_workspace_deps(toml_path)
            new_deps.update(ws_deps)

    # Add known codex-* deps that might not have been caught
    for dep in list(new_deps):
        if dep not in path_map and dep.startswith("codex-"):
            # Try to find by checking if there's a directory matching
            dir_name = dep.replace("codex-", "", 1)
            potential_paths = [
                dir_name,
                f"ext/{dir_name}",
                f"utils/{dir_name}",
                f"memories/{dir_name}",
            ]
            for pp in potential_paths:
                if os.path.isdir(os.path.join(ROOT, pp)):
                    path_map[dep] = pp
                    break

    before = len(all_deps)
    all_deps.update(new_deps)
    after = len(all_deps)
    if after == before:
        break
    print(f"  +{after-before} new deps found (total: {after})", file=sys.stderr)

# ── 4. Filter: only include crates that have a known path ──
# Also exclude Unix-only crates
exclude_crates = {
    "codex-linux-sandbox",
    "codex-process-hardening",
    "codex-stdio-to-uds",
    "codex-bwrap",
    "codex-shell-escalation",  # unix-only
}

final_crates = sorted(all_deps - exclude_crates)

print(f"\n=== Final crate set ({len(final_crates)} crates) ===", file=sys.stderr)
for c in final_crates:
    print(f"  {c}", file=sys.stderr)

print(f"\n=== Paths to copy ===")
for c in final_crates:
    if c in path_map:
        # Ensure the directory exists
        p = path_map[c].replace("\\", "/")
        print(p)
    elif c == "codex-windows-sandbox":
        # Check if it's in path_map
        print("windows-sandbox-rs")
    else:
        print(f"# WARNING: No path for {c}", file=sys.stderr)

# Also print the test support paths
if "core_test_support" in final_crates:
    print("core/tests/common")
if "app_test_support" in final_crates:
    print("app-server/tests/common")
if "mcp_test_support" in final_crates:
    print("mcp-server/tests/common")

print(f"\n=== Patch sections from root Cargo.toml ===")
patch_section = re.search(r'\[patch\..*?\](.*?)(?=\[|$)', root_toml, re.DOTALL)
if patch_section:
    print(patch_section.group(0))
else:
    print("No [patch] sections found")
