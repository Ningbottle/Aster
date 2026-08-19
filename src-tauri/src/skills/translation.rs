use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationDoc {
    pub skill_name: String,
    pub snapshot_id: String,
    pub purpose: String,
    pub applicable_tasks: String,
    pub target_tools: Vec<String>,
    pub prerequisites: String,
    pub risks: String,
    pub author: String,
    pub updated_at: String,
    pub markdown_body: String,
    pub is_stale: bool,
}


pub fn load_translation(
    translations_root: &Path,
    skill_name: &str,
    current_snapshot_id: Option<&str>,
) -> Result<Option<TranslationDoc>, String> {
    let file_path = translations_root.join(format!("{skill_name}.md"));
    if !file_path.is_file() {
        return Ok(None);
    }

    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let mut snapshot_id = String::new();
    let mut purpose = String::new();
    let mut applicable_tasks = String::new();
    let mut target_tools = Vec::new();
    let mut prerequisites = String::new();
    let mut risks = String::new();
    let mut author = "user".to_string();
    let mut updated_at = String::new();
    let markdown_body;

    if content.starts_with("---") {
        let parts: Vec<&str> = content.splitn(3, "---").collect();
        if parts.len() >= 3 {
            let frontmatter = parts[1];
            markdown_body = parts[2].trim_start().to_string();

            let mut in_tools_list = false;
            for line in frontmatter.lines() {
                let trimmed = line.trim();
                if in_tools_list {
                    if let Some(item) = trimmed.strip_prefix('-') {
                        target_tools.push(item.trim().to_string());
                        continue;
                    } else if !trimmed.is_empty() && !trimmed.starts_with('-') {
                        in_tools_list = false;
                    }
                }

                if let Some((k, v)) = trimmed.split_once(':') {
                    let key = k.trim().to_lowercase();
                    let val = v.trim().trim_matches('"').trim_matches('\'').to_string();
                    match key.as_str() {
                        "snapshot_id" => snapshot_id = val,
                        "purpose" => purpose = val,
                        "applicable_tasks" => applicable_tasks = val,
                        "target_tools" => {
                            if !val.is_empty() {
                                target_tools.push(val);
                            } else {
                                in_tools_list = true;
                            }
                        }
                        "prerequisites" => prerequisites = val,
                        "risks" => risks = val,
                        "author" => author = val,
                        "updated_at" => updated_at = val,
                        _ => {}
                    }
                }
            }
        } else {
            markdown_body = content.clone();
        }
    } else {
        markdown_body = content.clone();
    }

    let is_stale = if let Some(cur_id) = current_snapshot_id {
        !snapshot_id.is_empty() && snapshot_id != cur_id
    } else {
        false
    };

    Ok(Some(TranslationDoc {
        skill_name: skill_name.to_string(),
        snapshot_id,
        purpose,
        applicable_tasks,
        target_tools,
        prerequisites,
        risks,
        author,
        updated_at,
        markdown_body,
        is_stale,
    }))
}

/// 保存或更新中文说明文档（Derived Metadata），绝不覆盖原始不可变快照。
pub fn save_translation(
    conn: Option<&Connection>,
    translations_root: &Path,
    doc: &TranslationDoc,
) -> Result<(), String> {
    fs::create_dir_all(translations_root).map_err(|e| e.to_string())?;
    let file_path = translations_root.join(format!("{}.md", doc.skill_name));

    let mut tools_yaml = String::new();
    if doc.target_tools.is_empty() {
        tools_yaml.push_str(" []\n");
    } else {
        tools_yaml.push('\n');
        for t in &doc.target_tools {
            tools_yaml.push_str(&format!("  - {t}\n"));
        }
    }

    let formatted = format!(
        "---\nskill_name: {}\nsnapshot_id: {}\npurpose: {}\napplicable_tasks: {}\ntarget_tools:{}prerequisites: {}\nrisks: {}\nauthor: {}\nupdated_at: {}\n---\n\n{}",
        doc.skill_name,
        doc.snapshot_id,
        doc.purpose,
        doc.applicable_tasks,
        tools_yaml,
        doc.prerequisites,
        doc.risks,
        doc.author,
        if doc.updated_at.is_empty() { Utc::now().to_rfc3339() } else { doc.updated_at.clone() },
        doc.markdown_body
    );

    fs::write(&file_path, formatted).map_err(|e| e.to_string())?;

    if let Some(c) = conn {
        let _ = c.execute(
            "INSERT INTO skill_translation (id, skill_name, snapshot_id, file_path, purpose, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
             snapshot_id = excluded.snapshot_id,
             file_path = excluded.file_path,
             purpose = excluded.purpose,
             updated_at = excluded.updated_at",
            params![
                doc.skill_name,
                doc.skill_name,
                doc.snapshot_id,
                file_path.to_string_lossy(),
                doc.purpose,
                Utc::now().to_rfc3339(),
            ],
        );
    }

    Ok(())
}
