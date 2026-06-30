use std::io::Read;

use clap::{Parser, Subcommand};
use codepilotx_runtime::{
    build_index_request, query_index_request, run_diff_request, run_glob_request, run_grep_request,
    run_shell_request_with_event_sink, DiffRequest, IndexBuildRequest, IndexQueryRequest,
    SearchRequest, ShellRunEvent, ShellRunRequest,
};
use serde::Serialize;

#[derive(Parser)]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    ShellRun,
    Glob,
    Grep,
    Diff,
    IndexBuild,
    IndexQuery,
}

fn main() {
    if let Err(error) = run() {
        write_event(&ShellRunEvent::Failed {
            message: error.to_string(),
        });
        std::process::exit(1);
    }
}

fn run() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::ShellRun => {
            let mut input = String::new();
            std::io::stdin().read_to_string(&mut input)?;
            let request: ShellRunRequest = serde_json::from_str(&input)?;
            run_shell_request_with_event_sink(request, |event| {
                write_event(&event);
            })?;
        }
        Command::Glob => {
            let request: SearchRequest = read_json_stdin()?;
            write_event(&SearchEvent::Started);
            let response = run_glob_request(request)?;
            write_event(&SearchEvent::Completed {
                lines: response.lines,
            });
        }
        Command::Grep => {
            let request: SearchRequest = read_json_stdin()?;
            write_event(&SearchEvent::Started);
            let response = run_grep_request(request)?;
            write_event(&SearchEvent::Completed {
                lines: response.lines,
            });
        }
        Command::Diff => {
            let request: DiffRequest = read_json_stdin()?;
            write_event(&DiffEvent::Started);
            let response = run_diff_request(request)?;
            write_event(&DiffEvent::Completed {
                hunks: response.hunks,
            });
        }
        Command::IndexBuild => {
            let request: IndexBuildRequest = read_json_stdin()?;
            write_event(&IndexEvent::Started);
            let response = build_index_request(request)?;
            write_event(&IndexEvent::BuildCompleted {
                files_indexed: response.files_indexed,
                bytes_written: response.bytes_written,
            });
        }
        Command::IndexQuery => {
            let request: IndexQueryRequest = read_json_stdin()?;
            write_event(&IndexEvent::Started);
            let response = query_index_request(request)?;
            write_event(&IndexEvent::QueryCompleted {
                matches: response.matches,
            });
        }
    }
    Ok(())
}

fn read_json_stdin<T: serde::de::DeserializeOwned>() -> anyhow::Result<T> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    Ok(serde_json::from_str(&input)?)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
enum SearchEvent {
    Started,
    Completed { lines: Vec<String> },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
enum DiffEvent {
    Started,
    Completed {
        hunks: Vec<codepilotx_runtime::StructuredPatchHunk>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
enum IndexEvent {
    Started,
    BuildCompleted {
        files_indexed: usize,
        bytes_written: u64,
    },
    QueryCompleted {
        matches: Vec<codepilotx_runtime::IndexedFileEntry>,
    },
}

fn write_event(event: &impl Serialize) {
    match serde_json::to_string(event) {
        Ok(line) => println!("{line}"),
        Err(error) => {
            eprintln!("failed to serialize event: {error}");
        }
    }
}
