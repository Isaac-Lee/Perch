# Perch

<img src="desk/public/icon.svg" alt="Perch 아이콘" width="72" align="left" />

CLI 코딩 에이전트(Hermes, OpenCode)를 여러 개 띄워 한 화면에서 지켜보는 가벼운 데스크톱 앱이다. 세션은 분할 터미널로 띄우고, 옆 패널에서 모든 세션 상태를 한눈에 본다. 이름은 높은 곳에서 전체를 내려다보는 자리인 횃대(perch)에서 따왔다.

Hermes GUI는 창을 여러 개 띄우면 느려지고 버그가 많았다. 그래서 에이전트는 CLI 그대로 쓰고, 여러 세션을 띄우고 지켜보는 일만 이 앱이 맡는다. 칸이 늘어도 느려지지 않는 것이 목표다.

<br clear="left" />

![Perch 화면](docs/images/perch-grid.png)

![토큰 사용량](docs/images/perch-usage.png)

## 현재 상태

1단계인 UI 시제품까지 끝났다. 화면은 가짜 데이터로 그리며 브라우저에서 실행한다. 실제 터미널과 에이전트 연결은 2단계부터 붙인다.

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | UI 시제품 | 완료 |
| 2 | Tauri 셸 + 실제 터미널 | 시작 전 |
| 3 | Hermes 연결 | 시작 전 |
| 4 | OpenCode 연결 | 시작 전 |
| 5 | 오프라인 Windows 10 설치 파일 | 시작 전 |

## 실행

```bash
git clone https://github.com/Isaac-Lee/Perch.git
cd Perch/desk
npm install
npm run dev        # http://localhost:5173
npm test
```

Node 20 이상이 필요하다.

## 화면 구성

**세션 패널 (Sessions)**
- 모든 세션을 작업 디렉토리(git 저장소)별로 묶어 보여준다. 묶음은 접을 수 있다.
- 세션마다 상태(`Working`, `Thinking`, `Running`, `Needs approval`, `Question`, `Waiting`), 경과시간, git 브랜치, 토큰 수, 서브에이전트, todo가 표시된다.
- 세션을 클릭하면 그 세션으로 이동한다. 닫힌 세션이면 새로 연다.
- 승인 요청은 [Allow] / [Deny]로 바로 처리한다.
- 패널 폭은 경계를 끌어서 조절한다.

**세션 격자**
- 세션 수에 따라 자동으로 격자가 바뀐다. 개수 제한은 없다.
- [+]는 기본 에이전트와 폴더로 바로 세션을 연다.
- 세션마다 헤더(에이전트, 폴더, 브랜치, 상태 점, `Thinking` 표시, [Stop])와 하단 진행 줄(지금 하는 일 · 단계 수 · 경과시간)이 있다.
- 승인·질문 내용, 입력창, 모델 표시는 에이전트의 자체 터미널 화면에 맡긴다.

**토큰 사용량 (Token usage)**
- 기간별 합계, 토큰 추이 차트(`14d` / `30d` / `1y`, `1y`는 `Daily` / `Weekly`), 프로젝트·모델·에이전트·세션별 표를 보여준다.
- 가격표는 넣지 않았다. 비용은 에이전트가 기록한 값이 있을 때만 표시한다.

**설정 (Settings)**
- 터미널 글꼴과 크기, 새 세션의 기본 에이전트와 폴더를 바꿀 수 있다.

## 문서

| 문서 | 내용 |
|---|---|
| [docs/HANDOFF.md](docs/HANDOFF.md) | 이어서 작업할 때 먼저 읽는 문서. 현재 상태, 결정 사항, 지킬 규칙, 다음 할 일 |
| [설계 문서](docs/superpowers/specs/2026-11-17-perch-design.md) | 전체 5단계의 설계 |
| [1단계 계획](docs/superpowers/plans/2026-11-17-perch-ui-prototype.md) | UI 시제품 계획과 검토 반영 기록 |
| [desk/HERMES_UI_NOTES.md](desk/HERMES_UI_NOTES.md) | Hermes CLI가 자체적으로 그리는 화면 요소 정리 |

`prototype/`에는 초기에 만든 Hermes용 CLI 대시보드(`dash.py`)가 있다. 3단계에서 훅 로직을 옮길 때 참고하는 용도다.

## 사용한 것

| 이름 | 용도 | 라이선스 |
|---|---|---|
| [thinking-orbs](https://libraries.dev/) | 생각 중·진행 표시 | MIT |
| [unslop](https://github.com/heydamir/unslop) (Damir Sokolovsky) | 디자인 규칙 | CC BY 4.0 |
| [codeburn](https://github.com/getagentseal/codeburn) | 토큰 사용량 읽는 방식 참고 (코드는 새로 작성) | MIT |
| IBM Plex Sans, IBM Plex Sans KR | UI 글꼴 | SIL OFL 1.1 |
| [D2Coding](https://github.com/naver/d2-coding-font), [Monoplex KR](https://github.com/y-kim/monoplex) | 터미널 글꼴 | SIL OFL 1.1 |
| xterm.js, lucide | 터미널, 아이콘 | MIT, ISC |
