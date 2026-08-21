#![allow(clippy::unused_async)]

use crate::platform::credentials;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevicePollResult {
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubAuthStatus {
    pub has_token: bool,
    pub source: String,
}
#[tauri::command]
pub async fn github_device_start(client_id: Option<String>) -> Result<DeviceCodeResponse, String> {
    let cid = client_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Ov23liAsterDesktop".to_string());

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(15))
        .build();

    let body = serde_json::json!({
        "client_id": cid,
        "scope": "repo,read:user"
    })
    .to_string();

    let resp = agent
        .post("https://github.com/login/device/code")
        .set("Accept", "application/json")
        .set("Content-Type", "application/json")
        .set("User-Agent", "Aster-Desktop")
        .send_string(&body)
        .map_err(|e| format!("request device code failed: {e}"))?;

    let text = resp
        .into_string()
        .map_err(|e| format!("read response: {e}"))?;
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("parse response: {e}"))?;
    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        let desc = json
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or(err);
        return Err(format!("GitHub device code error: {desc}"));
    }

    Ok(DeviceCodeResponse {
        device_code: json
            .get("device_code")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        user_code: json
            .get("user_code")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        verification_uri: json
            .get("verification_uri")
            .and_then(|v| v.as_str())
            .unwrap_or("https://github.com/login/device")
            .to_string(),
        expires_in: json
            .get("expires_in")
            .and_then(|v| v.as_u64())
            .unwrap_or(900),
        interval: json.get("interval").and_then(|v| v.as_u64()).unwrap_or(5),
    })
}

#[tauri::command]
pub async fn github_device_poll(client_id: String, device_code: String) -> Result<DevicePollResult, String> {
    let cid = if client_id.trim().is_empty() {
        "Ov23liAsterDesktop".to_string()
    } else {
        client_id.trim().to_string()
    };

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(15))
        .build();

    let body = serde_json::json!({
        "client_id": cid,
        "device_code": device_code,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
    })
    .to_string();

    let resp = agent
        .post("https://github.com/login/oauth/access_token")
        .set("Accept", "application/json")
        .set("Content-Type", "application/json")
        .set("User-Agent", "Aster-Desktop")
        .send_string(&body)
        .map_err(|e| format!("poll token failed: {e}"))?;

    let text = resp
        .into_string()
        .map_err(|e| format!("read response: {e}"))?;
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("parse response: {e}"))?;
    if let Some(token) = json.get("access_token").and_then(|v| v.as_str()) {
        credentials::set_github_token(token)?;
        return Ok(DevicePollResult {
            status: "success".into(),
            error: None,
        });
    }

    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        match err {
            "authorization_pending" => Ok(DevicePollResult {
                status: "pending".into(),
                error: None,
            }),
            "slow_down" => Ok(DevicePollResult {
                status: "slow_down".into(),
                error: None,
            }),
            "expired_token" => Ok(DevicePollResult {
                status: "expired".into(),
                error: Some("授权已超时，请重新发起".into()),
            }),
            "access_denied" => Ok(DevicePollResult {
                status: "denied".into(),
                error: Some("用户拒绝了授权请求".into()),
            }),
            other => Ok(DevicePollResult {
                status: "error".into(),
                error: Some(format!("GitHub 返回错误: {other}")),
            }),
        }
    } else {
        Ok(DevicePollResult {
            status: "unknown".into(),
            error: Some("未识别的 GitHub 响应格式".into()),
        })
    }
}

#[tauri::command]
pub fn github_token_status() -> Result<GithubAuthStatus, String> {
    Ok(GithubAuthStatus {
        has_token: credentials::has_github_token(),
        source: "windows_credential_manager".into(),
    })
}

#[tauri::command]
pub fn github_set_pat(pat: String) -> Result<(), String> {
    let clean = pat.trim();
    if clean.is_empty() {
        return Err("Personal Access Token 不能为空".into());
    }
    credentials::set_github_token(clean)
}

#[tauri::command]
pub fn github_logout() -> Result<(), String> {
    credentials::delete_github_token()
}
