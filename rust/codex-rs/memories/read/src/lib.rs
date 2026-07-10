//! Read-path helpers for Codex memories.
//!
//! This crate owns memory injection, memory citation parsing, and telemetry
//! classification for read access to the memory folder. It intentionally does
//! not depend on the memory write pipeline.

pub mod citations;
mod metrics;
pub mod usage;

use codepilotx_utils_absolute_path::AbsolutePathBuf;

pub fn memory_root(codepilotx_home: &AbsolutePathBuf) -> AbsolutePathBuf {
    codepilotx_home.join("memories")
}
