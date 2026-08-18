# ADR-0003: M2 DeepSeek Harness（DSH）原生 Web 承载与独立连接器

## 状态

已接受（2026-08-16）

## 背景与上下文

在 Aster M2 里程碑中，我们需要将 DeepSeek Harness（DSH）作为第二宿主引入桌面工作台。
根据 [`content.md`](../../content.md) §7 与 [`AGENTS.md`](../../AGENTS.md) 的约束：
- DSH 是独立、可高度插件化的宿主，具有独立的 provider registry、插件系统、自定义模式与会话持久化语义；
- Aster Alpha 优先承载其原生 Web UI，而不是将其与 Pi 抹平为假的一致对话模型；
- DSH 处于快速演进阶段（Developer Preview），深度协议仍在变动，必须通过版本门控与安全降级机制进行防护。

## 决策

1. **宿主隔离与独立连接器 (`dsh_connector.rs`)**：
   - DSH 拥有独立的 Rust 连接器实现，不与 Pi 共享任何 RPC 类型、状态机或 UI 流程；
   - 共享的仅是基础进程监管（`supervisor.rs`）、数据目录（`AppDataLayout`）和 Evidence 词汇。
2. **Aster-managed 并排安装与外部探测**：
   - 锁定首发验证版本为 `@deepseek-ai/dsh-web-app@0.1.0-rc.6`；
   - 支持通过 npm 前缀安装到 `%LOCALAPPDATA%\Aster\runtimes\dsh/<version>`；
   - 允许外部 npm 安装探测，并对非锁定版本标记为“未验证版本”进行安全降级。
3. **动态端口分配与冲突避让**：
   - 默认端口 `38472`，在启动前探测 localhost 端口可用性；
   - 若端口被占用，自动递增寻找可用端口，避免端口冲突。
4. **HTTP 健康检查就绪探针**：
   - DSH 启动后，通过轻量 HTTP GET 探针探测 `http://127.0.0.1:<port>/`，确认服务真实就绪后向 UI 汇报健康状态，探针失败或超时则安全停止进程。
5. **安全的 localhost WebView2 窗口边界**：
   - 在独立窗口中以 `http://127.0.0.1:<port>/` 为起点加载 DSH 原生 UI，严格限制 origin 范围，保留 DSH 原生插件与模式的所有能力。
6. **进程安全与资源回收**：
   - `DshServer` 实现 `Drop` 特征，在析构或服务停止时自动终结进程树，杜绝 Windows 孤儿进程。

## 后果与验证

- **优点**：完整保留 DSH 的强大生态（原生 Web 界面、插件化机制、独立会话与模式），同时赋予 Aster 桌面管理、版本隔离与一键启动能力。
- **验证方式**：
  - 单元与集成测试：`cargo test --manifest-path src-tauri/Cargo.toml`
  - 前端类型与构建：`npm run check` & `npm run build`
  - 真实端到端无头自检：`cargo run --manifest-path src-tauri/Cargo.toml -- --selftest-m2`
