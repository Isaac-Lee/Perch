use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};

/// Output batching: at most this much added latency, and at most this many bytes per message.
const BATCH_WAIT: std::time::Duration = std::time::Duration::from_millis(4);
const BATCH_MAX: usize = 256 * 1024;

pub struct Pty {
    master: Option<Box<dyn MasterPty + Send>>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

pub fn command_for(agent: &str, windows: bool) -> (String, Vec<String>) {
    match (agent, windows) {
        ("shell", true) => ("powershell.exe".into(), vec!["-NoLogo".into()]),
        ("shell", false) => (std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into()), vec![]),
        (name, true) => ("cmd.exe".into(), vec!["/c".into(), name.into()]),
        (name, false) => (name.into(), vec![]),
    }
}

/// Like `command_for`, but hermes is started from its resolved executable in TUI mode (markdown, clickable links, image paste),
/// optionally `--resume <id>`.
pub fn launch(agent: &str, windows: bool, hermes_exe: Option<&std::path::Path>, resume: Option<&str>) -> Result<(String, Vec<String>), String> {
    if agent != "hermes" {
        return Ok(command_for(agent, windows));
    }
    let exe = hermes_exe.ok_or("hermes 실행 파일을 찾지 못했습니다")?;
    let mut args = vec!["--tui".to_string()];
    if let Some(id) = resume {
        args.extend(["--resume".to_string(), id.to_string()]);
    }
    Ok((exe.to_string_lossy().into_owned(), args))
}

pub fn spawn(
    program: &str,
    args: &[String],
    cwd: &str,
    env: &[(String, String)],
    cols: u16,
    rows: u16,
    mut on_data: impl FnMut(&[u8]) + Send + 'static,
    on_exit: impl FnOnce() + Send + 'static,
) -> Result<Pty, String> {
    if !std::path::Path::new(cwd).is_dir() {
        return Err(format!("폴더가 없습니다: {cwd}"));
    }
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new(program);
    cmd.args(args);
    cmd.cwd(cwd);
    for (k, v) in env {
        cmd.env(k, v);
    }
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // ConPTY hands out output in tiny reads (about two per line). One IPC message per read caps the app at
    // ~60 lines/s per pane, so reads are coalesced: the first chunk waits up to BATCH_WAIT for more to arrive.
    // The bounded channel blocks the reader (and through it the child) when the consumer falls behind.
    let (tx, rx) = std::sync::mpsc::sync_channel::<Vec<u8>>(1024);
    std::thread::spawn(move || {
        let mut buf = [0u8; 65536];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
                break;
            }
        }
    });
    std::thread::spawn(move || {
        while let Ok(mut batch) = rx.recv() {
            let deadline = std::time::Instant::now() + BATCH_WAIT;
            while batch.len() < BATCH_MAX {
                match rx.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now())) {
                    Ok(more) => batch.extend_from_slice(&more),
                    Err(_) => break,
                }
            }
            on_data(&batch);
        }
    });
    // ConPTY may never send read EOF, so exit is detected by wait().
    std::thread::spawn(move || {
        let _ = child.wait();
        on_exit();
    });
    Ok(Pty { master: Some(pair.master), writer, killer })
}

impl Pty {
    pub fn write(&mut self, data: &[u8]) -> Result<(), String> {
        self.writer.write_all(data).and_then(|_| self.writer.flush()).map_err(|e| e.to_string())
    }
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .as_ref()
            .ok_or("closed")?
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())
    }
    pub fn kill(&mut self) {
        let _ = self.killer.kill();
    }
}

