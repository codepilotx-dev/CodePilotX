use std::path::Path;

use anyhow::Result;
use predicates::prelude::PredicateBooleanExt;
use predicates::str::contains;
use tempfile::TempDir;

fn codepilotx_command(codepilotx_home: &Path) -> Result<assert_cmd::Command> {
    let mut cmd = assert_cmd::Command::new(codepilotx_utils_cargo_bin::cargo_bin("codex")?);
    cmd.env("codepilotx_HOME", codepilotx_home);
    Ok(cmd)
}

#[test]
fn strict_config_rejects_unknown_config_fields_for_exec_server() -> Result<()> {
    let codepilotx_home = TempDir::new()?;
    std::fs::write(
        codepilotx_home.path().join("config.toml"),
        r#"
foo = "bar"
"#,
    )?;

    let mut cmd = codepilotx_command(codepilotx_home.path())?;
    cmd.args([
        "exec-server",
        "--strict-config",
        "--listen",
        "http://127.0.0.1:0",
    ])
    .assert()
    .failure()
    .stderr(contains("unknown configuration field"));

    Ok(())
}

#[test]
fn local_exec_server_ignores_invalid_config_without_strict_config() -> Result<()> {
    let codepilotx_home = TempDir::new()?;
    std::fs::write(
        codepilotx_home.path().join("config.toml"),
        "not valid toml = [",
    )?;

    let mut cmd = codepilotx_command(codepilotx_home.path())?;
    cmd.args(["exec-server", "--listen", "stdio"])
        .assert()
        .success()
        .stderr(contains("not valid toml").not());

    Ok(())
}
