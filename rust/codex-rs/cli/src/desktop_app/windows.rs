use anyhow::Context as _;
use std::path::Path;
use std::path::PathBuf;
use tokio::process::Command;

const codepilotx_WINDOWS_INSTALLER_URL: &str =
    "https://get.microsoft.com/installer/download/9PLM9XGG6VKS?cid=website_cta_psi";
const codepilotx_MICROSOFT_STORE_WEB_URL: &str = "https://apps.microsoft.com/detail/9plm9xgg6vks";

pub async fn run_windows_app_open_or_install(
    workspace: PathBuf,
    download_url_override: Option<String>,
) -> anyhow::Result<()> {
    let workspace_path = workspace.display().to_string();
    let display_workspace = display_workspace_path(&workspace);
    if codepilotx_app_is_installed().await? {
        eprintln!("Opening Codex Desktop workspace {display_workspace}...");
        open_url(&codepilotx_new_thread_url(&workspace_path)).await?;
        return Ok(());
    }

    eprintln!("CodePilotX Desktop not found; opening Windows installer...");
    let download_url = download_url_override
        .as_deref()
        .unwrap_or(codepilotx_WINDOWS_INSTALLER_URL);
    if open_url(download_url).await.is_err() && download_url_override.is_none() {
        open_url(codepilotx_MICROSOFT_STORE_WEB_URL).await?;
    }
    eprintln!("After installing Codex Desktop, open workspace {display_workspace}.");
    Ok(())
}

async fn codepilotx_app_is_installed() -> anyhow::Result<bool> {
    let output = Command::new("powershell.exe")
        .arg("-NoProfile")
        .arg("-Command")
        .arg("Get-StartApps -Name 'Codex' | Select-Object -First 1 -ExpandProperty AppID")
        .output()
        .await
        .context("failed to invoke `powershell.exe`")?;

    if !output.status.success() {
        return Ok(false);
    }

    Ok(!String::from_utf8_lossy(&output.stdout).trim().is_empty())
}

async fn open_url(url: &str) -> anyhow::Result<()> {
    let status = Command::new("powershell.exe")
        .arg("-NoProfile")
        .arg("-Command")
        .arg("& { param($target) Start-Process -FilePath $target }")
        .arg(url)
        .status()
        .await
        .with_context(|| format!("failed to open {url}"))?;

    if status.success() {
        Ok(())
    } else {
        anyhow::bail!("failed to open {url} with {status}");
    }
}

fn codepilotx_new_thread_url(workspace: &str) -> String {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    serializer.append_pair("path", workspace);
    let query = serializer.finish();
    format!("codex://threads/new?{query}")
}

fn display_workspace_path(workspace: &Path) -> String {
    let path = workspace.display().to_string();
    if let Some(path) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{path}")
    } else if let Some(path) = path.strip_prefix(r"\\?\") {
        path.to_string()
    } else {
        path
    }
}

#[cfg(test)]
mod tests {
    use super::codepilotx_new_thread_url;
    use super::display_workspace_path;
    use pretty_assertions::assert_eq;
    use std::path::Path;

    #[test]
    fn display_workspace_path_removes_windows_extended_prefix() {
        assert_eq!(
            display_workspace_path(Path::new(r"\\?\C:\Users\fcoury\code\codex")),
            r"C:\Users\fcoury\code\codex"
        );
    }

    #[test]
    fn display_workspace_path_preserves_unc_prefix() {
        assert_eq!(
            display_workspace_path(Path::new(r"\\?\UNC\server\share\codex")),
            r"\\server\share\codex"
        );
    }

    #[test]
    fn display_workspace_path_leaves_regular_paths_unchanged() {
        assert_eq!(
            display_workspace_path(Path::new(r"C:\Users\fcoury\code\codex")),
            r"C:\Users\fcoury\code\codex"
        );
    }

    #[test]
    fn codepilotx_new_thread_url_encodes_windows_workspace_path() {
        assert_eq!(
            codepilotx_new_thread_url(r"C:\Users\akuma\repos\koba"),
            r"codex://threads/new?path=C%3A%5CUsers%5Cakuma%5Crepos%5Ckoba"
        );
    }

    #[test]
    fn codepilotx_new_thread_url_preserves_verbatim_workspace_path() {
        assert_eq!(
            codepilotx_new_thread_url(r"\\?\C:\Users\akuma\repos\koba"),
            r"codex://threads/new?path=%5C%5C%3F%5CC%3A%5CUsers%5Cakuma%5Crepos%5Ckoba"
        );
    }
}