impl Drop for Pty {
    fn drop(&mut self) {
        self.kill();
        // Dropping a ConPTY master (ClosePseudoConsole) can block; never do it on the caller's thread.
        if let Some(m) = self.master.take() {
            std::thread::spawn(move || drop(m));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::{Duration, Instant};

    fn tmp() -> String {
        std::env::temp_dir().to_string_lossy().into_owned()
    }

    #[test]
    fn echo_output_and_exit() {
        let (prog, args): (&str, Vec<String>) = if cfg!(windows) {
            ("cmd.exe", vec!["/c".into(), "echo hi".into()])
        } else {
            ("sh", vec!["-c".into(), "echo hi".into()])
        };
        let out = Arc::new(Mutex::new(Vec::new()));
        let o = out.clone();
        let (tx, rx) = mpsc::channel();
        let mut p = spawn(prog, &args, &tmp(), &[], 80, 24,
            move |b| o.lock().unwrap().extend_from_slice(b),
            move || { let _ = tx.send(()); }).unwrap();
        // ConPTY asks for the cursor position (ESC[6n) and stalls until answered; xterm does this in the app.
        let (t, mut replied, mut exited) = (Instant::now(), false, false);
        loop {
            let text = String::from_utf8_lossy(&out.lock().unwrap()).into_owned();
            if !replied && text.contains("\x1b[6n") {
                p.write(b"\x1b[1;1R").unwrap();
                replied = true;
            }
            exited |= rx.try_recv().is_ok();
            if exited && text.contains("hi") {
                break;
            }
            assert!(t.elapsed() < Duration::from_secs(3), "exited={exited} out={text:?}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn kill_triggers_exit() {
        let (prog, args): (&str, Vec<String>) =
            if cfg!(windows) { ("powershell.exe", vec!["-NoLogo".into()]) } else { ("sh", vec![]) };
        let (tx, rx) = mpsc::channel();
        let mut p = spawn(prog, &args, &tmp(), &[], 80, 24, |_| {}, move || { let _ = tx.send(()); }).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        p.kill();
        rx.recv_timeout(Duration::from_secs(3)).expect("on_exit after kill");
    }

    #[test]
    fn commands() {
        assert_eq!(command_for("shell", true), ("powershell.exe".to_string(), vec!["-NoLogo".to_string()]));
        assert_eq!(command_for("hermes", true), ("cmd.exe".to_string(), vec!["/c".to_string(), "hermes".to_string()]));
        assert_eq!(command_for("opencode", false), ("opencode".to_string(), Vec::<String>::new()));
        let (p, a) = command_for("shell", false);
        assert!(!p.is_empty() && a.is_empty());
    }

    #[test]
    fn hermes_launch() {
        let exe = std::path::Path::new("C:/h/hermes.exe");
        assert_eq!(launch("hermes", true, Some(exe), None).unwrap(), ("C:/h/hermes.exe".to_string(), vec!["--tui".to_string()]));
        assert_eq!(launch("hermes", true, Some(exe), Some("local-1")).unwrap().1, vec!["--tui", "--resume", "local-1"]);
        assert!(launch("hermes", true, None, None).unwrap_err().contains("찾지 못했습니다"));
        assert_eq!(launch("shell", true, None, None).unwrap(), command_for("shell", true));
    }

    #[test]
    fn missing_cwd_errs() {
        assert!(spawn("x", &[], "Z:\\no\\such\\dir", &[], 80, 24, |_| {}, || {}).is_err());
    }

    #[test]
    #[ignore] // manual: cargo test flood_timing -- --ignored --nocapture
    fn flood_timing() {
        let cmd = "1..4000 | % { \"line $_ \" + (\"x\"*80) }; echo DONE_MARK";
        let args: Vec<String> = vec!["-NoLogo".into(), "-NoProfile".into(), "-Command".into(), cmd.into()];
        let out = Arc::new(Mutex::new((Vec::new(), 0usize)));
        let o = out.clone();
        let mut p = spawn("powershell.exe", &args, &tmp(), &[], 80, 24,
            move |b| { let mut g = o.lock().unwrap(); g.0.extend_from_slice(b); g.1 += 1; }, || {}).unwrap();
        let (t, mut replied) = (Instant::now(), false);
        loop {
            let (text, calls) = { let g = out.lock().unwrap(); (String::from_utf8_lossy(&g.0).into_owned(), g.1) };
            if !replied && text.contains("[6n") { p.write(b"[1;1R").unwrap(); replied = true; }
            if text.contains("DONE_MARK") || t.elapsed() > Duration::from_secs(120) {
                println!("FLOOD elapsed={:?} bytes={} reads={} done={}", t.elapsed(), text.len(), calls, text.contains("DONE_MARK"));
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}
