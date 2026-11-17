"""Hermes Agent 세션 대시보드 (Tabby 등 아무 터미널에서 사용).

  dash                       대시보드 (Ctrl+C 종료)
  dash tab [hermes 인자...]   Tabby 탭에서 hermes 실행 + 탭 제목에 상태 표시
  dash hook                  Hermes 셸 훅 (Hermes가 호출, stdin = JSON)
  dash install [HERMES_HOME] / uninstall [HERMES_HOME]
  dash demo                  자체 점검

Hermes 0.23의 에이전트는 공용 gateway 프로세스에서 돌기 때문에 훅은 상태만 파일로 남기고,
탭 제목은 각 탭의 `dash tab` 래퍼가 자기 세션을 찾아 바꾼다.
"""
import ctypes, json, os, re, shutil, signal, subprocess, sys, time
from pathlib import Path

WIN = sys.platform == "win32"
FROZEN = getattr(sys, "frozen", False)
ROOT = Path(os.environ.get("AGENT_DASH_HOME") or Path.home() / ".agent-dash")
SES, CHILD, TABS = ROOT / "sessions", ROOT / "children", ROOT / "tabs"
RECENT = 30 * 60  # 탭 래퍼 없이 연 세션(Desktop 등)은 최근 30분 내 활동만 표시

# ---------------------------------------------------------------- 상태 기록 (훅)

def locked(path, fn):
    lock = path.with_suffix(".lock")
    for _ in range(250):  # 서브에이전트 훅이 동시에 같은 파일을 건드림
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL); break
        except FileExistsError:
            try:
                if time.time() - lock.stat().st_mtime > 5: lock.unlink()
            except OSError: pass
            time.sleep(0.02)
    else:
        return
    try:
        s = json.loads(path.read_text("utf-8")) if path.exists() else {}
        s = fn(s)
        if s is None: path.unlink(missing_ok=True)
        else:
            tmp = path.with_suffix(".tmp"); tmp.write_text(json.dumps(s, ensure_ascii=False), "utf-8"); os.replace(tmp, path)
    finally:
        os.close(fd); lock.unlink(missing_ok=True)


def apply(s, e, now):
    """Hermes 훅 이벤트 하나를 세션 상태에 반영. None = 세션 파일 삭제."""
    ev, x = e.get("hook_event_name"), e.get("extra") or {}
    if ev == "on_session_delete": return None
    s.setdefault("agents", {}); s.setdefault("opened", now)
    s["seen"], s["profile"] = now, e.get("profile", s.get("profile", ""))
    def state(st):
        if s.get("state") != st: s["state"], s["since"] = st, now
    if ev == "on_session_open":
        s["opened"] = now; state(s.get("state") or "idle")
    elif ev == "pre_llm_call":
        state("running"); s["tool"] = ""
        s["prompt"] = " ".join(str(x.get("user_message") or "").split())[:80]
    elif ev == "post_tool_call":
        state("running"); s["tool"] = e.get("tool_name") or ""
    elif ev == "on_human_input_request":
        state({"approval": "approval", "sudo": "approval"}.get(x.get("kind"), "question"))
    elif ev == "on_human_input_resolved":
        state("running")
    elif ev in ("on_session_end", "agent_loop_stopped"):
        state("idle"); s["tool"] = ""
    elif ev == "on_session_finalize":
        state("closed")
    elif ev == "subagent_start":
        s["agents"][x.get("child_session_id") or str(now)] = {
            "role": x.get("child_role") or "subagent", "goal": " ".join(str(x.get("child_goal") or "").split())[:100],
            "start": now, "tool": ""}
    elif ev == "subagent_stop":
        s["agents"].pop(x.get("child_session_id"), None)
    return s


def hook():
    try:
        raw = sys.stdin.buffer.read()
        try: e = json.loads(raw.decode("utf-8-sig"))
        except UnicodeDecodeError: e = json.loads(raw.decode("mbcs" if WIN else "latin-1"))  # PowerShell 5.1 파이프
        for d in (SES, CHILD): d.mkdir(parents=True, exist_ok=True)
        x, ev = e.get("extra") or {}, e.get("hook_event_name")
        sid = e.get("session_id") or x.get("parent_session_id") or ""
        if ev == "subagent_start" and x.get("child_session_id"):
            (CHILD / x["child_session_id"]).write_text(sid, "utf-8")
        old, new = x.get("old_session_id"), x.get("new_session_id")
        if old and new and old != new:  # /new, 압축 등으로 세션이 바뀌면 탭이 따라가도록 기록
            locked(SES / f"{new}.json", lambda s: {**s, "prev": old})
        parent = (CHILD / sid).read_text("utf-8") if sid and (CHILD / sid).exists() else ""
        if parent:  # 서브에이전트 자신의 이벤트 → 부모 세션의 해당 에이전트 줄만 갱신
            def upd(s):
                a = s.get("agents", {}).get(sid)
                if a and ev == "post_tool_call": a["tool"] = e.get("tool_name") or ""
                return s or None
            if ev == "post_tool_call": locked(SES / f"{parent}.json", upd)
            return
        if sid: locked(SES / f"{sid}.json", lambda s: apply(s, e, time.time()))
    except Exception:
        pass  # 대시보드 오류가 Hermes 작업을 막으면 안 됨 (항상 exit 0)

