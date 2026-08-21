//! Catalog and runtime binding tests for native Pi sessions.

use aster_lib::pi::connector::PiRuntime;
use aster_lib::pi::runtime::{
    decide_activate_project, decide_remove_project, decide_set_pi_host_workdir,
    ActivateProjectDecision, FakePiController, PiOpenError, PiRuntimeManager,
};
use aster_lib::pi::sessions::{
    project_paths_equal, resolve_session_path, scan_session_root, scan_session_root_with_limits,
    PiCatalogError, MAX_SESSION_FILES, MAX_SESSION_FILE_BYTES,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

const VALID_SESSION: &str = concat!(
    r#"{"type":"session","version":3,"id":"s-1","timestamp":"2026-08-19T00:00:00Z","cwd":"C:/fixture/project-a"}"#,
    "\n",
    r#"{"type":"session_info","id":"e-1","parentId":null,"timestamp":"2026-08-19T00:00:01Z","name":"Plan compiler"}"#,
    "\n",
    r#"{"type":"message","id":"e-2","parentId":"e-1","timestamp":"2026-08-19T00:00:02Z","message":{"role":"user","content":"not persisted by Aster"}}"#,
    "\n",
);

fn write_jsonl(dir: &Path, rel: &str, content: &str) {
    let path = dir.join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
}

#[test]
fn catalog_indexes_valid_native_session_metadata() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_jsonl(root, "cwd-a/s-1.jsonl", VALID_SESSION);

    let entries = scan_session_root(root).unwrap();
    assert_eq!(entries.len(), 1);
    let entry = &entries[0];
    assert_eq!(entry.session_id, "s-1");
    assert_eq!(entry.cwd, Path::new("C:/fixture/project-a"));
    assert_eq!(entry.rel_path, Path::new("cwd-a/s-1.jsonl"));
    assert_eq!(entry.session_name.as_deref(), Some("Plan compiler"));
    assert_eq!(entry.message_count, 1);
    assert_eq!(entry.created_at, "2026-08-19T00:00:00Z");
    let debug = format!("{entry:?}");
    assert!(
        !debug.contains("not persisted by Aster"),
        "catalog must not retain message text"
    );
}

#[test]
fn catalog_skips_malformed_header() {
    let tmp = tempfile::tempdir().unwrap();
    write_jsonl(tmp.path(), "bad.jsonl", "{\"type\":\"nope\"}\n");
    let entries = scan_session_root(tmp.path()).unwrap();
    assert!(entries.is_empty());
}

#[test]
fn catalog_skips_missing_cwd() {
    let tmp = tempfile::tempdir().unwrap();
    write_jsonl(
        tmp.path(),
        "no-cwd.jsonl",
        r#"{"type":"session","version":3,"id":"s-x","timestamp":"2026-08-19T00:00:00Z"}
"#,
    );
    let entries = scan_session_root(tmp.path()).unwrap();
    assert!(entries.is_empty());
}

#[test]
fn catalog_oversized_file_returns_limit_exceeded() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("huge.jsonl");
    let f = fs::File::create(&path).unwrap();
    f.set_len(MAX_SESSION_FILE_BYTES + 1).unwrap();
    drop(f);
    let err = scan_session_root(tmp.path()).unwrap_err();
    match err {
        PiCatalogError::LimitExceeded { kind, limit } => {
            assert_eq!(kind, "file size");
            assert_eq!(limit, MAX_SESSION_FILE_BYTES);
        }
        other => panic!("expected size limit, got {other}"),
    }
}

#[test]
fn catalog_too_many_files_returns_limit_exceeded() {
    let tmp = tempfile::tempdir().unwrap();
    write_jsonl(tmp.path(), "a.jsonl", VALID_SESSION);
    write_jsonl(tmp.path(), "b.jsonl", VALID_SESSION);
    write_jsonl(tmp.path(), "c.jsonl", VALID_SESSION);
    let err = scan_session_root_with_limits(tmp.path(), 2, MAX_SESSION_FILE_BYTES).unwrap_err();
    match err {
        PiCatalogError::LimitExceeded { kind, limit } => {
            assert_eq!(kind, "file count");
            assert_eq!(limit, 2);
        }
        other => panic!("expected file count limit, got {other}"),
    }
    assert_eq!(MAX_SESSION_FILES, 10_000);
}

