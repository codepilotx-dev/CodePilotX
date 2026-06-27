use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use codepilotx_runtime::{
    build_index_request, query_index_request, run_shell_request, IndexBuildRequest,
    IndexQueryRequest, ShellRunOutcome, ShellRunRequest,
};

fn platform_shell(command: &str) -> (String, Vec<String>) {
    if cfg!(windows) {
        (
            "cmd.exe".to_string(),
            vec!["/C".to_string(), command.to_string()],
        )
    } else {
        (
            "sh".to_string(),
            vec!["-c".to_string(), command.to_string()],
        )
    }
}

fn request(command: &str, output_file_path: PathBuf, timeout_ms: u64) -> ShellRunRequest {
    let (spawn_binary, shell_args) = platform_shell(command);
    ShellRunRequest {
        spawn_binary,
        shell_args,
        cwd: std::env::current_dir().expect("cwd should exist"),
        env: std::collections::HashMap::new(),
        timeout_ms,
        output_file_path,
        windows_hide: true,
    }
}

#[cfg(windows)]
fn sleep_request(output_file_path: PathBuf, timeout_ms: u64) -> ShellRunRequest {
    ShellRunRequest {
        spawn_binary: "powershell.exe".to_string(),
        shell_args: vec![
            "-NoProfile".to_string(),
            "-Command".to_string(),
            "Start-Sleep -Seconds 5".to_string(),
        ],
        cwd: std::env::current_dir().expect("cwd should exist"),
        env: std::env::vars().collect(),
        timeout_ms,
        output_file_path,
        windows_hide: true,
    }
}

#[cfg(not(windows))]
fn sleep_request(output_file_path: PathBuf, timeout_ms: u64) -> ShellRunRequest {
    request("sleep 5", output_file_path, timeout_ms)
}

#[test]
fn shell_run_writes_output_and_exit_code() {
    let temp = tempfile::tempdir().expect("tempdir should be created");
    let output_file_path = temp.path().join("output.txt");

    let outcome = run_shell_request(request("echo hello", output_file_path.clone(), 5_000))
        .expect("shell request should run");

    assert_eq!(outcome, ShellRunOutcome::Exited { code: 0 });
    assert!(fs::read_to_string(output_file_path)
        .expect("output should be readable")
        .contains("hello"));
}

#[test]
fn shell_run_writes_stdout_and_stderr_to_same_output_file() {
    let temp = tempfile::tempdir().expect("tempdir should be created");
    let output_file_path = temp.path().join("output.txt");

    let command = if cfg!(windows) {
        "echo out & echo err 1>&2"
    } else {
        "echo out; echo err >&2"
    };
    let outcome = run_shell_request(request(command, output_file_path.clone(), 5_000))
        .expect("shell request should run");

    assert_eq!(outcome, ShellRunOutcome::Exited { code: 0 });
    let output = fs::read_to_string(output_file_path).expect("output should be readable");
    assert!(output.contains("out"));
    assert!(output.contains("err"));
}

#[test]
fn shell_run_times_out() {
    let temp = tempfile::tempdir().expect("tempdir should be created");
    let output_file_path = temp.path().join("output.txt");

    let started = std::time::Instant::now();
    let outcome =
        run_shell_request(sleep_request(output_file_path, 100)).expect("shell request should run");

    assert_eq!(outcome, ShellRunOutcome::TimedOut);
    assert!(started.elapsed() < Duration::from_secs(3));
}

#[test]
fn index_build_and_query_are_workspace_scoped_and_bounded() {
    let temp = tempfile::tempdir().expect("tempdir should be created");
    let workspace = temp.path().join("workspace");
    fs::create_dir_all(workspace.join("src")).unwrap();
    fs::write(workspace.join("src").join("alpha.ts"), "alpha").unwrap();
    fs::write(workspace.join("src").join("beta.rs"), "beta").unwrap();
    fs::write(workspace.join("src").join("gamma.md"), "gamma").unwrap();
    let cache_path = temp.path().join("index.json");

    let build = build_index_request(IndexBuildRequest {
        workspace: workspace.clone(),
        cache_path: cache_path.clone(),
        hidden: true,
        no_ignore: true,
        max_files: Some(2),
    })
    .expect("index should build");

    assert_eq!(build.files_indexed, 2);
    assert!(build.bytes_written > 0);

    let query = query_index_request(IndexQueryRequest {
        cache_path,
        query: "src".to_string(),
        limit: 10,
    })
    .expect("index should query");

    assert_eq!(query.matches.len(), 2);
    assert!(query
        .matches
        .iter()
        .all(|entry| entry.path.starts_with("src/")));
}
