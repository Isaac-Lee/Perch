use crate::desk::{self, Desk, PaneInfo};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize, Clone, PartialEq, Debug, Default)]
pub struct Pending {
    pub kind: String,
    pub id: String,
    pub text: String,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct Sub {
    pub id: String,
    pub role: String,
    pub goal: String,
    pub start: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct Todo {
    pub text: String,
    pub status: String,
}

#[derive(Serialize, Clone, PartialEq, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub model: String,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub reasoning: u64,
    pub api_calls: u64,
    pub cost_usd: Option<f64>,
    pub started_at: u64,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub agent: String,
    pub session_id: String,
    pub state: String,
    pub since: u64,
    pub turn_start: Option<u64>,
    /// seconds the last finished turn took; None if unknown
    pub last_turn: Option<u64>,
    pub steps: u64,
    pub tool: String,
    pub tool_detail: String,
    pub prompt: String,
    pub pending: Option<Pending>,
    pub subagents: Vec<Sub>,
    pub todos: Vec<Todo>,
    pub seen: u64,
    pub pane_id: Option<String>,
    /// `pane` from the state file (the adapter saw PERCH_PANE); internal, not part of the contract
    #[serde(skip)]
    pub pane: Option<String>,
    pub title: Option<String>,
    pub cwd: String,
    pub repo_root: Option<String>,
    pub branch: Option<String>,
    pub usage: Option<Usage>,
}

/// Last published snapshot; the poller thread is the only writer.
#[derive(Default)]
pub struct Sessions(Mutex<Vec<SessionInfo>>);

impl Sessions {
    fn set_if_changed(&self, v: &[SessionInfo]) -> bool {
        let mut g = self.0.lock().unwrap();
        if *g == v {
            return false;
        }
        *g = v.to_vec();
        true
    }
    pub fn get(&self) -> Vec<SessionInfo> {
        self.0.lock().unwrap().clone()
    }
}

pub fn perch_home() -> PathBuf {
    if let Some(h) = std::env::var_os("PERCH_HOME").filter(|h| !h.is_empty()) {
        return h.into();
    }
    let u = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).unwrap_or_default();
    PathBuf::from(u).join(".perch")
}

pub(crate) fn parse_state(v: &Value) -> Option<SessionInfo> {
    let s = |k: &str| v[k].as_str().unwrap_or("").to_string();
    let n = |k: &str| v[k].as_u64().unwrap_or(0);
    let session_id = v["sessionId"].as_str().filter(|s| !s.is_empty())?.to_string();
    let pending = v["pending"].as_object().map(|_| {
        let p = &v["pending"];
        let f = |k: &str| p[k].as_str().unwrap_or("").to_string();
        Pending { kind: f("kind"), id: f("id"), text: f("text") }
    });
    let mut subagents: Vec<Sub> = v["subagents"].as_object().into_iter().flatten().map(|(id, o)| Sub {
        id: id.clone(),
        role: o["role"].as_str().unwrap_or("").into(),
        goal: o["goal"].as_str().unwrap_or("").into(),
        start: o["start"].as_u64().unwrap_or(0),
        tool: o["tool"].as_str().map(String::from),
    }).collect();
    subagents.sort_by(|a, b| (a.start, &a.id).cmp(&(b.start, &b.id)));
    let todos = v["todos"].as_array().into_iter().flatten().map(|t| Todo {
        text: t["text"].as_str().unwrap_or("").into(),
        status: t["status"].as_str().unwrap_or("pending").into(),
    }).collect();
    Some(SessionInfo {
        agent: if v["agent"].is_string() { s("agent") } else { "hermes".into() },
        session_id,
        state: if v["state"].is_string() { s("state") } else { "idle".into() },
        since: n("since"),
        turn_start: v["turnStart"].as_u64(),
        last_turn: v["lastTurn"].as_u64(),
        steps: n("steps"),
        tool: s("tool"),
        tool_detail: s("toolDetail"),
        prompt: s("prompt"),
        pending,
        subagents,
        todos,
        seen: n("seen"),
        pane_id: None,
        pane: v["pane"].as_str().filter(|s| !s.is_empty()).map(String::from),
        title: None,
        cwd: String::new(),
        repo_root: None,
        branch: None,
        usage: None,
    })
}