#[test]
fn catalog_rejects_reparse_point() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("root");
    let outside = tmp.path().join("outside");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&outside).unwrap();
    write_jsonl(&outside, "secret.jsonl", VALID_SESSION);
    let link = root.join("escape");
    junction::create(&outside, &link).expect("create junction for catalog test");
    let err = scan_session_root(&root).unwrap_err();
    assert!(
        matches!(err, PiCatalogError::ReparsePoint),
        "reparse points must be rejected, got {err}"
    );
}

#[test]
fn catalog_resolve_rejects_traversal() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("root");
    fs::create_dir_all(&root).unwrap();
    write_jsonl(tmp.path(), "escape.jsonl", VALID_SESSION);
    let err = resolve_session_path(&root, r"..\escape.jsonl").unwrap_err();
    assert!(
        matches!(
            err,
            PiCatalogError::PathEscape | PiCatalogError::InvalidLocator
        ),
        "traversal must be rejected, got {err}"
    );
}

fn dummy_runtime() -> PiRuntime {
    PiRuntime {
        version: "0.84.2".into(),
        cli_js: r"C:\fixture\cli.js".into(),
        managed: true,
    }
}

fn sink() -> aster_lib::pi::runtime::PiEventSink {
    Arc::new(|_, _, _| {})
}

fn write_session_file(dir: &Path, name: &str) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, "{}\n").unwrap();
    path
}

#[test]
fn binding_already_active_open_is_noop() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("proj-a");
    fs::create_dir_all(&project).unwrap();
    let a1 = write_session_file(&project, "a1.jsonl");
    let ctrl = FakePiController::new();
    let mgr = PiRuntimeManager::with_fake(Arc::clone(&ctrl));
    let first = mgr
        .open_session(&dummy_runtime(), &project, &a1, sink())
        .unwrap();
    let second = mgr
        .open_session(&dummy_runtime(), &project, &a1, sink())
        .unwrap();
    assert_eq!(first.binding.instance_id, second.binding.instance_id);
    assert_eq!(ctrl.starts.lock().unwrap().len(), 1);
    assert!(ctrl.switches.lock().unwrap().is_empty());
}

#[test]
fn binding_busy_rejects_switch_without_abort() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("proj-a");
    fs::create_dir_all(&project).unwrap();
    let a1 = write_session_file(&project, "a1.jsonl");
    let a2 = write_session_file(&project, "a2.jsonl");
    let ctrl = FakePiController::new();
    let mgr = PiRuntimeManager::with_fake(Arc::clone(&ctrl));
    mgr.open_session(&dummy_runtime(), &project, &a1, sink())
        .unwrap();
    ctrl.streaming.store(true, Ordering::SeqCst);
    let err = mgr
        .open_session(&dummy_runtime(), &project, &a2, sink())
        .unwrap_err();
    assert!(matches!(err, PiOpenError::Busy));
    assert_eq!(ctrl.aborts.load(Ordering::SeqCst), 0);
    assert!(ctrl.switches.lock().unwrap().is_empty());
    assert_eq!(ctrl.starts.lock().unwrap().len(), 1);
}

#[test]
fn binding_same_project_idle_uses_switch_session() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("proj-a");
    fs::create_dir_all(&project).unwrap();
    let a1 = write_session_file(&project, "a1.jsonl");
    let a2 = write_session_file(&project, "a2.jsonl");
    let ctrl = FakePiController::new();
    let mgr = PiRuntimeManager::with_fake(Arc::clone(&ctrl));
    mgr.open_session(&dummy_runtime(), &project, &a1, sink())
        .unwrap();
    let snap = mgr
        .open_session(&dummy_runtime(), &project, &a2, sink())
        .unwrap();
    assert_eq!(snap.binding.session_id, "a2");
    assert_eq!(ctrl.starts.lock().unwrap().len(), 1);
    assert_eq!(ctrl.switches.lock().unwrap().as_slice(), &[a2]);
    assert_eq!(ctrl.stops.load(Ordering::SeqCst), 0);
}

