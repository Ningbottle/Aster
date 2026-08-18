# 开发冒烟检查：用隔离数据目录启动 release 版 Aster，确认进程存活、
# 数据库被创建，然后终止进程。用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e-run-check.ps1
param(
    [string]$AsterExe = "$PSScriptRoot\..\src-tauri\target\release\aster.exe",
    [string]$DataDir = "$env:TEMP\aster-e2e-check"
)
$env:ASTER_APP_DATA_DIR = $DataDir
Start-Process -FilePath $AsterExe
Start-Sleep -Seconds 8
$procs = Get-Process aster -ErrorAction SilentlyContinue
if ($procs) {
    "RUNNING: $($procs.Count) process(es)"
    $procs | ForEach-Object { taskkill /PID $_.Id /T /F | Out-Null }
    "KILLED"
} else {
    "NOT RUNNING"
}
if (Test-Path "$DataDir\database\aster.db") {
    "DB CREATED: $DataDir\database\aster.db"
} else {
    "NO DB in $DataDir"
    Get-ChildItem -Recurse $DataDir -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
}
