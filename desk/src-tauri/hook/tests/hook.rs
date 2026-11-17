use perch_hook::{apply, run};
use serde_json::{json, Value};
use std::io::Write;
use std::process::{Command, Stdio};

fn ev(name: &str, extra: Value) -> Value {
    json!({"hook_event_name": name, "session_id": "local-a", "extra": extra})
}

fn step(st: Value, e: Value, now: u64) -> Value {
    apply(st, &e, now).unwrap()
}

#[test]
fn transitions() {
    let st = step(Value::Null, ev("on_session_open", json!({})), 10);
    assert_eq!((st["state"].as_str(), st["since"].as_u64(), st["sessionId"].as_str()), (Some("idle"), Some(10), Some("local-a")));
    // open on existing file only bumps seen
    let st = step(st, ev("on_session_start", json!({})), 11);
    assert_eq!((st["since"].as_u64(), st["seen"].as_u64()), (Some(10), Some(11)));
    // resume reopens a closed session
    let closed = step(st.clone(), ev("on_session_finalize", json!({})), 12);
    let reopened = step(closed, ev("on_session_open", json!({"reason": "resume"})), 13);
    assert_eq!((reopened["state"].as_str(), reopened["since"].as_u64()), (Some("idle"), Some(13)));

    let long = "가".repeat(100);
    let st = step(st, ev("pre_llm_call", json!({"user_message": long})), 20);
    assert_eq!((st["state"].as_str(), st["turnStart"].as_u64(), st["steps"].as_u64()), (Some("thinking"), Some(20), Some(0)));
    assert_eq!(st["prompt"].as_str().unwrap().chars().count(), 80);

    let mut e = ev("pre_tool_call", json!({}));
    e["tool_name"] = json!("terminal");
    e["tool_input"] = json!({"command": "npm test"});
    let st = step(st, e, 21);
    assert_eq!((st["state"].as_str(), st["tool"].as_str(), st["toolDetail"].as_str(), st["steps"].as_u64(), st["since"].as_u64()),
        (Some("tool"), Some("terminal"), Some("npm test"), Some(1), Some(21)));

    // no state change -> since kept
    let mut e = ev("pre_tool_call", json!({}));
    e["tool_name"] = json!("x");
    e["tool_input"] = json!({"zzz": 1});
    let st = step(st, e, 22);
    assert_eq!((st["since"].as_u64(), st["steps"].as_u64(), st["toolDetail"].as_str()), (Some(21), Some(2), Some("{\"zzz\":1}")));

    let mut e = ev("post_tool_call", json!({}));
    e["tool_name"] = json!("todo");
    e["tool_input"] = json!({"todos": [{"content": "a", "status": "completed"}, {"content": "b", "status": "pending"}]});
    let st = step(st, e, 23);
    assert_eq!(st["state"], "thinking");
    assert_eq!(st["todos"], json!([{"text":"a","status":"done"},{"text":"b","status":"pending"}]));

    let st = step(st, ev("on_human_input_request", json!({"kind":"tool_approval","request_id":"r1","prompt":"rm?"})), 24);
    assert_eq!(st["state"], "approval");
    assert_eq!(st["pending"], json!({"kind":"tool_approval","id":"r1","text":"rm?"}));
    let st = step(st, ev("on_human_input_resolved", json!({})), 25);
    assert_eq!((st["state"].as_str(), st["pending"].is_null()), (Some("thinking"), true));
    let st = step(st, ev("on_human_input_request", json!({"kind":"clarify","request_id":"r2","prompt":"?"})), 26);
    assert_eq!(st["state"], "question");

    let st = step(st, ev("on_session_end", json!({})), 30);
    assert_eq!((st["state"].as_str(), st["turnStart"].is_null(), st["tool"].as_str()), (Some("idle"), true, Some("")));
    let st = step(st, ev("on_session_finalize", json!({})), 31);
    assert_eq!(st["state"], "closed");
    assert!(apply(st, &ev("on_session_delete", json!({})), 32).is_none());
}

#[test]
fn subagents_via_files() {
    let d = tempfile::tempdir().unwrap();
    let h = d.path();
    let go = |e: Value, t: u64| run(&e.to_string(), h, t).unwrap();
    go(ev("on_session_open", json!({})), 1);
    go(ev("subagent_start", json!({"parent_session_id":"local-a","child_session_id":"local-c","child_role":"leaf","child_goal":"g"})), 2);
    let mut c = json!({"hook_event_name":"pre_tool_call","session_id":"local-c","tool_name":"terminal","tool_input":{}});
    c["extra"] = json!({});
    go(c, 3);
    let f = h.join("sessions/hermes-local-a.json");
    let st: Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
    assert_eq!(st["subagents"]["local-c"]["tool"], "terminal");
    assert_eq!(st["subagents"]["local-c"]["role"], "leaf");
    assert!(!h.join("sessions/hermes-local-c.json").exists());
    go(ev("subagent_stop", json!({"parent_session_id":"local-a","child_session_id":"local-c"})), 4);
    let st: Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
    assert!(st["subagents"].as_object().unwrap().is_empty());
    // delete with deleted_ids
    go(ev("on_session_delete", json!({"deleted_ids": ["local-a"]})), 5);
    assert!(!f.exists());
}

fn bin(args: &[&str], home: &std::path::Path, input: &str) -> std::process::Output {
    let mut c = Command::new(env!("CARGO_BIN_EXE_perch-hook"))
        .args(args).env("PERCH_HOME", home)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let _ = c.stdin.take().unwrap().write_all(input.as_bytes());
    c.wait_with_output().unwrap()
}

#[test]
fn binary_never_fails() {
    let d = tempfile::tempdir().unwrap();
    let good = ev("on_session_open", json!({})).to_string();
    let o = bin(&["hermes"], d.path(), &good);
    assert!(o.status.success() && o.stdout.is_empty() && o.stderr.is_empty());
    assert!(d.path().join("sessions/hermes-local-a.json").exists());
    for (args, input) in [(&["hermes"][..], "{not json"), (&["hermes"], ""), (&[], good.as_str()), (&["other"], good.as_str())] {
        let o = bin(args, d.path(), input);
        assert!(o.status.success() && o.stdout.is_empty());
    }
    // unwritable PERCH_HOME: a path under a regular file
    let file = d.path().join("f");
    std::fs::write(&file, "x").unwrap();
    let o = bin(&["hermes"], &file.join("sub"), &good);
    assert!(o.status.success() && o.stdout.is_empty());
}