# ---------------------------------------------------------------- 표시

STATE = {"running": ("\033[32m", "●", "작업중"), "approval": ("\033[31m", "⚠", "승인대기"),
         "question": ("\033[31m", "?", "질문대기"), "idle": ("\033[33m", "◆", "답변대기"),
         "closed": ("\033[90m", "○", "종료")}


def alive(pid):
    """프로세스 생존 여부. (Windows의 os.kill(pid, 0)은 프로세스를 죽이므로 쓰지 않음)"""
    if not WIN:
        try: os.kill(pid, 0); return True
        except OSError: return False
    k = ctypes.windll.kernel32
    h = k.OpenProcess(0x1000, False, int(pid))
    if not h: return False
    try:
        code = ctypes.c_ulong(); k.GetExitCodeProcess(h, ctypes.byref(code)); return code.value == 259
    finally: k.CloseHandle(h)


def read_json(f):
    try: return json.loads(f.read_text("utf-8"))
    except Exception: return None


def load_sessions():
    out = {}
    for f in SES.glob("*.json"):
        s = read_json(f)
        if s: out[f.stem] = s
    return out


def live_tabs():
    tabs = {}
    for f in TABS.glob("*.json"):
        t = read_json(f)
        if t and alive(t.get("pid", 0)): tabs[t["pid"]] = t
        else: f.unlink(missing_ok=True)
    return tabs


def fmt(sec):
    m, s = divmod(max(0, int(sec)), 60); h, m = divmod(m, 60)
    return f"{h}h{m:02d}m" if h else f"{m}m{s:02d}s"


def rows_for(sessions, tabs, now):
    by_sid = {t.get("session"): t for t in tabs.values() if t.get("session")}
    rows = []
    for sid, s in sessions.items():
        tab = by_sid.get(sid)
        if not tab and (s.get("state") == "closed" or now - s.get("seen", 0) > RECENT): continue
        rows.append((sid, s, tab))
    for t in tabs.values():  # 탭은 열렸는데 아직 세션이 없음
        if not t.get("session") or t["session"] not in sessions:
            rows.append(("", {"state": "idle", "since": t.get("start", now), "agents": {}}, t))
    order = ["approval", "question", "idle", "running", "closed"]
    rows.sort(key=lambda r: (order.index(r[1].get("state", "idle")) if r[1].get("state") in order else 0,
                             -(now - r[1].get("since", now))))
    return rows


def render(rows, now):
    cnt = {}
    for _, s, _ in rows: cnt[s.get("state")] = cnt.get(s.get("state"), 0) + 1
    wait = cnt.get("approval", 0) + cnt.get("question", 0) + cnt.get("idle", 0)
    out = [f"\033[H\033[J\033[1mHermes 세션 {len(rows)}개  작업중 {cnt.get('running', 0)} · 내 차례 {wait}"
           f"   {time.strftime('%H:%M:%S')}\033[0m", ""]
    for sid, s, tab in rows:
        c, icon, txt = STATE.get(s.get("state"), ("\033[31m", "⚠", str(s.get("state"))))
        ag = s.get("agents", {})
        where = f"탭 {tab.get('label')}" if tab else "탭 없음"
        out.append(f"{c}{icon} {txt:<4} {fmt(now - s.get('since', now)):>7}\033[0m  \033[1m{where}\033[0m"
                   + (f"  \033[36m🤖{len(ag)}\033[0m" if ag else "")
                   + (f"  \033[90m{s['tool']}\033[0m" if s.get("tool") else ""))
        out.append(f"   \033[90m{sid[:24] or '(세션 시작 전)'}  {s.get('profile', '')}  › {s.get('prompt', '')}\033[0m")
        for a in sorted(ag.values(), key=lambda a: a["start"]):
            out.append(f"   └ \033[36m{a['role']}\033[0m {fmt(now - a['start'])}  {a['goal']}"
                       + (f"  \033[90m{a['tool']}\033[0m" if a.get("tool") else ""))
    if not rows: out.append("열린 Hermes 세션 없음  (Tabby 탭에서 `dash tab`으로 hermes를 실행하세요)")
    return "\n".join(out) + "\n"


