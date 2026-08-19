//! Skills: download, scan, snapshot, translation, deploy, quarantine.
//!
//! 核心安全约束：
//! - 绝不执行下载内容中的任何脚本或二进制；
//! - 默认复制文件，不默认建立 symlink/junction；
//! - 绝不覆盖未托管目录；托管目录被外部修改后停止写入；
//! - 原始快照不可变，中文说明是独立派生文件；
//! - 诊断全脱敏，绝不存储宿主凭据。

pub mod deploy;
pub mod ids;
pub mod quarantine;
pub mod scan;
pub mod snapshot;
pub mod source;
pub mod translation;

pub use deploy::*;
pub use ids::*;
pub use quarantine::*;
pub use scan::*;
pub use snapshot::*;
pub use source::*;
pub use translation::*;

use crate::hosts::profile as host_profile;
use crate::platform::app_data;
use std::path::PathBuf;

pub fn allowed_deployment_roots(layout: &app_data::AppDataLayout) -> Vec<PathBuf> {
    let mut roots = vec![layout.root.clone(), layout.runtimes.clone()];
    for host in host_profile::scan_all_hosts(None) {
        for scope in host.discovered_scopes {
            let path = PathBuf::from(scope.resolved_path);
            if let Some(parent) = path.parent() {
                roots.push(parent.to_path_buf());
            }
            roots.push(path);
        }
    }
    roots
}

#[cfg(test)]
mod tests;
