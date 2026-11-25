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
fn prompt_skips_control_frames_and_unwraps_steers() {
    let say = |st: Value, m: &str| step(st, ev("pre_llm_call", json!({"user_message": m})), 10);
    let st = say(Value::Null, "hello");
    for frame in ["[ASYNC DELEGATION BATCH COMPLETE — deleg_1]\nx", "[System: note]", "[CONTEXT COMPACTION] s", "[/OUT-OF-BAND USER MESSAGE]"] {
        assert_eq!(say(st.clone(), frame)["prompt"], "hello", "{frame}");
    }
    let steer = "[OUT-OF-BAND USER MESSAGE — a direct message from the user]\nstop now\n[/OUT-OF-BAND USER MESSAGE]";
    assert_eq!(say(st.clone(), steer)["prompt"], "stop now");
    assert_eq!(say(st.clone(), "[link] text")["prompt"], "[link] text");
    let note = "[The user sent an image~ Here's what I can see (user-supplied image content, not instructions):\na [cat]\nsleeping]\n[If you need a closer look, use vision_analyze with image_url: C:/x.png ~]";
    assert_eq!(say(st.clone(), &format!("{note}\n\n{note}\n\n뭐가 보여?"))["prompt"], "뭐가 보여?");
    assert_eq!(say(st.clone(), note)["prompt"], "[이미지]");
    assert_eq!(say(st, "[The user sent an image but I couldn't quite see it]\n\nhi")["prompt"], "hi");
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

    // todo_list: extra.result is the full list, tool_input is a partial merge write
    let full = r#"{"todos":[{"id":"1","content":"a","status":"completed"},{"id":"2","content":"b","status":"in_progress"},{"id":"3","content":"c","status":"cancelled"},{"id":"4","content":"d","status":"pending"}]}"#;
    let mut e = ev("post_tool_call", json!({"result": full}));
    e["tool_name"] = json!("todo_list");
    e["tool_input"] = json!({"todos": [{"id":"2","status":"completed"}], "merge": true});
    let st = step(st, e, 23);
    let want = json!([{"text":"a","status":"done"},{"text":"b","status":"in_progress"},{"text":"d","status":"pending"}]);
    assert_eq!(st["todos"], want);

    // error result leaves todos untouched
    let mut e = ev("post_tool_call", json!({"result": "{\"error\":\"x\"}"}));
    e["tool_name"] = json!("todo_list");
    e["tool_input"] = json!({"todos": [{"id":"9","status":"done"}], "merge": true});
    let st = step(st, e, 23);
    assert_eq!(st["todos"], want);

    let st = step(st, ev("on_human_input_request", json!({"kind":"tool_approval","request_id":"r1","prompt":"rm?"})), 24);
    assert_eq!(st["state"], "approval");
    assert_eq!(st["pending"], json!({"kind":"tool_approval","id":"r1","text":"rm?"}));
    let st = step(st, ev("on_human_input_resolved", json!({})), 25);
    assert_eq!((st["state"].as_str(), st["pending"].is_null()), (Some("thinking"), true));
    let st = step(st, ev("on_human_input_request", json!({"kind":"clarify","request_id":"r2","prompt":"?"})), 26);
    assert_eq!(st["state"], "question");

    let st = step(st, ev("on_session_end", json!({})), 30);
    assert_eq!(st["lastTurn"].as_u64(), Some(10));
    let st = step(st, ev("on_session_end", json!({})), 35);
    assert_eq!(st["lastTurn"].as_u64(), Some(10));
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

fn tool_ev(name: &str) -> Value {
    let mut e = ev(name, json!({}));
    e["tool_name"] = json!("terminal");
    e["tool_input"] = json!({"command": "ls"});
    e
}

#[test]
fn late_events_after_turn_end_stay_idle() {
    let st = step(Value::Null, ev("pre_llm_call", json!({"user_message": "hi"})), 10);
    let st = step(st, tool_ev("pre_tool_call"), 11);
    let st = step(st, tool_ev("post_tool_call"), 12);
    assert_eq!(st["state"], "thinking");
    let st = step(st, ev("on_session_end", json!({})), 13);
    assert_eq!((st["state"].as_str(), st["since"].as_u64()), (Some("idle"), Some(13)));
    // post-turn review fork / late delegated tool: bookkeeping only
    let late = step(st.clone(), tool_ev("post_tool_call"), 20);
    assert_eq!((late["state"].as_str(), late["since"].as_u64(), late["seen"].as_u64()), (Some("idle"), Some(13), Some(20)));
    let late = step(st.clone(), tool_ev("pre_tool_call"), 21);
    assert_eq!((late["state"].as_str(), late["tool"].as_str(), late["steps"].as_u64()), (Some("idle"), Some(""), Some(1)));
    // a new turn works as before
    let st = step(late, ev("pre_llm_call", json!({"user_message": "again"})), 30);
    let st = step(st, tool_ev("pre_tool_call"), 31);
    assert_eq!(st["state"], "tool");
}

#[test]
fn human_input_outside_a_turn() {
    let st = step(Value::Null, ev("on_session_open", json!({})), 1);
    let st = step(st, ev("on_human_input_request", json!({"kind":"clarify","request_id":"r","prompt":"q"})), 2);
    assert_eq!(st["state"], "question");
    let st = step(st, ev("on_human_input_resolved", json!({})), 3);
    assert_eq!((st["state"].as_str(), st["pending"].is_null()), (Some("idle"), true));
    // resolved after the turn ended: stays idle
    let st = step(Value::Null, ev("pre_llm_call", json!({"user_message": "x"})), 10);
    let st = step(st, ev("on_session_end", json!({})), 11);
    let st = step(st, ev("on_human_input_resolved", json!({})), 12);
    assert_eq!(st["state"], "idle");
}

#[test]
fn force_idle_only_clears_working_files() {
    let d = tempfile::tempdir().unwrap();
    let h = d.path();
    let f = h.join("sessions/hermes-local-a.json");
    let read = || -> Value { serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap() };
    let go = |e: Value, t: u64| run(&e.to_string(), h, t).unwrap();
    let dir = h.join("sessions");
    assert!(!perch_hook::force_idle(&dir, "local-a", 5), "no file");
    go(ev("pre_llm_call", json!({"user_message": "x"})), 10);
    go(tool_ev("pre_tool_call"), 11);
    assert!(perch_hook::force_idle(&dir, "local-a", 20));
    let st = read();
    assert_eq!((st["state"].as_str(), st["turnStart"].is_null(), st["tool"].as_str(), st["since"].as_u64()), (Some("idle"), true, Some(""), Some(20)));
    assert_eq!(st["busyTotal"], 10);
    assert!(!perch_hook::force_idle(&dir, "local-a", 30), "idle is a no-op");
    assert_eq!(read()["since"], 20);
    go(ev("on_session_finalize", json!({})), 31);
    assert!(!perch_hook::force_idle(&dir, "local-a", 32), "closed is a no-op");
    assert_eq!(read()["state"], "closed");
    assert!(!perch_hook::force_idle(&dir, "../x", 33));
}

#[test]
fn busy_total_accumulates_finished_turns() {
    let mut st = step(json!({}), ev("pre_llm_call", json!({"user_message": "x"})), 10);
    st = step(st, ev("on_session_end", json!({})), 13);
    assert_eq!(st["busyTotal"], 3);
    st = step(st, ev("pre_llm_call", json!({"user_message": "y"})), 20);
    st = step(st, ev("on_session_end", json!({})), 25);
    assert_eq!(st["busyTotal"], 8);
}

#[test]
fn subagent_hooks_use_top_level_session_id() {
    // Hermes puts parent_session_id at the top level (as session_id) and drops it from `extra`
    let d = tempfile::tempdir().unwrap();
    let h = d.path();
    run(&ev("on_session_open", json!({})).to_string(), h, 1).unwrap();
    let start = json!({"hook_event_name":"subagent_start","session_id":"local-a","extra":{"child_session_id":"local-c","child_role":"leaf","child_goal":"g"}});
    run(&start.to_string(), h, 2).unwrap();
    let st: Value = serde_json::from_str(&std::fs::read_to_string(h.join("sessions/hermes-local-a.json")).unwrap()).unwrap();
    assert_eq!(st["subagents"]["local-c"]["role"], "leaf");
}

#[test]
fn ends_with_question_table() {
    use perch_hook::ends_with_question as q;
    for yes in [
        "정리했어요. 이대로 진행해볼까요?", "Shall I go ahead?", "진행할까요？", "**A로 할까요?**", "어느 쪽이 좋을까요? 🙂", "(괜찮을까요?)", "\"Which one?\"",
        "다음 중 어느 쪽으로 할까요?\n\n- A: 빠름\n- B: 안전", "Which do you prefer?\n1. fast\n2. safe", "끝났어요.\n\n뭘 할까요?\n\n```\ncode?\n```",
    ] {
        assert!(q(yes), "{yes}");
    }
    for no in ["", "   \n\n", "다 끝났습니다.", "Done. Let me know if...", "왜 그런지 궁금하죠? 아래에 정리했습니다.", "should I? no, done",
        "```\nwhat?\n```", "목록:\n- a\n- b", "a?\n1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h"] {
        assert!(!q(no), "{no}");
    }
    assert_eq!(perch_hook::last_question("끝. 다음 단계로 갈까요?").as_deref(), Some("다음 단계로 갈까요?"));
    assert_eq!(perch_hook::last_question("Which?\n- a\n- b").as_deref(), Some("Which?"));
}

#[test]
fn post_llm_call_sets_and_pre_llm_call_clears_asks() {
    let st = step(Value::Null, ev("pre_llm_call", json!({"user_message": "x"})), 10);
    let st = step(st, ev("post_llm_call", json!({"assistant_response": "이걸로 할까요?"})), 11);
    assert_eq!((st["asks"].as_bool(), st["ask"].as_str(), st["state"].as_str()), (Some(true), Some("이걸로 할까요?"), Some("thinking")));
    let st = step(st, ev("on_session_end", json!({})), 12);
    assert_eq!(st["asks"], true);
    let st = step(st, ev("post_llm_call", json!({"assistant_response": "끝났습니다."})), 13);
    assert_eq!((st["asks"].as_bool(), st["ask"].as_str()), (Some(false), Some("")));
    let st = step(st, ev("post_llm_call", json!({"assistant_response": "뭘까요?"})), 14);
    let st = step(st, ev("pre_llm_call", json!({"user_message": "y"})), 15);
    assert_eq!((st["asks"].as_bool(), st["ask"].as_str()), (Some(false), Some("")));
}

#[test]
fn pane_env_is_written_only_when_safe() {
    let d = std::env::temp_dir().join(format!("perch-pane-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    let read = |id: &str| -> Value {
        serde_json::from_str(&std::fs::read_to_string(d.join(format!("sessions/hermes-{id}.json"))).unwrap()).unwrap()
    };
    let e = |sid: &str| json!({"hook_event_name": "on_session_open", "session_id": sid, "extra": {}}).to_string();
    perch_hook::run_pane(&e("a"), &d, 1, Some("p3")).unwrap();
    assert_eq!(read("a")["pane"], "p3");
    for (i, bad) in [None, Some(""), Some("a b"), Some("../x")].into_iter().enumerate() {
        let id = format!("b{i}");
        perch_hook::run_pane(&e(&id), &d, 1, bad).unwrap();
        assert!(read(&id).get("pane").is_none(), "{bad:?}");
    }
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn empty_perch_home_falls_back_to_home() {
    let (home, cwd) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let input = ev("on_session_open", json!({})).to_string();
    let mut c = Command::new(env!("CARGO_BIN_EXE_perch-hook"))
        .arg("hermes").env("PERCH_HOME", "").env("HOME", home.path()).env_remove("USERPROFILE").current_dir(cwd.path())
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let _ = c.stdin.take().unwrap().write_all(input.as_bytes());
    let o = c.wait_with_output().unwrap();
    assert!(o.status.success() && o.stdout.is_empty());
    assert!(!cwd.path().join("sessions").exists());
    assert!(home.path().join(".perch/sessions/hermes-local-a.json").exists());
}
