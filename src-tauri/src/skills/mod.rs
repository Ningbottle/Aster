pub mod skill_flow;
pub use skill_flow::*;

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
