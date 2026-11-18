//! Relay between a chat pane and the Hermes gateway: `hermes gateway attach` gives a ws:// url,
//! this speaks just enough WebSocket over a plain TcpStream (loopback, no TLS) and forwards JSON lines.
//! The gateway rejects any connection that sends an Origin header, so the webview cannot connect itself.
use crate::desk::Desk;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{Manager, State};

#[derive(Debug)]
pub struct Attach {
    pub host: String,
    pub port: u16,
    pub path: String,
    /// `path` may carry the legacy session token and `protocols` the one-time ticket: never log either or put them into an error.
    /// Empty for a legacy `hermes serve` (token auth in the query string).
    pub protocols: Vec<String>,
}

/// Parses the JSON printed by `hermes gateway attach --json`. Errors never echo the input (it holds the ticket).
pub fn parse_attach(json: &str) -> Result<Attach, String> {
    let bad = || "gateway 주소를 해석할 수 없습니다".to_string();
    let v: serde_json::Value = serde_json::from_str(json).map_err(|_| bad())?;
    let url = v.get("url").and_then(|u| u.as_str()).ok_or_else(bad)?;
    let rest = url.strip_prefix("ws://").ok_or_else(bad)?;
    let (hostport, path) = match rest.find('/') {
        Some(i) => (&rest[..i], rest[i..].to_string()),
        None => (rest, "/".to_string()),
    };
    let (host, port) = match hostport.rsplit_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().map_err(|_| bad())?),
        None => (hostport, 80),
    };
    let protocols: Vec<String> = v
        .get("protocols")
        .and_then(|p| p.as_array())
        .map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect())
        .unwrap_or_default();
    if host.is_empty() || protocols.is_empty() {
        return Err(bad());
    }
    Ok(Attach { host: host.into(), port, path, protocols })
}

pub fn handshake_request(a: &Attach, key: &str) -> String {
    format!(
        "GET {} HTTP/1.1\r\nHost: {}:{}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {}\r\nSec-WebSocket-Version: 13\r\n{}\r\n",
        a.path,
        a.host,
        a.port,
        key,
        if a.protocols.is_empty() { String::new() } else { format!("Sec-WebSocket-Protocol: {}\r\n", a.protocols.join(", ")) }
    )
}

