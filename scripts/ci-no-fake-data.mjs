import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const srcDir = path.resolve(rootDir, "src");
const tauriSrcDir = path.resolve(rootDir, "src-tauri/src");

let failures = 0;

function getAllFiles(dir, exts) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(filePath, exts));
    } else {
      if (exts.some((ext) => filePath.endsWith(ext))) {
        results.push(filePath);
      }
    }
  }
  return results;
}

const frontendFiles = getAllFiles(srcDir, [".svelte", ".ts", ".js"]);
const backendFiles = getAllFiles(tauriSrcDir, [".rs"]);

console.log(`[CI Gate] Scanning ${frontendFiles.length} frontend files and ${backendFiles.length} backend files for fake data, constant true hacks, and empty catch blocks...`);

// 1. Fake data literal patterns across frontend & backend
const fakeDataPatterns = [
  "INITIAL_SKILLS",
  "defaultDeployments",
  "defaultEvidence",
  "M4 更新与恢复中心规划",
  "Skills 快照 Diff 排查",
  "vec![\"Pi\".into(), \"DSH\".into(), \"Antigravity\".into(), \"Cursor\".into()]",
  "2 个作用域，已检测 4 个 skills",
  "00756142ab04-${",
];

for (const pattern of fakeDataPatterns) {
  for (const file of [...frontendFiles, ...backendFiles]) {
    const content = fs.readFileSync(file, "utf8");
    if (content.includes(pattern)) {
      console.error(`[FAIL] Hardcoded fake data pattern found: '${pattern}' in ${path.relative(rootDir, file)}`);
      failures++;
    }
  }
}

// 2. Constant true hacks in frontend (|| true) — regex without 'g' flag to avoid stateful lastIndex leaks
const trueHackRegex = /\|\|\s*true\b/;
for (const file of frontendFiles) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    if (line.includes("// nofake:allow")) return;
    if (trueHackRegex.test(line)) {
      console.error(`[FAIL] Constant true hack (|| true) found in ${path.relative(rootDir, file)}:${idx + 1} -> ${line.trim()}`);
      failures++;
    }
  });
}

// 3. Empty catch blocks (swallowed errors) — regex without 'g' flag
const emptyCatchRegex = /catch\s*(\([a-zA-Z0-9_]*\))?\s*\{\s*\}/;
for (const file of frontendFiles) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    if (line.includes("// nofake:allow")) return;
    if (emptyCatchRegex.test(line)) {
      console.error(`[FAIL] Empty catch block (swallowed error) found in ${path.relative(rootDir, file)}:${idx + 1} -> ${line.trim()}`);
      failures++;
    }
  });
}

if (failures === 0) {
  console.log(`[OK] CI Gate Passed: Zero fake data patterns, zero constant true hacks, zero empty catch blocks across ${frontendFiles.length + backendFiles.length} files.`);
  process.exit(0);
} else {
  console.error(`[ERROR] CI Gate Failed with ${failures} violation(s).`);
  process.exit(1);
}
