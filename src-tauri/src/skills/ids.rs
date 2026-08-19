/// 校验来自前端的标识（快照 ID、技能名等）可安全用作单个路径段：
/// 拒绝路径分隔符、父目录引用、盘符、控制字符与空串。
pub fn is_safe_id_segment(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 200
        && !s.contains(['/', '\\', ':'])
        && !s.contains("..")
        && !s.chars().any(|c| c.is_control())
}
