# R1 自动化证据生成器的 PowerShell 入口。
# 真实 Tauri UI 验收必须单独执行并记录，不能由本脚本推断。

$ErrorActionPreference = "Stop"
$generator = Join-Path $PSScriptRoot "skills-deploy-pipeline.mjs"

node $generator
if ($LASTEXITCODE -ne 0) {
    throw "R1 automated evidence generation failed with exit code $LASTEXITCODE"
}
