use crate::acl::add_deny_write_ace;
use crate::path_normalization::canonicalize_path;
use anyhow::Result;
use std::ffi::c_void;
use std::path::Path;
use std::path::PathBuf;

pub fn is_command_cwd_root(root: &Path, canonical_command_cwd: &Path) -> bool {
    canonicalize_path(root) == canonical_command_cwd
}

/// # Safety
/// Caller must ensure `psid` is a valid SID pointer.
pub unsafe fn protect_workspace_config_dirs(cwd: &Path, psid: *mut c_void) -> Result<bool> {
    let mut changed = false;
    for path in existing_workspace_config_dirs([cwd]) {
        changed |= add_deny_write_ace(&path, psid)?;
    }
    Ok(changed)
}

/// # Safety
/// Caller must ensure `psid` is a valid SID pointer.
pub unsafe fn protect_workspace_agents_dir(cwd: &Path, psid: *mut c_void) -> Result<bool> {
    protect_workspace_subdir(cwd, psid, ".agents")
}

unsafe fn protect_workspace_subdir(cwd: &Path, psid: *mut c_void, subdir: &str) -> Result<bool> {
    let path = cwd.join(subdir);
    if path.is_dir() {
        add_deny_write_ace(&path, psid)
    } else {
        Ok(false)
    }
}

pub fn existing_workspace_config_dirs<'a>(
    roots: impl IntoIterator<Item = &'a Path>,
) -> Vec<PathBuf> {
    roots
        .into_iter()
        .flat_map(|root| [root.join(".codepilotx"), root.join(".codex")])
        .filter(|path| path.is_dir())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::existing_workspace_config_dirs;
    use pretty_assertions::assert_eq;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn existing_workspace_config_dirs_include_codepilotx_and_codex() {
        let temp = TempDir::new().expect("tempdir");
        let canonical = temp.path().join(".codepilotx");
        let legacy = temp.path().join(".codex");
        fs::create_dir(&canonical).expect("create .codepilotx");
        fs::create_dir(&legacy).expect("create .codex");

        assert_eq!(
            existing_workspace_config_dirs([temp.path()]),
            vec![canonical, legacy]
        );
    }
}