#[test]
fn binding_cross_project_idle_restarts_with_target_cwd() {
    let tmp = tempfile::tempdir().unwrap();
    let project_a = tmp.path().join("proj-a");
    let project_b = tmp.path().join("proj-b");
    fs::create_dir_all(&project_a).unwrap();
    fs::create_dir_all(&project_b).unwrap();
    let a1 = write_session_file(&project_a, "a1.jsonl");
    let b1 = write_session_file(&project_b, "b1.jsonl");
    let ctrl = FakePiController::new();
    let mgr = PiRuntimeManager::with_fake(Arc::clone(&ctrl));
    let first = mgr
        .open_session(&dummy_runtime(), &project_a, &a1, sink())
        .unwrap();
    let second = mgr
        .open_session(&dummy_runtime(), &project_b, &b1, sink())
        .unwrap();
    assert_ne!(first.binding.instance_id, second.binding.instance_id);
    assert!(project_paths_equal(
        &second.binding.project_path,
        &project_b
    ));
    let starts = ctrl.starts.lock().unwrap().clone();
    assert_eq!(starts.len(), 2);
    assert!(project_paths_equal(&starts[0].0, &project_a));
    assert!(project_paths_equal(&starts[1].0, &project_b));
    assert_eq!(starts[1].1.as_ref(), Some(&b1));
    assert_eq!(ctrl.stops.load(Ordering::SeqCst), 1);
}

#[test]
fn binding_failed_cross_project_start_leaves_no_false_binding() {
    let tmp = tempfile::tempdir().unwrap();
    let project_a = tmp.path().join("proj-a");
    let project_b = tmp.path().join("proj-b");
    fs::create_dir_all(&project_a).unwrap();
    fs::create_dir_all(&project_b).unwrap();
    let a1 = write_session_file(&project_a, "a1.jsonl");
    let b1 = write_session_file(&project_b, "b1.jsonl");
    let ctrl = FakePiController::new();
    let mgr = PiRuntimeManager::with_fake(Arc::clone(&ctrl));
    mgr.open_session(&dummy_runtime(), &project_a, &a1, sink())
        .unwrap();
    ctrl.fail_next_start.store(true, Ordering::SeqCst);
    let err = mgr
        .open_session(&dummy_runtime(), &project_b, &b1, sink())
        .unwrap_err();
    assert!(matches!(err, PiOpenError::StartFailed(_)));
    assert!(mgr.active_binding().is_none());
}

#[test]
fn binding_rpc_does_not_hold_runtime_lock() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("proj-a");
    fs::create_dir_all(&project).unwrap();
    let a1 = write_session_file(&project, "a1.jsonl");
    let ctrl = FakePiController::new();
    let mgr = Arc::new(PiRuntimeManager::with_fake(Arc::clone(&ctrl)));
    mgr.open_session(&dummy_runtime(), &project, &a1, sink())
        .unwrap();

    ctrl.block_next_get_state();
    let mgr_rpc = Arc::clone(&mgr);
    let handle = std::thread::spawn(move || mgr_rpc.get_state());
    ctrl.wait_until_get_state_entered();
    assert!(
        mgr.active_binding().is_some(),
        "event/command readers must not wait on the RPC mutex"
    );
    ctrl.release_get_state();
    handle.join().unwrap().unwrap();
}

#[test]
fn binding_new_session_clears_previous_file_identity() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("proj-a");
    fs::create_dir_all(&project).unwrap();
    let a1 = write_session_file(&project, "a1.jsonl");
    let ctrl = FakePiController::new();
    let mgr = PiRuntimeManager::with_fake(Arc::clone(&ctrl));
    mgr.open_session(&dummy_runtime(), &project, &a1, sink())
        .unwrap();
    mgr.create_session(&dummy_runtime(), &project, sink())
        .unwrap();
    mgr.open_session(&dummy_runtime(), &project, &a1, sink())
        .unwrap();
    assert_eq!(ctrl.switches.lock().unwrap().as_slice(), &[a1]);
}

