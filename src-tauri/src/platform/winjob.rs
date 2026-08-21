//! 宿主子进程的 Windows Job Object。
//!
//! 仅供 [`super::supervisor::spawn_logged`] 附着。句柄不可继承：子进程
//! 不得再持有 job handle，否则 `KILL_ON_JOB_CLOSE` 在 Aster 退出后不会触发。
//! 不把 Aster 自身放进该 job，以免关闭句柄时杀掉 UI 进程。
//!
//! 入 job 不用 `PROC_THREAD_ATTRIBUTE_JOB_LIST`：标准库的
//! `Command::spawn_with_attributes` / `raw_attribute` 在 stable 上仍是
//! unstable（#114854）。改为 CreateProcess `CREATE_SUSPENDED`（stable
//! `CommandExt::creation_flags`）→ `AssignProcessToJobObject` →
//! `NtResumeProcess`，避免子进程在入 job 前派生孙子。

use std::io;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};
use std::os::windows::process::CommandExt;
use std::process::{Child, Command};
use std::sync::OnceLock;

use serde_json::json;
use windows::core::BOOL;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
};

const CREATE_SUSPENDED: u32 = 0x0000_0004;

pub(crate) struct Job {
    handle: OwnedHandle,
}

impl Job {
    pub(crate) fn create_kill_on_close() -> io::Result<Self> {
        // lpJobAttributes = NULL → 句柄不可继承。
        let raw = unsafe { CreateJobObjectW(None, windows::core::PCWSTR::null()) }
            .map_err(win_err)?;
        if raw.is_invalid() {
            return Err(io::Error::last_os_error());
        }
        let job = Self {
            handle: unsafe { OwnedHandle::from_raw_handle(raw.0 as RawHandle) },
        };
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        unsafe {
            SetInformationJobObject(
                job.as_win32(),
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const std::ffi::c_void,
                std::mem::size_of_val(&info) as u32,
            )
        }
        .map_err(win_err)?;
        Ok(job)
    }

    fn as_win32(&self) -> HANDLE {
        HANDLE(self.handle.as_raw_handle() as _)
    }

    pub(crate) fn contains_process(&self, process: RawHandle) -> io::Result<bool> {
        let mut inside = BOOL::default();
        unsafe {
            IsProcessInJob(
                HANDLE(process as _),
                Some(self.as_win32()),
                &mut inside,
            )
        }
        .map_err(win_err)?;
        Ok(inside.as_bool())
    }

    pub(crate) fn assign_process(&self, process: RawHandle) -> io::Result<()> {
        unsafe { AssignProcessToJobObject(self.as_win32(), HANDLE(process as _)) }.map_err(win_err)
    }
}

fn win_err(err: windows::core::Error) -> io::Error {
    io::Error::other(err.to_string())
}

/// 标准库不在 stable 上暴露主线程句柄；ntdll 按进程恢复，避免悬挂的 CREATE_SUSPENDED 子进程。
fn resume_process(process: RawHandle) -> io::Result<()> {
    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn NtResumeProcess(processhandle: RawHandle) -> i32;
    }
    let status = unsafe { NtResumeProcess(process) };
    if status < 0 {
        Err(io::Error::other(format!("NtResumeProcess NTSTATUS={status:#x}")))
    } else {
        Ok(())
    }
}

fn kill_pid(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

static HOST_JOB: OnceLock<Option<Job>> = OnceLock::new();

pub(crate) fn host_job() -> Option<&'static Job> {
    HOST_JOB
        .get_or_init(|| match Job::create_kill_on_close() {
            Ok(job) => Some(job),
            Err(e) => {
                crate::diag::record(
                    "job",
                    json!({ "ok": false, "stage": "create", "err": e.to_string() }),
                );
                None
            }
        })
        .as_ref()
}

/// 尽量把 `cmd` 放入进程级 job 再跑起来。创建或入 job 失败时仍 spawn（fail-open）。
pub(crate) fn spawn_in_host_job(cmd: &mut Command, host: &str) -> io::Result<Child> {
    let job = host_job();
    if job.is_some() {
        cmd.creation_flags(CREATE_SUSPENDED);
    }
    let child = cmd.spawn()?;
    let pid = child.id();
    let Some(job) = job else {
        crate::diag::record(
            "job",
            json!({ "ok": false, "stage": "no_job", "host": host, "pid": pid }),
        );
        return Ok(child);
    };
    let handle = child.as_raw_handle();
    let assigned = job.assign_process(handle);
    if let Err(e) = resume_process(handle) {
        kill_pid(pid);
        crate::diag::record(
            "job",
            json!({
                "ok": false,
                "stage": "resume",
                "host": host,
                "pid": pid,
                "err": e.to_string(),
            }),
        );
        return Err(e);
    }
    match assigned {
        Ok(()) => {
            let in_job = job.contains_process(handle).unwrap_or(false);
            crate::diag::record(
                "job",
                json!({ "ok": in_job, "host": host, "pid": pid, "in_job": in_job }),
            );
        }
        Err(e) => {
            crate::diag::record(
                "job",
                json!({
                    "ok": false,
                    "stage": "assign",
                    "host": host,
                    "pid": pid,
                    "err": e.to_string(),
                }),
            );
        }
    }
    Ok(child)
}

#[cfg(test)]
pub(crate) fn host_job_contains(child: &Child) -> io::Result<bool> {
    let Some(job) = host_job() else {
        return Ok(false);
    };
    job.contains_process(child.as_raw_handle())
}

#[cfg(test)]
pub(crate) fn spawn_in_job(cmd: &mut Command, job: &Job) -> io::Result<Child> {
    cmd.creation_flags(CREATE_SUSPENDED);
    let child = cmd.spawn()?;
    let handle = child.as_raw_handle();
    let pid = child.id();
    let assigned = job.assign_process(handle);
    if let Err(e) = resume_process(handle) {
        kill_pid(pid);
        return Err(e);
    }
    assigned?;
    Ok(child)
}
