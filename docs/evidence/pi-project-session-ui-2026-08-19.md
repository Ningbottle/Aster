# Pi Project→Session Console UI Evidence

Date: 2026-08-19  
Host: Windows 11 x64, ordinary user  
Method: `npm run tauri dev` with WebView2 CDP (`scripts/cdp-ui.mjs`); no prompt text, session JSONL, credentials, env values, usernames, or raw absolute user paths recorded.

## Automated checks

| Command | Result |
|---|---|
| `npm run test:unit` | pass (4 tests) |
| `npm run check` | pass (0 errors; pre-existing a11y warnings in ProjectSelector / GithubAuthModal) |
| `npm run lint:nofake` | pass |
| `npm run build` | pass |
| `cargo test --manifest-path src-tauri/Cargo.toml` | pass (54 lib + 10 contracts + m0–m3 + 12 `pi_session_flow`) |

`clippy -D warnings` on the whole crate still reports pre-existing `dsh_connector.rs` doc-list lints in unrelated dirty work. Pi files touched for this plan were cleaned of clippy findings (`needless_ok`, identical `if` branches, needless `return`).

## Live UI (observed)

Started `npm run tauri dev` (Vite `localhost:1420`, `target\debug\aster.exe`). CDP target title `Aster`.

After clicking the title-bar **Pi** tab:

- Pi project tree rendered (`aria-label="Pi 项目与会话"`).
- Default sidebar width 280px.
- “打开项目” button present.
- No Pi-sidebar fake “发起新会话” row; no avatar footer.
- Empty workspace copy: “选择或创建一个 Pi 会话”.
- After catalog refresh: 11 project groups. Expanding 5 groups showed 50 session buttons, all using `未命名会话 · {timestamp}` (not first-prompt text).
- Opening one available session eventually showed workspace + header `Ready`. Header cwd ended with the project display name and was an absolute path. Permission disclosure: `Windows 用户权限（未沙箱化）`. Model `<select>` present (not “模型不可用”). Composer placeholder instructed Enter to send. Send disabled with empty draft.
- Restored conversation: 176 messages and 104 expandable tool `<details>` (no truncated `slice(0, 60)` UI).
- Idle switch to a sibling session in the same project: message count 176 → 203, state remained `Ready`, no busy dialog.
- Opening a session in another project: project display name changed; cwd still ended with the new project name; message count 203 → 153; state `Ready`.
- Ctrl+B hid the Pi sidebar (width 0) while the global Pi module tab remained; second Ctrl+B restored width 280.

Local Aster SQLite after this run: `PRAGMA user_version = 5`; table `pi_session_index` present with metadata columns only (no conversation/prompt/tool_output); 64 index rows.

## Failed / partial observations

- Header rename via DOM input did not persist. A subsequent `pi_session_set_name` invoke timed out; UI kept “未命名会话” and showed a visible backend timeout error (no credentials in the message).
- No harmless prompt was sent, so streaming, cancel, and busy-switch dialogs were not exercised.
- Sidebar resize at 1100×700 / 1440×900 / 200% scaling was not measured.
- Keyboard-only path beyond Ctrl+B was not completed.
- Restart-Aster resume, missing-file “缺失” row, and model/thinking persistence across restart were not re-run after this session.

## `e2e-run-check.ps1`

Not proven for this build. Existing `src-tauri/target/release/aster.exe` is an older binary (release not rebuilt in this task). Invoking the script against `target\debug\aster.exe` showed the process running but no isolated DB file within the script’s 8s window; check failed. No claim that the new binary migrates 0005 under the smoke script.

No orphan `node … pi-coding-agent … --mode rpc` processes were listed after stopping the leftover `aster.exe` from `tauri dev`.

## Acceptance matrix

| # | Case | Result |
|---|---|---|
| 1 | Open project, session header cwd matches project | pass |
| 2 | Harmless prompt | unverified |
| 3 | Restart Aster, restore messages | unverified (restore via `get_messages` was observed in-session: 176 then 203 then 153 messages) |
| 4 | Create A2 / idle A1↔A2 | partial (idle switch between two existing native sessions passed; “+” create not driven) |
| 5 | Busy switch blocked | unverified |
| 6 | Cross-project restart, header cwd is B | pass (project name + cwd suffix changed) |
| 7 | Switch back to A1 | unverified |
| 8 | Rename survives restart | fail/unverified (rename timed out; previous title remained) |
| 9 | Model/thinking from `get_state` after resume | partial (model select present after open; restart not done) |
| 10 | Missing session file shows Missing | unverified |
| 11 | Collapse/hide/resize/restore at listed sizes | partial (Ctrl+B + 280px default observed) |
| 12 | Keyboard-only core flow | partial (Ctrl+B only) |

Do not treat this Pi console as complete: automated checks pass, several UI matrix rows remain unverified or failed.
