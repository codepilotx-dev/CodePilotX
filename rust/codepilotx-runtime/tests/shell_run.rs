use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use codepilotx_runtime::{run_shell_request, ShellRunOutcome, ShellRunRequest};

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
fn shell_run_times_out() {
    let temp = tempfile::tempdir().expect("tempdir should be created");
    let output_file_path = temp.path().join("output.txt");

    let started = std::time::Instant::now();
    let outcome =
        run_shell_request(sleep_request(output_file_path, 100)).expect("shell request should run");

    assert_eq!(outcome, ShellRunOutcome::TimedOut);
    assert!(started.elapsed() < Duration::from_secs(3));
}