struct Db {
    title: Option<String>,
    cwd: Option<String>,
    repo_root: Option<String>,
    branch: Option<String>,
    usage: Usage,
}

/// Read-only lookup in Hermes' state.db. Any failure (no file, locked, older schema) means "no enrichment".
fn query_db(db: &Path, id: &str) -> Option<Db> {
    if !db.is_file() {
        return None;
    }
    let c = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).ok()?;
    c.busy_timeout(Duration::from_millis(200)).ok()?;
    c.query_row(
        "SELECT title, cwd, git_repo_root, git_branch, model, started_at, input_tokens, output_tokens, \
         cache_read_tokens, cache_write_tokens, reasoning_tokens, api_call_count, \
         COALESCE(actual_cost_usd, estimated_cost_usd) FROM sessions WHERE id = ?1",
        [id],
        |r| {
            let st = |i: usize| r.get::<_, Option<String>>(i).ok().flatten().filter(|s| !s.is_empty());
            // f64 reads INTEGER and REAL alike; NULL or a wrong type counts as 0
            let num = |i: usize| r.get::<_, Option<f64>>(i).ok().flatten().unwrap_or(0.0).max(0.0) as u64;
            Ok(Db {
                title: st(0),
                cwd: st(1),
                repo_root: st(2),
                branch: st(3),
                usage: Usage {
                    model: st(4).unwrap_or_default(),
                    started_at: num(5),
                    input: num(6),
                    output: num(7),
                    cache_read: num(8),
                    cache_write: num(9),
                    reasoning: num(10),
                    api_calls: num(11),
                    cost_usd: r.get::<_, Option<f64>>(12).ok().flatten(),
                },
            })
        },
    )
    .ok()
}

fn enrich(db: &Path, info: &mut SessionInfo) {
    if let Some(d) = query_db(db, &info.session_id) {
        info.title = d.title;
        info.cwd = d.cwd.unwrap_or_default();
        info.repo_root = d.repo_root;
        info.branch = d.branch;
        info.usage = Some(d.usage);
        // Hermes often leaves git_repo_root/git_branch empty; without them a closed session falls into "Shared workspace".
        if info.repo_root.is_none() && !info.cwd.is_empty() {
            (info.repo_root, info.branch) = crate::desk::git_info(Path::new(&info.cwd));
        }
    }
}

struct Cached {
    key: (Option<SystemTime>, u64),
    info: Option<SessionInfo>,
}

/// Watches `<dir>/*.json`; only files whose mtime/size changed are re-read (and re-enriched from state.db).
pub struct Poller {
    dir: PathBuf,
    db: PathBuf,
    files: HashMap<String, Cached>,
    /// session id -> ms when the poller first saw it (0 = existed before the app looked)
    pub first_seen: HashMap<String, u64>,
    primed: bool,
}

impl Poller {
    pub fn new(dir: PathBuf, db: PathBuf) -> Self {
        Poller { dir, db, files: HashMap::new(), first_seen: HashMap::new(), primed: false }
    }

    /// Returns true when anything on disk changed since the last call.
    pub fn scan(&mut self, now_ms: u64) -> bool {
        let mut changed = false;
        let mut present = HashSet::new();
        if let Ok(rd) = std::fs::read_dir(&self.dir) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                if !name.ends_with(".json") || name.starts_with('.') {
                    continue;
                }
                let Ok(md) = e.metadata() else { continue };
                if !md.is_file() {
                    continue;
                }
                present.insert(name.clone());
                let key = (md.modified().ok(), md.len());
                if self.files.get(&name).is_some_and(|c| c.key == key) {
                    continue;
                }
                // an unreadable file (e.g. mid-rename on Windows) is retried next tick; a broken one is skipped
                let Ok(text) = std::fs::read_to_string(e.path()) else {
                    present.remove(&name);
                    continue;
                };
                let info = serde_json::from_str::<Value>(&text).ok().and_then(|v| parse_state(&v)).map(|mut i| {
                    enrich(&self.db, &mut i);
                    i
                });
                self.files.insert(name, Cached { key, info });
                changed = true;
            }
        }
        let before = self.files.len();
        self.files.retain(|k, _| present.contains(k));
        changed |= before != self.files.len();
        let first = if self.primed { now_ms } else { 0 };
        for c in self.files.values().filter_map(|c| c.info.as_ref()) {
            self.first_seen.entry(c.session_id.clone()).or_insert(first);
        }
        self.primed = true;
        changed
    }

    pub fn snapshot(&self) -> Vec<SessionInfo> {
        let mut v: Vec<SessionInfo> = self.files.values().filter_map(|c| c.info.clone()).collect();
        v.sort_by(|a, b| a.session_id.cmp(&b.session_id));
        v
    }
}

