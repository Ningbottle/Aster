# Confirm Aster rfd folder picker owned by aster.exe.
# Folder edit=1152 and IDOK=1 are Win32 dlg items.
param(
    [Parameter(Mandatory = $true)]
    [string]$Folder,
    [int]$TimeoutMs = 20000
)

$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class RfdNative {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr hDlg, int id);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam);
  [DllImport("user32.dll")]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  public const uint WM_SETTEXT = 0x000C;
  public const uint WM_COMMAND = 0x0111;
  public const uint WM_CHAR = 0x0102;
  public const int VK_RETURN = 0x0D;
}
"@

function Get-AsterDialogHwnd {
    $aster = Get-Process aster -ErrorAction SilentlyContinue
    if (-not $aster) { return [IntPtr]::Zero }
    $script:asterPid = [uint32]$aster.Id
    $script:found = [IntPtr]::Zero
    $cb = [RfdNative+EnumProc]{
        param($h, $l)
        if (-not [RfdNative]::IsWindowVisible($h)) { return $true }
        $wpid = [uint32]0
        [void][RfdNative]::GetWindowThreadProcessId($h, [ref]$wpid)
        if ($wpid -ne $script:asterPid) { return $true }
        $sb = New-Object System.Text.StringBuilder 256
        [void][RfdNative]::GetClassName($h, $sb, $sb.Capacity)
        if ($sb.ToString() -eq "#32770") {
            $script:found = $h
            return $false
        }
        return $true
    }
    [void][RfdNative]::EnumWindows($cb, [IntPtr]::Zero)
    return $script:found
}

$deadline = [datetime]::UtcNow.AddMilliseconds($TimeoutMs)
$dh = [IntPtr]::Zero
while ([datetime]::UtcNow -lt $deadline) {
    $dh = Get-AsterDialogHwnd
    if ($dh -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 200
}
if ($dh -eq [IntPtr]::Zero) {
    Write-Output "NO_DIALOG"
    exit 2
}

$edit = [RfdNative]::GetDlgItem($dh, 1152)
$ok = [RfdNative]::GetDlgItem($dh, 1)
if ($edit -eq [IntPtr]::Zero -or $ok -eq [IntPtr]::Zero) {
    Write-Output ("MISSING_DLGITEM edit=" + $edit + " ok=" + $ok)
    exit 3
}

$unusedPid = [uint32]0
$dlgThread = [RfdNative]::GetWindowThreadProcessId($dh, [ref]$unusedPid)
$curThread = [RfdNative]::GetCurrentThreadId()
[void][RfdNative]::AttachThreadInput($curThread, $dlgThread, $true)
[void][RfdNative]::SetForegroundWindow($dh)
$n = [RfdNative]::SendMessage($edit, [RfdNative]::WM_SETTEXT, [IntPtr]::Zero, $Folder)
if ([int64]$n -eq 0) {
    [void][RfdNative]::AttachThreadInput($curThread, $dlgThread, $false)
    Write-Output "SETTEXT_FAIL"
    exit 4
}
Start-Sleep -Milliseconds 80
[void][RfdNative]::PostMessage($edit, [RfdNative]::WM_CHAR, [IntPtr][RfdNative]::VK_RETURN, [IntPtr]::Zero)
Start-Sleep -Milliseconds 700
[void][RfdNative]::SendMessage($dh, [RfdNative]::WM_COMMAND, [IntPtr]1, $ok)
Start-Sleep -Milliseconds 400
[void][RfdNative]::AttachThreadInput($curThread, $dlgThread, $false)
if ((Get-AsterDialogHwnd) -ne [IntPtr]::Zero) {
    Write-Output "STILL_OPEN"
    exit 5
}
Write-Output "CONFIRMED"
exit 0
