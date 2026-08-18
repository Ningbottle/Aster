//! M2 集成测试：在真实临时目录中验证
//! 「DSH 运行时探测 -> 端口分配 -> 冲突避让 -> 服务器生命周期与停止」流程，
//! 不依赖外部网络。

use aster_lib::app_data::AppDataLayout;
use aster_lib::dsh_connector::{self, DshServer};
use std::fs;
use std::process::{Command, Stdio};

#[test]
fn test_m2_dsh_connector_discovery_and_port_handling() {
    let tmp = tempfile::tempdir().unwrap();
    let layout = AppDataLayout::open(tmp.path()).unwrap();

    // 1. 构造模拟的 managed DSH 目录
    let dsh_pkg = layout
        .runtimes
        .join("dsh")
        .join("0.1.0-rc.6")
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh-web-app");
    fs::create_dir_all(dsh_pkg.join("lib")).unwrap();
    fs::write(dsh_pkg.join("lib").join("index.js"), "console.log('dsh mock');").unwrap();

    // 2. 探测
    let runtimes = dsh_connector::discover(&layout.root);
    assert_eq!(runtimes.len(), 1);
    assert_eq!(runtimes[0].version, "0.1.0-rc.6");
    assert!(runtimes[0].managed);
    assert!(runtimes[0].supported);

    // 3. 端口查找与冲突避让
    let free_port = dsh_connector::find_available_port(39950).unwrap();
    assert!(free_port >= 39950);

    let listener = std::net::TcpListener::bind(("127.0.0.1", free_port)).unwrap();
    let next_free = dsh_connector::find_available_port(free_port).unwrap();
    assert!(next_free > free_port);
    drop(listener);

    // 4. 服务器测试构造器与状态
    let mut cmd = Command::new("cmd");
    cmd.args(["/C", "ping", "-n", "10", "127.0.0.1"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let child = cmd.spawn().unwrap();

    let mut server = DshServer::new_for_testing(child, free_port, "0.1.0-rc.6".into(), true);
    let status = server.status();
    assert_eq!(status.port, free_port);
    assert_eq!(status.version, "0.1.0-rc.6");
    assert!(status.running);

    server.stop().unwrap();
    assert!(server.is_stopped());
}
