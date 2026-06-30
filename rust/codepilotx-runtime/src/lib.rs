use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::fs::OpenOptions;
use std::path::Path;
use std::path::PathBuf;
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant, UNIX_EPOCH};

use anyhow::{Context, Result};
use ignore::overrides::{Override, OverrideBuilder};
use ignore::Match;
use ignore::WalkBuilder;
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellRunRequest {
    pub spawn_binary: String,
    pub shell_args: Vec<String>,
    pub cwd: PathBuf,
    pub env: HashMap<String, String>,
    pub timeout_ms: u64,
    pub output_file_path: PathBuf,
    pub windows_hide: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub args: Vec<String>,
    pub target: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRequest {
    pub old_content: String,
    pub new_content: String,
    pub context_lines: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResponse {
    pub hunks: Vec<StructuredPatchHunk>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexBuildRequest {
    pub workspace: PathBuf,
    pub cache_path: PathBuf,
    pub hidden: bool,
    pub no_ignore: bool,
    pub max_files: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexBuildResponse {
    pub files_indexed: usize,
    pub bytes_written: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexQueryRequest {
    pub cache_path: PathBuf,
    pub query: String,
    pub limit: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedFileEntry {
    pub path: String,
    pub size: u64,
    pub modified_unix_seconds: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexQueryResponse {
    pub matches: Vec<IndexedFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexCacheFile {
    version: u32,
    workspace: String,
    files: Vec<IndexedFileEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredPatchHunk {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ShellRunOutcome {
    Exited { code: i32 },
    TimedOut,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ShellRunEvent {
    Started { pid: u32 },
    Exited { code: i32 },
    TimedOut,
    Failed { message: String },
}

pub fn run_glob_request(request: SearchRequest) -> Result<SearchResponse> {
    let options = parse_glob_args(&request.args)?;
    let matcher = PathMatcher::new(&request.target, &options.globs)?;
    let mut entries = Vec::new();

    for entry in walk_files(&request.target, options.hidden, options.no_ignore)? {
        let relative_path = path_for_output(&request.target, &entry);
        if matcher.matches(&relative_path) {
            let modified = if options.sort_modified {
                fs::metadata(&entry)
                    .and_then(|metadata| metadata.modified())
                    .ok()
            } else {
                None
            };
            entries.push((relative_path, modified));
        }
    }

    if options.sort_modified {
        entries.sort_by(|a, b| {
            let time_order = a.1.cmp(&b.1);
            if time_order == std::cmp::Ordering::Equal {
                a.0.cmp(&b.0)
            } else {
                time_order
            }
        });
    }

    Ok(SearchResponse {
        lines: entries.into_iter().map(|(path, _)| path).collect(),
    })
}

pub fn run_grep_request(request: SearchRequest) -> Result<SearchResponse> {
    let options = parse_grep_args(&request.args)?;
    let matcher = PathMatcher::new(&request.target, &options.globs)?;
    let regex = RegexBuilder::new(&options.pattern)
        .case_insensitive(options.case_insensitive)
        .dot_matches_new_line(options.multiline)
        .multi_line(options.multiline)
        .build()
        .with_context(|| format!("invalid regex pattern {}", options.pattern))?;
    let mut lines = Vec::new();

    for entry in walk_files(&request.target, options.hidden, false)? {
        let relative_path = path_for_output(&request.target, &entry);
        if !matcher.matches(&relative_path) {
            continue;
        }
        if let Some(type_filter) = &options.type_filter {
            if !type_filter.matches(&entry) {
                continue;
            }
        }

        let Ok(content) = fs::read_to_string(&entry) else {
            continue;
        };

        let absolute_path = absolutize(&entry)?;
        let line_infos = split_lines_with_offsets(&content);
        let matched_lines =
            find_matched_line_indexes(&regex, &content, &line_infos, options.multiline);
        let file_match_count = if options.multiline {
            regex.find_iter(&content).count()
        } else {
            matched_lines.len()
        };

        match options.mode {
            GrepMode::FilesWithMatches if file_match_count > 0 => {
                lines.push(display_path(&absolute_path));
            }
            GrepMode::Count if file_match_count > 0 => {
                lines.push(format!(
                    "{}:{}",
                    display_path(&absolute_path),
                    file_match_count
                ));
            }
            GrepMode::Content if file_match_count > 0 => {
                append_content_matches(
                    &mut lines,
                    &absolute_path,
                    &line_infos,
                    &matched_lines,
                    &options,
                );
            }
            _ => {}
        }
    }

    Ok(SearchResponse { lines })
}

pub fn run_diff_request(request: DiffRequest) -> Result<DiffResponse> {
    let diff = TextDiff::from_lines(&request.old_content, &request.new_content);
    let mut hunks = Vec::new();

    for group in diff.grouped_ops(request.context_lines) {
        let mut lines = Vec::new();
        let mut old_start: Option<usize> = None;
        let mut new_start: Option<usize> = None;
        let mut old_lines = 0usize;
        let mut new_lines = 0usize;

        for op in group {
            for change in diff.iter_changes(&op) {
                let marker = match change.tag() {
                    ChangeTag::Delete => {
                        old_lines += 1;
                        old_start.get_or_insert(change.old_index().unwrap_or(0) + 1);
                        "-"
                    }
                    ChangeTag::Insert => {
                        new_lines += 1;
                        new_start.get_or_insert(change.new_index().unwrap_or(0) + 1);
                        "+"
                    }
                    ChangeTag::Equal => {
                        old_lines += 1;
                        new_lines += 1;
                        old_start.get_or_insert(change.old_index().unwrap_or(0) + 1);
                        new_start.get_or_insert(change.new_index().unwrap_or(0) + 1);
                        " "
                    }
                };
                lines.push(format!("{}{}", marker, trim_line_end(change.value())));
            }
        }

        hunks.push(StructuredPatchHunk {
            old_start: old_start.unwrap_or(1),
            old_lines,
            new_start: new_start.unwrap_or(1),
            new_lines,
            lines,
        });
    }

    Ok(DiffResponse { hunks })
}

pub fn build_index_request(request: IndexBuildRequest) -> Result<IndexBuildResponse> {
    let workspace = absolutize(&request.workspace)?;
    let mut files = Vec::new();

    for entry in walk_files(&workspace, request.hidden, request.no_ignore)? {
        if request
            .max_files
            .is_some_and(|max_files| files.len() >= max_files)
        {
            break;
        }
        let metadata = fs::metadata(&entry)
            .with_context(|| format!("read metadata for {}", entry.display()))?;
        let modified_unix_seconds = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs());
        files.push(IndexedFileEntry {
            path: path_for_output(&workspace, &entry),
            size: metadata.len(),
            modified_unix_seconds,
        });
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));

    let cache = IndexCacheFile {
        version: 1,
        workspace: display_path(&workspace),
        files,
    };
    let json = serde_json::to_vec(&cache).context("serialize index cache")?;
    write_cache_file(&request.cache_path, &json)?;

    Ok(IndexBuildResponse {
        files_indexed: cache.files.len(),
        bytes_written: json.len() as u64,
    })
}

pub fn query_index_request(request: IndexQueryRequest) -> Result<IndexQueryResponse> {
    let content = fs::read(&request.cache_path)
        .with_context(|| format!("read index cache {}", request.cache_path.display()))?;
    let cache: IndexCacheFile = serde_json::from_slice(&content).context("parse index cache")?;
    let query = request.query.to_ascii_lowercase();
    let limit = request.limit;
    let matches = cache
        .files
        .into_iter()
        .filter(|entry| entry.path.to_ascii_lowercase().contains(&query))
        .take(limit)
        .collect();
    Ok(IndexQueryResponse { matches })
}

pub fn run_shell_request(request: ShellRunRequest) -> Result<ShellRunOutcome> {
    run_shell_request_with_event_sink(request, |_| {})
}

pub fn run_shell_request_with_event_sink(
    request: ShellRunRequest,
    mut emit: impl FnMut(ShellRunEvent),
) -> Result<ShellRunOutcome> {
    let output_file = open_shell_output_file(&request.output_file_path)?;
    let stderr_file = output_file
        .try_clone()
        .context("failed to clone shell output file handle")?;

    let mut command = Command::new(&request.spawn_binary);
    command
        .args(&request.shell_args)
        .current_dir(&request.cwd)
        .env_clear()
        .envs(&request.env)
        .stdin(Stdio::null())
        .stdout(Stdio::from(output_file))
        .stderr(Stdio::from(stderr_file));

    prepare_command(&mut command, request.windows_hide);

    let mut child = command
        .spawn()
        .with_context(|| format!("failed to spawn {}", request.spawn_binary))?;
    let process_handle = match ProcessHandle::attach(&child) {
        Ok(handle) => handle,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    emit(ShellRunEvent::Started { pid: child.id() });

    let deadline = Instant::now() + Duration::from_millis(request.timeout_ms);
    loop {
        if let Some(status) = child.try_wait().context("failed to poll child process")? {
            let code = exit_status_code(status);
            emit(ShellRunEvent::Exited { code });
            return Ok(ShellRunOutcome::Exited { code });
        }

        if Instant::now() >= deadline {
            process_handle.terminate(&mut child);
            emit(ShellRunEvent::TimedOut);
            return Ok(ShellRunOutcome::TimedOut);
        }

        thread::sleep(Duration::from_millis(25));
    }
}

#[derive(Debug, Clone)]
struct GlobOptions {
    globs: Vec<String>,
    hidden: bool,
    no_ignore: bool,
    sort_modified: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GrepMode {
    Content,
    FilesWithMatches,
    Count,
}

#[derive(Debug, Clone)]
struct GrepOptions {
    globs: Vec<String>,
    hidden: bool,
    max_columns: usize,
    mode: GrepMode,
    line_numbers: bool,
    case_insensitive: bool,
    before_context: usize,
    after_context: usize,
    multiline: bool,
    type_filter: Option<FileTypeFilter>,
    pattern: String,
}

fn parse_glob_args(args: &[String]) -> Result<GlobOptions> {
    let mut globs = Vec::new();
    let mut hidden = false;
    let mut no_ignore = false;
    let mut sort_modified = false;
    let mut saw_files = false;
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--files" => saw_files = true,
            "--glob" => {
                index += 1;
                let pattern = args.get(index).context("--glob requires a pattern")?;
                globs.push(pattern.clone());
            }
            "--sort=modified" => sort_modified = true,
            "--no-ignore" => no_ignore = true,
            "--hidden" => hidden = true,
            arg => anyhow::bail!("unsupported glob arg {arg}"),
        }
        index += 1;
    }

    if !saw_files {
        anyhow::bail!("glob request must include --files");
    }

    Ok(GlobOptions {
        globs,
        hidden,
        no_ignore,
        sort_modified,
    })
}

fn parse_grep_args(args: &[String]) -> Result<GrepOptions> {
    let mut globs = Vec::new();
    let mut hidden = false;
    let mut max_columns = 500usize;
    let mut mode = GrepMode::Content;
    let mut line_numbers = false;
    let mut case_insensitive = false;
    let mut before_context = 0usize;
    let mut after_context = 0usize;
    let mut multiline = false;
    let mut type_filter = None;
    let mut pattern: Option<String> = None;
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--hidden" => hidden = true,
            "--glob" => {
                index += 1;
                let value = args.get(index).context("--glob requires a pattern")?;
                globs.push(value.clone());
            }
            "--max-columns" => {
                index += 1;
                let value = args.get(index).context("--max-columns requires a value")?;
                max_columns = value.parse().context("invalid --max-columns value")?;
            }
            "-i" => case_insensitive = true,
            "-l" => mode = GrepMode::FilesWithMatches,
            "-c" => mode = GrepMode::Count,
            "-n" => line_numbers = true,
            "-A" => {
                index += 1;
                after_context = parse_usize_arg(args.get(index), "-A")?;
            }
            "-B" => {
                index += 1;
                before_context = parse_usize_arg(args.get(index), "-B")?;
            }
            "-C" | "--context" => {
                index += 1;
                let context = parse_usize_arg(args.get(index), args[index - 1].as_str())?;
                before_context = context;
                after_context = context;
            }
            "-U" | "--multiline-dotall" => multiline = true,
            "--type" => {
                index += 1;
                let value = args.get(index).context("--type requires a value")?;
                type_filter = Some(FileTypeFilter::parse(value)?);
            }
            "-e" => {
                index += 1;
                let value = args.get(index).context("-e requires a pattern")?;
                pattern = Some(value.clone());
            }
            arg if arg.starts_with('-') => anyhow::bail!("unsupported grep arg {arg}"),
            arg => {
                if pattern.is_some() {
                    anyhow::bail!("multiple grep patterns are not supported");
                }
                pattern = Some(arg.to_string());
            }
        }
        index += 1;
    }

    Ok(GrepOptions {
        globs,
        hidden,
        max_columns,
        mode,
        line_numbers,
        case_insensitive,
        before_context,
        after_context,
        multiline,
        type_filter,
        pattern: pattern.context("grep pattern is required")?,
    })
}

fn parse_usize_arg(value: Option<&String>, flag: &str) -> Result<usize> {
    value
        .with_context(|| format!("{flag} requires a value"))?
        .parse()
        .with_context(|| format!("invalid {flag} value"))
}

#[derive(Debug, Clone)]
struct FileTypeFilter {
    extensions: &'static [&'static str],
    filenames: &'static [&'static str],
}

impl FileTypeFilter {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "c" => Ok(Self::extensions(&["c", "h"])),
            "cpp" | "c++" => Ok(Self::extensions(&[
                "cc", "cpp", "cxx", "c++", "hh", "hpp", "hxx", "h++",
            ])),
            "csharp" | "cs" => Ok(Self::extensions(&["cs"])),
            "css" => Ok(Self::extensions(&["css"])),
            "go" => Ok(Self::extensions(&["go"])),
            "html" => Ok(Self::extensions(&["html", "htm"])),
            "java" => Ok(Self::extensions(&["java"])),
            "js" => Ok(Self::extensions(&["js", "jsx", "mjs", "cjs"])),
            "json" => Ok(Self::extensions(&["json", "jsonc"])),
            "kotlin" | "kt" => Ok(Self::extensions(&["kt", "kts"])),
            "markdown" | "md" => Ok(Self::extensions(&["md", "markdown"])),
            "php" => Ok(Self::extensions(&["php"])),
            "py" | "python" => Ok(Self::extensions(&["py", "pyi"])),
            "rb" | "ruby" => Ok(Self::extensions(&["rb"])),
            "rust" | "rs" => Ok(Self::extensions(&["rs"])),
            "scala" => Ok(Self::extensions(&["scala", "sc"])),
            "sh" | "shell" => Ok(Self::extensions(&["sh", "bash", "zsh", "fish"])),
            "swift" => Ok(Self::extensions(&["swift"])),
            "toml" => Ok(Self::extensions(&["toml"])),
            "ts" => Ok(Self::extensions(&["ts", "tsx", "mts", "cts"])),
            "txt" => Ok(Self::extensions(&["txt"])),
            "xml" => Ok(Self::extensions(&["xml"])),
            "yaml" | "yml" => Ok(Self::extensions(&["yaml", "yml"])),
            "docker" => Ok(Self {
                extensions: &["dockerfile"],
                filenames: &["dockerfile"],
            }),
            other => anyhow::bail!("unsupported grep --type {other}"),
        }
    }

    fn extensions(extensions: &'static [&'static str]) -> Self {
        Self {
            extensions,
            filenames: &[],
        }
    }

    fn matches(&self, path: &Path) -> bool {
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase);
        if extension
            .as_deref()
            .is_some_and(|extension| self.extensions.contains(&extension))
        {
            return true;
        }

        let filename = path
            .file_name()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase);
        filename
            .as_deref()
            .is_some_and(|filename| self.filenames.contains(&filename))
    }
}

