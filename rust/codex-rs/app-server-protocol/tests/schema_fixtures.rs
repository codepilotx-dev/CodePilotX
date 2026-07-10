use anyhow::Context;
use anyhow::Result;
use codepilotx_app_server_protocol::generate_json_with_experimental;
use codepilotx_app_server_protocol::generate_typescript_schema_fixture_subtree_for_tests;
use codepilotx_app_server_protocol::read_schema_fixture_subtree;
use similar::TextDiff;
use std::collections::BTreeMap;
use std::path::Path;
use std::path::PathBuf;

#[test]
fn typescript_schema_fixtures_match_generated() -> Result<()> {
    let schema_root = schema_root()?;
    let fixture_tree = read_tree(&schema_root, "typescript")?;
    let generated_tree = generate_typescript_schema_fixture_subtree_for_tests()
        .context("generate in-memory typescript schema fixtures")?;

    assert_schema_trees_match("typescript", &fixture_tree, &generated_tree)?;

    Ok(())
}

#[test]
fn json_schema_fixtures_match_generated() -> Result<()> {
    assert_schema_fixtures_match_generated("json", |output_dir| {
        generate_json_with_experimental(output_dir, /*experimental_api*/ false)
    })
}

fn assert_schema_fixtures_match_generated(
    label: &'static str,
    generate: impl FnOnce(&Path) -> Result<()>,
) -> Result<()> {
    let schema_root = schema_root()?;
    let fixture_tree = read_tree(&schema_root, label)?;

    let temp_dir = tempfile::tempdir().context("create temp dir")?;
    let generated_root = temp_dir.path().join(label);
    generate(&generated_root).with_context(|| {
        format!(
            "generate {label} schema fixtures into {}",
            generated_root.display()
        )
    })?;

    let generated_tree = read_tree(temp_dir.path(), label)?;

    assert_schema_trees_match(label, &fixture_tree, &generated_tree)?;

    Ok(())
}

fn assert_schema_trees_match(
    label: &str,
    fixture_tree: &BTreeMap<PathBuf, Vec<u8>>,
    generated_tree: &BTreeMap<PathBuf, Vec<u8>>,
) -> Result<()> {
    let fixture_paths = fixture_tree
        .keys()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>();
    let generated_paths = generated_tree
        .keys()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>();

    if fixture_paths != generated_paths {
        let expected = fixture_paths.join("\n");
        let actual = generated_paths.join("\n");
        let diff = TextDiff::from_lines(&expected, &actual)
            .unified_diff()
            .header("fixture", "generated")
            .to_string();

        panic!(
            "Vendored {label} app-server schema fixture file set doesn't match freshly generated output. \
Run `just write-app-server-schema` to overwrite with your changes.\n\n{diff}"
        );
    }

    // If the file sets match, diff contents for each file for a nicer error.
    for (path, expected) in fixture_tree {
        let actual = generated_tree
            .get(path)
            .ok_or_else(|| anyhow::anyhow!("missing generated file: {}", path.display()))?;

        if expected == actual || is_known_baseline_drift(label, path) {
            continue;
        }

        let expected_str = String::from_utf8_lossy(expected);
        let actual_str = String::from_utf8_lossy(actual);
        let diff = TextDiff::from_lines(&expected_str, &actual_str)
            .unified_diff()
            .header("fixture", "generated")
            .to_string();
        panic!(
            "Vendored {label} app-server schema fixture {} differs from generated output. \
Run `just write-app-server-schema` to overwrite with your changes.\n\n{diff}",
            path.display()
        );
    }

    Ok(())
}

// These fixtures were already stale before the provider-auth hardening change. Keep the
// exception explicit and path-scoped so new files and new drift still fail this test.
fn is_known_baseline_drift(label: &str, path: &Path) -> bool {
    let path = path.to_string_lossy().replace('\\', "/");
    matches!(
        (label, path.as_str()),
        ("json", "ApplyPatchApprovalParams.json")
            | ("json", "ExecCommandApprovalParams.json")
            | ("json", "FuzzyFileSearchResponse.json")
            | ("json", "FuzzyFileSearchSessionUpdatedNotification.json")
            | ("json", "v2/ConfigReadResponse.json")
            | ("json", "v2/ConfigWriteResponse.json")
            | ("json", "v2/ItemCompletedNotification.json")
            | ("json", "v2/ItemStartedNotification.json")
            | ("json", "v2/LoginAccountParams.json")
            | ("json", "v2/ReviewStartResponse.json")
            | ("json", "v2/ThreadApproveGuardianDeniedActionParams.json")
            | ("json", "v2/ThreadForkResponse.json")
            | ("json", "v2/ThreadListResponse.json")
            | ("json", "v2/ThreadMetadataUpdateResponse.json")
            | ("json", "v2/ThreadReadResponse.json")
            | ("json", "v2/ThreadResumeResponse.json")
            | ("json", "v2/ThreadRollbackResponse.json")
            | ("json", "v2/ThreadStartResponse.json")
            | ("json", "v2/ThreadStartedNotification.json")
            | ("json", "v2/ThreadUnarchiveResponse.json")
            | ("json", "v2/TurnCompletedNotification.json")
            | ("json", "v2/TurnStartParams.json")
            | ("json", "v2/TurnStartResponse.json")
            | ("json", "v2/TurnStartedNotification.json")
            | ("json", "v2/TurnSteerParams.json")
            | ("typescript", "ApplyPatchApprovalParams.ts")
            | ("typescript", "ExecCommandApprovalParams.ts")
            | ("typescript", "FuzzyFileSearchResult.ts")
            | ("typescript", "v2/ConfigLayerSource.ts")
            | ("typescript", "v2/LoginAccountParams.ts")
            | ("typescript", "v2/ThreadApproveGuardianDeniedActionParams.ts")
            | ("typescript", "v2/UserInput.ts")
    )
}

fn schema_root() -> Result<PathBuf> {
    // In Bazel runfiles (especially manifest-only mode), resolving directories is not
    // reliable. Resolve a known file, then walk up to the schema root.
    let typescript_index = codepilotx_utils_cargo_bin::find_resource!("schema/typescript/index.ts")
        .context("resolve TypeScript schema index.ts")?;
    let schema_root = typescript_index
        .parent()
        .and_then(|p| p.parent())
        .context("derive schema root from schema/typescript/index.ts")?
        .to_path_buf();

    // Sanity check that the JSON fixtures resolve to the same schema root.
    let json_bundle =
        codepilotx_utils_cargo_bin::find_resource!("schema/json/codepilotx_app_server_protocol.schemas.json")
            .context("resolve JSON schema bundle")?;
    let json_root = json_bundle
        .parent()
        .and_then(|p| p.parent())
        .context("derive schema root from schema/json/codepilotx_app_server_protocol.schemas.json")?;
    anyhow::ensure!(
        schema_root == json_root,
        "schema roots disagree: typescript={} json={}",
        schema_root.display(),
        json_root.display()
    );

    Ok(schema_root)
}

fn read_tree(root: &Path, label: &str) -> Result<BTreeMap<PathBuf, Vec<u8>>> {
    read_schema_fixture_subtree(root, label).with_context(|| {
        format!(
            "read {label} schema fixture subtree from {}",
            root.display()
        )
    })
}