#[test]
fn project_activate_same_binding_is_noop() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("proj-a");
    fs::create_dir_all(&project).unwrap();
    let a1 = write_session_file(&project, "a1.jsonl");
    let mgr = PiRuntimeManager::with_fake(FakePiController::new());
    mgr.open_session(&dummy_runtime(), &project, &a1, sink())
        .unwrap();
    let binding = mgr.active_binding().unwrap();
    let decision = decide_activate_project(Some(&binding), &project).unwrap();
    assert_eq!(decision, ActivateProjectDecision::Noop);
}

#[test]
fn project_activate_other_path_is_refused_idle_and_busy() {
    let tmp = tempfile::tempdir().unwrap();
    let project_a = tmp.path().join("proj-a");
    let project_b = tmp.path().join("proj-b");
    fs::create_dir_all(&project_a).unwrap();
    fs::create_dir_all(&project_b).unwrap();
    let a1 = write_session_file(&project_a, "a1.jsonl");
    let ctrl = FakePiController::new();
    let mgr = PiRuntimeManager::with_fake(Arc::clone(&ctrl));
    mgr.open_session(&dummy_runtime(), &project_a, &a1, sink())
        .unwrap();
    let binding = mgr.active_binding().unwrap();
    let err = decide_activate_project(Some(&binding), &project_b).unwrap_err();
    assert!(err.contains("活动 Pi Session"));
    assert!(err.contains("proj-a"));
    assert!(err.contains("停止 Session"));
    ctrl.streaming.store(true, Ordering::SeqCst);
    let binding = mgr.active_binding().unwrap();
    let err_busy = decide_activate_project(Some(&binding), &project_b).unwrap_err();
    assert!(err_busy.contains("活动 Pi Session"));
    assert_eq!(ctrl.aborts.load(Ordering::SeqCst), 0);
    assert_eq!(ctrl.stops.load(Ordering::SeqCst), 0);
}

#[test]
fn project_remove_bound_refused_unrelated_allowed() {
    let tmp = tempfile::tempdir().unwrap();
    let project_a = tmp.path().join("proj-a");
    let project_b = tmp.path().join("proj-b");
    fs::create_dir_all(&project_a).unwrap();
    fs::create_dir_all(&project_b).unwrap();
    let a1 = write_session_file(&project_a, "a1.jsonl");
    let mgr = PiRuntimeManager::with_fake(FakePiController::new());
    mgr.open_session(&dummy_runtime(), &project_a, &a1, sink())
        .unwrap();
    let binding = mgr.active_binding().unwrap();
    assert!(decide_remove_project(Some(&binding), &project_a).is_err());
    assert!(decide_remove_project(Some(&binding), &project_b).is_ok());
}

#[test]
fn project_ops_allowed_after_stop() {
    let tmp = tempfile::tempdir().unwrap();
    let project_a = tmp.path().join("proj-a");
    let project_b = tmp.path().join("proj-b");
    fs::create_dir_all(&project_a).unwrap();
    fs::create_dir_all(&project_b).unwrap();
    let a1 = write_session_file(&project_a, "a1.jsonl");
    let mgr = PiRuntimeManager::with_fake(FakePiController::new());
    mgr.open_session(&dummy_runtime(), &project_a, &a1, sink())
        .unwrap();
    mgr.stop().unwrap();
    assert!(mgr.active_binding().is_none());
    assert_eq!(
        decide_activate_project(None, &project_b).unwrap(),
        ActivateProjectDecision::Proceed
    );
    assert!(decide_remove_project(None, &project_a).is_ok());
}

#[test]
fn pi_host_workdir_refused_while_bound_allowed_after_stop() {
    let tmp = tempfile::tempdir().unwrap();
    let project_a = tmp.path().join("proj-a");
    fs::create_dir_all(&project_a).unwrap();
    let a1 = write_session_file(&project_a, "a1.jsonl");
    let mgr = PiRuntimeManager::with_fake(FakePiController::new());
    mgr.open_session(&dummy_runtime(), &project_a, &a1, sink())
        .unwrap();
    let bound = mgr.bound_binding().unwrap();
    let err = decide_set_pi_host_workdir(Some(&bound)).unwrap_err();
    assert!(err.contains("活动 Pi Session"));
    mgr.stop().unwrap();
    assert!(decide_set_pi_host_workdir(mgr.bound_binding().as_ref()).is_ok());
}