/// Client frame: FIN=1, masked.
pub fn encode_frame(opcode: u8, payload: &[u8], mask: [u8; 4]) -> Vec<u8> {
    let n = payload.len();
    let mut f = vec![0x80 | opcode];
    if n < 126 {
        f.push(0x80 | n as u8);
    } else if n <= 0xFFFF {
        f.push(0x80 | 126);
        f.extend((n as u16).to_be_bytes());
    } else {
        f.push(0x80 | 127);
        f.extend((n as u64).to_be_bytes());
    }
    f.extend(mask);
    f.extend(payload.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
    f
}

#[derive(Debug, PartialEq)]
pub enum Msg {
    Text(String),
    Ping(Vec<u8>),
    Close,
}

#[derive(Default)]
pub struct Decoder {
    buf: Vec<u8>,
    /// Payload of the data message being reassembled; Some(true) = text, Some(false) = binary (dropped)
    frag: Vec<u8>,
    kind: Option<bool>,
}

impl Decoder {
    /// Feeds bytes read from the socket; returns the complete messages they finish. UTF-8 is decoded only once a message is whole.
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<Msg> {
        self.buf.extend_from_slice(bytes);
        let mut out = vec![];
        let mut pos = 0;
        while let Some((fin, op, payload, used)) = parse_frame(&self.buf[pos..]) {
            pos += used;
            match op {
                0 | 1 | 2 => {
                    if op != 0 {
                        self.frag.clear();
                        self.kind = Some(op == 1);
                    }
                    if self.kind.is_some() {
                        self.frag.extend(payload);
                    }
                    if fin {
                        if self.kind == Some(true) {
                            out.push(Msg::Text(String::from_utf8_lossy(&self.frag).into_owned()));
                        }
                        self.frag.clear();
                        self.kind = None;
                    }
                }
                8 => out.push(Msg::Close),
                9 => out.push(Msg::Ping(payload)),
                _ => {}
            }
        }
        self.buf.drain(..pos);
        out
    }
}

/// (fin, opcode, unmasked payload, bytes used), or None if `b` holds no complete frame.
fn parse_frame(b: &[u8]) -> Option<(bool, u8, Vec<u8>, usize)> {
    if b.len() < 2 {
        return None;
    }
    let masked = b[1] & 0x80 != 0;
    let (len, mut at) = match b[1] & 0x7F {
        126 => (u16::from_be_bytes(b.get(2..4)?.try_into().ok()?) as usize, 4),
        127 => (u64::from_be_bytes(b.get(2..10)?.try_into().ok()?) as usize, 10),
        n => (n as usize, 2),
    };
    let mask: Option<[u8; 4]> = if masked { Some(b.get(at..at + 4)?.try_into().ok()?) } else { None };
    if masked {
        at += 4;
    }
    let payload = b.get(at..at.checked_add(len)?)?;
    let payload = match mask {
        Some(m) => payload.iter().enumerate().map(|(i, x)| x ^ m[i % 4]).collect(),
        None => payload.to_vec(),
    };
    Some((b[0] & 0x80 != 0, b[0] & 0x0F, payload, at + len))
}

fn mask_key() -> [u8; 4] {
    static N: AtomicU32 = AtomicU32::new(0);
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    // ponytail: loopback only, mask is not a security boundary
    t.wrapping_add(N.fetch_add(0x9E37_79B9, Ordering::Relaxed)).to_le_bytes()
}

fn closed_line(reason: &str) -> String {
    serde_json::json!({ "perch": "closed", "reason": reason }).to_string()
}

struct Conn {
    /// Shared by chat_send and the reader's Pong replies
    w: Arc<Mutex<TcpStream>>,
    /// Separate handle so Drop can shut down even while a write holds `w`
    sd: TcpStream,
}

impl Drop for Conn {
    fn drop(&mut self) {
        let _ = self.sd.shutdown(Shutdown::Both);
    }
}

#[derive(Default)]
struct ChatsInner {
    conns: HashMap<String, Conn>,
    /// Bumped by every begin/close, so a connect that finished late can tell it was superseded or cancelled
    gens: HashMap<String, u64>,
}

#[derive(Default)]
pub struct Chats(Mutex<ChatsInner>);

impl Chats {
    fn bump(g: &mut ChatsInner, id: &str) -> (u64, Option<Conn>) {
        let n = g.gens.entry(id.to_string()).or_insert(0);
        *n += 1;
        (*n, g.conns.remove(id))
    }

    /// Closes the pane's connection and cancels any connect still in flight.
    pub fn close(&self, id: &str) {
        let old = Self::bump(&mut self.0.lock().unwrap(), id).1;
        drop(old);
    }

    /// Starts a connect: closes the existing connection; only the returned generation may install.
    fn begin(&self, id: &str) -> u64 {
        let (n, old) = Self::bump(&mut self.0.lock().unwrap(), id);
        drop(old);
        n
    }

    #[cfg(test)]
    fn is_current(&self, id: &str, epoch: u64) -> bool {
        self.0.lock().unwrap().gens.get(id) == Some(&epoch)
    }

    /// Installs `conn` only if `epoch` is still current; otherwise it is dropped (socket shut down).
    fn install(&self, id: &str, epoch: u64, conn: Conn) -> bool {
        let mut g = self.0.lock().unwrap();
        if g.gens.get(id) != Some(&epoch) {
            return false;
        }
        g.conns.insert(id.to_string(), conn);
        true
    }

    fn writer(&self, id: &str) -> Option<Arc<Mutex<TcpStream>>> {
        self.0.lock().unwrap().conns.get(id).map(|c| c.w.clone())
    }
}

/// Error text from the JSON verdict `hermes gateway attach` prints on stdout when it fails.
/// Only `detail`, `reason_code` and `state` are read (never the ticket). None if `stdout` is not JSON or has none of them.
fn attach_failure(stdout: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(stdout.trim()).ok()?;
    ["detail", "reason_code", "state"]
        .iter()
        .find_map(|k| v.get(*k).and_then(|x| x.as_str()).filter(|s| !s.is_empty()))
        .map(String::from)
}

/// `Ok(None)`: this hermes has no `gateway attach` (< 0.23.1), use `legacy_attach`.
fn attach() -> Result<Option<Attach>, String> {
    let exe = crate::hermes::exe().ok_or("hermes 실행 파일을 찾을 수 없습니다")?;
    let mut cmd = std::process::Command::new(exe);
    // --recover stops a still-running older gateway once and starts the current one
    cmd.args(["gateway", "attach", "--json", "--recover", "--timeout", "60"])
        .stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().map_err(|e| format!("hermes를 실행할 수 없습니다: {e}"))?;
    if !out.status.success() {
        if out.status.code() == Some(2) {
            return Ok(None); // argparse rejected the unknown subcommand
        }
        if let Some(m) = attach_failure(&String::from_utf8_lossy(&out.stdout)) {
            return Err(m);
        }
        let err = String::from_utf8_lossy(&out.stderr);
        let chars: Vec<char> = err.trim().chars().collect();
        let tail: String = chars[chars.len().saturating_sub(300)..].iter().collect();
        return Err(if tail.is_empty() { "gateway에 연결하지 못했습니다".into() } else { tail });
    }
    parse_attach(&String::from_utf8_lossy(&out.stdout)).map(Some)
}

/// One `hermes serve` child shared by all panes: (child, port, token).
#[derive(Default)]
pub struct LegacyServe(Mutex<Option<(std::process::Child, u16, String)>>);

impl LegacyServe {
    /// Called on app exit.
    pub fn kill(&self) {
        if let Some((c, _, _)) = self.0.lock().unwrap().as_mut() {
            let _ = c.kill();
        }
    }
}

fn session_token() -> String {
    use std::hash::{BuildHasher, Hasher};
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    // ponytail: loopback-only token, swap for getrandom if it ever matters
    (0..2)
        .map(|_| {
            let mut h = std::collections::hash_map::RandomState::new().build_hasher();
            h.write_u128(t);
            h.write_u32(std::process::id());
            format!("{:016x}", h.finish())
        })
        .collect()
}

/// Older Hermes (no `gateway attach`): runs our own `hermes serve` on a free loopback port, started lazily and reused.
fn legacy_attach(state: &LegacyServe) -> Result<Attach, String> {
    let mut g = state.0.lock().unwrap(); // held while starting, so panes connecting together share one child
    let alive = g.as_mut().is_some_and(|e| matches!(e.0.try_wait(), Ok(None)));
    if let (true, Some((_, port, token))) = (alive, g.as_ref()) {
        return Ok(Attach { host: "127.0.0.1".into(), port: *port, path: format!("/api/ws?token={token}"), protocols: vec![] });
    }
    let exe = crate::hermes::exe().ok_or("hermes 실행 파일을 찾을 수 없습니다")?;
    // ponytail: the port is only known free until the child binds it; another process could grab it in between
    let port = std::net::TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map_err(|e| e.to_string())?.port();
    let token = session_token();
    let mut cmd = std::process::Command::new(exe);
    cmd.args(["serve", "--host", "127.0.0.1", "--port", &port.to_string()])
        .env("HERMES_DASHBOARD_SESSION_TOKEN", &token)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("hermes serve를 실행할 수 없습니다: {e}"))?;
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    for _ in 0..300 {
        if let Ok(Some(st)) = child.try_wait() {
            let code = st.code().map_or("알 수 없음".to_string(), |c| c.to_string());
            return Err(format!("hermes serve가 종료되었습니다 (종료 코드 {code}). 터미널에서 `hermes serve`를 실행해 원인을 확인하세요."));
        }
        if TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(200)).is_ok() {
            *g = Some((child, port, token.clone()));
            return Ok(Attach { host: "127.0.0.1".into(), port, path: format!("/api/ws?token={token}"), protocols: vec![] });
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    let _ = child.kill();
    Err("hermes serve가 60초 안에 시작되지 않았습니다. 터미널에서 `hermes serve`를 실행해 원인을 확인하세요.".into())
}

/// Connects and upgrades; returns the stream plus any bytes that arrived after the response headers.
fn connect(a: &Attach) -> Result<(TcpStream, Vec<u8>), String> {
    let mut s = TcpStream::connect((a.host.as_str(), a.port)).map_err(|e| format!("gateway에 접속할 수 없습니다: {e}"))?;
    let _ = s.set_nodelay(true);
    let _ = s.set_read_timeout(Some(std::time::Duration::from_secs(10)));
    s.write_all(handshake_request(a, "cGVyY2gtY2hhdC1wYW5lIQ==").as_bytes()).map_err(|e| format!("gateway 접속 실패: {e}"))?;
    let mut head = Vec::new();
    let mut chunk = [0u8; 2048];
    let end = loop {
        if let Some(i) = head.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
        if head.len() > 16 * 1024 {
            return Err("gateway 응답이 올바르지 않습니다".into());
        }
        match s.read(&mut chunk) {
            Ok(0) => return Err("gateway가 연결을 닫았습니다".into()),
            Ok(n) => head.extend_from_slice(&chunk[..n]),
            Err(e) => return Err(format!("gateway 응답을 받지 못했습니다: {e}")),
        }
    };
    let status = String::from_utf8_lossy(&head[..head.iter().position(|&b| b == b'\r').unwrap_or(0)]).into_owned();
    if !status.starts_with("HTTP/1.1 101") {
        return Err(format!("gateway가 접속을 거부했습니다: {status}"));
    }
    let _ = s.set_read_timeout(None);
    Ok((s, head[end..].to_vec()))
}

fn read_loop(mut r: TcpStream, w: Arc<Mutex<TcpStream>>, rest: Vec<u8>, on_line: Channel<String>) {
    let mut d = Decoder::default();
    let mut pending = d.feed(&rest);
    let mut buf = [0u8; 8192];
    let reason = 'outer: loop {
        for m in pending.drain(..) {
            match m {
                Msg::Text(t) => {
                    for l in t.split('\n').filter(|l| !l.trim().is_empty()) {
                        let _ = on_line.send(l.trim_end_matches('\r').to_string());
                    }
                }
                Msg::Ping(p) => {
                    let _ = w.lock().unwrap().write_all(&encode_frame(0xA, &p, mask_key()));
                }
                Msg::Close => break 'outer "close",
            }
        }
        match r.read(&mut buf) {
            Ok(0) => break "eof",
            Ok(n) => pending = d.feed(&buf[..n]),
            Err(_) => break "error",
        }
    };
    let _ = on_line.send(closed_line(reason));
}

