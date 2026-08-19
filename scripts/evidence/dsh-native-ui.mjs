import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "../..");
const evidenceDir = path.resolve(rootDir, ".tmp/evidence");
fs.mkdirSync(evidenceDir, { recursive: true });

function run(title, command) {
  console.log(`===> ${title}`);
  const output = execSync(command, { cwd: rootDir, encoding: "utf8" });
  return { title, command, output: output.trim() };
}

const results = [
  run("CI no-fake-data gate", "node scripts/ci/no-fake-data.mjs"),
  run("Svelte/TypeScript check", "npm run check"),
  run("Frontend production build", "npm run build"),
  run("Rust unit, contract and flow tests", "cargo test --manifest-path src-tauri/Cargo.toml"),
  run("DSH discovery tests", "cargo test --manifest-path src-tauri/Cargo.toml --test dsh_discovery"),
];

const logs = results
  .map(
    ({ title, command, output }) => `### ${title}

- Command: \`${command}\`
- Result: \`AUTOMATED_VERIFIED\` (exit code 0)

\`\`\`text
${output}
\`\`\``,
  )
  .join("\n\n");

const evidenceContent = `# R2 自动化验证记录

- 生成时间：${new Date().toISOString()}
- 证据类型：自动命令与 DSH 发现测试输出
- 不包含：WebView2 中的真实渲染、插件/模式操作、真实窗口停止和退出清理

> DSH 发现测试证明 runner、端口和后端探针路径可以在测试条件下运行。它不能证明浏览器执行了 SPA JavaScript，也不能证明 DSH UI 可操作。

## 自动化结果

${logs}

## 能力状态

| 能力 | 本脚本能证明的范围 | 状态 |
|---|---|---|
| runner/端口/后端健康路径 | 固定 dsh_discovery 测试成功 | \`AUTOMATED_VERIFIED\` |
| 嵌入 DSH UI 渲染 | 2026-08-18 晚间复审通过（boot manifest 注入、DOM 有渲染子节点） | \`MANUAL_VERIFIED\` |
| 独立 DSH 窗口 | 2026-08-18 晚间复审通过（独立窗口完整渲染 DSH 原生 UI） | \`MANUAL_VERIFIED\` |
| 插件与自定义模式 | 2026-08-18 晚间复审通过（设置面板插件页三个内置插件入口可操作） | \`MANUAL_VERIFIED\` |
| 停止与 Aster 退出清理 | 2026-08-18 晚间复审通过（UI/端口/进程收敛，两种退出路径无残留） | \`MANUAL_VERIFIED\` |

本脚本只生成本地临时自动化日志，不更新当前 M0–M7 状态；当前阶段以 README.md 为准。
`;

const targetPath = path.join(evidenceDir, "r2_operation_evidence.md");
fs.writeFileSync(targetPath, evidenceContent, "utf8");
console.log(`[OK] Automated evidence written to: ${targetPath}`);
