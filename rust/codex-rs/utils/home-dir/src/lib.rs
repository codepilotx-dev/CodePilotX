use codepilotx_utils_absolute_path::AbsolutePathBuf;
use dirs::home_dir;
use std::path::Path;
use std::path::PathBuf;

/// Returns the path to the CodePilotX configuration directory, using the
/// following resolution order:
///
/// 1. `CODEPILOTX_CONFIG_DIR` environment variable (must exist and be a directory)
/// 2. `CODEPILOTX_HOME` environment variable (must exist and be a directory)
/// 3. `CODEX_HOME` environment variable (legacy, must exist and be a directory)
/// 4. Existing `~/.codepilotx` directory
/// 5. Existing `~/.codex` directory (legacy)
/// 6. `~/.codepilotx`
///
/// For env-var paths, the value will be canonicalized and this function will Err
/// if the path does not exist or is not a directory.
pub fn find_codepilotx_home() -> std::io::Result<AbsolutePathBuf> {
    let home = home_dir().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Could not find home directory",
        )
    })?;
    find_codepilotx_home_with(&home, |name| {
        std::env::var(name).ok().filter(|value| !value.is_empty())
    })
}

fn find_codepilotx_home_with(
    home: &Path,
    mut get_env: impl FnMut(&str) -> Option<String>,
) -> std::io::Result<AbsolutePathBuf> {
    for name in ["CODEPILOTX_CONFIG_DIR", "CODEPILOTX_HOME", "CODEX_HOME"] {
        if let Some(value) = get_env(name).filter(|value| !value.is_empty()) {
            return resolve_home_env_var(&value, name);
        }
    }

    let codepilotx_dir = home.join(".codepilotx");
    if codepilotx_dir.is_dir() {
        let canonical = codepilotx_dir.canonicalize()?;
        return AbsolutePathBuf::from_absolute_path(canonical);
    }

    let codex_dir = home.join(".codex");
    if codex_dir.is_dir() {
        let canonical = codex_dir.canonicalize()?;
        return AbsolutePathBuf::from_absolute_path(canonical);
    }

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
    use super::find_codepilotx_home_with;
    use super::resolve_home_env_var;
    use codepilotx_utils_absolute_path::AbsolutePathBuf;
    use pretty_assertions::assert_eq;
    use std::collections::HashMap;
    use std::fs;
    use std::io::ErrorKind;
    use tempfile::TempDir;

    #[test]
    fn home_resolution_follows_documented_priority() {
        let temp_home = TempDir::new().expect("temp home");
        let config_dir = temp_home.path().join("config-dir");
        let codepilotx_home = temp_home.path().join("codepilotx-home");
        let codex_home = temp_home.path().join("codex-home");
        let dot_codepilotx = temp_home.path().join(".codepilotx");
        let dot_codex = temp_home.path().join(".codex");
        for path in [
            &config_dir,
            &codepilotx_home,
            &codex_home,
            &dot_codepilotx,
            &dot_codex,
        ] {
            fs::create_dir(path).expect("create candidate home");
        }

        let candidates = [
            ("CODEPILOTX_CONFIG_DIR", &config_dir),
            ("CODEPILOTX_HOME", &codepilotx_home),
            ("CODEX_HOME", &codex_home),
        ];
        for first_enabled in 0..=candidates.len() {
            let env = candidates[first_enabled..]
                .iter()
                .map(|(name, path)| ((*name).to_string(), path.display().to_string()))
                .collect::<HashMap<_, _>>();
            let resolved =
                find_codepilotx_home_with(temp_home.path(), |name| env.get(name).cloned())
                    .expect("resolve home");
            let expected_path = match first_enabled {
                0..=2 => candidates[first_enabled]
                    .1
                    .canonicalize()
                    .expect("canonical env home"),
                _ => dot_codepilotx
                    .canonicalize()
                    .expect("canonical .codepilotx"),
            };
            let expected =
                AbsolutePathBuf::from_absolute_path(expected_path).expect("absolute expected home");
            assert_eq!(resolved, expected);
        }

        fs::remove_dir(&dot_codepilotx).expect("remove .codepilotx");
        let resolved = find_codepilotx_home_with(temp_home.path(), |_| None).expect("legacy home");
        let expected = AbsolutePathBuf::from_absolute_path(
            dot_codex.canonicalize().expect("canonical .codex"),
        )
        .expect("absolute legacy home");
        assert_eq!(resolved, expected);

        fs::remove_dir(&dot_codex).expect("remove .codex");
        let resolved = find_codepilotx_home_with(temp_home.path(), |_| None).expect("default home");
        let expected = AbsolutePathBuf::from_absolute_path(temp_home.path().join(".codepilotx"))
            .expect("absolute default home");
        assert_eq!(resolved, expected);
    }

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
        let file_str = file_path.to_str().expect("file path should be valid utf-8");

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
}
