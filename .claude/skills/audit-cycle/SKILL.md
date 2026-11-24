---
name: audit-cycle
description: Perch 개선 사이클 한 바퀴를 돈다. Fable 5.2가 저장소 전체를 검수해 GitHub 이슈를 만들고, 이슈를 비슷한 것끼리 묶어 브랜치로 나눈 뒤 Sonnet 5.5 서브에이전트들이 브랜치마다 병렬로 작업해 PR을 연다. 모든 PR이 머지되면 릴리스를 낸다. "audit cycle", "검수 사이클", "이슈 만들고 작업하고 릴리스", "/audit-cycle"에 쓴다.
---

# Perch 검수 사이클

메인 세션(오케스트레이터)은 조율만 한다. 검수는 Fable, 구현은 Sonnet에게 맡기고, 메인 세션은 이슈 분류, 결과 검토, 릴리스를 맡는다.

## 0. 준비

- `git checkout main && git pull`, 작업 트리가 깨끗한지 본다.
- `gh issue list --label audit --state open`으로 지난 사이클에서 남은 이슈를 확인한다. 남은 것이 있으면 새 검수 전에 사용자에게 그것부터 처리할지 묻는다.

## 1. 검수 → 이슈 (Fable 5.2)

`Agent`를 `model: "fable"`, `subagent_type: "general-purpose"`로 하나 띄운다. 지시에 넣을 것:

- 저장소 파일을 고치지 않는다. 바깥으로 하는 일은 이슈 생성과 `audit` 라벨 생성뿐이다.
- 먼저 읽을 것: `README.md`, `docs/HANDOFF.md`(4절이 설계 문서보다 우선), `docs/VERSIONING.md`, `docs/ADAPTERS.md`, `desk/NOTES.md`, `desk/HERMES_UI_NOTES.md`, `.github/`.
- 기록된 사용자 결정을 따른다 (OpenCode 상태 어댑터는 하지 않기로 함, 화면 언어 규칙, 화면에 "pane"이라는 말 금지).
- 범위: 버그, 성능, 보안(Tauri 권한, 명령 주입), UX·접근성, 테스트, CI·릴리스, 문서, 제품 목표에 맞는 소수의 새 기능.
- `gh issue list --state all --limit 200`으로 중복과 이미 결정된 것을 거른다. 모든 항목은 `path:line` 근거가 있어야 한다. 10~20개, 각각 PR 하나 크기.
- 이슈는 한국어, 저장소 문서체("~한다"). 본문 절: `## 문제` / `## 제안` / `## 확인 방법` / `## 범위`. 라벨: `audit` + `bug`/`enhancement`/`documentation` 중 하나 (+ `accessibility`, `good first issue`).
- 마지막 보고: 이슈마다 `#번호 | 종류 | 영역 | 제목 | 주요 파일` 한 줄.

## 2. 분류 → 브랜치 묶음 (메인 세션)

- 각 이슈를 `gh issue view`로 직접 읽고 근거가 맞는지 본다. 틀리거나 사용자 결정에 어긋나는 이슈는 이유를 달아 닫거나 사용자에게 묻는다.
- 같은 파일·같은 영역을 건드리는 이슈끼리 묶는다. 묶음끼리는 파일이 겹치지 않게 한다 (병렬 작업에서 충돌이 나지 않도록). 겹치면 한 묶음으로 합친다.
- 브랜치 이름: `fix/<영역>`, `feat/<영역>`, `docs/<영역>`. 묶음은 보통 3~6개.
- 묶음 표(브랜치, 이슈 번호, 파일)를 사용자에게 보여 준다.

## 3. 구현 (Sonnet 5.5, 병렬)

묶음마다 `Agent`를 `model: "sonnet"`, `isolation: "worktree"`로 한 메시지 안에서 함께 띄운다. 각 지시는 짧게 두고(브랜치, 이슈 번호, 파일 범위, 다른 브랜치와 겹치는 파일, PR 제목), 이 스킬 폴더의 `impl-brief.md`(절대 경로)를 먼저 읽고 따르라고 한다. 그 파일에 담긴 규칙:

