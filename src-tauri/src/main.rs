// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 无头自检模式：Pi 纵切 (M1) 与 DSH 纵切 (M2) 的端到端自检
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--selftest-m1") {
        std::process::exit(aster_lib::selftest_m1());
    }
    if args.iter().any(|a| a == "--selftest-m2") {
        std::process::exit(aster_lib::selftest_m2());
    }
    if args.iter().any(|a| a == "--selftest-m3") {
        std::process::exit(aster_lib::selftest_m3());
    }
    aster_lib::run()
}
