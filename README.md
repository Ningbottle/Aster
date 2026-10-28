# Aster

面向 Windows 的本地 Pi agent：以用户确认的 Claude Code Desktop 页面为视觉与交互目标，使用 Aster 品牌，并保留自己的模型选择器、按模型能力呈现的思考程度选择器及首页 token 用量图。整体视觉对齐仍在进行。

后端直接复用 [ThinkRail](https://github.com/JetBrains/thinkrail) 的服务端与契约，Pi SDK 在 Bun 宿主进程内运行。

```text
src/
├─ host/       启动 ThinkRail Bun 宿主
├─ main/       Electron 窗口、宿主监管和原生动作/界面偏好 IPC
├─ preload/    窄白名单 bridge
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
- `npm run check:desktop`：前端与窗口类型检查，包含未使用局部代码和参数检查。
- `npm run test:desktop`：前端契约与渲染测试。
- `npm run test:host`：隔离目录中的真实宿主/Pi 验证。
- `npm run test:ui`：真实桌面 UI 验证，需已有 Playwright，可用 `ASTER_PLAYWRIGHT_MODULE` 指定。
- `npm run test:ui:round3`：导航、时间线、卡片、预览、模型选择与重启偏好的定向 Electron 验证，同样支持 `ASTER_PLAYWRIGHT_MODULE`。
- `npm run lint:nofake`：有限模式的静态扫描，不能替代行为与真实数据验证。

默认宿主数据目录为 `~/.aster`，可通过 `THINKRAIL_DATA_DIR` 指定；Pi 使用自己的配置和原生会话目录。旧个人数据库与会话不读取、不迁移、不删除。

## 来源与差异

上游固定提交为 `8fc50b802a8800e104373b927e63bcedb3b6f8fb`，Bun `1.4.4`、Pi SDK `1.2.0`，来源记录在 `vendor/thinkrail/upstream.json`。保留 Apache-2.0 许可证；未复制上游 Web 应用和架构规约。

Aster 新会话首页的用量卡通过只读 `usage.getSummary` 补丁汇总已注册工作区的 Pi 原生记录；保留分叉去重、日期范围和不完整读数提示，不另存聊天历史。补丁清单见同一来源记录。

New 直接创建会话；模型菜单读取真实列表，思考程度只呈现模型支持的档位，以 Pi 返回的有效值为准，不写死五档。新会话前可选模型；模型通过宿主现有设置保存为默认值，滑杆不覆盖用户的全局默认思考程度。Chat / Code 是同一 Pi 会话的两种呈现，切换不创建、分叉、取消会话或改变权限；Code 提供终端与信息卡。

导航可独立调宽；Environment/Context/Outputs 保持固定宽度，文件预览另有独立分栏与多页签。导航宽度、上次会话、Chat/Code、导航折叠与预览比例通过窄 IPC 保存至 Electron `userData/ui-preferences.json`；宿主随机端口下的 localStorage 仅作本次运行的镜像。

消息的时间与复制动作是回合级、默认不可见的，只在悬停或键盘聚焦时出现；只运行工具、没有正文的回合不渲染 meta。界面文字使用随包 Inter，代码使用随包 Cascadia Mono，中文使用显式系统 CJK 链，不依赖本机偶然安装的专有字体；Markdown 使用 `remark-cjk-friendly` 解析 CJK 标点邻接的强调，代码块由 PrismJS 按语言着色，令牌以 React 文本节点渲染。代码块、命令、diff 与工具结果都有复制入口，剪贴板失败时显示可见错误而不是假装成功。当前界面仅提供浅色主题；首页保留 token 用量图。

本地宿主只监听 `127.0.0.1`，拒绝异源请求；不提供上游遥测项目 Key。业务处理器沿用上游。接口存在不等于 Aster 前端已经完整呈现上游所有功能，测试也不代表发行安装包已验收。

前端包含 open-claude-ui 的 MIT 组件适配，许可证保留在 `src/renderer/cds/LICENSE`；官方静态资料与第三方参考的来源分开记录。开发边界见 [AGENTS.md](AGENTS.md)。