#[tauri::command]
pub async fn chat_connect(
    desk: State<'_, Desk>,
    chats: State<'_, Chats>,
    app: tauri::AppHandle,
    id: String,
    on_line: Channel<String>,
) -> Result<(), String> {
    desk.check_chat(&id)?;
    let epoch = chats.begin(&id);
    let (stream, rest) = tauri::async_runtime::spawn_blocking(move || {
        let a = match attach()? {
            Some(a) => a,
            None => legacy_attach(&app.state::<LegacyServe>())?,
        };
        connect(&a)
    })
        .await
        .map_err(|e| e.to_string())??;
    let w = Arc::new(Mutex::new(stream.try_clone().map_err(|e| e.to_string())?));
    let conn = Conn { w: w.clone(), sd: stream.try_clone().map_err(|e| e.to_string())? };
    if desk.check_chat(&id).is_err() || !chats.install(&id, epoch, conn) {
        let _ = stream.shutdown(Shutdown::Both);
        return Err("연결이 취소되었습니다".into());
    }
    std::thread::spawn(move || read_loop(stream, w, rest, on_line));
    Ok(())
}

#[tauri::command]
pub async fn chat_send(chats: State<'_, Chats>, id: String, line: String) -> Result<(), String> {
    let w = chats.writer(&id).ok_or("연결되지 않았습니다")?;
    let r = w.lock().unwrap().write_all(&encode_frame(1, line.as_bytes(), mask_key()));
    r.map_err(|e| format!("전송하지 못했습니다: {e}"))
}

