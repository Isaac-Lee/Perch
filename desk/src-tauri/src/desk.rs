use crate::pty::{self, Pty};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

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
}

struct Entry {
    info: PaneInfo,
    pty: Option<Pty>,
    chan: Chan,
}

#[derive(Default)]
struct Inner {
    entries: Vec<Entry>,
    next: u64,
}

#[derive(Default)]
pub struct Desk(Mutex<Inner>);

impl Desk {
    fn snapshot(&self) -> Vec<PaneInfo> {
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

    pub fn close_window(&self, app: &AppHandle, label: &str) {
        if self.remove(|i| i.window == label) {
            emit_snapshot(app);
        }
    }
}

fn emit_snapshot(app: &AppHandle) {
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
) -> Result<String, String> {
    if !["hermes", "opencode", "shell"].contains(&agent.as_str()) {
        return Err(format!("알 수 없는 에이전트: {agent}"));
    }
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
            info: PaneInfo { id: id.clone(), agent, cwd, repo_root, branch, window: window.label().to_string(), created_at },
            pty: None,
            chan: Arc::default(),
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
    let (chan, agent, cwd, running) = {
        let g = desk.0.lock().unwrap();
        let e = g.entries.iter().find(|e| e.info.id == id).ok_or("칸이 없습니다")?;
        (e.chan.clone(), e.info.agent.clone(), e.info.cwd.clone(), e.pty.is_some())
    };
    *chan.lock().unwrap() = Some(on_data.clone());
    if running {
        return Ok(());
    }
    let (prog, args) = pty::command_for(&agent, cfg!(windows));
    let (c1, app2, id2) = (chan.clone(), app.clone(), id.clone());
    let spawned = pty::spawn(
        &prog, &args, &cwd, &[("PERCH_PANE".into(), id.clone())], cols, rows,
        move |bytes| {
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

#[tauri::command]
pub async fn home_dir() -> Result<String, String> {
    std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