/// Fills `pane_id` and, where state.db gave nothing, the pane's cwd / repo / branch.
pub fn decorate(mut base: Vec<SessionInfo>, panes: &[PaneInfo]) -> Vec<SessionInfo> {
    for s in &mut base {
        if let Some(p) = panes.iter().find(|p| p.session_id.as_deref() == Some(&s.session_id)) {
            s.pane_id = Some(p.id.clone());
            if s.cwd.is_empty() {
                s.cwd = p.cwd.clone();
            }
            s.repo_root = s.repo_root.take().or_else(|| p.repo_root.clone());
            s.branch = s.branch.take().or_else(|| p.branch.clone());
        }
    }
    base
}

/// "1" (allow once) or Esc (deny) when the session is waiting for an approval. The TUI numbers its choices
/// from what the gateway offers, so deny is not always "4"; Esc always denies.
pub fn approve_key(sessions: &[SessionInfo], id: &str, allow: bool) -> Result<&'static str, String> {
    let s = sessions.iter().find(|s| s.session_id == id).ok_or("세션을 찾을 수 없습니다")?;
    if s.state != "approval" || s.pending.is_none() {
        return Err("승인을 기다리는 상태가 아닙니다".into());
    }
    Ok(if allow { "1" } else { "" })
}

// ---- PTY output: find "Session: <id>" ----

const SCAN_MAX: usize = 64 * 1024;

#[derive(Clone, Copy)]
enum Ansi {
    Text,
    Esc,
    Csi,
    Osc,
    OscEsc,
}

/// Looks for the banner's session id in the first 64KB of a pane's output.
pub struct Scan {
    st: Ansi,
    text: Vec<u8>,
    seen: usize,
    done: bool,
}

impl Scan {
    pub fn new() -> Self {
        Scan { st: Ansi::Text, text: Vec::new(), seen: 0, done: false }
    }

    /// Feeds raw output; Some(id) once found. After a hit, or once 64KB went by, it does nothing (cheap).
    pub fn feed(&mut self, bytes: &[u8]) -> Option<String> {
        if self.done {
            return None;
        }
        self.seen += bytes.len();
        for &b in bytes {
            self.st = match (self.st, b) {
                (Ansi::Text, 0x1b) => Ansi::Esc,
                (Ansi::Text, _) => {
                    self.text.push(b);
                    Ansi::Text
                }
                (Ansi::Esc, b'[') => Ansi::Csi,
                (Ansi::Esc, b']') => Ansi::Osc,
                (Ansi::Esc, 0x20..=0x2f) => Ansi::Esc, // intermediates, e.g. ESC ( B
                (Ansi::Esc, _) => Ansi::Text,
                (Ansi::Csi, 0x40..=0x7e) => Ansi::Text,
                (Ansi::Csi, _) => Ansi::Csi,
                (Ansi::Osc, 0x07) => Ansi::Text,
                (Ansi::Osc, 0x1b) => Ansi::OscEsc,
                (Ansi::Osc, _) => Ansi::Osc,
                (Ansi::OscEsc, _) => Ansi::Text,
            };
        }
        let found = extract_session_id(&String::from_utf8_lossy(&self.text));
        if found.is_some() || self.seen > SCAN_MAX {
            self.done = true;
            self.text = Vec::new();
        }
        found
    }
}

/// `Session: local-…` in already-stripped text. The id must be followed by a non-id character,
/// otherwise it may still be cut off at the end of the buffer.
pub fn extract_session_id(text: &str) -> Option<String> {
    for (i, _) in text.match_indices("Session:") {
        let rest = text[i + 8..].trim_start_matches([' ', '\t']);
        let end = rest.find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        if let Some(end) = end {
            if end > 6 && rest.starts_with("local-") {
                return Some(rest[..end].to_string());
            }
        }
    }
    None
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The only background thread: every 500ms it checks the status folder; it emits only on change.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut poller = Poller::new(perch_home().join("sessions"), crate::hermes::home().join("state.db"));
        loop {
            poller.scan(now_ms());
            let base = poller.snapshot();
            let desk = app.state::<Desk>();
            if desk.relink(&base, &poller.first_seen) {
                desk::emit_snapshot(&app);
            }
            let out = decorate(base, &desk.snapshot());
            if app.state::<Sessions>().set_if_changed(&out) {
                let _ = app.emit("desk://sessions", out);
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    });
}

