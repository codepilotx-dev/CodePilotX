pub(crate) use codepilotx_skills::install_system_skills;
pub(crate) use codepilotx_skills::system_cache_root_dir;

use codepilotx_utils_absolute_path::AbsolutePathBuf;

pub(crate) fn uninstall_system_skills(codepilotx_home: &AbsolutePathBuf) {
    let _ = std::fs::remove_dir_all(system_cache_root_dir(codepilotx_home));
}
