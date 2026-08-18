//! Aster 应用数据目录布局（content.md §11）。
//!
//! 默认根目录是 `%LOCALAPPDATA%\Aster`。`ASTER_APP_DATA_DIR` 环境变量只在
//! 开发与测试中用于重定向根目录，避免测试写入真实用户目录。

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const ROOT_ENV_VAR: &str = "ASTER_APP_DATA_DIR";

/// 数据根目录下的概念分区。命名在此固定（content.md 指明 M0 决定）。
#[derive(Debug, Clone)]
pub struct AppDataLayout {
    pub root: PathBuf,
    pub database: PathBuf,
    pub runtimes: PathBuf,
    pub skills: PathBuf,
    pub translations: PathBuf,
    pub sessions: PathBuf,
    pub logs: PathBuf,
    pub exports: PathBuf,
    pub quarantine: PathBuf,
    pub staging: PathBuf,
}

impl AppDataLayout {
    /// 解析默认根目录：环境变量覆盖优先，否则 `%LOCALAPPDATA%\Aster`。
    pub fn default_root() -> io::Result<PathBuf> {
        if let Some(overridden) = std::env::var_os(ROOT_ENV_VAR) {
            if !overridden.is_empty() {
                return Ok(PathBuf::from(overridden));
            }
        }
        let local = dirs::data_local_dir()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "cannot resolve %LOCALAPPDATA%"))?;
        Ok(local.join("Aster"))
    }

    /// 在指定根目录创建布局（幂等）。
    pub fn open(root: impl AsRef<Path>) -> io::Result<Self> {
        let root = root.as_ref().to_path_buf();
        // 拒绝把根目录设到已存在但不是目录的路径上，避免误用文件路径。
        if root.exists() && !root.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("app data root is not a directory: {}", root.display()),
            ));
        }
        let layout = Self::paths(&root);
        for dir in [
            &layout.root,
            &layout.database,
            &layout.runtimes,
            &layout.skills,
            &layout.translations,
            &layout.sessions,
            &layout.logs,
            &layout.exports,
            &layout.quarantine,
            &layout.staging,
        ] {
            fs::create_dir_all(dir)?;
        }
        Ok(layout)
    }

    /// 打开默认根目录下的布局。
    pub fn open_default() -> io::Result<Self> {
        Self::open(Self::default_root()?)
    }

    fn paths(root: &Path) -> Self {
        let dir = |name: &str| root.join(name);
        Self {
            root: root.to_path_buf(),
            database: dir("database"),
            runtimes: dir("runtimes"),
            skills: dir("skills"),
            translations: dir("translations"),
            sessions: dir("sessions"),
            logs: dir("logs"),
            exports: dir("exports"),
            quarantine: dir("quarantine"),
            staging: dir("staging"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_creates_all_partitions_idempotently() {
        let tmp = tempfile::tempdir().unwrap();
        let layout = AppDataLayout::open(tmp.path()).unwrap();
        assert!(layout.database.is_dir());
        assert!(layout.quarantine.is_dir());
        assert!(layout.staging.is_dir());
        // 幂等
        AppDataLayout::open(tmp.path()).unwrap();
    }

    #[test]
    fn open_rejects_file_as_root() {
        let tmp = tempfile::tempdir().unwrap();
        let file_path = tmp.path().join("not-a-dir");
        fs::write(&file_path, b"x").unwrap();
        let err = AppDataLayout::open(&file_path).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }
}
