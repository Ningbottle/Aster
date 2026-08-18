//! 11 个目标工具 HostProfile 与本地环境扫描器。
//!
//! 根据 content.md §8 与 AGENTS.md 约束：
//! - HostProfile 是版本化、只读、不可执行的数据；
//! - 包含 Windows 路径模板、作用域（user/project/custom）、发现形态（flat/bundle/recursive）与官方置信度（verified/experimental/scan-only）；
//! - 运行时行为由内置连接器或文件系统驱动，不从远程动态执行脚本。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConfidenceLevel {
    Verified,
    Experimental,
    ScanOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DiscoveryShape {
    Flat,
    Bundle,
    Recursive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScopeKind {
    User,
    Project,
    Custom,
}

impl ScopeKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ScopeKind::User => "user",
            ScopeKind::Project => "project",
            ScopeKind::Custom => "custom",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScopeCandidate {
    pub kind: ScopeKind,
    pub path_template: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostProfile {
    pub id: String,
    pub display_name: String,
    pub profile_version: String,
    pub confidence: ConfidenceLevel,
    pub discovery_shape: DiscoveryShape,
    pub supported_scopes: Vec<ScopeCandidate>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredScope {
    pub kind: ScopeKind,
    pub path_template: String,
    pub resolved_path: String,
    pub exists: bool,
    pub skills_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredHost {
    pub profile: HostProfile,
    pub installed: bool,
    pub discovered_scopes: Vec<DiscoveredScope>,
    pub status: String,
}

/// 返回内置的全部 11 个目标工具 HostProfile（只读静态事实表）。
pub fn all_profiles() -> Vec<HostProfile> {
    vec![
        HostProfile {
            id: "cursor".into(),
            display_name: "Cursor".into(),
            profile_version: "1.0.0".into(),
            confidence: ConfidenceLevel::ScanOnly,
            discovery_shape: DiscoveryShape::Flat,
            supported_scopes: vec![
                ScopeCandidate {
                    kind: ScopeKind::User,
                    path_template: "%USERPROFILE%\\.cursor\\skills".into(),
                    description: "用户级 Cursor Skills 目录".into(),
                },
                ScopeCandidate {
                    kind: ScopeKind::Project,
                    path_template: "<project>\\.cursor\\skills".into(),
                    description: "工作区级 Cursor Skills 目录".into(),
                },
            ],
            description: "Cursor AI 编辑器（支持 .cursor/skills 静态配置发现）".into(),
        },
        HostProfile {
            id: "pi".into(),
            display_name: "Pi".into(),
            profile_version: "1.0.0".into(),
            confidence: ConfidenceLevel::Verified,
            discovery_shape: DiscoveryShape::Bundle,
            supported_scopes: vec![
                ScopeCandidate {
                    kind: ScopeKind::User,
                    path_template: "%USERPROFILE%\\.pi\\skills".into(),
                    description: "用户级 Pi Skills 目录".into(),
                },
                ScopeCandidate {
                    kind: ScopeKind::Project,
                    path_template: "<project>\\.pi\\skills".into(),
                    description: "工作区级 Pi Skills 目录".into(),
                },
            ],
            description: "Pi RPC Coding Agent 宿主（严格 JSONL 协议连接与深度 Evidence）".into(),
        },
        HostProfile {
            id: "dsh".into(),
            display_name: "DeepSeek Harness".into(),
            profile_version: "1.0.0".into(),
            confidence: ConfidenceLevel::Verified,
            discovery_shape: DiscoveryShape::Bundle,
            supported_scopes: vec![
                ScopeCandidate {
                    kind: ScopeKind::User,
                    path_template: "%APPDATA%\\deepseek\\skills".into(),
                    description: "用户级 DSH 插件与 Skills 目录".into(),
                },
                ScopeCandidate {
                    kind: ScopeKind::Project,
                    path_template: "<project>\\.dsh\\skills".into(),
                    description: "工作区级 DSH Skills 目录".into(),
                },
            ],
            description: "DeepSeek Harness 原生 Web UI 与插件宿主".into(),
        },
        HostProfile {
            id: "zcode".into(),
            display_name: "Zcode".into(),
            profile_version: "1.0.0".into(),
            confidence: ConfidenceLevel::Experimental,
            discovery_shape: DiscoveryShape::Flat,
            supported_scopes: vec![
                ScopeCandidate {
                    kind: ScopeKind::User,
                    path_template: "%USERPROFILE%\\.zcode\\skills".into(),
                    description: "用户级 Zcode 规则与 Skills 目录".into(),
                },
                ScopeCandidate {
                    kind: ScopeKind::Project,
                    path_template: "<project>\\.zcode\\skills".into(),
                    description: "工作区级 Zcode Skills 目录".into(),
                },
            ],
            description: "Zcode AI 助手（实验性支持）".into(),
        },
        HostProfile {
            id: "grok-build".into(),
            display_name: "Grok Build".into(),
            profile_version: "1.0.0".into(),
            confidence: ConfidenceLevel::Experimental,
            discovery_shape: DiscoveryShape::Flat,
            supported_scopes: vec![
                ScopeCandidate {
                    kind: ScopeKind::User,
                    path_template: "%USERPROFILE%\\.grok\\skills".into(),
                    description: "用户级 Grok Build 指令集目录".into(),
                },
                ScopeCandidate {
                    kind: ScopeKind::Project,
                    path_template: "<project>\\.grok\\skills".into(),
                    description: "工作区级 Grok Build 目录".into(),
                },
            ],
            description: "xAI Grok Build 开发环境（实验性支持）".into(),
        },
        HostProfile {
            id: "qoder".into(),
            display_name: "Qoder".into(),
            profile_version: "1.0.0".into(),
            confidence: ConfidenceLevel::Experimental,
            discovery_shape: DiscoveryShape::Bundle,
            supported_scopes: vec![
                ScopeCandidate {
                    kind: ScopeKind::User,
                    path_template: "%USERPROFILE%\\.qoder\\skills".into(),
                    description: "用户级 Qoder Skills 目录".into(),
                },
                ScopeCandidate {
                    kind: ScopeKind::Project,
                    path_template: "<project>\\.qoder\\skills".into(),
                    description: "工作区级 Qoder Skills 目录".into(),
                },
            ],
            description: "Qoder 智能研发助手（实验性支持）".into(),
        },
        HostProfile {
            id: "codex".into(),
            display_name: "Codex".into(),
            profile_version: "1.0.0".into(),
            confidence: ConfidenceLevel::Experimental,
            discovery_shape: DiscoveryShape::Flat,
            supported_scopes: vec![
                ScopeCandidate {
                    kind: ScopeKind::User,
                    path_template: "%USERPROFILE%\\.codex\\skills".into(),
                    description: "用户级 OpenAI Codex 提示词与技能目录".into(),
                },
                ScopeCandidate {
                    kind: ScopeKind::Project,
                    path_template: "<project>\\.codex\\skills".into(),
                    description: "工作区级 Codex 技能目录".into(),
                },
            ],
            description: "Codex 命令行与集成工具（实验性支持）".into(),
        },
        HostProfile {
            id: "claude-code".into(),
            display_name: "Claude Code".into(),
            profile_version: "1.0.0".into(),
            confidence: ConfidenceLevel::ScanOnly,
            discovery_shape: DiscoveryShape::Bundle,
            supported_scopes: vec![
                ScopeCandidate {
                    kind: ScopeKind::User,
                    path_template: "%APPDATA%\\Claude\\skills".into(),
                    description: "用户级 Claude Code Skills 目录".into(),
                },
                ScopeCandidate {
                    kind: ScopeKind::Project,
                    path_template: "<project>\\.claude\\skills".into(),
                    description: "工作区级 Claude Code 目录".into(),
                },
            ],
            description: "Anthropic Claude Code 命令行助手（扫描与静态发现）".into(),
        },
        HostProfile {
            id: "zed".into(),
            display_name: "Zed".into(),
            profile_version: "1.0.0".into(),
            confidence: ConfidenceLevel::Experimental,
            discovery_shape: DiscoveryShape::Bundle,
            supported_scopes: vec![
                ScopeCandidate {
                    kind: ScopeKind::User,
                    path_template: "%APPDATA%\\Zed\\skills".into(),
                    description: "用户级 Zed 编辑器 Slash Commands / Skills 目录".into(),
                },
                ScopeCandidate {
                    kind: ScopeKind::Project,
                    path_template: "<project>\\.zed\\skills".into(),
                    description: "工作区级 Zed 目录".into(),
                },
            ],
            description: "Zed 高性能多用户代码编辑器（实验性支持）".into(),
        },
        HostProfile {
            id: "kimi-code".into(),
            display_name: "Kimi Code".into(),
            profile_version: "1.0.0".into(),
            confidence: ConfidenceLevel::Experimental,
            discovery_shape: DiscoveryShape::Bundle,
            supported_scopes: vec![
                ScopeCandidate {
                    kind: ScopeKind::User,
                    path_template: "%APPDATA%\\Moonshot\\skills".into(),
                    description: "用户级 Kimi Code 扩展目录".into(),
                },
                ScopeCandidate {
                    kind: ScopeKind::Project,
                    path_template: "<project>\\.kimi\\skills".into(),
                    description: "工作区级 Kimi Code 目录".into(),
                },
            ],
            description: "Moonshot Kimi Code 编程工具（实验性支持）".into(),
        },
        HostProfile {
            id: "antigravity".into(),
            display_name: "Antigravity".into(),
            profile_version: "1.0.0".into(),
            confidence: ConfidenceLevel::Verified,
            discovery_shape: DiscoveryShape::Bundle,
            supported_scopes: vec![
                ScopeCandidate {
                    kind: ScopeKind::User,
                    path_template: "%USERPROFILE%\\.gemini\\antigravity\\skills".into(),
                    description: "用户级 Antigravity Skills 目录".into(),
                },
                ScopeCandidate {
                    kind: ScopeKind::Project,
                    path_template: "<project>\\.gemini\\skills".into(),
                    description: "工作区级 Antigravity Skills 目录".into(),
                },
            ],
            description: "Google DeepMind Antigravity Agentic IDE（已验证原生 Skills 支持）".into(),
        },
    ]
}

/// 根据 ID 获取单个 HostProfile。
pub fn get_profile(id: &str) -> Option<HostProfile> {
    all_profiles().into_iter().find(|p| p.id.eq_ignore_ascii_case(id))
}

/// 扩展 Windows 环境变量与 `<project>` 占位符。
/// 支持环境变量：%USERPROFILE%, %APPDATA%, %LOCALAPPDATA%, %TEMP%, %PROGRAMFILES% 等。
pub fn expand_path_template(template: &str, project_root: Option<&Path>) -> Result<PathBuf, String> {
    let mut resolved = template.to_string();

    if resolved.contains("<project>") {
        if let Some(root) = project_root {
            resolved = resolved.replace("<project>", &root.to_string_lossy());
        } else {
            return Err("template contains <project> but no project root was provided".into());
        }
    }

    // 提取环境变量映射（大写键名）
    let mut env_map: HashMap<String, String> = HashMap::new();
    for (k, v) in std::env::vars() {
        env_map.insert(k.to_uppercase(), v);
    }

    // 处理 %VAR% 及 %% 转义
    let mut result = String::new();
    let mut chars = resolved.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '%' {
            if chars.peek() == Some(&'%') {
                chars.next();
                result.push('%');
                continue;
            }
            let mut var_name = String::new();
            let mut closed = false;
            for next_ch in chars.by_ref() {
                if next_ch == '%' {
                    closed = true;
                    break;
                }
                var_name.push(next_ch);
            }
            if closed && !var_name.is_empty() {
                let var_upper = var_name.to_uppercase();
                if let Some(val) = env_map.get(&var_upper) {
                    result.push_str(val);
                } else if var_upper == "USERPROFILE" || var_upper == "HOME" {
                    let home = dirs::home_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
                    result.push_str(&home);
                } else if var_upper == "APPDATA" {
                    let roaming = dirs::config_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
                    result.push_str(&roaming);
                } else if var_upper == "LOCALAPPDATA" {
                    let local = dirs::data_local_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
                    result.push_str(&local);
                } else if var_upper == "TEMP" || var_upper == "TMP" {
                    let temp = std::env::temp_dir().to_string_lossy().to_string();
                    result.push_str(&temp);
                } else if var_upper == "PROGRAMFILES" || var_upper == "PROGRAMW6432" {
                    let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
                    result.push_str(&pf);
                } else {
                    return Err(format!("unknown environment variable in template: %{var_name}%"));
                }
            } else {
                result.push('%');
                result.push_str(&var_name);
            }
        } else {
            result.push(ch);
        }
    }

    // 规范化路径分隔符为当前系统标准
    let p = PathBuf::from(result.replace('/', std::path::MAIN_SEPARATOR_STR));
    Ok(p)
}

/// 扫描单个目标工具的本地状态与作用域目录。
pub fn scan_host(profile: &HostProfile, project_root: Option<&Path>) -> DiscoveredHost {
    let mut discovered_scopes = Vec::new();
    let mut any_installed = false;

    for candidate in &profile.supported_scopes {
        match expand_path_template(&candidate.path_template, project_root) {
            Ok(p) => {
                let exists = p.exists();
                let skills_count = if exists && p.is_dir() {
                    std::fs::read_dir(&p)
                        .map(|d| d.filter_map(|e| e.ok()).count())
                        .unwrap_or(0)
                } else {
                    0
                };
                if exists {
                    any_installed = true;
                }
                discovered_scopes.push(DiscoveredScope {
                    kind: candidate.kind,
                    path_template: candidate.path_template.clone(),
                    resolved_path: p.to_string_lossy().to_string(),
                    exists,
                    skills_count,
                });
            }
            Err(e) => {
                discovered_scopes.push(DiscoveredScope {
                    kind: candidate.kind,
                    path_template: candidate.path_template.clone(),
                    resolved_path: format!("<error: {e}>"),
                    exists: false,
                    skills_count: 0,
                });
            }
        }
    }

    let status = match (profile.confidence, any_installed) {
        (ConfidenceLevel::Verified, true) => "verified_and_ready".into(),
        (ConfidenceLevel::Verified, false) => "verified_not_detected".into(),
        (ConfidenceLevel::Experimental, true) => "experimental_detected".into(),
        (ConfidenceLevel::Experimental, false) => "experimental_not_detected".into(),
        (ConfidenceLevel::ScanOnly, true) => "scan_only_detected".into(),
        (ConfidenceLevel::ScanOnly, false) => "scan_only_not_detected".into(),
    };

    DiscoveredHost {
        profile: profile.clone(),
        installed: any_installed,
        discovered_scopes,
        status,
    }
}

/// 扫描所有 11 个目标工具。
pub fn scan_all_hosts(project_root: Option<&Path>) -> Vec<DiscoveredHost> {
    all_profiles()
        .into_iter()
        .map(|p| scan_host(&p, project_root))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_11_profiles_defined() {
        let profiles = all_profiles();
        assert_eq!(profiles.len(), 11, "必须恰好定义 11 个目标工具 Profiles");

        let expected_ids = [
            "cursor",
            "pi",
            "dsh",
            "zcode",
            "grok-build",
            "qoder",
            "codex",
            "claude-code",
            "zed",
            "kimi-code",
            "antigravity",
        ];
        for id in expected_ids {
            assert!(
                profiles.iter().any(|p| p.id == id),
                "缺少目标工具 Profile: {id}"
            );
        }
    }

    #[test]
    fn verified_profiles_strictly_gated() {
        let pi = get_profile("pi").expect("pi profile exists");
        assert_eq!(pi.confidence, ConfidenceLevel::Verified);
        assert_eq!(pi.discovery_shape, DiscoveryShape::Bundle);

        let dsh = get_profile("dsh").expect("dsh profile exists");
        assert_eq!(dsh.confidence, ConfidenceLevel::Verified);

        let antigravity = get_profile("antigravity").expect("antigravity profile exists");
        assert_eq!(antigravity.confidence, ConfidenceLevel::Verified);

        let cursor = get_profile("cursor").expect("cursor profile exists");
        assert_eq!(cursor.confidence, ConfidenceLevel::ScanOnly);
    }

    #[test]
    fn expand_path_template_handles_env_and_project() {
        let tmp = tempfile::tempdir().unwrap();
        let proj = tmp.path().join("my-project");
        std::fs::create_dir_all(&proj).unwrap();

        // 1. 测试 <project> 占位符
        let expanded = expand_path_template("<project>\\.cursor\\skills", Some(&proj)).unwrap();
        assert!(expanded.to_string_lossy().contains("my-project"));
        assert!(expanded.ends_with(".cursor\\skills") || expanded.ends_with(".cursor/skills"));

        // 2. 测试缺少 project root 时报错
        let err = expand_path_template("<project>\\.cursor\\skills", None).unwrap_err();
        assert!(err.contains("no project root"));

        // 3. 测试 %USERPROFILE% 或 %APPDATA%
        let user_expanded = expand_path_template("%USERPROFILE%\\.gemini\\antigravity\\skills", None).unwrap();
        assert!(!user_expanded.to_string_lossy().contains("%USERPROFILE%"));
        assert!(user_expanded.to_string_lossy().contains("antigravity"));

        // 4. 测试小写环境变量与 %% 转义
        let lower_env = expand_path_template("%userprofile%\\test", None).unwrap();
        assert!(!lower_env.to_string_lossy().contains("%userprofile%"));

        let escaped = expand_path_template("%%LOCALAPPDATA%%\\test", None).unwrap();
        assert!(escaped.to_string_lossy().contains("%LOCALAPPDATA%"));
    }

    #[test]
    fn scan_host_finds_real_directories_and_degrades_gracefully() {
        let tmp = tempfile::tempdir().unwrap();
        let proj = tmp.path().join("demo-proj");
        let fake_scope = proj.join(".cursor").join("skills");
        std::fs::create_dir_all(&fake_scope).unwrap();
        std::fs::write(fake_scope.join("sample.txt"), "hello").unwrap();

        let cursor = get_profile("cursor").unwrap();
        let discovered = scan_host(&cursor, Some(&proj));
        assert!(discovered.installed, "应检测到创建的项目级作用域");
        let proj_scope = discovered
            .discovered_scopes
            .iter()
            .find(|s| s.kind == ScopeKind::Project)
            .unwrap();
        assert!(proj_scope.exists);
        assert_eq!(proj_scope.skills_count, 1);

        // 未配置宿主降级
        let unconfigured = get_profile("zcode").unwrap();
        let unconf_disc = scan_host(&unconfigured, Some(&proj));
        let proj_unconf = unconf_disc
            .discovered_scopes
            .iter()
            .find(|s| s.kind == ScopeKind::Project)
            .unwrap();
        assert!(!proj_unconf.exists);
    }
}
