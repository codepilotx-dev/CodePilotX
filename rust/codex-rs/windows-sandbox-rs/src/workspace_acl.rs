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
    apply_acl_rules(existing_workspace_config_dirs([cwd]).iter(), |path| {
        add_deny_write_ace(path, psid)
    })
}

pub(crate) fn apply_acl_rules<P: AsRef<Path>>(
    paths: impl IntoIterator<Item = P>,
    mut apply: impl FnMut(&Path) -> Result<bool>,
) -> Result<bool> {
    let mut changed = false;
    for path in paths {
        changed |= apply(path.as_ref())?;
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
    use super::apply_acl_rules;
    use super::existing_workspace_config_dirs;
    use pretty_assertions::assert_eq;
    use std::fs;
    use std::path::PathBuf;
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

    #[test]
    fn apply_acl_rules_returns_the_first_error() {
        let first = PathBuf::from("first");
        let second = PathBuf::from("second");
        let mut attempted = Vec::new();

        let error = apply_acl_rules([first.as_path(), second.as_path()], |path| {
            attempted.push(path.to_path_buf());
            Err(anyhow::anyhow!("acl denied"))
        })
        .expect_err("first ACL failure must be returned");

        assert_eq!(error.to_string(), "acl denied");
        assert_eq!(attempted, vec![first]);
    }
}
