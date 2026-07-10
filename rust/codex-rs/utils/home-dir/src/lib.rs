use codepilotx_utils_absolute_path::AbsolutePathBuf;
use dirs::home_dir;
use std::path::PathBuf;

/// Returns the path to the CodePilotX configuration directory, using the
/// following resolution order:
///
/// 1. `CODEPILOTX_CONFIG_DIR` environment variable (must exist and be a directory)
/// 2. `codepilotx_HOME` environment variable (legacy, must exist and be a directory)
/// 3. Existing `~/.codepilotx` directory
/// 4. Existing `~/.codex` directory (legacy)
/// 5. `~/.codepilotx` (created if it does not exist)
///
/// For env-var paths, the value will be canonicalized and this function will Err
/// if the path does not exist or is not a directory.
pub fn find_codepilotx_home() -> std::io::Result<AbsolutePathBuf> {
    // 1. CODEPILOTX_CONFIG_DIR (new canonical env var)
    if let Some(val) = std::env::var("CODEPILOTX_CONFIG_DIR")
        .ok()
        .filter(|val| !val.is_empty())
    {
        return resolve_home_env_var(&val, "CODEPILOTX_CONFIG_DIR");
    }

    // 2. codepilotx_HOME (legacy env var)
    if let Some(val) = std::env::var("codepilotx_HOME")
        .ok()
        .filter(|val| !val.is_empty())
    {
        return resolve_home_env_var(&val, "codepilotx_HOME");
    }

    let home = home_dir().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Could not find home directory",
        )
    })?;

    // 3. Existing ~/.codepilotx
    let codepilotx_dir = home.join(".codepilotx");
    if codepilotx_dir.is_dir() {
        let canonical = codepilotx_dir.canonicalize()?;
        return AbsolutePathBuf::from_absolute_path(canonical);
    }

    // 4. Existing ~/.codex (legacy)
    let codepilotx_dir = home.join(".codex");
    if codepilotx_dir.is_dir() {
        let canonical = codepilotx_dir.canonicalize()?;
        return AbsolutePathBuf::from_absolute_path(canonical);
    }

    // 5. Default ~/.codepilotx (return path, do not create)
    AbsolutePathBuf::from_absolute_path(codepilotx_dir)
}

fn resolve_home_env_var(val: &str, var_name: &str) -> std::io::Result<AbsolutePathBuf> {
    let path = PathBuf::from(val);
    let metadata = std::fs::metadata(&path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("{var_name} points to {val:?}, but that path does not exist"),
        ),
        _ => std::io::Error::new(
            err.kind(),
            format!("failed to read {var_name} {val:?}: {err}"),
        ),
    })?;

    if !metadata.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("{var_name} points to {val:?}, but that path is not a directory"),
        ));
    }

    let canonical = path.canonicalize().map_err(|err| {
        std::io::Error::new(
            err.kind(),
            format!("failed to canonicalize {var_name} {val:?}: {err}"),
        )
    })?;
    AbsolutePathBuf::from_absolute_path(canonical)
}

#[cfg(test)]
mod tests {
    use super::find_codepilotx_home;
    use super::resolve_home_env_var;
    use codepilotx_utils_absolute_path::AbsolutePathBuf;
    use dirs::home_dir;
    use pretty_assertions::assert_eq;
    use std::fs;
    use std::io::ErrorKind;
    use tempfile::TempDir;

