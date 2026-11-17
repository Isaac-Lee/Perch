use serde::Serialize;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

const EVENTS: [&str; 12] = [
    "on_session_open", "on_session_start", "pre_llm_call", "pre_tool_call", "post_tool_call",
    "on_human_input_request", "on_human_input_resolved", "on_session_end", "on_session_finalize",
    "on_session_delete", "subagent_start", "subagent_stop",
];
const BEGIN: &str = "# >>> perch";
const END: &str = "# <<< perch";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub home: String,
    pub exe: Option<String>,
    pub connected: bool,
    pub hook_path: String,
}

pub fn home_from(env_home: Option<String>, windows: bool, local_app: Option<String>, user_home: Option<String>) -> PathBuf {
    if let Some(h) = env_home.filter(|h| !h.is_empty()) {
        return h.into();
    }
    match (windows, local_app, user_home) {
        (true, Some(l), _) => PathBuf::from(l).join("hermes"),
        (_, _, Some(u)) => PathBuf::from(u).join(if windows { "AppData/Local/hermes" } else { ".hermes" }),
        _ => PathBuf::from(".hermes"),
    }
}

pub fn home() -> PathBuf {
    let e = |k: &str| std::env::var(k).ok();
    home_from(e("HERMES_HOME"), cfg!(windows), e("LOCALAPPDATA"), e("USERPROFILE").or_else(|| e("HOME")))
}

/// PATH's `hermes` first, then `<home>/bin/hermes`.
// ponytail: only the real executable is looked up (no .cmd/.bat shims, they cannot be spawned directly).
pub fn find_exe(home: &Path, path_var: Option<&OsStr>, windows: bool) -> Option<PathBuf> {
    let name = if windows { "hermes.exe" } else { "hermes" };
    let from_path = path_var.into_iter().flat_map(std::env::split_paths).map(|d| d.join(name));
    from_path.chain([home.join("bin").join(name)]).find(|p| p.is_file())
}

pub fn exe() -> Option<PathBuf> {
    find_exe(&home(), std::env::var_os("PATH").as_deref(), cfg!(windows))
}

pub fn hook_path() -> PathBuf {
    let dir = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)).unwrap_or_default();
    dir.join(if cfg!(windows) { "perch-hook.exe" } else { "perch-hook" })
}

pub fn status() -> Status {
    status_of(&home(), &hook_path(), exe().as_deref())
}

pub fn status_of(home: &Path, hook: &Path, exe: Option<&Path>) -> Status {
    let text = std::fs::read_to_string(home.join("config.yaml")).unwrap_or_default();
    Status {
        home: home.to_string_lossy().into_owned(),
        exe: exe.map(|e| e.to_string_lossy().into_owned()),
        connected: hook.is_file() && block_text(&text).is_some_and(|b| b.contains(&quoted(hook))),
        hook_path: hook.to_string_lossy().into_owned(),
    }
}

/// The command string Hermes sees after YAML decoding: `"<hook>" hermes`.
fn command(hook: &Path) -> String {
    format!("\"{}\" hermes", hook.display())
}

/// The command as written inside the YAML single-quoted scalar.
fn quoted(hook: &Path) -> String {
    command(hook).replace('\'', "''")
}

/// The marked block (markers included), if present.
fn block_text(text: &str) -> Option<&str> {
    let a = text.find(BEGIN)?;
    let b = text[a..].find(END).map_or(text.len(), |i| a + i + END.len());
    Some(&text[a..b])
}

/// Commands listed in a marked block, YAML-unquoted.
fn block_commands(blk: &str) -> Vec<String> {
    blk.lines().filter_map(|l| l.trim().strip_prefix("- command: '")).filter_map(|r| r.trim_end().strip_suffix('\''))
        .map(|c| c.replace("''", "'")).collect()
}

fn block(hook: &Path, nl: &str) -> String {
    // The command goes into a YAML single-quoted scalar: there a backslash is a plain character (no escapes),
    // so Windows paths survive unchanged; only `'` must be doubled. Hermes splits the decoded string with its
    // own split_command_line (not shlex), which keeps backslashes; the inner double quotes protect spaces.
    let cmd = quoted(hook);
    let mut s = format!("{BEGIN}{nl}hooks:{nl}");
    for ev in EVENTS {
        s += &format!("  {ev}:{nl}    - command: '{cmd}'{nl}      timeout: 5{nl}");
    }
    s + END + nl
}

