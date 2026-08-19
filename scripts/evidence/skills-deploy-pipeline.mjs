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
  run(
    "Release process/AppData smoke check",
    "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/e2e-run-check.ps1",
  ),
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

const evidenceContent = `# R1 自动化验证记录

- 生成时间：${new Date().toISOString()}
- 证据类型：自动命令输出
- 不包含：真实 Tauri UI 操作、真实宿主加载、真实用户部署目录

> 本文件只能证明下列命令成功退出。进程/AppData 冒烟只证明 release 程序能启动并创建数据库，不证明扫描、Diff、部署、evidence 或回滚能从 UI 完成。

## 自动化结果

${logs}

## 能力状态

| 能力 | 本脚本能证明的范围 | 状态 |
|---|---|---|
| 无硬编码业务数据门禁 | 静态扫描规则未命中 | \`AUTOMATED_VERIFIED\` |
| 前端/Rust 契约与流程 | 固定 fixture 和临时文件系统测试通过 | \`AUTOMATED_VERIFIED\` |
| release 启动与数据库创建 | 隔离 AppData 冒烟通过 | \`AUTOMATED_VERIFIED\` |
| Skills 列表/详情 | 2026-08-18 晚间真实 UI 复审通过（七步验收第 1–2 步） | \`MANUAL_VERIFIED\` |
| Diff | 2026-08-18 晚间真实 UI 复审通过（七步验收第 3 步）；白天审计观察到的卡住已不可复现 | \`MANUAL_VERIFIED\` |
| 计划→部署→evidence→回滚 | 2026-08-18 晚间真实 UI 复审通过（七步验收第 4–7 步，隔离数据目录 + 测试部署作用域） | \`MANUAL_VERIFIED\` |

本脚本只生成本地临时自动化日志，不更新当前 M0–M7 状态；当前阶段以 README.md 为准。
`;

const targetPath = path.join(evidenceDir, "r1_operation_evidence.md");
fs.writeFileSync(targetPath, evidenceContent, "utf8");
console.log(`[OK] Automated evidence written to: ${targetPath}`);
