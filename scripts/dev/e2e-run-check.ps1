# 开发冒烟检查：用隔离数据目录隐藏启动 release 版 Aster，确认指定进程存活、
# 数据库被创建，然后只终止本脚本启动的进程树。它不验证真实 UI 或业务链路。
param(
    [string]$AsterExe = "$PSScriptRoot\..\..\src-tauri\target\release\aster.exe",
    [string]$DataDir = (Join-Path $env:TEMP ("aster-e2e-check-{0}-{1}" -f $PID, [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()))
)

$ErrorActionPreference = "Stop"
$resolvedExe = (Resolve-Path -LiteralPath $AsterExe).Path
$env:ASTER_APP_DATA_DIR = $DataDir
$asterProcess = $null
$wasRunning = $false
$databaseCreated = $false

try {
    $asterProcess = Start-Process -FilePath $resolvedExe -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 8

    $running = Get-Process -Id $asterProcess.Id -ErrorAction SilentlyContinue
    $wasRunning = $null -ne $running
    $databasePath = Join-Path $DataDir "database\aster.db"
    $databaseCreated = Test-Path -LiteralPath $databasePath

    if ($wasRunning) {
        "PROCESS RUNNING: PID $($asterProcess.Id)"
    } else {
        "PROCESS EXITED BEFORE CHECK: PID $($asterProcess.Id)"
    }

    if ($databaseCreated) {
        "DB CREATED: $databasePath"
    } else {
        "DB NOT CREATED: $databasePath"
    }
}
finally {
    if ($null -ne $asterProcess -and (Get-Process -Id $asterProcess.Id -ErrorAction SilentlyContinue)) {
        taskkill /PID $asterProcess.Id /T /F | Out-Null
        "PROCESS TREE TERMINATED: PID $($asterProcess.Id)"
    }
}

if (-not $wasRunning -or -not $databaseCreated) {
    throw "Aster release smoke check failed. Data retained at: $DataDir"
}
