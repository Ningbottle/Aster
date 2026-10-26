# Aster

后端直接复用 [ThinkRail](https://github.com/JetBrains/thinkrail) 的服务端与契约，前端独立研究 Claude Code Desktop 的界面和交互。

```text
src/
├─ host/       启动 ThinkRail Bun 宿主
├─ main/       桌面窗口，不管理会话或数据库
└─ renderer/   Aster 自己的前端，通过 ThinkRail 契约通信
vendor/thinkrail/
├─ packages/   上游 server、contracts 及其依赖
├─ pi-extensions/
└─ thinkrail-extensions/
```

Pi SDK 在 Bun 宿主进程内运行；会话、命名、历史与 Skills 使用 ThinkRail/Pi 的实现，不再维护独立 SQLite 或手写 Pi JSONL RPC。桌面窗口壳与业务宿主分开，前端也可在浏览器中访问同一个本地宿主。

## 运行

- `npm ci`：安装前端工具和项目内 Bun，再按锁文件安装上游宿主依赖。
- `npm run dev:desktop`：编译并启动桌面窗口与本地宿主。
- `npm run build:desktop`：编译窗口壳和前端，不生成安装包。
- `npm run dev:host`：仅启动 Bun 宿主，控制台输出实际本地端口；先编译前端。
- `npm run check:desktop`：前端与窗口类型检查。
- `npm run test:desktop`：前端契约与渲染测试。
- `npm run test:host`：隔离目录中的真实宿主/Pi 验证。
- `npm run test:ui`：真实桌面 UI 验证，需已有 Playwright，可用 `ASTER_PLAYWRIGHT_MODULE` 指定。

默认宿主数据目录为 `~/.aster`，可通过 `THINKRAIL_DATA_DIR` 指定；Pi 使用自己的配置和原生会话目录。旧个人数据库与会话不读取、不迁移、不删除。

## 来源与差异

上游固定提交为 `8fc50b802a8800e104373b927e63bcedb3b6f8fb`，Bun `1.4.4`、Pi SDK `1.2.0`，来源记录在 `vendor/thinkrail/upstream.json`。保留 Apache-2.0 许可证；未复制上游 Web 应用和架构规约。

Aster 新会话首页的用量卡通过只读 `usage.getSummary` 补丁汇总已注册工作区的 Pi 原生记录；保留分叉去重、日期范围和不完整读数提示，不另存聊天历史。补丁清单见同一来源记录。

本地宿主只监听 `127.0.0.1`，拒绝异源请求；不提供上游遥测项目 Key。业务处理器沿用上游。接口存在不等于 Aster 前端已经完整呈现上游所有功能，测试也不代表发行安装包已验收。

前端包含 open-claude-ui 的 MIT 组件适配，许可证保留在 `src/renderer/cds/LICENSE`；官方静态资料与第三方参考的来源分开记录。开发边界见 [AGENTS.md](AGENTS.md)。
