# ADR-0003: M2 / R2 DeepSeek Harness（DSH）原生 Web 承载与独立连接器

## 状态

原结论“已接受并在 R2 兑现”已被 2026-08-18 真实 UI 审计推翻；当前状态与验收进度以 [`docs/status.md`](../status.md) 与 [`docs/milestones/R2.md`](../milestones/R2.md) 为准。更正记录见文末“2026-08-18 更正”一节。

## 背景与上下文

在 Aster 中，我们需要将 DeepSeek Harness（DSH）作为第二宿主引入桌面工作台。
根据 [`content.md`](../../content.md) §7、§14 与 [`AGENTS.md`](../../AGENTS.md) 的约束：
- DSH 是独立、可高度插件化的宿主，具有独立的 provider registry、插件系统、自定义模式与会话持久化语义；
- Aster Alpha 优先承载其原生 Web UI，而不是将其与 Pi 抹平为假的一致对话模型；
- 在 R2 里程碑核查中，我们推翻了原占位页逻辑，真实接入 `@deepseek-ai/dsh-web-app@0.1.0-rc.6` 与 `@deepseek-ai/dsh-web-frontend` SPA 前端，使原生界面、插件化与会话持久化在桌面 WebView 与嵌入 iframe 中真实可用。

## 决策

1. **宿主隔离与独立连接器 (`dsh_connector.rs`)**：
   - DSH 拥有独立的 Rust 连接器实现，不与 Pi 共享任何 RPC 类型、状态机或 UI 流程；
   - 共享的仅是基础进程监管（`supervisor.rs`）、数据目录（`AppDataLayout`）和 Evidence 词汇。
2. **Aster-managed 并排安装与外部探测**：
   - 锁定首发验证版本为 `@deepseek-ai/dsh-web-app@0.1.0-rc.6`；
   - 支持通过 npm 前缀安装到 `%LOCALAPPDATA%\Aster\runtimes\dsh/<version>`；
   - 允许外部 npm 安装探测，并对非锁定版本标记为“未验证版本”进行安全降级。
3. **真实 WebApp ESM Runner 挂载**：
   - 由 `prepare_runner` 生成符合 Cordis 插件体系的 `server.mjs`，引入 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-host-webserver` 与 `@deepseek-ai/dsh-web-app`；
   - 自动挂载 `@deepseek-ai/dsh-web-frontend/dist` SPA 静态资源及 API Gateway，绝不使用虚假占位页面伪造成功。
4. **动态端口分配与冲突避让**：
   - 默认端口 `38472`，在启动前探测 localhost 端口可用性；
   - 若端口被占用，自动递增寻找可用端口，避免端口冲突。
5. **真实 SPA HTTP 健康检查就绪探针**：
   - DSH 启动后，通过轻量 HTTP GET 探针探测 `http://127.0.0.1:<port>/`，校验响应体中同时包含 `<title>DeepSeek Harness</title>` 与 `<div id="root"></div>`，确认服务真实就绪后向 UI 汇报健康状态，探针失败或超时（25s）则安全停止进程。
6. **安全的 localhost WebView2 窗口边界与独立窗口**：
   - 在主界面中以 `iframe` 安全沙箱承载原生 UI；
   - 提供 `dsh_open_window` Tauri 命令，可在原生 WebView2 独立窗口中加载 `http://127.0.0.1:<port>/`，严格限制 origin 范围。
7. **进程安全与资源回收**：
   - `DshServer` 实现 `Drop` 特征，在析构或服务停止时自动终结进程树，杜绝 Windows 孤儿进程。

## 后果与验证

- **优点**：完整保留 DSH 的强大生态（原生 Web 界面、插件化机制、独立会话与模式），同时赋予 Aster 桌面管理、版本隔离与一键启动能力。
- **验证方式**：
  - 单元与集成测试：`cargo test --manifest-path src-tauri/Cargo.toml`
  - 前端类型与构建：`npm run check` & `npm run build`
  - 门禁脚本：`npm run lint:nofake`
  - 真实端到端无头自检：`cargo run --manifest-path src-tauri/Cargo.toml -- --selftest-m2`
  - R2 操作证据报告：[`docs/evidence/r2_operation_evidence.md`](../evidence/r2_operation_evidence.md)（⚠️ 该报告的“真实承载兑现”结论已被 2026-08-18 人工审计推翻，仅作历史记录）
  
  ## 2026-08-18 更正
  
  **被推翻的部分**：真实 UI 审计发现嵌入与独立窗口均为空白。根因：决策 3 的自拼 `server.mjs` runner 只静态加载 `dsh-web-app`，官方前端 shell（`dsh-client-web` 的 `AppWebEntry.run()`）必须解析服务端注入的 `window.__DSH_BOOT__` boot manifest，缺失即启动失败；决策 5 的“title + #root 静态标记”探针无法区分这种形态，把空白页误判为健康。
  
  **替换决策**：
  
  1. managed/外部安装均以官方 CLI 包 `@deepseek-ai/dsh`（入口 `lib/bin.js`）为完整宿主判据；仅含 `dsh-web-app` 的旧布局不得识别为完整宿主（由 m2_flow 失败测试锁定）。
  2. 启动改为官方 CLI：`node bin.js web --host 127.0.0.1 --port <动态端口> --trusted-host <host:port>`（`web` 是 `--profile web` 的别名）；`DSH_HOME` 指向 Aster 管理的 `dsh-home/`（profile 缺失时 CLI 自愈创建），`DSH_TELEMETRY_DISABLED=1` 关闭遥测；cwd 为当前工作区（`dsh-fs-local` 的 cwd 默认取 `process.cwd()`）。旧 runner 的 `PORT`/`HOST`/`DSH_WORKSPACE`/`DSH_CONFIG_DIR` 在官方包中无消费者，已删除。以上行为经 `@deepseek-ai/dsh@0.1.0-rc.6` 探测安装实证。
  3. 健康探针分三层暴露：进程存活 / 静态页面可达 / boot manifest 已注入；`healthy` 要求三层全部通过。boot_ok 仍不等于“真实渲染可交互”，后者只能由真实 UI 验收给出（R2 合同第 2–4 条）。
  4. 停止路径在 `taskkill /T /F` 后等待子进程回收（超时 5s 如实报错）；主窗口关闭时先关闭其余窗口，应用退出钩子里兜底停止 DSH/Pi 进程树，修复“停止卡住”与“退出残留”。
  
  **仍然有效**：决策 1（独立连接器）、2（并排安装与锁定版本 `0.1.0-rc.6`）、4（动态端口）、6（WebView 边界）。
