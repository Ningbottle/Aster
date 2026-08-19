# 临时运行期稳定性取证脚本（Runtime Stability 专项审计，2026-08-19）。
#
# 用途：在「Aster 卡住 / 关不掉 / 疑似残留」的现场跑一次，抓取无法事后重建的
# 瞬时状态。与 src-tauri/src/diag.rs 配套：diag.jsonl 说明 Rust 侧走到哪一步，
# 本脚本说明操作系统侧当时是什么样子。
#
# 审计结束后与 diag.rs 一并删除，不要在其上扩展成常驻监控。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/capture-runtime-state.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/capture-runtime-state.ps1 -Label "场景3-streaming中关闭"
#
# 只读：不结束任何进程，不写入仓库以外目录（除报告文件）。

[CmdletBinding()]
param(
    [string]$Label = "unlabeled",
    [string]$AppDataRoot,
    [string]$OutDir
)

# 数据根目录必须与 Rust 侧 AppDataLayout::default_root() 同一套解析规则，
# 否则用 ASTER_APP_DATA_DIR 跑隔离目录时会去错的位置找 diag.jsonl 并误报“不存在”。
if (-not $AppDataRoot) {
    if ($env:ASTER_APP_DATA_DIR) { $AppDataRoot = $env:ASTER_APP_DATA_DIR }
    else { $AppDataRoot = Join-Path $env:LOCALAPPDATA 'Aster' }
}
if (-not $OutDir) { $OutDir = Join-Path $AppDataRoot 'logs\capture' }

$ErrorActionPreference = 'Continue'
# PowerShell 5.1 的 Add-Content 默认写 ANSI 代码页，中文标题会随机器区域设置
# 变成乱码。统一强制 UTF-8，报告才能跨机器、跨编辑器阅读。
$PSDefaultParameterValues['Add-Content:Encoding'] = 'UTF8'
$PSDefaultParameterValues['Out-File:Encoding'] = 'UTF8'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$report = Join-Path $OutDir "capture-$stamp.txt"

function Section($title) {
    $line = "=" * 78
    Add-Content -Path $report -Value "`n$line`n$title`n$line"
}

Add-Content -Path $report -Value "Aster runtime capture"
Add-Content -Path $report -Value "label : $Label"
Add-Content -Path $report -Value "taken : $(Get-Date -Format 'o')"

# ---------------------------------------------------------------- Aster 进程
Section "1. aster.exe"
$aster = @(Get-CimInstance Win32_Process -Filter "Name='aster.exe'")
if ($aster.Count -eq 0) {
    Add-Content -Path $report -Value "aster.exe NOT RUNNING"
} else {
    $aster | Select-Object ProcessId, ParentProcessId, CreationDate, WorkingSetSize, ThreadCount |
        Format-Table -AutoSize | Out-String -Width 200 | Add-Content -Path $report
}

