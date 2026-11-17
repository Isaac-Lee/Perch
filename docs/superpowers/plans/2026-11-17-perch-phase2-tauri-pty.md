# Perch 2단계 계획 — Tauri 셸 + 실제 터미널

날짜: 2026-11-17 · 기준 문서: `docs/HANDOFF.md` 6절, `docs/superpowers/specs/2026-11-17-perch-design.md` 5.5절

## 0. 공통 규칙 (모든 작업에 적용)

- 자기 작업 절과 이 0절, 1절만 읽는다. "수정 파일"에 없는 파일은 고치지 않는다. "읽을 파일"에 없는 파일은 필요할 때만 읽는다.
- `~/.claude/` 아래는 어떤 것도 읽거나 고치지 않는다.
- 실행 중 네트워크 접속 코드를 넣지 않는다 (업데이터, 텔레메트리, CDN 금지).
- 브라우저 모드(`npm run dev`, mock 데이터)와 기존 테스트는 계속 동작해야 한다.
- 화면 문구 규칙: 라벨·버튼은 영어, 설명 문장은 한글. 화면에 "pane"이라는 단어를 쓰지 않는다.
- 추상화를 미리 만들지 않는다. 구현이 하나뿐인 trait/interface, 쓰이지 않는 설정값 금지.
- 커밋하지 않는다. 감독자가 검토 후 커밋한다.
- 보고는 10줄 이하: 바꾼 파일, 실행한 완료 기준 명령과 결과, 계획과 달라진 점, 확인 못 한 것.

## 1. 프런트 ↔ 백엔드 계약

Tauri 명령 (모두 `invoke`):

| 명령 | 인자 | 반환 | 동작 |
|---|---|---|---|
| `pane_create` | `agent: "hermes"\|"opencode"\|"shell"`, `cwd: string` | `paneId: string` | 호출한 창 소유로 칸을 등록한다. PTY는 아직 띄우지 않는다. 스냅샷을 보낸다 |
| `pane_attach` | `id`, `cols`, `rows`, `onData: Channel` | 없음 | 처음 호출이면 그 크기로 PTY를 띄운다. 이미 떠 있으면 출력 채널만 교체한다 |
| `pane_write` | `id`, `data: string` | 없음 | PTY에 입력한다 |
| `pane_resize` | `id`, `cols`, `rows` | 없음 | PTY 크기를 바꾼다 |
| `pane_close` | `id` | 없음 | PTY를 종료하고 칸을 지운다. 스냅샷을 보낸다 |
| `desk_snapshot` | 없음 | `PaneInfo[]` | 현재 모든 창의 칸 목록 |
| `home_dir` | 없음 | `string` | 사용자 홈 폴더 |

이벤트 `desk://panes` (모든 창에 전송): 페이로드 `PaneInfo[]`.

```ts
type PaneInfo = {
  id: string; agent: "hermes" | "opencode" | "shell";
  cwd: string; repoRoot: string | null; branch: string | null;
  window: string;      // 칸을 가진 창의 label
  createdAt: number;   // epoch 초
};
```

- 출력 채널은 PTY에서 읽은 바이트를 그대로 보낸다 (JS에서 `Uint8Array`로 받아 `term.write`). UTF-8 경계 처리는 xterm이 한다.
- 자식 프로세스가 끝나면 백엔드가 칸을 지우고 스냅샷을 보낸다.
- 모든 PTY에 환경변수 `PERCH_PANE=<paneId>`를 넣는다.
- 실행 명령: shell은 Windows `powershell.exe -NoLogo`, 그 외 `$SHELL`(없으면 `/bin/sh`). hermes는 `hermes`, opencode는 `opencode`. Windows에서 에이전트 명령은 `cmd /c <이름>`으로 감싼다 (`.cmd` shim 대응).

## T1. Tauri 뼈대

목표: 기존 mock UI가 Tauri 창에 그대로 뜬다. Rust 로직은 없다.

읽을 파일: `desk/package.json`, `desk/vite.config.ts`, `desk/.gitignore`, `desk/index.html`