/// Every row of Hermes' state.db with tokens, as closed sessions (read-only; empty if the db is unusable).
pub fn usage_history_from(db: &Path) -> Vec<SessionInfo> {
    let Ok(c) = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX) else { return vec![] };
    let _ = c.busy_timeout(Duration::from_millis(200));
    let Ok(mut q) = c.prepare(
        "SELECT id, title, cwd, git_repo_root, git_branch, model, started_at, input_tokens, output_tokens, \
         cache_read_tokens, cache_write_tokens, reasoning_tokens, api_call_count, \
         COALESCE(actual_cost_usd, estimated_cost_usd) FROM sessions",
    ) else { return vec![] };
    let Ok(rows) = q.query_map([], |r| {
        let st = |i: usize| r.get::<_, Option<String>>(i).ok().flatten().filter(|s| !s.is_empty());
        let num = |i: usize| r.get::<_, Option<f64>>(i).ok().flatten().unwrap_or(0.0).max(0.0) as u64;
        Ok((r.get::<_, String>(0)?, st(1), st(2), st(3), st(4), Usage {
            model: st(5).unwrap_or_default(), started_at: num(6), input: num(7), output: num(8), cache_read: num(9),
            cache_write: num(10), reasoning: num(11), api_calls: num(12), cost_usd: r.get::<_, Option<f64>>(13).ok().flatten(),
        }))
    }) else { return vec![] };
    let mut git: HashMap<String, (Option<String>, Option<String>)> = HashMap::new();
    let mut out = vec![];
    for (id, title, cwd, root, branch, usage) in rows.flatten() {
        if usage.input + usage.output + usage.cache_read + usage.cache_write + usage.reasoning == 0 {
            continue;
        }
        let cwd = cwd.unwrap_or_default();
        let (repo_root, branch) = if root.is_some() || cwd.is_empty() {
            (root, branch)
        } else {
            let g = git.entry(cwd.clone()).or_insert_with(|| desk::git_info(Path::new(&cwd))).clone();
            (g.0, branch.or(g.1))
        };
        out.push(SessionInfo {
            agent: "hermes".into(), session_id: id, state: "closed".into(), since: usage.started_at, turn_start: None, last_turn: None, steps: 0,
            tool: String::new(), tool_detail: String::new(), prompt: String::new(), pending: None, subagents: vec![], todos: vec![],
            seen: usage.started_at, pane_id: None, pane: None, title, cwd, repo_root, branch, usage: Some(usage),
        });
    }
    out
}

