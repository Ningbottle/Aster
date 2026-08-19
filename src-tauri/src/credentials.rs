//! Windows Credential Manager (WCM) 凭据管理。
//!
//! Aster 凭据边界：
//! - GitHub 私有来源的令牌只进入 Windows Credential Manager；
//! - 绝不把密钥/Token 复制进 SQLite、日志、导出包或诊断包；
//! - 服务名固定为 `aster.github`，用户名为 `default`。

use keyring::Entry;

pub const GITHUB_SERVICE_NAME: &str = "aster.github";
pub const GITHUB_USER_NAME: &str = "default";

/// 从 Windows 凭据管理器中安全读取 GitHub Token。
pub fn get_github_token() -> Option<String> {
    let entry = Entry::new(GITHUB_SERVICE_NAME, GITHUB_USER_NAME).ok()?;
    entry.get_password().ok()
}

/// 将 GitHub Token 安全存入 Windows 凭据管理器。
pub fn set_github_token(token: &str) -> Result<(), String> {
    let entry = Entry::new(GITHUB_SERVICE_NAME, GITHUB_USER_NAME)
        .map_err(|e| format!("failed to access Windows Credential Manager: {e}"))?;
    entry
        .set_password(token)
        .map_err(|e| format!("failed to save credential to Windows Credential Manager: {e}"))
}

/// 从 Windows 凭据管理器中安全删除 GitHub Token。
pub fn delete_github_token() -> Result<(), String> {
    let entry = match Entry::new(GITHUB_SERVICE_NAME, GITHUB_USER_NAME) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!(
            "failed to delete credential from Windows Credential Manager: {e}"
        )),
    }
}

/// 检查是否存在有效的 GitHub Token（不返回 Token 明文）。
pub fn has_github_token() -> bool {
    get_github_token()
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_service_and_user_constants() {
        assert_eq!(GITHUB_SERVICE_NAME, "aster.github");
        assert_eq!(GITHUB_USER_NAME, "default");
    }
}
