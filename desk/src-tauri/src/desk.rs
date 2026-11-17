use crate::pty::{self, Pty};
use crate::sessions::{self, Scan, SessionInfo, Sessions};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

type Chan = Arc<Mutex<Option<Channel<InvokeResponseBody>>>>;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PaneInfo {
    pub id: String,
    pub agent: String,
    pub cwd: String,
    pub repo_root: Option<String>,
    pub branch: Option<String>,
    pub window: String,
    pub created_at: u64,
    /// Connected Hermes session (full id, or the banner's prefix until the session shows up)
    pub session_id: Option<String>,
}

struct Entry {
    info: PaneInfo,
    pty: Option<Pty>,
    chan: Chan,
    created_ms: u64,
    resume: Option<String>,
}

#[derive(Default)]
struct Inner {
    entries: Vec<Entry>,
    next: u64,
    /// Hermes pane whose PTY was started last; the next one waits until it is linked or 5s passed
    gate: Option<(String, std::time::Instant)>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Links Hermes panes to sessions. Returns true if any pane changed.
/// 1) a pane holding an id prefix gets the unique full id that starts with it;
/// 2) a still unlinked pane gets the earliest unlinked session first seen after the pane was created.
// ponytail: a session resumed from outside Perch already has a state file, so it is never guessed; only the banner links it.
fn relink_entries(entries: &mut [Entry], sessions: &[SessionInfo], first_seen: &HashMap<String, u64>) -> bool {
    let mut changed = false;
    // 0) direct: the state file names the pane (any agent); the pane's agent must match and it must still be free
    for s in sessions {
        let Some(p) = &s.pane else { continue };
        if entries.iter().any(|e| e.info.session_id.as_deref() == Some(&s.session_id)) {
            continue;
        }
        if let Some(e) = entries.iter_mut().find(|e| e.info.id == *p && e.info.agent == s.agent && e.info.session_id.is_none()) {
            e.info.session_id = Some(s.session_id.clone());
            changed = true;
        }
    }
    for e in entries.iter_mut().filter(|e| e.info.agent == "hermes") {
        let Some(p) = e.info.session_id.clone() else { continue };
        if sessions.iter().any(|s| s.session_id == p) {
            continue;
        }
        let mut m = sessions.iter().filter(|s| s.session_id.starts_with(&p));
        if let (Some(full), None) = (m.next(), m.next()) {
            e.info.session_id = Some(full.session_id.clone());
            changed = true;
        }
    }
    let taken: HashSet<&str> = entries.iter().filter_map(|e| e.info.session_id.as_deref()).collect();
    let mut free: Vec<(u64, String)> = sessions.iter()
        .filter(|s| !taken.contains(s.session_id.as_str()))
        .filter_map(|s| first_seen.get(&s.session_id).filter(|&&t| t > 0).map(|&t| (t, s.session_id.clone())))
        .collect();
    free.sort();
    let mut order: Vec<usize> = (0..entries.len())
        .filter(|&i| entries[i].info.agent == "hermes" && entries[i].info.session_id.is_none())
        .collect();
    order.sort_by_key(|&i| entries[i].created_ms);
    for i in order {
        if let Some(pos) = free.iter().position(|(t, _)| *t >= entries[i].created_ms) {
            entries[i].info.session_id = Some(free.remove(pos).1);
            changed = true;
        }
    }
    changed
}

#[derive(Default)]
pub struct Desk(Mutex<Inner>);

impl Desk {
    pub fn snapshot(&self) -> Vec<PaneInfo> {
        self.0.lock().unwrap().entries.iter().map(|e| e.info.clone()).collect()
    }

    /// Removes entries matching `pred`; true if any were removed. Ptys are dropped (killed) after unlocking.
    fn remove(&self, pred: impl Fn(&PaneInfo) -> bool) -> bool {
        let removed: Vec<Entry> = {
            let mut g = self.0.lock().unwrap();
            let (gone, keep) = std::mem::take(&mut g.entries).into_iter().partition(|e| pred(&e.info));
            g.entries = keep;
            gone
        };
        !removed.is_empty()
    }

    pub fn relink(&self, sessions: &[SessionInfo], first_seen: &HashMap<String, u64>) -> bool {
        relink_entries(&mut self.0.lock().unwrap().entries, sessions, first_seen)
    }

    /// Records the id found in a pane's banner (only if the pane has none yet).
    fn set_session(&self, pane: &str, id: String) -> bool {
        let mut g = self.0.lock().unwrap();
        match g.entries.iter_mut().find(|e| e.info.id == pane && e.info.session_id.is_none()) {
            Some(e) => {
                e.info.session_id = Some(id);
                true
            }
            None => false,
        }
    }

