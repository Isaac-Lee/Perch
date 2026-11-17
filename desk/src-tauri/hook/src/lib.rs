use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn home() -> PathBuf {
    if let Some(p) = std::env::var_os("PERCH_HOME") {
        return PathBuf::from(p);
    }
    let h = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).unwrap_or_default();
    PathBuf::from(h).join(".perch")
}

fn cut(s: &str) -> String {
    s.chars().take(80).collect()
}

fn tool_detail(input: &Value) -> String {
    for k in ["command", "path", "file_path", "query", "url"] {
        if let Some(t) = input.get(k).and_then(Value::as_str) {
            return cut(t);
        }
    }
    if input.is_null() { String::new() } else { cut(&input.to_string()) }
}

fn set_state(st: &mut Value, name: &str, now: u64) {
    if st["state"] != name {
        st["state"] = json!(name);
        st["since"] = json!(now);
    }
}

fn new_state(sid: &str, now: u64) -> Value {
    json!({"agent":"hermes","sessionId":sid,"state":"idle","since":now,"turnStart":null,"steps":0,
        "tool":"","toolDetail":"","prompt":"","pending":null,"subagents":{},"todos":[],"seen":now})
}

/// Pure transition for one session file. `state` is Null when no file exists. None = delete the file.
/// Internal event "subagent_tool" (built by `run` for a child's pre_tool_call) updates the parent's subagents[child].tool.
pub fn apply(state: Value, event: &Value, now: u64) -> Option<Value> {
    let name = event["hook_event_name"].as_str().unwrap_or("");
    if name == "on_session_delete" {
        return None;
    }
    let mut st = if state.is_object() {
        state
    } else {
        new_state(event["session_id"].as_str().unwrap_or(""), now)
    };
    st["seen"] = json!(now);
    let ex = &event["extra"];
    match name {
        "pre_llm_call" => {
            st["turnStart"] = json!(now);
            st["steps"] = json!(0);
            st["prompt"] = json!(cut(ex["user_message"].as_str().unwrap_or("")));
            st["pending"] = Value::Null;
            set_state(&mut st, "thinking", now);
        }
        "pre_tool_call" => {
            st["tool"] = json!(event["tool_name"].as_str().unwrap_or(""));
            st["toolDetail"] = json!(tool_detail(&event["tool_input"]));
            st["steps"] = json!(st["steps"].as_u64().unwrap_or(0) + 1);
            set_state(&mut st, "tool", now);
        }
        "post_tool_call" => {
            set_state(&mut st, "thinking", now);
            if event["tool_name"] == "todo" {
                // ponytail: assumes tool_input.todos = [{content|text, status}]; real shape unverified, untouched otherwise
                if let Some(a) = event["tool_input"]["todos"].as_array() {
                    let todos: Vec<Value> = a.iter().filter_map(|t| {
                        let text = t["content"].as_str().or_else(|| t["text"].as_str())?;
                        let status = match t["status"].as_str()? {
                            "completed" | "done" => "done",
                            "in_progress" => "in_progress",
                            _ => "pending",
                        };
                        Some(json!({"text": text, "status": status}))
                    }).collect();
                    st["todos"] = json!(todos);
                }
            }
        }
        "on_human_input_request" => {
            let kind = ex["kind"].as_str().unwrap_or("");
            let approval = kind.contains("approval");
            st["pending"] = json!({"kind": kind, "id": ex["request_id"].as_str().unwrap_or(""),
                "text": ex["prompt"].as_str().unwrap_or("")});
            set_state(&mut st, if approval { "approval" } else { "question" }, now);
        }
        "on_human_input_resolved" => {
            st["pending"] = Value::Null;
            set_state(&mut st, "thinking", now);
        }
        "on_session_end" => {
            st["turnStart"] = Value::Null;
            st["tool"] = json!("");
            st["toolDetail"] = json!("");
            set_state(&mut st, "idle", now);
        }
        "on_session_finalize" => set_state(&mut st, "closed", now),
        "subagent_start" => {
            let child = ex["child_session_id"].as_str().unwrap_or("");
            if !st["subagents"].is_object() {
                st["subagents"] = json!({});
            }
            st["subagents"][child] = json!({"role": ex["child_role"].as_str().unwrap_or(""),
                "goal": ex["child_goal"].as_str().unwrap_or(""), "start": now});
        }
        "subagent_stop" => {
            if let Some(m) = st["subagents"].as_object_mut() {
                m.remove(ex["child_session_id"].as_str().unwrap_or(""));
            }
        }
        "subagent_tool" => {
            let child = ex["child_session_id"].as_str().unwrap_or("");
            if let Some(c) = st["subagents"].get_mut(child) {
                c["tool"] = json!(ex["tool"].as_str().unwrap_or(""));
            }
        }
        _ => {} // on_session_open/start and unknown events: file created above, seen updated
    }
    Some(st)
}

fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() < 200 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn session_file(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("hermes-{id}.json"))
}

struct Lock(Option<PathBuf>);
impl Drop for Lock {
    fn drop(&mut self) {
        if let Some(p) = &self.0 {
            let _ = fs::remove_file(p);
        }
    }
}

fn lock(file: &Path) -> Lock {
    let mut p = file.as_os_str().to_owned();
    p.push(".lock");
    let p = PathBuf::from(p);
    let start = Instant::now();
    loop {
        if fs::OpenOptions::new().write(true).create_new(true).open(&p).is_ok() {
            return Lock(Some(p));
        }
        let stale = fs::metadata(&p).and_then(|m| m.modified()).ok()
            .and_then(|t| t.elapsed().ok()).is_some_and(|e| e > Duration::from_secs(2));
        if stale {
            let _ = fs::remove_file(&p);
            continue;
        }
        if start.elapsed() > Duration::from_millis(200) {
            return Lock(None);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn update(dir: &Path, id: &str, event: &Value, now: u64) -> Option<()> {
    let file = session_file(dir, id);
    let _l = lock(&file);
    let old = fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    match apply(old, event, now) {
        None => {
            let _ = fs::remove_file(&file);
        }
        Some(mut v) => {
            if v["sessionId"] == "" {
                v["sessionId"] = json!(id);
            }
            let mut t = file.as_os_str().to_owned();
            t.push(format!(".tmp{}", std::process::id()));
            let t = PathBuf::from(t);
            fs::write(&t, serde_json::to_vec(&v).ok()?).ok()?;
            if fs::rename(&t, &file).is_err() {
                let _ = fs::remove_file(&t);
            }
        }
    }
    Some(())
}

/// Process one hook payload against the state folder. Errors are swallowed by callers.
pub fn run(input: &str, home: &Path, now: u64) -> Option<()> {
    let ev: Value = serde_json::from_str(input).ok()?;
    let name = ev["hook_event_name"].as_str()?;
    let sid = ev["session_id"].as_str().unwrap_or("");
    let dir = home.join("sessions");
    let kids = dir.join(".children");
    fs::create_dir_all(&kids).ok()?;
    match name {
        "subagent_start" | "subagent_stop" => {
            let parent = ev["extra"]["parent_session_id"].as_str()?;
            let child = ev["extra"]["child_session_id"].as_str()?;
            if !safe_id(parent) || !safe_id(child) {
                return None;
            }
            if name == "subagent_start" {
                fs::write(kids.join(child), parent).ok()?;
            } else {
                let _ = fs::remove_file(kids.join(child));
            }
            update(&dir, parent, &ev, now)
        }
        "on_session_delete" => {
            let mut ids: Vec<&str> = ev["extra"]["deleted_ids"].as_array()
                .map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
            ids.push(sid);
            for id in ids.into_iter().filter(|i| safe_id(i)) {
                let _ = fs::remove_file(session_file(&dir, id));
                let _ = fs::remove_file(kids.join(id));
            }
            Some(())
        }
        _ => {
            if !safe_id(sid) {
                return None;
            }
            if let Ok(parent) = fs::read_to_string(kids.join(sid)) {
                // child session: never gets its own file, only its tool shows on the parent
                let parent = parent.trim();
                if name == "pre_tool_call" && safe_id(parent) {
                    let mut m = Map::new();
                    m.insert("hook_event_name".into(), json!("subagent_tool"));
                    m.insert("extra".into(), json!({"child_session_id": sid, "tool": ev["tool_name"]}));
                    update(&dir, parent, &Value::Object(m), now);
                }
                return Some(());
            }
            update(&dir, sid, &ev, now)
        }
    }
}
