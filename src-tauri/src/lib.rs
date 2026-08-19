pub mod dsh;
pub mod hosts;
pub mod ipc;
pub mod pi;
pub mod platform;
pub mod skills;

pub use hosts::profile as host_profile;
pub use ipc::diag;
pub use ipc::github::{DeviceCodeResponse, DevicePollResult, GithubAuthStatus};
pub use ipc::pi as pi_commands;
pub use ipc::project::RecentProjectDto;
pub use ipc::skills::SkillItemDto;
pub use platform::app_data;
pub use platform::credentials;
pub use platform::db;
pub use platform::evidence;
pub use platform::logging;
pub use platform::supervisor;
pub use pi::connector as pi_connector;
pub use pi::runtime as pi_runtime;
pub use pi::sessions as pi_sessions;
pub use dsh::connector as dsh_connector;

pub fn run() {
    ipc::boot::run()
}