struct PathMatcher {
    overrides: Override,
}

impl PathMatcher {
    fn new(root: &Path, patterns: &[String]) -> Result<Self> {
        let mut builder = OverrideBuilder::new(root);

        for raw in patterns {
            let (prefix, pattern) = raw
                .strip_prefix('!')
                .map_or(("", raw.as_str()), |pattern| ("!", pattern));
            for expanded in expand_glob_pattern(pattern) {
                builder
                    .add(&format!("{prefix}{expanded}"))
                    .with_context(|| format!("invalid glob pattern {}", raw))?;
            }
        }

        Ok(Self {
            overrides: builder.build()?,
        })
    }

    fn matches(&self, relative_path: &str) -> bool {
        !matches!(
            self.overrides.matched(Path::new(relative_path), false),
            Match::Ignore(_)
        )
    }
}

fn expand_glob_pattern(pattern: &str) -> Vec<String> {
    let normalized = pattern.replace('\\', "/");
    if normalized.contains('/') || normalized.starts_with("**") {
        return vec![normalized];
    }
    vec![
        normalized.clone(),
        format!("**/{normalized}"),
        format!("{normalized}/**"),
        format!("**/{normalized}/**"),
    ]
}

fn walk_files(target: &Path, hidden: bool, no_ignore: bool) -> Result<Vec<PathBuf>> {
    if target.is_file() {
        return Ok(vec![target.to_path_buf()]);
    }

    let mut builder = WalkBuilder::new(target);
    builder
        .hidden(!hidden)
        .ignore(!no_ignore)
        .git_ignore(!no_ignore)
        .git_exclude(!no_ignore)
        .git_global(!no_ignore)
        .parents(!no_ignore)
        .require_git(true);

    let mut files = Vec::new();
    for entry in builder.build() {
        let entry = entry?;
        if entry
            .file_type()
            .is_some_and(|file_type| file_type.is_file())
        {
            files.push(entry.path().to_path_buf());
        }
    }
    Ok(files)
}

