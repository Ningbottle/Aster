# Complete or dismiss the rfd "pick folder" dialog used by project_pick_directory.
# Usage:
#   powershell -File complete-rfd.ps1 -Path <folder>
#   powershell -File complete-rfd.ps1 -Dismiss
param(
    [string]$Path = "",
    [switch]$Dismiss,
    [int]$TimeoutMs = 15000
)

$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class RfdWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Get-RfdHwnd {
    $script:found = [IntPtr]::Zero
    $cb = [RfdWin+EnumProc]{
        param($h, $l)
        if (-not [RfdWin]::IsWindowVisible($h)) { return $true }
        $sb = New-Object System.Text.StringBuilder 512
        [void][RfdWin]::GetWindowText($h, $sb, $sb.Capacity)
        $t = $sb.ToString()
        if ([string]::IsNullOrEmpty($t)) { return $true }
        if ($t -eq "Aster") { return $true }
        if ($t -like "*Aster*" -or $t -like "*项目根目录*" -or $t -like "*工作目录*") {
            $script:found = $h
            return $false
        }
        return $true
    }
    [void][RfdWin]::EnumWindows($cb, [IntPtr]::Zero)
    return $script:found
}

$deadline = [datetime]::UtcNow.AddMilliseconds($TimeoutMs)
$hwnd = [IntPtr]::Zero
while ([datetime]::UtcNow -lt $deadline) {
    $hwnd = Get-RfdHwnd
    if ($hwnd -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 200
}
if ($hwnd -eq [IntPtr]::Zero) {
    Write-Output "NO_DIALOG"
    exit 2
}

[void][RfdWin]::ShowWindow($hwnd, 9)
[void][RfdWin]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 150

$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if ($null -eq $root) {
    Write-Output "NO_UIA"
    exit 4
}

if ($Dismiss) {
    $root.SetFocus()
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
    Write-Output "DISMISSED"
    exit 0
}

if (-not $Path) {
    Write-Output "NO_PATH"
    exit 3
}

$treeScope = [System.Windows.Automation.TreeScope]::Descendants
$editCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit
)
$btnCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
)
$comboCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::ComboBox
)

$edits = $root.FindAll($treeScope, $editCond)
$combos = $root.FindAll($treeScope, $comboCond)
$btns = $root.FindAll($treeScope, $btnCond)
$editNames = @()
for ($i = 0; $i -lt $edits.Count; $i++) {
    $editNames += ("edit[{0}]={1}" -f $i, $edits.Item($i).Current.Name)
}
$btnNames = @()
for ($i = 0; $i -lt $btns.Count; $i++) {
    $btnNames += ("btn[{0}]={1}" -f $i, $btns.Item($i).Current.Name)
}

$set = $false
$targets = New-Object System.Collections.Generic.List[System.Windows.Automation.AutomationElement]
for ($i = 0; $i -lt $edits.Count; $i++) { [void]$targets.Add($edits.Item($i)) }
for ($i = 0; $i -lt $combos.Count; $i++) { [void]$targets.Add($combos.Item($i)) }

foreach ($el in $targets) {
    try {
        $pat = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($null -ne $pat) {
            $pat.SetValue($Path)
            $set = $true
        }
    } catch {}
}

$clicked = $false
$want = @("选择文件夹", "Select Folder", "选择目录", "确定", "OK")
for ($i = 0; $i -lt $btns.Count; $i++) {
    $name = [string]$btns.Item($i).Current.Name
    if ($want -contains $name) {
        try {
            $inv = $btns.Item($i).GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            $inv.Invoke()
            $clicked = $true
            break
        } catch {}
    }
}

if (-not $clicked -and $btns.Count -gt 0) {
    # Common layout: primary confirm is the first enabled button that is not Cancel/取消.
    for ($i = 0; $i -lt $btns.Count; $i++) {
        $name = [string]$btns.Item($i).Current.Name
        if ($name -eq "取消" -or $name -eq "Cancel" -or $name -eq "关闭") { continue }
        try {
            $inv = $btns.Item($i).GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            $inv.Invoke()
            $clicked = $true
            $want = @("fallback:$name")
            break
        } catch {}
    }
}

Write-Output ("UIA set={0} clicked={1} edits={2} btns={3}" -f $set, $clicked, ($editNames -join ","), ($btnNames -join ","))
if ($set -and $clicked) { exit 0 } else { exit 5 }