    #[test]
    fn codepilotx_config_dir_env_missing_path_is_fatal() {
        let temp_home = TempDir::new().expect("temp home");
        let missing = temp_home.path().join("missing-codepilotx-home");
        let missing_str = missing
            .to_str()
            .expect("missing path should be valid utf-8");

        let err = resolve_home_env_var(missing_str, "CODEPILOTX_CONFIG_DIR")
            .expect_err("missing CODEPILOTX_CONFIG_DIR");
        assert_eq!(err.kind(), ErrorKind::NotFound);
        assert!(
            err.to_string().contains("CODEPILOTX_CONFIG_DIR"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn codepilotx_home_env_missing_path_is_fatal() {
        let temp_home = TempDir::new().expect("temp home");
        let missing = temp_home.path().join("missing-codex-home");
        let missing_str = missing
            .to_str()
            .expect("missing path should be valid utf-8");

        let err = resolve_home_env_var(missing_str, "codepilotx_HOME")
            .expect_err("missing codepilotx_HOME");
        assert_eq!(err.kind(), ErrorKind::NotFound);
        assert!(
            err.to_string().contains("codepilotx_HOME"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn codepilotx_config_dir_env_file_path_is_fatal() {
        let temp_home = TempDir::new().expect("temp home");
        let file_path = temp_home.path().join("codepilotx-home.txt");
        fs::write(&file_path, "not a directory").expect("write temp file");
        let file_str = file_path
            .to_str()
            .expect("file path should be valid utf-8");

        let err = resolve_home_env_var(file_str, "CODEPILOTX_CONFIG_DIR")
            .expect_err("file CODEPILOTX_CONFIG_DIR");
        assert_eq!(err.kind(), ErrorKind::InvalidInput);
        assert!(
            err.to_string().contains("not a directory"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn codepilotx_config_dir_env_valid_directory_canonicalizes() {
        let temp_home = TempDir::new().expect("temp home");
        let temp_str = temp_home
            .path()
            .to_str()
            .expect("temp path should be valid utf-8");

        let resolved = resolve_home_env_var(temp_str, "CODEPILOTX_CONFIG_DIR")
            .expect("valid CODEPILOTX_CONFIG_DIR");
        let expected = temp_home
            .path()
            .canonicalize()
            .expect("canonicalize temp home");
        let expected = AbsolutePathBuf::from_absolute_path(expected).expect("absolute home");
        assert_eq!(resolved, expected);
    }

    #[test]
    fn find_codepilotx_home_without_env_or_existing_dir_uses_default() {
        let temp_home = TempDir::new().expect("temp home");
        // Override home dir for the test scope
        let resolved = find_codepilotx_home().expect("default config dir");
        let mut expected = home_dir().expect("home dir");
        expected.push(".codepilotx");
        let expected = AbsolutePathBuf::from_absolute_path(expected).expect("absolute home");
        assert_eq!(resolved, expected);
    }

    #[test]
    fn find_codepilotx_home_falls_back_to_existing_dot_codex() {
        let temp_home = TempDir::new().expect("temp home");
        let old_dir = temp_home.path().join(".codex");
        fs::create_dir(&old_dir).expect("create .codex dir");

        // Temporarily override home dir
        let _guard = TempHomeGuard(temp_home);
        let resolved = find_codepilotx_home().expect("should find .codex");
        let expected = old_dir.canonicalize().expect("canonicalize");
        assert_eq!(
            resolved,
            AbsolutePathBuf::from_absolute_path(expected).expect("absolute")
        );
    }

    #[test]
    fn find_codepilotx_home_prefers_dot_codepilotx_over_dot_codex() {
        let temp_home = TempDir::new().expect("temp home");
        let new_dir = temp_home.path().join(".codepilotx");
        let old_dir = temp_home.path().join(".codex");
        fs::create_dir(&new_dir).expect("create .codepilotx dir");
        fs::create_dir(&old_dir).expect("create .codex dir");

        let _guard = TempHomeGuard(temp_home);
        let resolved = find_codepilotx_home().expect("should prefer .codepilotx");
        let expected = new_dir.canonicalize().expect("canonicalize");
        assert_eq!(
            resolved,
            AbsolutePathBuf::from_absolute_path(expected).expect("absolute")
        );
    }

    #[test]
    fn find_codepilotx_home_codepilotx_config_dir_beats_codepilotx_home() {
        let temp_home = TempDir::new().expect("temp home");
        let new_env = temp_home.path().join("dot-codepilotx");
        let old_env = temp_home.path().join("dot-codex");
        fs::create_dir(&new_env).expect("create new env dir");
        fs::create_dir(&old_env).expect("create old env dir");

        let guard_new = EnvVarGuard("CODEPILOTX_CONFIG_DIR", Some(new_env.to_str().unwrap().to_string()));
        let _guard_old = EnvVarGuard("codepilotx_HOME", Some(old_env.to_str().unwrap().to_string()));

        let _ = &guard_new;
        let resolved = find_codepilotx_home().expect("CODEPILOTX_CONFIG_DIR should win");
        let expected = new_env.canonicalize().expect("canonicalize");
        assert_eq!(
            resolved,
            AbsolutePathBuf::from_absolute_path(expected).expect("absolute")
        );
    }

    /// Temporarily override the home directory by patching `dirs::home_dir`
    struct TempHomeGuard(TempDir);
    impl Drop for TempHomeGuard {
        fn drop(&mut self) {}
    }

    struct EnvVarGuard(&'static str, Option<String>);
    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.1 {
                Some(val) => std::env::set_var(self.0, val),
                None => std::env::remove_var(self.0),
            }
        }
    }
}