fn path_for_output(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn absolutize(path: &Path) -> Result<PathBuf> {
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        Ok(std::env::current_dir()?.join(path))
    }
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[derive(Debug, Clone)]
struct LineInfo<'a> {
    text: &'a str,
    start: usize,
    end: usize,
}

fn split_lines_with_offsets(content: &str) -> Vec<LineInfo<'_>> {
    let mut lines = Vec::new();
    let mut start = 0usize;

    for raw in content.split_inclusive('\n') {
        let end = start + raw.len();
        let text = trim_line_end(raw);
        lines.push(LineInfo { text, start, end });
        start = end;
    }

    if start < content.len() {
        lines.push(LineInfo {
            text: &content[start..],
            start,
            end: content.len(),
        });
    }

    lines
}

fn find_matched_line_indexes(
    regex: &regex::Regex,
    content: &str,
    lines: &[LineInfo<'_>],
    multiline: bool,
) -> BTreeSet<usize> {
    let mut indexes = BTreeSet::new();

    if multiline {
        for matched in regex.find_iter(content) {
            for (index, line) in lines.iter().enumerate() {
                let overlaps = matched.start() < line.end && matched.end() > line.start;
                let zero_length_at_line =
                    matched.start() == matched.end() && matched.start() == line.start;
                if overlaps || zero_length_at_line {
                    indexes.insert(index);
                }
            }
        }
        return indexes;
    }

    for (index, line) in lines.iter().enumerate() {
        if regex.is_match(line.text) {
            indexes.insert(index);
        }
    }

    indexes
}

fn append_content_matches(
    output: &mut Vec<String>,
    path: &Path,
    lines: &[LineInfo<'_>],
    matched_lines: &BTreeSet<usize>,
    options: &GrepOptions,
) {
    if matched_lines.is_empty() {
        return;
    }

    let ranges = context_ranges(
        matched_lines,
        lines.len(),
        options.before_context,
        options.after_context,
    );
    for (range_index, (start, end)) in ranges.into_iter().enumerate() {
        if range_index > 0 && (options.before_context > 0 || options.after_context > 0) {
            output.push("--".to_string());
        }
        for line_index in start..=end {
            let is_match = matched_lines.contains(&line_index);
            if let Some(line) = format_grep_content_line(
                path,
                line_index + 1,
                lines[line_index].text,
                is_match,
                options.line_numbers,
                options.before_context > 0 || options.after_context > 0,
                options.max_columns,
            ) {
                output.push(line);
            }
        }
    }
}

fn context_ranges(
    matched_lines: &BTreeSet<usize>,
    line_count: usize,
    before_context: usize,
    after_context: usize,
) -> Vec<(usize, usize)> {
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for &line_index in matched_lines {
        let start = line_index.saturating_sub(before_context);
        let end = line_index
            .saturating_add(after_context)
            .min(line_count.saturating_sub(1));

        if let Some((_, previous_end)) = ranges.last_mut() {
            if start <= previous_end.saturating_add(1) {
                *previous_end = (*previous_end).max(end);
                continue;
            }
        }
        ranges.push((start, end));
    }
    ranges
}

fn format_grep_content_line(
    path: &Path,
    line_number: usize,
    line: &str,
    is_match: bool,
    line_numbers: bool,
    has_context: bool,
    max_columns: usize,
) -> Option<String> {
    if line.chars().count() > max_columns {
        return None;
    }
    let path = display_path(path);
    let separator = if has_context && !is_match { '-' } else { ':' };

    if line_numbers {
        Some(format!("{path}{separator}{line_number}{separator}{line}"))
    } else {
        Some(format!("{path}{separator}{line}"))
    }
}

fn trim_line_end(value: &str) -> &str {
    value.trim_end_matches('\n').trim_end_matches('\r')
}

fn write_cache_file(path: &Path, content: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("create cache directory {}", parent.display()))?;
    }
    let temp_path = path.with_extension("tmp");
    fs::write(&temp_path, content)
        .with_context(|| format!("write temporary cache {}", temp_path.display()))?;
    replace_cache_file(&temp_path, path)?;
    Ok(())
}

