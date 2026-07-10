use std::fmt;
use std::sync::Arc;

use anyhow::Result;
use codepilotx_exec_server::Environment;
use codepilotx_exec_server::ExecServerRuntimePaths;
use codepilotx_exec_server::ExecutorFileSystem;
use codepilotx_exec_server::FileSystemSandboxContext;
use codepilotx_exec_server::LocalFileSystem;
use codepilotx_protocol::models::PermissionProfile;
use codepilotx_protocol::permissions::FileSystemAccessMode;
use codepilotx_protocol::permissions::FileSystemPath;
use codepilotx_protocol::permissions::FileSystemSandboxEntry;
use codepilotx_protocol::permissions::FileSystemSandboxPolicy;
use codepilotx_protocol::permissions::NetworkSandboxPolicy;
use codepilotx_utils_absolute_path::AbsolutePathBuf;

use crate::common::exec_server::ExecServerHarness;
use crate::common::exec_server::TestCodexHelperPaths;
use crate::common::exec_server::exec_server;
use crate::common::exec_server::test_codepilotx_helper_paths;

pub(crate) struct FileSystemContext {
    pub(crate) file_system: Arc<dyn ExecutorFileSystem>,
    _helper_paths: Option<TestCodexHelperPaths>,
    _server: Option<ExecServerHarness>,
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum FileSystemImplementation {
    Local,
    Remote,
}

impl fmt::Display for FileSystemImplementation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Local => formatter.write_str("local"),
            Self::Remote => formatter.write_str("remote"),
        }
    }
}

pub(crate) async fn create_file_system_context(
    implementation: FileSystemImplementation,
) -> Result<FileSystemContext> {
    match implementation {
        FileSystemImplementation::Local => {
            let helper_paths = test_codepilotx_helper_paths()?;
            let runtime_paths = ExecServerRuntimePaths::new(
                helper_paths.codepilotx_exe.clone(),
                helper_paths.codepilotx_linux_sandbox_exe.clone(),
            )?;
            Ok(FileSystemContext {
                file_system: Arc::new(LocalFileSystem::with_runtime_paths(runtime_paths)),
                _helper_paths: Some(helper_paths),
                _server: None,
            })
        }
        FileSystemImplementation::Remote => {
            let server = exec_server().await?;
            let environment =
                Environment::create_for_tests(Some(server.websocket_url().to_string()))?;
            Ok(FileSystemContext {
                file_system: environment.get_filesystem(),
                _helper_paths: None,
                _server: Some(server),
            })
        }
    }
}

pub(crate) fn absolute_path(path: std::path::PathBuf) -> AbsolutePathBuf {
    assert!(
        path.is_absolute(),
        "path must be absolute: {}",
        path.display()
    );
    AbsolutePathBuf::try_from(path).expect("path should be absolute")
}

pub(crate) fn read_only_sandbox(readable_root: std::path::PathBuf) -> FileSystemSandboxContext {
    let readable_root = absolute_path(readable_root);
    sandbox_context(vec![FileSystemSandboxEntry {
        path: FileSystemPath::Path {
            path: readable_root,
        },
        access: FileSystemAccessMode::Read,
    }])
}

pub(crate) fn workspace_write_sandbox(
    writable_root: std::path::PathBuf,
) -> FileSystemSandboxContext {
    let writable_root = absolute_path(writable_root);
    sandbox_context(vec![FileSystemSandboxEntry {
        path: FileSystemPath::Path {
            path: writable_root,
        },
        access: FileSystemAccessMode::Write,
    }])
}

fn sandbox_context(entries: Vec<FileSystemSandboxEntry>) -> FileSystemSandboxContext {
    FileSystemSandboxContext::from_permission_profile(PermissionProfile::from_runtime_permissions(
        &FileSystemSandboxPolicy::restricted(entries),
        NetworkSandboxPolicy::Restricted,
    ))
}