#[tauri::command]
pub async fn chat_close(chats: State<'_, Chats>, id: String) -> Result<(), String> {
    chats.close(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attach_parses() {
        let a = parse_attach(r#"{"url":"ws://127.0.0.1:9120/api/ws","protocols":["hermes-gateway-v1","hermes-gateway-ticket.abc"]}"#).unwrap();
        assert_eq!((a.host.as_str(), a.port, a.path.as_str()), ("127.0.0.1", 9120, "/api/ws"));
        assert_eq!(a.protocols.len(), 2);
        assert!(parse_attach(r#"{"url":"http://x/","protocols":["a"]}"#).is_err());
        assert!(parse_attach(r#"{"url":"ws://127.0.0.1:1/api/ws","protocols":[]}"#).is_err());
        let e = parse_attach(r#"{"url":"wss://h/","protocols":["hermes-gateway-ticket.SECRET"]}"#).unwrap_err();
        assert!(!e.contains("SECRET"));
    }

    #[test]
    fn attach_failure_picks_fields() {
        assert_eq!(attach_failure(r#"{"state":"incompatible","reason_code":"runtime_protocol","detail":"old gateway"}"#).as_deref(), Some("old gateway"));
        assert_eq!(attach_failure(r#"{"state":"incompatible","reason_code":"runtime_protocol"}"#).as_deref(), Some("runtime_protocol"));
        assert_eq!(attach_failure(r#"{"state":"failed"}"#).as_deref(), Some("failed"));
        assert_eq!(attach_failure("usage: hermes ..."), None);
    }

    #[test]
    fn handshake_without_protocols_omits_header() {
        let a = Attach { host: "127.0.0.1".into(), port: 1, path: "/api/ws?token=t".into(), protocols: vec![] };
        let r = handshake_request(&a, "k");
        assert!(!r.contains("Sec-WebSocket-Protocol") && r.ends_with("Sec-WebSocket-Version: 13\r\n\r\n"));
    }

    #[test]
    fn connect_generations() {
        let c = Chats::default();
        let g = c.begin("p1");
        assert!(c.is_current("p1", g));
        c.close("p1");
        assert!(!c.is_current("p1", g), "close during connect cancels it");
        let (a, b) = (c.begin("p2"), c.begin("p2"));
        assert!(!c.is_current("p2", a) && c.is_current("p2", b));
    }

    #[test]
    fn handshake_has_protocols_and_no_origin() {
        let a = parse_attach(r#"{"url":"ws://127.0.0.1:9120/api/ws","protocols":["p1","p2"]}"#).unwrap();
        let r = handshake_request(&a, "k");
        assert!(r.starts_with("GET /api/ws HTTP/1.1\r\n") && r.ends_with("\r\n\r\n"));
        assert!(r.contains("Host: 127.0.0.1:9120\r\n") && r.contains("Sec-WebSocket-Protocol: p1, p2\r\n"));
        assert!(!r.to_lowercase().contains("origin"));
    }

    #[test]
    fn encode_lengths() {
        let m = [1, 2, 3, 4];
        let f = encode_frame(1, b"hi", m);
        assert_eq!(&f[..6], &[0x81, 0x82, 1, 2, 3, 4]);
        assert_eq!(&f[6..], &[b'h' ^ 1, b'i' ^ 2]);
        assert_eq!(encode_frame(1, &[0; 126], m)[1], 0x80 | 126);
        assert_eq!(encode_frame(1, &[0; 70000], m)[1], 0x80 | 127);
    }

    // server frames are unmasked
    fn srv(fin: bool, op: u8, p: &[u8]) -> Vec<u8> {
        let mut f = vec![if fin { 0x80 } else { 0 } | op];
        if p.len() < 126 {
            f.push(p.len() as u8);
        } else if p.len() <= 0xFFFF {
            f.push(126);
            f.extend((p.len() as u16).to_be_bytes());
        } else {
            f.push(127);
            f.extend((p.len() as u64).to_be_bytes());
        }
        f.extend(p);
        f
    }

    #[test]
    fn decode_split_across_reads_and_many_per_read() {
        let mut d = Decoder::default();
        let mut all = srv(true, 1, b"one");
        all.extend(srv(true, 1, b"two"));
        assert!(d.feed(&all[..3]).is_empty());
        assert_eq!(d.feed(&all[3..]), vec![Msg::Text("one".into()), Msg::Text("two".into())]);
    }

    #[test]
    fn decode_fragmented_utf8_and_control() {
        let mut d = Decoder::default();
        let s = "한글".as_bytes(); // 6 bytes; split inside the first character
        let mut b = srv(false, 1, &s[..2]);
        b.extend(srv(true, 9, b"p")); // ping between fragments
        b.extend(srv(true, 0, &s[2..]));
        b.extend(srv(true, 8, b""));
        assert_eq!(d.feed(&b), vec![Msg::Ping(b"p".to_vec()), Msg::Text("한글".into()), Msg::Close]);
    }

    #[test]
    fn decode_long_frame() {
        let mut d = Decoder::default();
        let p = vec![b'a'; 70000];
        assert_eq!(d.feed(&srv(true, 1, &p)), vec![Msg::Text(String::from_utf8(p).unwrap())]);
    }

    #[test]
    fn decode_byte_by_byte_and_binary_ignored() {
        let mut d = Decoder::default();
        let mut all = srv(true, 2, b"bin");
        all.extend(srv(true, 1, b"ok"));
        let got: Vec<Msg> = all.iter().flat_map(|b| d.feed(&[*b])).collect();
        assert_eq!(got, vec![Msg::Text("ok".into())]);
    }
}