#[tauri::command]
pub async fn usage_history() -> Result<Vec<SessionInfo>, String> {
    let db = crate::hermes::home().join("state.db");
    tauri::async_runtime::spawn_blocking(move || usage_history_from(&db)).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sessions_snapshot(sessions: State<'_, Sessions>) -> Result<Vec<SessionInfo>, String> {
    Ok(sessions.get())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn state(id: &str, st: &str) -> String {
        format!(r#"{{"agent":"hermes","sessionId":"{id}","state":"{st}","since":5,"turnStart":null,"lastTurn":42,"steps":2,"tool":"","toolDetail":"",
            "prompt":"p","pending":null,"subagents":{{"c1":{{"role":"leaf","goal":"g","start":3,"tool":"terminal"}}}},
            "todos":[{{"text":"t","status":"done"}}],"seen":9}}"#)
    }

    fn make_db(path: &Path, id: &str) {
        let c = Connection::open(path).unwrap();
        c.execute_batch(
            "CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, title_source TEXT, cwd TEXT, git_repo_root TEXT, git_branch TEXT, \
             model TEXT, started_at REAL, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, \
             reasoning_tokens INTEGER, api_call_count INTEGER, estimated_cost_usd REAL, actual_cost_usd REAL, parent_session_id TEXT);",
        ).unwrap();
        c.execute(
            "INSERT INTO sessions (id, title, cwd, git_repo_root, git_branch, model, started_at, input_tokens, output_tokens, \
             cache_read_tokens, cache_write_tokens, reasoning_tokens, api_call_count, estimated_cost_usd) \
             VALUES (?1, 'T', '/w', '/r', 'main', 'm', 1700000000.5, 10, 20, 30, 40, 50, 6, 0.25)",
            [id],
        ).unwrap();
    }

    #[test]
    fn scan_three_files_broken_and_unchanged() {
        let t = tempfile::tempdir().unwrap();
        let dir = t.path().join("sessions");
        fs::create_dir_all(dir.join(".children")).unwrap();
        for (i, st) in ["thinking", "idle", "tool"].iter().enumerate() {
            fs::write(dir.join(format!("hermes-local-{i}.json")), state(&format!("local-{i}"), st)).unwrap();
        }
        fs::write(dir.join("hermes-bad.json"), "{not json").unwrap();
        fs::write(dir.join("hermes-x.json.lock"), "").unwrap();
        let mut p = Poller::new(dir.clone(), t.path().join("none.db"));
        assert!(p.scan(1000));
        let s = p.snapshot();
        assert_eq!(s.len(), 3);
        assert_eq!(s[0].session_id, "local-0");
        assert_eq!((s[0].state.as_str(), s[0].steps, s[0].subagents[0].tool.as_deref()), ("thinking", 2, Some("terminal")));
        assert_eq!(s[0].todos[0].status, "done");
        assert_eq!(s[0].last_turn, Some(42));
        assert!(p.first_seen.values().all(|&v| v == 0));
        assert!(!p.scan(2000), "unchanged -> no change");
        // a new file after the first pass gets a real first-seen time; removal is a change
        fs::write(dir.join("hermes-local-9.json"), state("local-9", "idle")).unwrap();
        assert!(p.scan(3000));
        assert_eq!(p.first_seen["local-9"], 3000);
        fs::remove_file(dir.join("hermes-local-1.json")).unwrap();
        assert!(p.scan(4000));
        assert_eq!(p.snapshot().len(), 3);
    }

    #[test]
    fn missing_dir_is_empty() {
        let mut p = Poller::new(PathBuf::from("Z:/no/such"), PathBuf::from("Z:/no/db"));
        assert!(!p.scan(1));
        assert!(p.snapshot().is_empty());
    }

    #[test]
    fn db_enrichment() {
        let t = tempfile::tempdir().unwrap();
        let db = t.path().join("state.db");
        make_db(&db, "local-abc");
        let dir = t.path().join("s");
        fs::create_dir(&dir).unwrap();
        fs::write(dir.join("hermes-local-abc.json"), state("local-abc", "idle")).unwrap();
        fs::write(dir.join("hermes-local-zzz.json"), state("local-zzz", "idle")).unwrap();
        let mut p = Poller::new(dir, db);
        p.scan(0);
        let s = p.snapshot();
        let u = s[0].usage.clone().unwrap();
        assert_eq!((s[0].title.as_deref(), s[0].cwd.as_str(), s[0].repo_root.as_deref(), s[0].branch.as_deref()), (Some("T"), "/w", Some("/r"), Some("main")));
        assert_eq!((u.model.as_str(), u.started_at, u.input, u.output, u.cache_read, u.cache_write, u.reasoning, u.api_calls, u.cost_usd),
                   ("m", 1700000000, 10, 20, 30, 40, 50, 6, Some(0.25)));
        assert!(s[1].usage.is_none() && s[1].title.is_none(), "no row -> no enrichment");
    }

    #[test]
    fn history_rows() {
        let t = tempfile::tempdir().unwrap();
        let db = t.path().join("state.db");
        make_db(&db, "a");
        let c = Connection::open(&db).unwrap();
        c.execute("INSERT INTO sessions (id, cwd, model, started_at, input_tokens, output_tokens) VALUES ('b', ?1, 'm2', 1700000100, 5, 0)",
            [t.path().to_string_lossy().as_ref()]).unwrap();
        c.execute("INSERT INTO sessions (id, started_at, input_tokens, output_tokens) VALUES ('z', 1, 0, 0)", []).unwrap();
        drop(c);
        let mut h = usage_history_from(&db);
        h.sort_by(|x, y| x.session_id.cmp(&y.session_id));
        assert_eq!(h.len(), 2);
        let (a, b) = (&h[0], &h[1]);
        assert_eq!((a.session_id.as_str(), a.state.as_str(), a.since, a.seen, a.title.as_deref(), a.cwd.as_str()), ("a", "closed", 1700000000, 1700000000, Some("T"), "/w"));
        assert_eq!((a.repo_root.as_deref(), a.branch.as_deref(), a.pane_id.clone()), (Some("/r"), Some("main"), None));
        let u = a.usage.clone().unwrap();
        assert_eq!((u.input, u.output, u.api_calls, u.cost_usd), (10, 20, 6, Some(0.25)));
        assert_eq!((b.session_id.as_str(), b.usage.clone().unwrap().input, b.repo_root.clone()), ("b", 5, None));
        assert!(usage_history_from(&t.path().join("none.db")).is_empty());
    }

    #[test]
    fn db_missing_or_old_schema() {
        let t = tempfile::tempdir().unwrap();
        assert!(query_db(&t.path().join("nope.db"), "x").is_none());
        assert!(!t.path().join("nope.db").exists(), "read-only open must not create the file");
        let db = t.path().join("old.db");
        Connection::open(&db).unwrap().execute_batch("CREATE TABLE sessions (id TEXT, title TEXT); INSERT INTO sessions VALUES ('x','t');").unwrap();
        assert!(query_db(&db, "x").is_none());
        fs::write(t.path().join("junk.db"), "not a database at all").unwrap();
        assert!(query_db(&t.path().join("junk.db"), "x").is_none());
    }

    #[test]
    fn decorate_and_approve() {
        let mut s = parse_state(&serde_json::from_str(&state("local-1", "approval")).unwrap()).unwrap();
        assert!(approve_key(&[s.clone()], "local-1", true).is_err(), "no pending");
        s.pending = Some(Pending { kind: "approval".into(), id: "r".into(), text: "t".into() });
        assert_eq!(approve_key(&[s.clone()], "local-1", true), Ok("1"));
        assert_eq!(approve_key(&[s.clone()], "local-1", false), Ok(""));
        assert!(approve_key(&[s.clone()], "nope", true).is_err());
        s.state = "thinking".into();
        assert!(approve_key(&[s.clone()], "local-1", true).is_err());
        let pane = PaneInfo {
            id: "p1".into(), agent: "hermes".into(), cwd: "/c".into(), repo_root: Some("/rr".into()), branch: Some("b".into()),
            window: "main".into(), created_at: 0, session_id: Some("local-1".into()), view: "tui".into(),
        };
        let d = decorate(vec![s], &[pane]);
        assert_eq!((d[0].pane_id.as_deref(), d[0].cwd.as_str(), d[0].branch.as_deref()), (Some("p1"), "/c", Some("b")));
    }

    #[test]
    fn extract_ids() {
        let id = format!("local-{}", "a1b2c3d4e5f60718");
        assert_eq!(extract_session_id(&format!("x\nSession: {id}\n")), Some(id.clone()));
        assert_eq!(extract_session_id(&format!("Session:{id} ")), Some(id.clone()));
        assert_eq!(extract_session_id(&format!("Session: {id}")), None, "may be cut off");
        assert_eq!(extract_session_id("Session: saved\n"), None);
        assert_eq!(extract_session_id("nothing here\n"), None);
    }

    #[test]
    fn scan_with_ansi_across_chunks() {
        let id = "local-0123456789abcdef";
        let out = format!("\x1b[?25l\x1b]0;title\x07\x1b[2mSes\x1b[0msion:\x1b[0m \x1b[38;5;5m{id}\x1b[0m\r\n");
        let mut sc = Scan::new();
        let (a, b) = out.as_bytes().split_at(20);
        assert_eq!(sc.feed(a), None);
        assert_eq!(sc.feed(b), Some(id.to_string()));
        assert_eq!(sc.feed(b"Session: local-ffffffffffffffff\n"), None, "stops after a hit");
    }

    #[test]
    fn scan_gives_up_after_64kb() {
        let mut sc = Scan::new();
        assert_eq!(sc.feed(&vec![b'x'; SCAN_MAX + 1]), None);
        assert_eq!(sc.feed(b"Session: local-0123456789abcdef\n"), None);
        assert!(sc.text.is_empty());
        let mut sc = Scan::new();
        assert_eq!(sc.feed(b"hello\r\n"), None);
    }
}