#[cfg(windows)]
fn replace_cache_file(temp_path: &Path, path: &Path) -> Result<()> {
    let backup_path = path.with_extension("bak");
    if backup_path.exists() {
        fs::remove_file(&backup_path)
            .with_context(|| format!("remove stale cache backup {}", backup_path.display()))?;
    }

    let had_existing = path.exists();
    if had_existing {
        fs::rename(path, &backup_path)
            .with_context(|| format!("backup cache {}", path.display()))?;
    }

    match fs::rename(temp_path, path) {
        Ok(()) => {
            if had_existing {
                let _ = fs::remove_file(&backup_path);
            }
            Ok(())
        }
        Err(error) => {
            if had_existing {
                let _ = fs::rename(&backup_path, path);
            }
            Err(error).with_context(|| {
                format!(
                    "move temporary cache {} to {}",
                    temp_path.display(),
                    path.display()
                )
            })
        }
    }
}

#[cfg(not(windows))]
fn replace_cache_file(temp_path: &Path, path: &Path) -> Result<()> {
    fs::rename(temp_path, path).with_context(|| {
        format!(
            "move temporary cache {} to {}",
            temp_path.display(),
            path.display()
        )
    })
}

#[cfg(windows)]
fn open_shell_output_file(path: &Path) -> Result<fs::File> {
    OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .with_context(|| format!("failed to open shell output file {}", path.display()))
}

