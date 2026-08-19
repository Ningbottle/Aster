//! DSH 发现集成测试：在真实临时目录中验证
//! 「DSH 运行时探测 -> 端口分配 -> 冲突避让 -> 服务器生命周期与停止」流程，
//! 不依赖外部网络。

use aster_lib::platform::app_data::AppDataLayout;
use aster_lib::dsh::connector::{self as dsh_connector, DshServer};
use std::fs;
use std::process::{Command, Stdio};

#[test]
fn dsh_connector_discovery_and_port_handling() {
    let tmp = tempfile::tempdir().unwrap();
    let layout = AppDataLayout::open(tmp.path()).unwrap();

    // 1. 构造模拟的 managed DSH 目录（官方 CLI 包 @deepseek-ai/dsh 布局）
    let dsh_pkg = layout
        .runtimes
        .join("dsh")
        .join("0.1.0-rc.6")
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh");
    fs::create_dir_all(dsh_pkg.join("lib")).unwrap();
    fs::write(dsh_pkg.join("lib").join("bin.js"), "// dsh cli mock").unwrap();
    fs::write(
        dsh_pkg.join("package.json"),
        r#"{"name":"@deepseek-ai/dsh","version":"0.1.0-rc.6","bin":{"dsh":"lib/bin.js"}}"#,
    )
    .unwrap();

    // 2. 探测（只断言 managed；本机若有外部安装不影响）
    let runtimes = dsh_connector::discover(&layout.root);
    let managed: Vec<_> = runtimes.iter().filter(|r| r.managed).collect();
    assert_eq!(managed.len(), 1);
    assert_eq!(managed[0].version, "0.1.0-rc.6");
    assert!(managed[0].supported);

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

    // 5. entry_path 指向官方 CLI 入口（启动参数由 DshServer::start 组装）
    assert!(managed[0].entry_path.ends_with("bin.js"));
    assert!(std::path::Path::new(&managed[0].entry_path).is_file());
}

/// R2 失败测试（锁定空白页根因）：仅安装 dsh-web-app（旧 runner 自行拼装
/// 时代的布局，缺少官方 CLI 与 window.__DSH_BOOT__ 注入链路）的目录，
/// 不得被 discover 识别为完整宿主。
#[test]
fn webapp_only_install_must_not_be_recognized_as_complete_host() {
    let tmp = tempfile::tempdir().unwrap();
    let layout = AppDataLayout::open(tmp.path()).unwrap();

    let webapp_pkg = layout
        .runtimes
        .join("dsh")
        .join("0.1.0-rc.6")
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh-web-app");
    fs::create_dir_all(webapp_pkg.join("lib")).unwrap();
    fs::write(webapp_pkg.join("lib").join("index.js"), "// webapp only").unwrap();

    let runtimes = dsh_connector::discover(&layout.root);
    assert!(
        runtimes.iter().all(|r| !r.managed),
        "仅有 dsh-web-app 的 managed 安装不得被识别为完整宿主：{runtimes:?}"
    );
}

/// 与上一条配对：包含官方 CLI 包 @deepseek-ai/dsh（lib/bin.js）的安装
/// 才是完整宿主，entry_path 指向官方 CLI 入口而非自拼 runner。
#[test]
fn full_cli_install_is_recognized_as_complete_host() {
    let tmp = tempfile::tempdir().unwrap();
    let layout = AppDataLayout::open(tmp.path()).unwrap();

    let cli_pkg = layout
        .runtimes
        .join("dsh")
        .join("0.1.0-rc.6")
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh");
    fs::create_dir_all(cli_pkg.join("lib")).unwrap();
    fs::write(cli_pkg.join("lib").join("bin.js"), "// official dsh cli").unwrap();
    fs::write(
        cli_pkg.join("package.json"),
        r#"{"name":"@deepseek-ai/dsh","version":"0.1.0-rc.6","bin":{"dsh":"lib/bin.js"}}"#,
    )
    .unwrap();

    let runtimes = dsh_connector::discover(&layout.root);
    let managed: Vec<_> = runtimes.iter().filter(|r| r.managed).collect();
    assert_eq!(managed.len(), 1, "官方 CLI 安装应被识别：{runtimes:?}");
    assert_eq!(managed[0].version, "0.1.0-rc.6");
    assert!(managed[0].supported);
    assert!(
        managed[0].entry_path.ends_with("bin.js"),
        "entry_path 应指向官方 CLI 入口：{}",
        managed[0].entry_path
    );
}