- 브랜치 이름, 맡을 이슈 번호 목록 (`gh issue view <n>`으로 읽게 한다), 건드려도 되는 파일 범위. 범위 밖 파일은 고치지 않는다.
- `origin/main`에서 브랜치를 만든다.
- `desk/`에서 `npm install`(필요 시), `npm test`, `npm run lint`, `npx tsc --noEmit -p .`가 통과해야 한다. Rust를 고쳤으면 `export PATH="$HOME/.cargo/bin:$PATH"` 뒤 `cargo check`(desk/src-tauri)와 `cargo test`.
- 화면 동작을 바꿨으면 README 기능 설명도 고친다. 훅은 항상 exit 0, stdout 없음. 실행 중 네트워크 접속을 더하지 않는다.
- 커밋 메시지는 `fix:`/`feat:`/`docs:` 접두어, 끝에 Co-Authored-By 줄.
- push 뒤 `gh pr create --base main`으로 PR을 연다. 본문은 `.github/pull_request_template.md` 형식, 이슈마다 `Closes #번호`, 체크리스트를 실제로 확인한 것만 체크.
- 마지막 보고: PR URL, 고친 이슈, 돌린 검사와 결과, 못 한 것.

## 4. 검토 (메인 세션)

- 각 PR의 `gh pr diff`를 읽는다. 문제가 있으면 같은 서브에이전트에게 `SendMessage`로 고치게 한다.
- 이슈를 일부만 고친 PR은 본문의 `Closes #n`을 `Refs #n`으로 바꿔 이슈가 열려 있게 한다.
- 통합 확인: `git worktree add ../Perch-integ -b integ/<날짜> origin/main` 뒤 모든 PR 브랜치를 차례로 merge한다. 충돌 파일을 기록하고 직접 풀어 본다 (풀이가 곧 머지 순서와 rebase 안내가 된다). 거기서 `npm test`, `npm run lint`, `npx tsc --noEmit -p .`, `node scripts/build-hook.mjs` 뒤 `cargo test --workspace`를 돌린다.
- 실제 앱 확인: computer-use는 `tauri dev`의 맨 바이너리를 앱으로 보지 못한다. `npm run tauri build -- --debug --bundles app`으로 `.app`을 만들어 `open`으로 띄운 뒤 화면을 확인한다. 종료는 `osascript -e 'tell application id "com.isaaclee.perch" to quit'`. 확인이 끝나면 통합 worktree는 지운다 (push하지 않는다).
- `gh pr checks`로 CI를 본다 (빌드는 약 15분). 실패하면 원인을 서브에이전트에게 넘긴다.
- 충돌하는 PR은 먼저 머지된 PR 뒤에 `origin/main`으로 rebase해야 한다. 충돌 없는 PR부터 머지 순서를 사용자에게 알려 준다.
- PR을 머지하지 않는다. 머지는 사용자가 한다 (사용자가 명시적으로 머지하라고 하면 그때만 `gh pr merge --merge`).

## 5. 릴리스 (모든 PR 머지 뒤)

`docs/VERSIONING.md`를 따른다.

1. `git checkout main && git pull`. `git log v<이전 버전>..`으로 변경을 모은다.
2. 버전: "새로 더한 것"이 하나라도 있으면 MINOR, 고친 것·다듬은 것만 있으면 PATCH, docs/CI/테스트만이면 릴리스하지 않는다.
3. `release/<버전>` 브랜치에서 `desk/src-tauri/tauri.conf.json`, `desk/src-tauri/Cargo.toml`, `desk/src-tauri/hook/Cargo.toml`, `desk/package.json`, `desk/package-lock.json`, `desk/src-tauri/Cargo.lock`의 버전을 올린다. README를 변경과 대조해 고치고, `docs/releases/v<버전>.md`(새로 더한 것 / 다듬은 것 / 고친 것 / 설치 표)를 쓰고, `docs/HANDOFF.md`의 최신 릴리스 문장을 고친다. 지난 릴리스 커밋(`git show <Release 커밋>`)과 같은 파일들인지 대조한다.
4. 커밋 `Release <버전>`, PR을 열고 사용자가 머지하길 기다린다.
5. 머지 뒤 main에서 `git tag v<버전> && git push origin v<버전>`. 태그 빌드가 초안 릴리스에 설치 파일을 붙인다.
6. 빌드가 끝나면 `gh release view v<버전>`으로 `.exe`와 `.dmg`가 붙었는지 보고, `gh release edit v<버전> --notes-file docs/releases/v<버전>.md --title "Perch v<버전>"` 뒤 `gh release edit v<버전> --draft=false --latest`로 게시한다.

## 반복

다음 사이클은 이 스킬을 다시 부른다. 1단계의 중복 검사가 이미 만든 이슈를 거른다.