/// (text without the marked block, whether a block was present)
fn split_block(text: &str) -> (String, bool) {
    let (mut out, mut inside, mut found) = (String::new(), false, false);
    for line in text.split_inclusive('\n') {
        let t = line.trim_end();
        if !inside && t == BEGIN {
            inside = true;
            found = true;
        } else if inside {
            inside = t != END;
        } else {
            out += line;
        }
    }
    (out, found)
}

fn write_atomic(path: &Path, data: &str) -> Result<(), String> {
    let tmp = path.with_extension("perch-tmp");
    std::fs::write(&tmp, data).and_then(|_| std::fs::rename(&tmp, path)).map_err(|e| format!("{}: {e}", path.display()))
}

/// Seconds since epoch -> `YYYY-MM-DDTHH:MM:SSZ` (days-to-civil algorithm).
fn iso_utc(secs: u64) -> String {
    let (days, rem) = ((secs / 86400) as i64, secs % 86400);
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + (m <= 2) as i64;
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn read_allowlist(path: &Path) -> Result<serde_json::Value, String> {
    match std::fs::read_to_string(path) {
        Ok(t) => serde_json::from_str(&t).map_err(|e| format!("승인 목록을 읽을 수 없습니다: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(format!("승인 목록을 읽을 수 없습니다: {e}")),
    }
}

pub fn connect(home: &Path, hook: &Path) -> Result<(), String> {
    let cfg = home.join("config.yaml");
    let old = match std::fs::read_to_string(&cfg) {
        Ok(t) => Some(t),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("config.yaml을 읽을 수 없습니다: {e}")),
    };
    let nl = if old.as_deref().is_some_and(|t| t.contains("\r\n")) { "\r\n" } else { "\n" };
    let (base, had_block) = split_block(old.as_deref().unwrap_or(""));
    let blk = block(hook, nl);
    if base.lines().any(|l| l.starts_with("hooks:")) {
        return Err(format!("기존 hooks가 있어 자동으로 합치지 않습니다. config.yaml의 hooks에 직접 넣을 내용:\n{blk}"));
    }
    let list_path = home.join("shell-hooks-allowlist.json");
    let mut list = read_allowlist(&list_path)?;

    let mut text = base.clone();
    if !text.is_empty() && !text.ends_with('\n') {
        text += nl;
    }
    text += &blk;

    let cmd = command(hook);
    let mtime = std::fs::metadata(hook).and_then(|m| m.modified()).ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| iso_utc(d.as_secs()));
    let approvals = list.as_object_mut().ok_or("승인 목록 형식이 올바르지 않습니다")?
        .entry("approvals").or_insert_with(|| serde_json::json!([]))
        .as_array_mut().ok_or("승인 목록 형식이 올바르지 않습니다")?;
    // an earlier perch block (maybe another hook path) is being replaced: drop its approvals
    let stale = block_text(old.as_deref().unwrap_or("")).map(block_commands).unwrap_or_default();
    approvals.retain(|e| !e["command"].as_str().is_some_and(|c| c != cmd && stale.iter().any(|s| s == c)));
    for ev in EVENTS {
        let same = |e: &serde_json::Value| e["event"] == ev && e["command"] == cmd.as_str();
        if !approvals.iter().any(same) {
            approvals.push(serde_json::json!({
                "event": ev, "command": cmd, "approved_at": iso_utc(now()), "script_mtime_at_approval": mtime,
            }));
        }
    }

    std::fs::create_dir_all(home).map_err(|e| e.to_string())?;
    if old.is_some() && !had_block {
        // only an original (block-free) config becomes the backup
        std::fs::copy(&cfg, home.join("config.yaml.perch-backup")).map_err(|e| format!("백업 실패: {e}"))?;
    }
    write_atomic(&cfg, &text)?;
    write_atomic(&list_path, &serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?)
}

pub fn disconnect(home: &Path, hook: &Path) -> Result<(), String> {
    let cfg = home.join("config.yaml");
    if let Ok(t) = std::fs::read_to_string(&cfg) {
        let (rest, found) = split_block(&t);
        if found {
            write_atomic(&cfg, &rest)?;
        }
    }
    let list_path = home.join("shell-hooks-allowlist.json");
    let mut list = read_allowlist(&list_path)?;
    let cmd = command(hook);
    if let Some(a) = list.get_mut("approvals").and_then(|a| a.as_array_mut()) {
        let before = a.len();
        a.retain(|e| e["command"] != cmd.as_str());
        if a.len() != before {
            write_atomic(&list_path, &serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn hermes_gateway_stop() -> Result<(), String> {
    let exe = exe().ok_or("hermes 실행 파일을 찾지 못했습니다.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut c = std::process::Command::new(exe);
        c.args(["gateway", "stop"]).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        #[cfg(windows)]
        std::os::windows::process::CommandExt::creation_flags(&mut c, 0x0800_0000); // CREATE_NO_WINDOW
        let mut child = c.spawn().map_err(|e| format!("gateway를 멈추지 못했습니다: {e}"))?;
        let end = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            match child.try_wait() {
                Ok(Some(st)) if st.success() => return Ok(()),
                Ok(Some(st)) => return Err(format!("gateway를 멈추지 못했습니다 (종료 코드 {}).", st.code().map_or("?".into(), |c| c.to_string()))),
                Ok(None) if std::time::Instant::now() < end => std::thread::sleep(std::time::Duration::from_millis(100)),
                Ok(None) => {
                    let _ = child.kill();
                    return Err("gateway를 멈추지 못했습니다: 30초 안에 끝나지 않았습니다.".into());
                }
                Err(e) => return Err(format!("gateway를 멈추지 못했습니다: {e}")),
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn hermes_status() -> Result<Status, String> {
    Ok(status())
}

#[tauri::command]
pub async fn hermes_connect() -> Result<Status, String> {
    connect(&home(), &hook_path())?;
    Ok(status())
}

#[tauri::command]
pub async fn hermes_disconnect() -> Result<Status, String> {
    disconnect(&home(), &hook_path())?;
    Ok(status())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let t = tempfile::tempdir().unwrap();
        let home = t.path().join("hermes home");
        fs::create_dir(&home).unwrap();
        let hook = t.path().join("Program Files").join("perch-hook.exe");
        fs::create_dir_all(hook.parent().unwrap()).unwrap();
        fs::write(&hook, "x").unwrap();
        (t, home, hook)
    }

    #[test]
    fn connect_disconnect_roundtrip() {
        let (_t, home, hook) = setup();
        let orig = "model: x\nagent:\n  a: 1\n";
        fs::write(home.join("config.yaml"), orig).unwrap();
        fs::write(home.join("shell-hooks-allowlist.json"), r#"{"approvals":[{"event":"e","command":"other"}]}"#).unwrap();

        connect(&home, &hook).unwrap();
        let once = fs::read_to_string(home.join("config.yaml")).unwrap();
        assert!(once.starts_with(orig) && once.contains(BEGIN) && once.contains("on_session_open:"));
        assert!(once.contains(&format!("'\"{}\" hermes'", hook.display())));
        assert_eq!(fs::read_to_string(home.join("config.yaml.perch-backup")).unwrap(), orig);
        let list: serde_json::Value = serde_json::from_str(&fs::read_to_string(home.join("shell-hooks-allowlist.json")).unwrap()).unwrap();
        assert_eq!(list["approvals"].as_array().unwrap().len(), 1 + EVENTS.len());
        assert!(status_of(&home, &hook, None).connected);

        connect(&home, &hook).unwrap();
        assert_eq!(fs::read_to_string(home.join("config.yaml")).unwrap(), once);
        assert_eq!(fs::read_to_string(home.join("config.yaml.perch-backup")).unwrap(), orig);
        let list: serde_json::Value = serde_json::from_str(&fs::read_to_string(home.join("shell-hooks-allowlist.json")).unwrap()).unwrap();
        assert_eq!(list["approvals"].as_array().unwrap().len(), 1 + EVENTS.len());

        disconnect(&home, &hook).unwrap();
        assert_eq!(fs::read_to_string(home.join("config.yaml")).unwrap(), orig);
        let list: serde_json::Value = serde_json::from_str(&fs::read_to_string(home.join("shell-hooks-allowlist.json")).unwrap()).unwrap();
        assert_eq!(list["approvals"].as_array().unwrap().len(), 1);
        assert!(!status_of(&home, &hook, None).connected);
    }

    #[test]
    fn connect_without_files_and_crlf() {
        let (_t, home, hook) = setup();
        connect(&home, &hook).unwrap();
        assert!(home.join("shell-hooks-allowlist.json").is_file() && !home.join("config.yaml.perch-backup").exists());
        disconnect(&home, &hook).unwrap();
        assert_eq!(fs::read_to_string(home.join("config.yaml")).unwrap(), "");
        fs::write(home.join("config.yaml"), "a: 1\r\n").unwrap();
        connect(&home, &hook).unwrap();
        assert!(fs::read_to_string(home.join("config.yaml")).unwrap().contains("hooks:\r\n"));
        disconnect(&home, &hook).unwrap();
        assert_eq!(fs::read_to_string(home.join("config.yaml")).unwrap(), "a: 1\r\n");
    }

    #[test]
    fn existing_hooks_errs_and_leaves_files() {
        let (_t, home, hook) = setup();
        let orig = "hooks:\n  pre_tool_call: []\n";
        fs::write(home.join("config.yaml"), orig).unwrap();
        let err = connect(&home, &hook).unwrap_err();
        assert!(err.contains("기존 hooks가 있어 자동으로 합치지 않습니다") && err.contains("on_session_open"));
        assert_eq!(fs::read_to_string(home.join("config.yaml")).unwrap(), orig);
        assert!(!home.join("shell-hooks-allowlist.json").exists() && !home.join("config.yaml.perch-backup").exists());
        // `hooks:` inside the perch block does not count
        fs::write(home.join("config.yaml"), "a: 1\n").unwrap();
        connect(&home, &hook).unwrap();
        connect(&home, &hook).unwrap();
    }

    #[test]
    fn moved_hook_is_not_connected_and_connect_replaces() {
        let (t, home, hook) = setup();
        let hook2 = t.path().join("new dir").join("perch-hook.exe");
        fs::create_dir_all(hook2.parent().unwrap()).unwrap();
        fs::write(&hook2, "x").unwrap();
        connect(&home, &hook).unwrap();
        assert!(status_of(&home, &hook, None).connected);
        assert!(!status_of(&home, &hook2, None).connected);
        connect(&home, &hook2).unwrap();
        let cfg = fs::read_to_string(home.join("config.yaml")).unwrap();
        assert_eq!(cfg.matches(BEGIN).count(), 1);
        assert!(status_of(&home, &hook2, None).connected && !status_of(&home, &hook, None).connected);
        let list: serde_json::Value = serde_json::from_str(&fs::read_to_string(home.join("shell-hooks-allowlist.json")).unwrap()).unwrap();
        let a = list["approvals"].as_array().unwrap();
        assert_eq!(a.len(), EVENTS.len());
        assert!(a.iter().all(|e| e["command"] == command(&hook2).as_str()));
        // hook file missing -> not connected
        fs::remove_file(&hook2).unwrap();
        assert!(!status_of(&home, &hook2, None).connected);
    }

    #[test]
    fn quote_in_path_is_doubled() {
        let b = block(Path::new("/o'k/perch-hook"), "\n");
        assert!(b.contains("'\"/o''k/perch-hook\" hermes'"));
    }

    #[test]
    fn iso() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_utc(1794925073), "2026-11-17T14:17:53Z");
        assert_eq!(iso_utc(951782400), "2000-02-29T00:00:00Z");
    }

    #[test]
    fn exe_lookup() {
        let t = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) { "hermes.exe" } else { "hermes" };
        let home = t.path().join("home");
        let bin = t.path().join("onpath");
        fs::create_dir_all(home.join("bin")).unwrap();
        fs::create_dir_all(&bin).unwrap();
        let path = std::env::join_paths([&bin]).unwrap();
        // none
        assert_eq!(find_exe(&home, Some(&path), cfg!(windows)), None);
        // under <home>/bin
        fs::write(home.join("bin").join(name), "").unwrap();
        assert_eq!(find_exe(&home, Some(&path), cfg!(windows)), Some(home.join("bin").join(name)));
        // PATH wins
        fs::write(bin.join(name), "").unwrap();
        assert_eq!(find_exe(&home, Some(&path), cfg!(windows)), Some(bin.join(name)));
    }

    #[test]
    fn home_resolution() {
        assert_eq!(home_from(Some("X".into()), true, None, None), PathBuf::from("X"));
        assert_eq!(home_from(None, true, Some("L".into()), Some("U".into())), PathBuf::from("L").join("hermes"));
        assert_eq!(home_from(None, false, None, Some("U".into())), PathBuf::from("U").join(".hermes"));
    }
}