def dashboard():
    if WIN: ctypes.windll.kernel32.SetConsoleMode(ctypes.windll.kernel32.GetStdHandle(-11), 7)  # ANSI
    if WIN: ctypes.windll.kernel32.SetConsoleTitleW("Hermes 대시보드")
    while True:
        now = time.time()
        sys.stdout.write(render(rows_for(load_sessions(), live_tabs(), now), now)); sys.stdout.flush()
        time.sleep(1)

# ---------------------------------------------------------------- 탭 래퍼

def set_title(t):
    if WIN: ctypes.windll.kernel32.SetConsoleTitleW(t)
    else: sys.stdout.write(f"\033]0;{t}\007"); sys.stdout.flush()


def pick_session(tab, sessions, tabs):
    """이 탭의 세션: --resume ID > 현재 세션의 후속(/new 등) > 탭 시작 후 처음 열린, 다른 탭이 안 가진 세션."""
    cur = tab.get("session")
    if cur:
        nxt = [sid for sid, s in sessions.items() if s.get("prev") == cur]
        return nxt[0] if nxt else cur
    taken = {t.get("session") for p, t in tabs.items() if p != tab["pid"]}
    fresh = sorted((s.get("opened", 0), sid) for sid, s in sessions.items()
                   if sid not in taken and s.get("opened", 0) >= tab["start"] - 2)
    # ponytail: 두 탭을 1~2초 안에 동시에 열면 세션이 뒤바뀔 수 있음. 정확히 하려면 --resume ID 사용
    return fresh[0][1] if fresh else None


def title_for(s, now, label):
    _, icon, txt = STATE.get(s.get("state"), ("", "⚠", str(s.get("state"))))
    n = len(s.get("agents", {}))
    return f"{icon} {txt} {int((now - s.get('since', now)) // 60)}m · {label}" + (f" 🤖{n}" if n else "")


def tab(args):
    TABS.mkdir(parents=True, exist_ok=True)
    exe = shutil.which("hermes") or "hermes"
    cmd = [exe] + args
    m = re.search(r"--resume[= ](\S+)", " ".join(args))
    signal.signal(signal.SIGINT, signal.SIG_IGN)  # Ctrl+C는 hermes가 받아야 함
    p = subprocess.Popen(cmd)
    me = {"pid": os.getpid(), "child": p.pid, "start": time.time(), "session": m.group(1) if m else None,
          "label": Path.cwd().name or str(Path.cwd())}
    f = TABS / f"{os.getpid()}.json"
    last = ""
    try:
        while p.poll() is None:
            now, sessions = time.time(), load_sessions()
            sid = pick_session(me, sessions, live_tabs())
            if sid != me["session"] or not f.exists():
                me["session"] = sid; f.write_text(json.dumps(me, ensure_ascii=False), "utf-8")
            t = title_for(sessions.get(sid) or {"state": "idle", "since": me["start"]}, now, me["label"])
            if t != last: set_title(t); last = t
            try: p.wait(1)
            except subprocess.TimeoutExpired: pass
    finally:
        f.unlink(missing_ok=True)
    sys.exit(p.returncode)

# ---------------------------------------------------------------- 설치 (Hermes config.yaml 에만 등록)

EVENTS = ["on_session_open", "pre_llm_call", "post_tool_call", "on_human_input_request", "on_human_input_resolved",
          "on_session_end", "agent_loop_stopped", "on_session_finalize", "on_session_delete",
          "subagent_start", "subagent_stop"]  # pre_tool_call은 일부러 제외: 실패 시 도구 호출을 막을 수 있음
BEGIN, END = "# >>> agent-dash (자동 생성, 직접 수정 금지)", "# <<< agent-dash"
DEST = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "agent-dash"


def hermes_home(arg):
    h = Path(arg or os.environ.get("HERMES_HOME") or Path.home() / ".hermes")
    if not (h / "config.yaml").exists(): sys.exit(f"Hermes 설정을 찾지 못했습니다: {h / 'config.yaml'}\n"
                                                  f"사용법: dash install <HERMES_HOME 경로>")
    return h


def hook_command():
    if FROZEN: return f'"{(DEST / "dash.exe").as_posix()}" hook'
    return f'"{Path(sys.executable).as_posix()}" "{(DEST / "dash.py").as_posix()}" hook'


def strip_block(text):
    return re.sub(rf"\n?{re.escape(BEGIN)}.*?{re.escape(END)}\n?", "\n", text, flags=re.S)