    pub fn close_window(&self, app: &AppHandle, label: &str) {
        if self.remove(|i| i.window == label) {
            emit_snapshot(app);
        }
    }
}

pub fn emit_snapshot(app: &AppHandle) {
    let snap = app.state::<Desk>().snapshot();
    let _ = app.emit("desk://panes", snap);
}

fn read_head(git_dir: &Path) -> Option<String> {
    let head = std::fs::read_to_string(git_dir.join("HEAD")).ok()?;
    let head = head.trim();
    Some(match head.strip_prefix("ref: refs/heads/") {
        Some(b) => b.to_string(),
        None => head.chars().take(7).collect(),
    })
}

/// (repo_root, branch)
pub fn git_info(cwd: &Path) -> (Option<String>, Option<String>) {
    for dir in cwd.ancestors() {
        let dot = dir.join(".git");
        let git_dir = if dot.is_dir() {
            dot
        } else if dot.is_file() {
            let Ok(txt) = std::fs::read_to_string(&dot) else { continue };
            let Some(p) = txt.trim().strip_prefix("gitdir:") else { continue };
            let p = PathBuf::from(p.trim());
            if p.is_absolute() { p } else { dir.join(p) }
        } else {
            continue;
        };
        return (Some(dir.to_string_lossy().into_owned()), read_head(&git_dir));
    }
    (None, None)
}

#[tauri::command]
pub async fn pane_create(
    app: AppHandle,
    window: WebviewWindow,
    desk: State<'_, Desk>,
    agent: String,
    cwd: String,
    resume: Option<String>,
) -> Result<String, String> {
    if !["hermes", "opencode", "shell"].contains(&agent.as_str()) {
        return Err(format!("알 수 없는 에이전트: {agent}"));
    }
    if let Some(r) = &resume {
        if agent != "hermes" || r.is_empty() || r.starts_with('-') {
            return Err("resume은 hermes 세션 id에만 쓸 수 있습니다".into());
        }
    }
    // One spelling per folder: the repo root is the sidebar group key.
    let cwd = if cfg!(windows) { cwd.replace('/', "\\") } else { cwd };
    let (repo_root, branch) = git_info(Path::new(&cwd));
    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let id = {
        let mut g = desk.0.lock().unwrap();
        g.next += 1;
        let id = format!("p{}", g.next);
        g.entries.push(Entry {
            info: PaneInfo {
                id: id.clone(), agent, cwd, repo_root, branch, window: window.label().to_string(), created_at,
                session_id: resume.clone(),
            },
            pty: None,
            chan: Arc::default(),
            created_ms: now_ms(),
            resume,
        });
        id
    };
    emit_snapshot(&app);
    Ok(id)
}

#[tauri::command]
pub async fn pane_attach(
    app: AppHandle,
    desk: State<'_, Desk>,
    id: String,
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let (chan, agent, cwd, running, resume, linked) = {
        let g = desk.0.lock().unwrap();
        let e = g.entries.iter().find(|e| e.info.id == id).ok_or("칸이 없습니다")?;
        (e.chan.clone(), e.info.agent.clone(), e.info.cwd.clone(), e.pty.is_some(), e.resume.clone(), e.info.session_id.is_some())
    };
    *chan.lock().unwrap() = Some(on_data.clone());
    if running {
        return Ok(());
    }
    let guess = agent == "hermes" && !linked;
    if guess {
        // One unlinked Hermes pane at a time, so that "first new session" can only be this pane's.
        loop {
            let busy = {
                let mut g = desk.0.lock().unwrap();
                let busy = g.gate.as_ref().is_some_and(|(gid, t)| {
                    *gid != id && t.elapsed() < std::time::Duration::from_secs(5)
                        && g.entries.iter().any(|e| e.info.id == *gid && e.info.session_id.is_none())
                });
                if !busy {
                    g.gate = Some((id.clone(), std::time::Instant::now()));
                }
                busy
            };
            if !busy {
                break;
            }
            let _ = tauri::async_runtime::spawn_blocking(|| std::thread::sleep(std::time::Duration::from_millis(100))).await;
        }
    }
    let exe = if agent == "hermes" { crate::hermes::exe() } else { None };
    let (prog, args) = match pty::launch(&agent, cfg!(windows), exe.as_deref(), resume.as_deref()) {
        Ok(c) => c,
        Err(err) => {
            let _ = on_data.send(InvokeResponseBody::Raw(format!("\r\n[Perch] {err}\r\n").into_bytes()));
            return Err(err);
        }
    };
    let (c1, app2, id2) = (chan.clone(), app.clone(), id.clone());
    let (app3, id3) = (app.clone(), id.clone());
    let mut scan = guess.then(Scan::new);
    let spawned = pty::spawn(
        &prog, &args, &cwd, &[("PERCH_PANE".into(), id.clone())], cols, rows,
        move |bytes| {
            if let Some(found) = scan.as_mut().and_then(|s| s.feed(bytes)) {
                scan = None;
                if app3.state::<Desk>().set_session(&id3, found) {
                    emit_snapshot(&app3);
                }
            }
            let ch = c1.lock().unwrap().clone();
            if let Some(ch) = ch {
                let _ = ch.send(InvokeResponseBody::Raw(bytes.to_vec()));
            }
        },
        move || {
            if app2.state::<Desk>().remove(|i| i.id == id2) {
                emit_snapshot(&app2);
            }
        },
    );
    match spawned {
        Ok(p) => {
            let mut g = desk.0.lock().unwrap();
            if let Some(e) = g.entries.iter_mut().find(|e| e.info.id == id) {
                e.pty = Some(p);
            }
            Ok(())
        }
        Err(err) => {
            let _ = on_data.send(InvokeResponseBody::Raw(format!("\r\n[Perch] {err}\r\n").into_bytes()));
            let mut g = desk.0.lock().unwrap();
            if g.gate.as_ref().is_some_and(|(gid, _)| *gid == id) {
                g.gate = None;
            }
            Err(err)
        }
    }
}

fn with_pty(desk: &Desk, id: &str, f: impl FnOnce(&mut Pty) -> Result<(), String>) -> Result<(), String> {
    let mut g = desk.0.lock().unwrap();
    match g.entries.iter_mut().find(|e| e.info.id == id).and_then(|e| e.pty.as_mut()) {
        Some(p) => f(p),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn pane_write(desk: State<'_, Desk>, id: String, data: String) -> Result<(), String> {
    with_pty(&desk, &id, |p| p.write(data.as_bytes()))
}

/// Answers a pending approval of a connected session by typing the menu number into its pane.
#[tauri::command]
pub async fn session_approve(
    desk: State<'_, Desk>,
    sessions: State<'_, Sessions>,
    session_id: String,
    allow: bool,
) -> Result<(), String> {
    let key = sessions::approve_key(&sessions.get(), &session_id, allow)?;
    let mut g = desk.0.lock().unwrap();
    match g.entries.iter_mut().find(|e| e.info.session_id.as_deref() == Some(&session_id)).and_then(|e| e.pty.as_mut()) {
        Some(p) => p.write(key.as_bytes()),
        None => Err("연결된 칸이 없습니다".into()),
    }
}

#[tauri::command]
pub async fn pane_resize(desk: State<'_, Desk>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    with_pty(&desk, &id, |p| p.resize(cols, rows))
}

#[tauri::command]
pub async fn pane_close(app: AppHandle, desk: State<'_, Desk>, id: String) -> Result<(), String> {
    if desk.remove(|i| i.id == id) {
        emit_snapshot(&app);
    }
    Ok(())
}

#[tauri::command]
pub async fn desk_snapshot(desk: State<'_, Desk>) -> Result<Vec<PaneInfo>, String> {
    Ok(desk.snapshot())
}

/// Opens another Perch window with a unique label (w1, w2, ...). Failures are only logged.
pub fn open_window(app: &AppHandle) {
    static N: AtomicU64 = AtomicU64::new(0);
    let label = format!("w{}", N.fetch_add(1, Ordering::Relaxed) + 1);
    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::default())
        .title("Perch")
        .inner_size(1280.0, 800.0)
        .min_inner_size(800.0, 500.0)
        .build();
    match built {
        Ok(w) => { let _ = w.set_focus(); }
        Err(e) => eprintln!("[Perch] 새 창을 열지 못했습니다: {e}"),
    }
}

#[tauri::command]
pub async fn window_new(app: AppHandle) -> Result<(), String> {
    open_window(&app);
    Ok(())
}

#[tauri::command]
pub async fn window_focus(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub async fn pane_focus(app: AppHandle, id: String) -> Result<(), String> {
    app.emit("desk://focus", id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn home_dir() -> Result<String, String> {
    std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn entry(id: &str, agent: &str, created_ms: u64, session: Option<&str>) -> Entry {
        Entry {
            info: PaneInfo {
                id: id.into(), agent: agent.into(), cwd: String::new(), repo_root: None, branch: None, window: "main".into(),
                created_at: 0, session_id: session.map(String::from),
            },
            pty: None, chan: Arc::default(), created_ms, resume: None,
        }
    }

    fn sess(id: &str) -> SessionInfo {
        crate::sessions::parse_state(&serde_json::json!({ "sessionId": id })).unwrap()
    }

    #[test]
    fn relink_prefix_and_guess() {
        let (a, b, c) = ("local-aaaaaaaaaaaaaaaa1111", "local-bbbbbbbbbbbbbbbb2222", "local-cccccccccccccccc3333");
        let ss = [sess(a), sess(b), sess(c)];
        let fs: HashMap<String, u64> = [(a.to_string(), 0), (b.to_string(), 2000), (c.to_string(), 3000)].into();
        let mut es = vec![
            entry("p1", "hermes", 1500, None),
            entry("p2", "hermes", 2500, None),
            entry("p3", "hermes", 9000, None),
            entry("p4", "shell", 1000, None),
            entry("p5", "hermes", 100, Some("local-aaaaaaaaaaaaaaaa")),
        ];
        assert!(relink_entries(&mut es, &ss, &fs));
        let got: Vec<_> = es.iter().map(|e| e.info.session_id.clone()).collect();
        assert_eq!(got, [Some(b.into()), Some(c.into()), None, None, Some(a.into())]);
        assert!(!relink_entries(&mut es, &ss, &fs), "stable");
    }

    #[test]
    fn relink_ignores_old_and_ambiguous() {
        let ss = [sess("local-aaaa1"), sess("local-aaaa2")];
        let fs: HashMap<String, u64> = [("local-aaaa1".to_string(), 0), ("local-aaaa2".to_string(), 0)].into();
        let mut es = vec![entry("p1", "hermes", 10, None), entry("p2", "hermes", 10, Some("local-aaaa"))];
        assert!(!relink_entries(&mut es, &ss, &fs));
        assert_eq!(es[1].info.session_id.as_deref(), Some("local-aaaa"));
    }

    #[test]
    fn relink_by_pane_field() {
        let mut s = sess("oc-1");
        s.agent = "opencode".into();
        s.pane = Some("p7".into());
        let fs = HashMap::new();
        let mut es = vec![entry("p7", "opencode", 1, None), entry("p8", "hermes", 1, None)];
        assert!(relink_entries(&mut es, &[s.clone()], &fs));
        assert_eq!(es[0].info.session_id.as_deref(), Some("oc-1"));
        assert_eq!(es[1].info.session_id, None);
        let mut es = vec![entry("p7", "hermes", 1, None)];
        assert!(!relink_entries(&mut es, &[s], &fs), "agent mismatch");
        assert_eq!(es[0].info.session_id, None);
    }

    const HASH: &str = "0123456789abcdef0123456789abcdef01234567";

    #[test]
    fn branch() {
        let t = tempfile::tempdir().unwrap();
        fs::create_dir(t.path().join(".git")).unwrap();
        fs::write(t.path().join(".git/HEAD"), "ref: refs/heads/feat/x\n").unwrap();
        let (r, b) = git_info(t.path());
        assert_eq!(r.unwrap(), t.path().to_string_lossy());
        assert_eq!(b.unwrap(), "feat/x");
    }

    #[test]
    fn detached() {
        let t = tempfile::tempdir().unwrap();
        fs::create_dir(t.path().join(".git")).unwrap();
        fs::write(t.path().join(".git/HEAD"), format!("{HASH}\n")).unwrap();
        assert_eq!(git_info(t.path()).1.unwrap(), "0123456");
    }

    #[test]
    fn not_a_repo() {
        // ponytail: assumes the system temp dir is not inside a git repo
        let t = tempfile::tempdir().unwrap();
        assert_eq!(git_info(t.path()), (None, None));
    }

    #[test]
    fn subdir() {
        let t = tempfile::tempdir().unwrap();
        fs::create_dir(t.path().join(".git")).unwrap();
        fs::write(t.path().join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        let sub = t.path().join("a/b");
        fs::create_dir_all(&sub).unwrap();
        let (r, b) = git_info(&sub);
        assert_eq!(r.unwrap(), t.path().to_string_lossy());
        assert_eq!(b.unwrap(), "main");
    }

    #[test]
    fn worktree_file() {
        let t = tempfile::tempdir().unwrap();
        let gd = t.path().join("gitdata");
        fs::create_dir(&gd).unwrap();
        fs::write(gd.join("HEAD"), "ref: refs/heads/wt\n").unwrap();
        let wt = t.path().join("wt");
        fs::create_dir(&wt).unwrap();
        fs::write(wt.join(".git"), format!("gitdir: {}\n", gd.display())).unwrap();
        let (r, b) = git_info(&wt);
        assert_eq!(r.unwrap(), wt.to_string_lossy());
        assert_eq!(b.unwrap(), "wt");
    }
}
