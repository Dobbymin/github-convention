# github-convention

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

저장소의 기존 컨벤션을 유지하면서 이슈 중심의 GitHub 개발 워크플로를 적용하는 플러그인입니다.

별도 빌드나 npm 패키지 설치 없이 마크다운 스킬, 서브에이전트, 슬래시 커맨드, 경량 Node 훅으로 동작합니다. 모든 Git 및 GitHub 변경 작업은 메인 에이전트(오케스트레이터)가 맡고, 병렬 워커는 격리된 워크트리에서 구현과 테스트만 수행합니다.

---

## v0.2.0 구조 요약

- **플러그인 네이티브 구조:** TypeScript 모노레포와 CLI를 제거하고, `gh` CLI와 에이전트 네이티브 도구에 위임합니다.
- **Zero-Config 기본 동작:** `.github-convention/config.yaml`이 없는 일반 Git 저장소에서도 `.github/` 템플릿, 라벨, CI, 커밋 이력을 읽어 바로 동작합니다.
- **단계별 스킬 분리:** 모든 `SKILL.md`를 8KB(8,192바이트) 이하로 쪼개 필요한 단계만 불러옵니다.
- **결정론적 안전 훅:** `PreToolUse(Bash)` 훅이 `--force` 단독 사용, 기본 브랜치 직접 푸시, `--no-verify`, `gh pr merge`, 스테이징된 시크릿 커밋을 코드 수준에서 차단합니다.

---

## 설치 방법

### 1. Claude Code 마켓플레이스 설치

```text
/plugin marketplace add Dobbymin/github-convention
/plugin install github-convention
```

### 2. 지원 하네스 루트 매니페스트

저장소 루트에 플랫폼별 매니페스트를 함께 둡니다.

- Claude Code: [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json), [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json)
- Codex: [`.codex-plugin/plugin.json`](.codex-plugin/plugin.json)
- Cursor: [`.cursor-plugin/plugin.json`](.cursor-plugin/plugin.json)
- Antigravity: [`.antigravity-plugin/plugin.json`](.antigravity-plugin/plugin.json)
- Gemini CLI: [`gemini-extension.json`](gemini-extension.json)

### 3. 셸 스크립트로 스킬만 설치 (`install.sh` / `uninstall.sh`)

`skills/` 아래 6개 스킬을 `.agents/skills/`(또는 지정한 경로)에 심링크하거나 복사합니다.

```bash
# 프로젝트 범위 심링크 설치
./install.sh --scope project

# 전역 복사 설치 및 제거
./install.sh --scope global --copy
./uninstall.sh --scope global
```

---

## 구성 요소

### 스킬 (`skills/`)

세션 시작 시 `using-github-convention`이 작업 성격에 맞는 스킬로 안내합니다.

| 스킬 | 역할 |
| :--- | :--- |
| [`using-github-convention`](skills/using-github-convention/SKILL.md) | 워크플로 라우팅, Zero-Config 감지, 아티팩트 언어 규칙, 공통 승인 경계 |
| [`issue-planning`](skills/issue-planning/SKILL.md) | 저장소 컨벤션 분석, Parent/Sub-issue 분해, `Blocked by` DAG, 승인 후 이슈 생성 |
| [`parallel-execution`](skills/parallel-execution/SKILL.md) | 단독/순차/병렬 모드 선택, worktree 격리, 워커 계약 및 diff 검증 |
| [`git-pr-workflow`](skills/git-pr-workflow/SKILL.md) | 브랜치/단위 커밋, PR 전 7단계 게이트, 템플릿 우선순위, 리베이스 |
| [`review-ci-loop`](skills/review-ci-loop/SKILL.md) | PR 리뷰 분류(자동 수정 vs 승인 요청), 스레드 해결, CI 실패 재시도 |
| [`release-and-recovery`](skills/release-and-recovery/SKILL.md) | 시크릿 스캔, 훅/브랜치 보호, 배포 헬스체크, SemVer 릴리스, 중단 상태 복구 |

### 서브에이전트 (`agents/`)

역할에 따라 허용 도구를 제한합니다.

- [`repo-analyzer`](agents/repo-analyzer.md) — 읽기 전용 저장소 컨벤션 및 템플릿 분석
- [`task-worker`](agents/task-worker.md) — 격리된 워크트리 내 구현·테스트 전용(커밋/푸시/`gh` 쓰기 차단)
- [`pr-reviewer`](agents/pr-reviewer.md) — 읽기 전용 PR 전 diff·완료 기준·시크릿·언어 셀프리뷰

### 슬래시 커맨드 (`commands/`)

| 커맨드 | 설명 |
| :--- | :--- |
| `/gh-plan` | 저장소 컨벤션 분석 및 승인 기반 Parent/Sub-issue 초안 작성 |
| `/gh-pr` | 품질 게이트·시크릿 스캔·셀프리뷰 검증 후 PR 생성 또는 갱신 |
| `/gh-review` | PR 리뷰 코멘트 분류·수정 및 실패한 CI 점검·재시도 |
| `/gh-status` | 실시간 GitHub 상태와 로컬 worktree·상태 파일 대조 및 복구 안내 |
| `/gh-doctor` | `git`, `gh auth`, 기본 브랜치, 템플릿, 플러그인 상태 읽기 전용 점검 |

### 훅 (`hooks/`)

Node.js 22 이상 표준 라이브러리만 사용하며 외부 의존성이 없습니다.

- [`session-start.mjs`](hooks/session-start.mjs) — `SessionStart`(`startup|clear|compact`) 시 Git 저장소 또는 `.github-convention/config.yaml`을 감지해 `using-github-convention` 컨텍스트를 주입합니다.
- [`guard-bash.mjs`](hooks/guard-bash.mjs) — `PreToolUse(Bash)`에서 `--force` 단독 사용, 기본 브랜치 직접 푸시, `--no-verify`, `gh pr merge`, 스테이징된 시크릿을 차단합니다. 이슈/태그/릴리스 생성은 스킬의 사용자 승인 절차를 따릅니다.

---

## 선택적 프로젝트 설정

대부분의 저장소는 별도 설정 없이 바로 동작합니다. 병렬 워커 상한 등 프로젝트별 예외가 필요할 때만 `.github-convention/config.yaml`을 추가하세요.

- [설정 예시 (`examples/config.yaml`)](examples/config.yaml) · [설정 스키마 (`schemas/config.schema.json`)](schemas/config.schema.json)
- [로컬 상태 예시 (`examples/state.json`)](examples/state.json) · [상태 스키마 (`schemas/state.schema.json`)](schemas/state.schema.json)
- [이슈 템플릿 안내 (`docs/issue-templates.md`)](docs/issue-templates.md) · [라벨 정책 (`docs/label-policy.md`)](docs/label-policy.md) · [PR 기본 템플릿 (`templates/PULL_REQUEST_TEMPLATE.md`)](templates/PULL_REQUEST_TEMPLATE.md)

---

## 저장소 검증

Node.js 22 이상 환경에서 외부 패키지 설치 없이 바로 검증할 수 있습니다.

```bash
npm run validate   # 매니페스트 버전, frontmatter, 스킬 8KB 상한, 훅 경로 점검
npm run garden     # 깨진 마크다운 링크, 레거시 잔여 참조, 고아 파일 점검
npm test           # 훅, 검증기, install.sh/uninstall.sh 단위 테스트
npm run check      # 위 3가지 일괄 실행
```

## 라이선스

[MIT License](LICENSE)