#[cfg(not(windows))]
fn open_shell_output_file(path: &Path) -> Result<fs::File> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .with_context(|| format!("failed to open shell output file {}", path.display()))
}

#[cfg(unix)]
fn exit_status_code(status: ExitStatus) -> i32 {
    use std::os::unix::process::ExitStatusExt;

    status
        .code()
        .or_else(|| status.signal().map(|signal| 128 + signal))
        .unwrap_or(1)
}

#[cfg(not(unix))]
fn exit_status_code(status: ExitStatus) -> i32 {
    status.code().unwrap_or(1)
}

#[cfg(windows)]
fn prepare_command(command: &mut Command, windows_hide: bool) {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    if windows_hide {
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

#[cfg(unix)]
fn prepare_command(command: &mut Command, _windows_hide: bool) {
    use std::os::unix::process::CommandExt;

    command.process_group(0);
}

#[cfg(not(any(unix, windows)))]
fn prepare_command(_command: &mut Command, _windows_hide: bool) {}

struct ProcessHandle {
    #[cfg(windows)]
    job: windows_sys::Win32::Foundation::HANDLE,
}

impl ProcessHandle {
    fn attach(child: &std::process::Child) -> Result<Self> {
        attach_process_handle(child)
    }

    fn terminate(&self, child: &mut std::process::Child) {
        terminate_process_handle(self, child);
    }
}

#[cfg(windows)]
fn attach_process_handle(child: &std::process::Child) -> Result<ProcessHandle> {
    use std::mem::size_of;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if job.is_null() {
        anyhow::bail!("failed to create Windows job object");
    }

    let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let set_ok = unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &mut info as *mut _ as *mut _,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if set_ok == 0 {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(job);
        }
        anyhow::bail!("failed to configure Windows job object");
    }

    let assigned = unsafe { AssignProcessToJobObject(job, child.as_raw_handle() as _) };
    if assigned == 0 {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(job);
        }
        anyhow::bail!("failed to assign process to Windows job object");
    }

    Ok(ProcessHandle { job })
}