# ------------------------------------------------- 线程等待状态（卡在等什么）
# ThreadState 5 = Wait。WaitReason 关键值：
#   0  Executive      内核对象（互斥体/管道/进程句柄）——「在等某个东西」
#   4  DelayExecution Sleep()——轮询循环
#   6  UserRequest    通用用户态等待
#   13 WrUserRequest  GetMessage 等消息（UI 线程空闲的正常形态）
#   37 WrQueue        线程池等任务队列（tokio/Windows 线程池空闲）
# 判读要点：健康的主线程应停在 13。若主线程停在 0 或 4，说明它正阻塞在
# 内核对象或 Sleep 上——那正是消息泵停摆、最小化/关闭失效的时刻。
Section "2. aster.exe 线程等待状态（主线程停在 0/4 = 消息泵被占）"
$reasonMap = @{
    0='Executive'; 1='FreePage'; 2='PageIn'; 3='PoolAllocation'; 4='DelayExecution';
    5='Suspended'; 6='UserRequest'; 7='EventPairHigh'; 8='EventPairLow'; 9='LpcReceive';
    10='LpcReply'; 11='VirtualMemory'; 12='PageOut'; 13='WrUserRequest'; 37='WrQueue'
}
foreach ($proc in $aster) {
    Add-Content -Path $report -Value "-- PID $($proc.ProcessId) --"
    $threads = @(Get-CimInstance Win32_Thread -Filter "ProcessHandle='$($proc.ProcessId)'")
    # StartAddress 无法区分主线程；按 ThreadId 升序，最早创建的通常是主线程。
    $threads | Sort-Object ThreadId | ForEach-Object {
        $r = $_.ThreadWaitReason
        $name = $reasonMap[[int]$r]
        if (-not $name) { $name = "reason$r" }
        "  tid={0,-8} state={1,-3} wait={2,-4} ({3})  kernel={4} user={5}" -f `
            $_.ThreadId, $_.ThreadState, $r, $name, $_.KernelModeTime, $_.UserModeTime
    } | Add-Content -Path $report
    $threads | Group-Object ThreadState, ThreadWaitReason |
        Select-Object Count, Name | Format-Table -AutoSize |
        Out-String -Width 200 | Add-Content -Path $report
}

# ------------------------------------------------------------------- 进程树
Section "3. 完整进程树（Aster 及其后代）"
$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine, CreationDate)
$byParent = @{}
foreach ($p in $all) {
    if (-not $byParent.ContainsKey([int]$p.ParentProcessId)) { $byParent[[int]$p.ParentProcessId] = @() }
    $byParent[[int]$p.ParentProcessId] += $p
}
function Emit-Tree($pid_, $depth) {
    if ($depth -gt 6) { return }
    foreach ($child in $byParent[[int]$pid_]) {
        $cl = ""
        if ($child.CommandLine) { $cl = $child.CommandLine.Substring(0, [Math]::Min(140, $child.CommandLine.Length)) }
        Add-Content -Path $report -Value ("{0}+- {1} ({2})  {3}" -f ("   " * $depth), $child.Name, $child.ProcessId, $cl)
        Emit-Tree $child.ProcessId ($depth + 1)
    }
}
foreach ($proc in $aster) {
    Add-Content -Path $report -Value "aster.exe ($($proc.ProcessId))"
    Emit-Tree $proc.ProcessId 1
}

# --------------------------------------------------------- 孤儿宿主进程检测
Section "4. 孤儿宿主进程（Pi / DSH，父进程已消失）"
$livePids = @{}
foreach ($p in $all) { $livePids[[int]$p.ProcessId] = $true }
$hostProcs = @($all | Where-Object {
    $_.CommandLine -and ($_.CommandLine -match 'pi-coding-agent' -or $_.CommandLine -match '@deepseek-ai\\dsh' -or $_.CommandLine -match 'Local\\Aster\\runtimes')
})
if ($hostProcs.Count -eq 0) {
    Add-Content -Path $report -Value "没有发现 Pi/DSH 宿主进程"
} else {
    foreach ($h in $hostProcs) {
        $parentAlive = $livePids.ContainsKey([int]$h.ParentProcessId)
        $verdict = "parent-alive"
        if (-not $parentAlive) { $verdict = "*** ORPHAN ***" }
        Add-Content -Path $report -Value ("{0}  pid={1} ppid={2} created={3}" -f $verdict, $h.ProcessId, $h.ParentProcessId, $h.CreationDate)
        Add-Content -Path $report -Value ("    {0}" -f $h.CommandLine)
    }
}

# ------------------------------------------------------------------- 端口
Section "5. 宿主进程持有的监听端口（端口泄漏证据）"
$hostPids = @($hostProcs | ForEach-Object { [int]$_.ProcessId })
$conns = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $hostPids -contains [int]$_.OwningProcess -or $_.LocalPort -ge 38472 -and $_.LocalPort -le 38572 })
if ($conns.Count -eq 0) {
    Add-Content -Path $report -Value "DSH 端口段 (38472-38572) 无监听，宿主进程也无监听端口"
} else {
    $conns | Select-Object LocalAddress, LocalPort, State, OwningProcess |
        Sort-Object LocalPort | Format-Table -AutoSize | Out-String -Width 200 | Add-Content -Path $report
}

# ----------------------------------------------- diag.jsonl：停在哪一步
# 这是本次审计要回答的核心问题。做法：顺序扫描 begin/end，凡有 begin 而无
# 配对 end 的 Span，就是当前仍未返回的操作——挂起点。
Section "6. diag.jsonl 未闭合 Span（= 程序当前停在这一步）"
$diag = Join-Path $AppDataRoot 'logs\diag.jsonl'
if (-not (Test-Path $diag)) {
    Add-Content -Path $report -Value "diag.jsonl 不存在。确认已用带 diag 的构建运行（debug 默认开启，release 需 ASTER_DIAG=1）。"
} else {
    Add-Content -Path $report -Value "source: $diag ($((Get-Item $diag).Length) bytes)"
    $open = New-Object System.Collections.ArrayList
    $lastKinds = New-Object System.Collections.ArrayList
    Get-Content $diag | ForEach-Object {
        $o = $null
        try { $o = $_ | ConvertFrom-Json } catch { return }
        if (-not $o) { return }
        if ($o.detail.at -eq 'begin') {
            [void]$open.Add($o)
        } elseif ($o.detail.at -eq 'end') {
            for ($i = $open.Count - 1; $i -ge 0; $i--) {
                if ($open[$i].kind -eq $o.kind -and $open[$i].detail.name -eq $o.detail.name) {
                    $open.RemoveAt($i); break
                }
            }
        }
        [void]$lastKinds.Add($o)
        if ($lastKinds.Count -gt 40) { $lastKinds.RemoveAt(0) }
    }
    if ($open.Count -eq 0) {
        Add-Content -Path $report -Value "没有未闭合 Span —— Rust 侧没有正在进行的阻塞操作。"
        Add-Content -Path $report -Value "若此时 UI 仍无响应，说明阻塞不在被插桩的路径上（例如在 WebView2 或前端侧）。"
    } else {
        Add-Content -Path $report -Value ">>> 以下操作已开始但从未返回，按开始顺序："
        foreach ($o in $open) {
            Add-Content -Path $report -Value ("  [{0}] kind={1} name={2} on_main={3} thread={4}" -f `
                $o.ts, $o.kind, $o.detail.name, $o.on_main, $o.thread)
        }
        Add-Content -Path $report -Value ""
        Add-Content -Path $report -Value "判读：若其中有 on_main=True 的 ipc/rpc/taskkill 条目，"
        Add-Content -Path $report -Value "      即证明主线程消息泵正被该操作占用（最小化/关闭必然无响应）。"
    }
    Section "7. diag.jsonl 最后 40 条记录"
    $lastKinds | ForEach-Object {
        "[{0}] on_main={1,-5} {2,-14} {3}" -f $_.ts, $_.on_main, $_.kind, ($_.detail | ConvertTo-Json -Compress)
    } | Add-Content -Path $report

    Section "8. 主线程上最慢的 20 次操作（卡顿排行）"
    $slow = @()
    Get-Content $diag | ForEach-Object {
        $o = $null
        try { $o = $_ | ConvertFrom-Json } catch { return }
        if ($o -and $o.detail.at -eq 'end' -and $o.on_main -eq $true -and $o.detail.elapsed_ms) {
            $slow += $o
        }
    }
    if ($slow.Count -eq 0) {
        Add-Content -Path $report -Value "主线程上没有已完成的计时操作。"
    } else {
        $slow | Sort-Object { [int]$_.detail.elapsed_ms } -Descending | Select-Object -First 20 | ForEach-Object {
            "{0,8} ms  {1,-14} {2}  note={3}" -f $_.detail.elapsed_ms, $_.kind, $_.detail.name, $_.detail.note
        } | Add-Content -Path $report
    }
}

Write-Host ""
Write-Host "capture written to: $report"
Write-Host ""
# 现场即时可见的最关键一段，直接回显到终端。
if (Test-Path $report) {
    $text = Get-Content $report -Raw
    $idx = $text.IndexOf("6. diag.jsonl")
    if ($idx -ge 0) {
        $tailStart = $text.IndexOf("7. diag.jsonl", $idx)
        if ($tailStart -lt 0) { $tailStart = $text.Length }
        Write-Host $text.Substring($idx, $tailStart - $idx)
    }
}