def install(arg):
    home = hermes_home(arg)
    cfg = home / "config.yaml"
    text = strip_block(cfg.read_text("utf-8"))
    if re.search(r"(?m)^hooks:", text):
        sys.exit("config.yaml에 이미 hooks: 항목이 있어 자동으로 합칠 수 없습니다. 아래 이벤트를 직접 추가하세요:\n"
                 + "\n".join(f"  {e}: [{{command: '{hook_command()}', timeout: 10}}]" for e in EVENTS))
    if FROZEN and Path(sys.executable).parent.resolve() != DEST.resolve():
        shutil.rmtree(DEST, ignore_errors=True); shutil.copytree(Path(sys.executable).parent, DEST)
    elif not FROZEN:
        DEST.mkdir(parents=True, exist_ok=True); shutil.copy2(__file__, DEST / "dash.py")
    cmd = hook_command()
    block = [BEGIN, "hooks:"] + [f"  {e}:\n    - command: '{cmd}'\n      timeout: 10" for e in EVENTS] + [END]
    shutil.copy2(cfg, cfg.with_suffix(".yaml.bak-agent-dash"))
    cfg.write_text(text.rstrip("\n") + "\n\n" + "\n".join(block) + "\n", "utf-8")
    # 첫 실행 승인 프롬프트 대신 허용 목록에 미리 등록 (명령 문자열이 정확히 같아야 함)
    al = home / "shell-hooks-allowlist.json"
    data = read_json(al) if al.exists() else None
    data = data if isinstance(data, dict) else {}
    ap = [a for a in data.get("approvals", []) if "agent-dash" not in str(a.get("command", ""))]
    ap += [{"event": e, "command": cmd} for e in EVENTS]
    data["approvals"] = ap
    al.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")
    print(f"설치 완료\n  프로그램: {DEST}\n  Hermes 설정: {cfg} (백업: {cfg.name}.bak-agent-dash)\n"
          f"  확인: hermes hooks list\n새 hermes 세션부터 적용됩니다.")


def uninstall(arg):
    home = hermes_home(arg)
    cfg = home / "config.yaml"
    cfg.write_text(strip_block(cfg.read_text("utf-8")), "utf-8")
    al = home / "shell-hooks-allowlist.json"
    if al.exists() and isinstance(d := read_json(al), dict):
        d["approvals"] = [a for a in d.get("approvals", []) if "agent-dash" not in str(a.get("command", ""))]
        al.write_text(json.dumps(d, indent=2, ensure_ascii=False), "utf-8")
    print(f"Hermes 설정에서 훅을 제거했습니다. 프로그램 폴더는 직접 지우세요: {DEST}")

# ---------------------------------------------------------------- 점검

def demo():
    t, s = 1000.0, {}
    s = apply(s, {"hook_event_name": "on_session_open", "profile": "default"}, t)
    s = apply(s, {"hook_event_name": "pre_llm_call", "extra": {"user_message": "빌드  해줘"}}, t + 1)
    assert s["state"] == "running" and s["since"] == t + 1 and s["prompt"] == "빌드 해줘"
    s = apply(s, {"hook_event_name": "subagent_start", "extra": {"child_session_id": "c1", "child_role": "leaf", "child_goal": "로그 분석"}}, t + 2)
    s = apply(s, {"hook_event_name": "on_human_input_request", "extra": {"kind": "approval"}}, t + 3)
    assert s["state"] == "approval" and list(s["agents"]) == ["c1"]
    s = apply(s, {"hook_event_name": "post_tool_call", "tool_name": "terminal"}, t + 4)
    assert s["state"] == "running" and s["tool"] == "terminal"
    s = apply(s, {"hook_event_name": "subagent_stop", "extra": {"child_session_id": "c1"}}, t + 5)
    s = apply(s, {"hook_event_name": "on_session_end"}, t + 6)
    assert s["state"] == "idle" and s["agents"] == {} and s["since"] == t + 6
    assert apply(s, {"hook_event_name": "on_session_delete"}, t) is None
    # 탭 ↔ 세션 연결
    me = {"pid": 1, "start": 100.0, "session": None}
    ses = {"old": {"opened": 50}, "a": {"opened": 101}, "b": {"opened": 103}}
    assert pick_session(me, ses, {2: {"session": "a"}}) == "b"
    me["session"] = "b"; ses["n"] = {"opened": 200, "prev": "b"}
    assert pick_session(me, ses, {}) == "n"
    assert strip_block(f"a: 1\n\n{BEGIN}\nhooks:\n  x: 1\n{END}\n") .strip() == "a: 1"
    assert alive(os.getpid()) and not alive(99999999)
    print("ok")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    a = sys.argv[1:]
    cmd = a[0] if a else ""
    if cmd == "hook": hook(); sys.exit(0)
    elif cmd == "tab": tab(a[1:])
    elif cmd == "install": install(a[1] if len(a) > 1 else None)
    elif cmd == "uninstall": uninstall(a[1] if len(a) > 1 else None)
    elif cmd == "demo": demo()
    else:
        try: dashboard()
        except KeyboardInterrupt: pass