#[cfg(windows)]
fn terminate_process_handle(handle: &ProcessHandle, child: &mut std::process::Child) {
    use windows_sys::Win32::System::JobObjects::TerminateJobObject;

    unsafe {
        TerminateJobObject(handle.job, 1);
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(windows)]
impl Drop for ProcessHandle {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.job);
        }
    }
}

#[cfg(unix)]
fn attach_process_handle(_child: &std::process::Child) -> Result<ProcessHandle> {
    Ok(ProcessHandle {})
}

#[cfg(unix)]
fn terminate_process_handle(_handle: &ProcessHandle, child: &mut std::process::Child) {
    let pgid = child.id() as i32;
    unsafe {
        libc::kill(-pgid, libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(not(any(unix, windows)))]
fn attach_process_handle(_child: &std::process::Child) -> Result<ProcessHandle> {
    Ok(ProcessHandle {})
}

#[cfg(not(any(unix, windows)))]
fn terminate_process_handle(_handle: &ProcessHandle, child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn glob_lists_matching_files_with_exclusions() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("src").join("a.ts"), "").unwrap();
        fs::write(dir.path().join("src").join("b.js"), "").unwrap();
        fs::write(dir.path().join("src").join("skip.ts"), "").unwrap();

        let response = run_glob_request(SearchRequest {
            args: vec![
                "--files".into(),
                "--glob".into(),
                "*.ts".into(),
                "--glob".into(),
                "!skip.ts".into(),
                "--sort=modified".into(),
                "--no-ignore".into(),
                "--hidden".into(),
            ],
            target: dir.path().to_path_buf(),
        })
        .unwrap();

        assert_eq!(response.lines, vec!["src/a.ts"]);
    }

    #[test]
    fn glob_later_include_overrides_earlier_exclude() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("keep.ts"), "").unwrap();
        fs::write(dir.path().join("skip.ts"), "").unwrap();

        let response = run_glob_request(SearchRequest {
            args: vec![
                "--files".into(),
                "--glob".into(),
                "!*.ts".into(),
                "--glob".into(),
                "keep.ts".into(),
                "--sort=modified".into(),
                "--no-ignore".into(),
                "--hidden".into(),
            ],
            target: dir.path().to_path_buf(),
        })
        .unwrap();

        assert_eq!(response.lines, vec!["keep.ts"]);
    }

    #[test]
    fn glob_respects_hidden_and_gitignore_flags() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".hidden.ts"), "").unwrap();
        fs::write(dir.path().join("visible.ts"), "").unwrap();
        fs::write(dir.path().join("ignored.ts"), "").unwrap();
        fs::write(dir.path().join(".gitignore"), "ignored.ts\n").unwrap();

        let visible_only = run_glob_request(SearchRequest {
            args: vec![
                "--files".into(),
                "--glob".into(),
                "*.ts".into(),
                "--sort=modified".into(),
            ],
            target: dir.path().to_path_buf(),
        })
        .unwrap();
        assert_eq!(visible_only.lines, vec!["visible.ts"]);

        let all_files = run_glob_request(SearchRequest {
            args: vec![
                "--files".into(),
                "--glob".into(),
                "*.ts".into(),
                "--sort=modified".into(),
                "--hidden".into(),
                "--no-ignore".into(),
            ],
            target: dir.path().to_path_buf(),
        })
        .unwrap();
        assert_eq!(
            sorted(all_files.lines),
            vec![".hidden.ts", "ignored.ts", "visible.ts"]
        );
    }

    #[test]
    fn glob_does_not_apply_parent_gitignore_outside_git_repo() {
        let parent = tempdir().unwrap();
        fs::write(parent.path().join(".gitignore"), "ignored.ts\n").unwrap();
        let child = parent.path().join("child");
        fs::create_dir(&child).unwrap();
        fs::write(child.join("ignored.ts"), "").unwrap();
        fs::write(child.join("visible.ts"), "").unwrap();

        let response = run_glob_request(SearchRequest {
            args: vec![
                "--files".into(),
                "--glob".into(),
                "*.ts".into(),
                "--sort=modified".into(),
                "--hidden".into(),
            ],
            target: child,
        })
        .unwrap();

        assert_eq!(response.lines, vec!["ignored.ts", "visible.ts"]);
    }

    #[test]
    fn grep_supports_content_files_and_count_modes() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.txt"), "alpha\nbeta\nalpha\n").unwrap();
        fs::write(dir.path().join("b.txt"), "beta\n").unwrap();

        let content = run_grep_request(SearchRequest {
            args: vec![
                "--hidden".into(),
                "--max-columns".into(),
                "500".into(),
                "-n".into(),
                "alpha".into(),
            ],
            target: dir.path().to_path_buf(),
        })
        .unwrap();
        let a_path = display_path(&dir.path().join("a.txt"));
        assert_eq!(
            content.lines,
            vec![format!("{a_path}:1:alpha"), format!("{a_path}:3:alpha")]
        );

        let files = run_grep_request(SearchRequest {
            args: vec![
                "--hidden".into(),
                "--max-columns".into(),
                "500".into(),
                "-l".into(),
                "alpha".into(),
            ],
            target: dir.path().to_path_buf(),
        })
        .unwrap();
        assert_eq!(files.lines, vec![a_path.clone()]);

        let count = run_grep_request(SearchRequest {
            args: vec![
                "--hidden".into(),
                "--max-columns".into(),
                "500".into(),
                "-c".into(),
                "alpha".into(),
            ],
            target: dir.path().to_path_buf(),
        })
        .unwrap();
        assert_eq!(count.lines, vec![format!("{a_path}:2")]);
    }

    #[test]
    fn grep_content_omits_matching_lines_beyond_max_columns() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("a.txt"),
            format!("{}needle\nshort needle\n", "x".repeat(12)),
        )
        .unwrap();
        let a_path = display_path(&dir.path().join("a.txt"));

        let content = run_grep_request(SearchRequest {
            args: vec![
                "--hidden".into(),
                "--max-columns".into(),
                "15".into(),
                "-n".into(),
                "needle".into(),
            ],
            target: dir.path().to_path_buf(),
        })
        .unwrap();

        assert_eq!(content.lines, vec![format!("{a_path}:2:short needle")]);
    }

    #[test]
    fn grep_supports_context_type_and_multiline() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.ts"), "alpha\nbeta\ngamma\n").unwrap();
        fs::write(dir.path().join("b.js"), "alpha\nbeta\ngamma\n").unwrap();
        let a_path = display_path(&dir.path().join("a.ts"));

        let context = run_grep_request(SearchRequest {
            args: vec![
                "--hidden".into(),
                "--max-columns".into(),
                "500".into(),
                "-n".into(),
                "-C".into(),
                "1".into(),
                "--type".into(),
                "ts".into(),
                "beta".into(),
            ],
            target: dir.path().to_path_buf(),
        })
        .unwrap();
        assert_eq!(
            context.lines,
            vec![
                format!("{a_path}-1-alpha"),
                format!("{a_path}:2:beta"),
                format!("{a_path}-3-gamma"),
            ]
        );

        let multiline = run_grep_request(SearchRequest {
            args: vec![
                "--hidden".into(),
                "--max-columns".into(),
                "500".into(),
                "-n".into(),
                "-U".into(),
                "--multiline-dotall".into(),
                "alpha\nbeta".into(),
            ],
            target: dir.path().to_path_buf(),
        })
        .unwrap();
        assert!(multiline.lines.contains(&format!("{a_path}:1:alpha")));
        assert!(multiline.lines.contains(&format!("{a_path}:2:beta")));
    }

    #[test]
    fn diff_returns_structured_hunks() {
        let response = run_diff_request(DiffRequest {
            old_content: "one\ntwo\nthree\n".into(),
            new_content: "one\nTWO\nthree\n".into(),
            context_lines: 3,
        })
        .unwrap();

        assert_eq!(response.hunks.len(), 1);
        assert_eq!(response.hunks[0].old_start, 1);
        assert_eq!(response.hunks[0].new_start, 1);
        assert_eq!(
            response.hunks[0].lines,
            vec![" one", "-two", "+TWO", " three"]
        );
    }

    #[test]
    fn diff_preserves_special_characters() {
        let response = run_diff_request(DiffRequest {
            old_content: "cost & value\n".into(),
            new_content: "cost $ value\n".into(),
            context_lines: 3,
        })
        .unwrap();

        assert_eq!(
            response.hunks[0].lines,
            vec!["-cost & value", "+cost $ value"]
        );
    }

    #[test]
    fn diff_empty_side_hunks_start_at_one() {
        let added = run_diff_request(DiffRequest {
            old_content: String::new(),
            new_content: "one\n".into(),
            context_lines: 3,
        })
        .unwrap();
        assert_eq!(added.hunks[0].old_start, 1);
        assert_eq!(added.hunks[0].new_start, 1);

        let removed = run_diff_request(DiffRequest {
            old_content: "one\n".into(),
            new_content: String::new(),
            context_lines: 3,
        })
        .unwrap();
        assert_eq!(removed.hunks[0].old_start, 1);
        assert_eq!(removed.hunks[0].new_start, 1);
    }

    fn sorted(mut lines: Vec<String>) -> Vec<String> {
        lines.sort();
        lines
    }
}
