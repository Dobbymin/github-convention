# 설치 가이드 (`INSTALL.md`)

[한국어](README.md) | [English](README.en.md)

`github-convention`은 사용 환경에 맞춰 세 가지 방식으로 설치할 수 있습니다.

1. **마켓플레이스/플러그인 직접 설치** — 스킬과 슬래시 커맨드(`commands/`), 조건부 세션 훅(`hooks/`)을 에이전트에 바로 추가할 때
2. **Node CLI 설치 (`@dobbymin/github-convention-cli`)** — 프로젝트 초기화(`.github-convention/config.yaml`), 다중 에이전트 일괄 설치, 상태·무결성 검증까지 함께 쓸 때
3. **경량 셸 스크립트 설치 (`install.sh`)** — Node CLI 없이 스킬(`skills/github-convention/`)만 `.agents/skills/github-convention/`에 연결할 때

---

## 1. 사전 준비

- **공통:** `git`, GitHub CLI(`gh auth login` 권장 — [GitHub CLI 공식 문서](https://cli.github.com/))
- **Node CLI 사용 시:** Node.js `>=22`
- **셸 스크립트 사용 시:** POSIX `sh` (macOS / Linux)

---

## 2. 방법 A: 마켓플레이스 / 플러그인 직접 설치

저장소 루트의 매니페스트(`.claude-plugin/`, `.codex-plugin/`, `gemini-extension.json`, `plugin.json`)를 통해 플랫폼에서 직접 불러올 수 있습니다.

- **Claude Code:**
  ```text
  /plugin marketplace add Dobbymin/github-convention
  /plugin install github-convention
  ```
- **Codex / Gemini CLI:** 루트 `.codex-plugin/plugin.json` 또는 `gemini-extension.json`을 지원하는 확장/플러그인 경로로 연결합니다.

> [!NOTE]
> 마켓플레이스로 스킬만 설치한 뒤에도 프로젝트 설정 초기화나 상태 진단이 필요하면 `npx @dobbymin/github-convention-cli doctor --project .`처럼 CLI를 병행할 수 있습니다.

---

## 3. 방법 B: Node CLI로 설치 및 관리

### 원클릭 실행 (`npx`)

```bash
# 1) 환경 진단 (읽기 전용)
npx @dobbymin/github-convention-cli doctor --project .

# 2) 대상 프로젝트 초기화 (.github-convention/config.yaml 및 정규 스킬 준비)
npx @dobbymin/github-convention-cli init --project . --dry-run
npx @dobbymin/github-convention-cli init --project .

# 3) 에이전트별 스킬 설치 (대화형 선택)
npx @dobbymin/github-convention-cli install --project .
```

### 특정 에이전트 · 전역 설치

```bash
# 특정 에이전트만 프로젝트 범위 설치
npx @dobbymin/github-convention-cli install --project . --agent claude-code --scope project

# 여러 에이전트 전역(global) 비대화형 설치
npx @dobbymin/github-convention-cli install --agent claude-code,codex,gemini-cli --scope global --yes
```

### 점검 · 업데이트 · 제거

```bash
# 설치 상태 및 무결성 확인
npx @dobbymin/github-convention-cli list --project .
npx @dobbymin/github-convention-cli validate --project .

# 스킬 업데이트 및 제거
npx @dobbymin/github-convention-cli update --project . --agent claude-code --scope project
npx @dobbymin/github-convention-cli uninstall --project . --agent claude-code --scope project
```

---

## 4. 방법 C: 경량 셸 스크립트 (`install.sh` / `uninstall.sh`)

Node.js 없이 `skills/github-convention/`만 설치할 때 사용합니다.

```bash
# 미리보기
./install.sh --dry-run

# 현재 프로젝트(.agents/skills/github-convention)에 심링크 설치
./install.sh --scope project

# 전역(~/.agents/skills/github-convention)에 파일 복사 설치
./install.sh --scope global --copy

# 제거 (install.sh로 설치한 심링크·관리 폴더만 안전하게 삭제)
./uninstall.sh --scope project
```

지원 옵션: `--scope <project|global>`, `--target <dir>`, `--copy`, `--dry-run`, `-h | --help`.

---

## 5. 지원 에이전트 및 설치 경로

`init` 또는 프로젝트 범위 설치 시 정규 스킬 원본은 `.agents/skills/github-convention/`에 배치되며, 각 에이전트 호환 경로는 아래 규칙을 따릅니다. (상세 감지 기준: [`docs/agent-adapters.md`](docs/agent-adapters.md))

| 에이전트               | ID            | 프로젝트 스킬 경로                         | 전역 스킬 경로                                        |
| :--------------------- | :------------ | :----------------------------------------- | :---------------------------------------------------- |
| **OpenAI Codex**       | `codex`       | `.agents/skills`                           | `~/.agents/skills`                                    |
| **Claude Code**        | `claude-code` | `.claude/skills`                           | `~/.claude/skills`                                    |
| **Gemini CLI**         | `gemini-cli`  | `.agents/skills` (보조 `.gemini/skills`)   | `~/.agents/skills` (보조 `~/.gemini/skills`)          |
| **Google Antigravity** | `antigravity` | `.agents/skills`                           | `~/.gemini/config/skills`                             |
| **OpenCode**           | `opencode`    | `.agents/skills` (보조 `.opencode/skills`) | `~/.agents/skills` (보조 `~/.config/opencode/skills`) |
| **Kilo Code / CLI**    | `kilo`        | `.agents/skills` (보조 `.kilo/skills`)     | `~/.agents/skills` (보조 `~/.kilo/skills`)            |
| **GitHub Copilot CLI** | `copilot`     | `.github/skills` (보조 `.agents/skills`)   | `~/.copilot/skills` (보조 `~/.agents/skills`)         |