#[test]
fn project_activate_refused_while_crashed_until_stop() {
    let tmp = tempfile::tempdir().unwrap();
    let project_a = tmp.path().join("proj-a");
    let project_b = tmp.path().join("proj-b");
    fs::create_dir_all(&project_a).unwrap();
    fs::create_dir_all(&project_b).unwrap();
    let a1 = write_session_file(&project_a, "a1.jsonl");
    let ctrl = FakePiController::new();
    let mgr = PiRuntimeManager::with_fake(Arc::clone(&ctrl));
    mgr.open_session(&dummy_runtime(), &project_a, &a1, sink())
        .unwrap();
    ctrl.force_closed.store(true, Ordering::SeqCst);
    assert!(mgr.active_binding().is_none());
    assert_eq!(mgr.runtime_snapshot(true).lifecycle, "crashed");
    let bound = mgr.bound_binding().expect("slot still occupied");
    let err = decide_activate_project(Some(&bound), &project_b).unwrap_err();
    assert!(err.contains("活动 Pi Session"));
    mgr.stop().unwrap();
    assert!(mgr.bound_binding().is_none());
    assert_eq!(
        decide_activate_project(None, &project_b).unwrap(),
        ActivateProjectDecision::Proceed
    );
}

#[test]
fn stop_timeout_keeps_slot_and_blocks_project_change() {
    let tmp = tempfile::tempdir().unwrap();
    let project_a = tmp.path().join("proj-a");
    let project_b = tmp.path().join("proj-b");
    fs::create_dir_all(&project_a).unwrap();
    fs::create_dir_all(&project_b).unwrap();
    let a1 = write_session_file(&project_a, "a1.jsonl");
    let ctrl = FakePiController::new();
    let mgr = PiRuntimeManager::with_fake(Arc::clone(&ctrl));
    mgr.open_session(&dummy_runtime(), &project_a, &a1, sink())
        .unwrap();
    ctrl.fail_next_stop.store(true, Ordering::SeqCst);
    let err = mgr
        .stop()
        .expect_err("timeout must not look like a clean stop");
    assert!(
        err.contains("未能停止") || err.to_lowercase().contains("still alive"),
        "{err}"
    );
    let bound = mgr.bound_binding().expect("slot must stay occupied");
    let blocked = decide_activate_project(Some(&bound), &project_b).unwrap_err();
    assert!(blocked.contains("活动 Pi Session"));
    assert!(decide_set_pi_host_workdir(mgr.bound_binding().as_ref()).is_err());
}

#[test]
fn runtime_snapshot_ready_then_busy_then_closed() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("proj-a");
    fs::create_dir_all(&project).unwrap();
    let a1 = write_session_file(&project, "a1.jsonl");
    let ctrl = FakePiController::new();
    let mgr = PiRuntimeManager::with_fake(Arc::clone(&ctrl));
    let closed = mgr.runtime_snapshot(true);
    assert_eq!(closed.lifecycle, "closed");
    mgr.open_session(&dummy_runtime(), &project, &a1, sink())
        .unwrap();
    let ready = mgr.runtime_snapshot(true);
    assert_eq!(ready.lifecycle, "ready");
    assert_eq!(ready.session_id.as_deref(), Some("a1"));
    ctrl.streaming.store(true, Ordering::SeqCst);
    mgr.snapshot().unwrap();
    let busy = mgr.runtime_snapshot(true);
    assert_eq!(busy.lifecycle, "busy");
    mgr.stop().unwrap();
    let after = mgr.runtime_snapshot(true);
    assert_eq!(after.lifecycle, "closed");
    let setup = mgr.runtime_snapshot(false);
    assert_eq!(setup.lifecycle, "needsSetup");
}