할 일 (작업 폴더 `desk/`):
1. `npm install -D @tauri-apps/cli@^2` 그리고 `npm install @tauri-apps/api@^2`. `package.json` scripts에 `"tauri": "tauri"` 추가.
2. `npx tauri init --ci -A Perch -W Perch -D ../dist -P http://localhost:5173 --before-dev-command "npm run dev" --before-build-command "npm run build"` 로 `src-tauri/`를 만든다.
3. `src-tauri/tauri.conf.json`: `productName` "Perch", `identifier` "com.isaaclee.perch", 창 `title` "Perch", 크기 1280x800, 최소 800x500. 번들 대상과 업데이터는 건드리지 않는다 (5단계).
4. `src-tauri/Cargo.toml`: 패키지 이름 `perch`, lib 이름 `perch_lib`. `src/main.rs`의 호출도 맞춘다. init이 넣은 로그 플러그인 등 쓰지 않는 의존성과 코드는 지운다. `lib.rs`는 `tauri::Builder::default().run(...)`만 남긴다.
5. `npx tauri icon public/icon.svg` 로 `src-tauri/icons/`를 만든다. 모바일용(android, ios) 폴더는 지운다.
6. `vite.config.ts`: `server: { port: 5173, strictPort: true }`, `clearScreen: false` 추가. 기존 설정은 유지.
7. `.gitignore`에 `src-tauri/target/`, `src-tauri/gen/` 추가.

수정 파일: `desk/package.json`, `desk/package-lock.json`, `desk/vite.config.ts`, `desk/.gitignore`, `desk/src-tauri/**` (신규)

하지 말 것: `cargo`, `tauri dev`, `tauri build` 실행 (이 PC의 C++ 링커 준비 여부를 감독자가 따로 확인한다). `src/` 아래 수정.

완료 기준:
- `npm test` 25개 통과, `npm run build` 성공.
- `src-tauri/`에 `Cargo.toml`, `build.rs`, `tauri.conf.json`, `src/main.rs`, `src/lib.rs`, `capabilities/default.json`, `icons/icon.ico`, `icons/icon.icns`, `icons/32x32.png`가 있다.
- `tauri.conf.json`의 `bundle.icon` 경로가 실제 파일과 일치한다.

## T2. PTY 백엔드 (Rust)

T1 검증 후 세부를 확정한다. 개요:
- `src-tauri/src/pty.rs`: `portable-pty`로 칸별 PTY 관리. Tauri 타입을 쓰지 않아 단위 테스트가 가능해야 한다.
- `src-tauri/src/desk.rs`: 1절의 명령과 이벤트, 칸 목록 상태, git 정보(`.git`을 상위로 찾고 `HEAD`에서 브랜치를 읽는다. `.git`이 파일인 worktree도 처리).
- 완료 기준: `cargo test` — `cmd /c echo hi` 출력 수신, close 후 자식 프로세스 종료, git 정보 3가지 경우(브랜치, detached, 저장소 아님).

## T3. 프런트 연결

T1 검증 후 세부를 확정한다. 개요:
- `src/lib/backend.ts`: `isTauri`(`"__TAURI_INTERNALS__" in window`)와 1절 명령의 얇은 래퍼.
- `useDesk`: Tauri면 실제 백엔드, 아니면 `useMockDesk`. 반환 형태는 `useMockDesk`와 같다. 세션은 열린 칸에서 만든다 (`sessionId = paneId`, `state = "idle"`). `stop`은 `\x03` 입력, `approve`는 무동작.
- `TerminalView`: 기존 것은 mock용으로 두고 실제 PTY용을 추가한다. `@xterm/addon-webgl`, `@xterm/addon-unicode11` 적용.
- 완료 기준: 앱에서 셸 칸 입출력, 크기 조절 반영, 이모지 2칸, 테두리 세로선 끊김 없음. 브라우저 모드와 `npm test` 유지.

## T4. 여러 창

- `tauri-plugin-single-instance`: 두 번째 실행은 새 창을 연다. 패널은 모든 창의 칸을 보여주고, 격자는 자기 창의 칸만 그린다.
- 다른 창의 세션을 클릭하면 그 창을 앞으로 가져온다. 창을 닫으면 그 창의 칸 PTY만 종료한다.

## T5. 성능 검증 (감독자)

셸 8칸 유휴 메모리가 같은 조건의 Tabby보다 적고, 유휴 CPU 1% 미만.

## 3단계로 넘기는 메모

- 검색은 세션 제목, 폴더, 브랜치만 본다. 대화 기록 검색은 하지 않는다 (사용자 결정, 2026-11-17).
- 세션 제목은 에이전트가 자동으로 만든 것을 쓴다. 상태 형식에 `title` 필드를 추가한다. Hermes와 OpenCode가 제목을 어디에 저장하는지(`state.db` 컬럼 등)는 실제 설치본으로 확인한다. 제목이 아직 없으면 마지막 요청 문구를 대신 보여준다.
