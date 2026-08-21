//! Custom titlebar chrome is not covered by `core:window:default`.
//! Keep the four mutating permissions in the main-window capability.

#[test]
fn default_capability_allows_custom_titlebar_chrome() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities/default.json");
    let raw =
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    let v: serde_json::Value = serde_json::from_str(&raw).expect("default.json must be JSON");
    let perms = v["permissions"]
        .as_array()
        .expect("permissions must be an array");
    let as_str: Vec<&str> = perms.iter().filter_map(|p| p.as_str()).collect();
    for needed in [
        "core:window:allow-minimize",
        "core:window:allow-toggle-maximize",
        "core:window:allow-close",
        "core:window:allow-start-dragging",
    ] {
        assert!(
            as_str.iter().any(|p| *p == needed),
            "capabilities/default.json missing {needed}; got {as_str:?}"
        );
    }
}
