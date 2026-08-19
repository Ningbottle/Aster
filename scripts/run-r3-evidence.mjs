import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const evidenceDir = path.resolve(rootDir, ".tmp/evidence");
fs.mkdirSync(evidenceDir, { recursive: true });

let markdown = `# R3 自动化验证记录

- 生成时间：${new Date().toISOString()}
- 证据类型：静态门禁、fixture、契约测试、构建
- 不包含：真实 GitHub 网络、真实 Device Flow、Windows Credential Manager 写入、真实隔离删除

> UI 元素或 command 存在不代表外部链路成功。

## 自动化结果

`;

function run(title, command) {
  console.log(`===> ${title}`);
  try {
    const output = execSync(command, { cwd: rootDir, encoding: "utf8" });
    markdown += `### ${title}

- Command: \`${command}\`
- Result: \`AUTOMATED_VERIFIED\` (exit code 0)

\`\`\`text
${output.trim()}
\`\`\`

`;
  } catch (error) {
    const stdout = error.stdout?.toString() ?? "";
    const stderr = error.stderr?.toString() ?? "";
    console.error(stdout);
    console.error(stderr);
    throw error;
  }
}

run("CI gate selftest", "node scripts/ci-no-fake-data.mjs --selftest");
run("CI no-fake-data scan", "node scripts/ci-no-fake-data.mjs");
run("Frontend/Rust contract fixture generation", "node scripts/generate-contract-fixtures.mjs");
run("Rust unit, contract and flow tests", "cargo test --manifest-path src-tauri/Cargo.toml");
run("Svelte/TypeScript check", "npm run check");
run("Frontend production build", "npm run build");

markdown += `## 工作包状态

| 工作包 | 自动化能证明的范围 | 仍需的真实验证 | 状态 |
|---|---|---|---|
| 工作目录与最近项目 | 迁移 0004、DTO 和固定测试 | 空 AppData 选择目录、重启恢复、Pi/DSH 独立上下文 | \`MANUAL_PENDING\` |
| GitHub 公开仓库 | DTO、归档大小/路径边界与 fixture | 真实公开仓库网络扫描、commit/subpath/多 Skill | \`EXTERNAL_PENDING\` |
| 私有仓库凭据 | keyring 调用代码与常量测试 | 用户参与 Device Flow、Credential Manager 写入/清理 | \`EXTERNAL_PENDING\` |
| 安全隔离区 | 静态隔离与命令 fixture | UI 查看原因、取消删除、确认不可逆删除 | \`MANUAL_PENDING\` |

本脚本只生成本地临时自动化日志，不更新当前 M0–M7 状态；当前阶段以 README.md 为准。
`;

const targetPath = path.join(evidenceDir, "r3_operation_evidence.md");
fs.writeFileSync(targetPath, markdown, "utf8");
console.log(`[OK] Automated evidence written to: ${targetPath}`);
