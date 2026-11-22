# github-convention

[![Release: v0.2.1](https://img.shields.io/badge/release-v0.2.1-green)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

저장소의 기존 컨벤션을 유지하면서 이슈 중심의 GitHub 개발 워크플로를 적용하는 플러그인입니다.

별도 빌드나 npm 패키지 설치 없이 마크다운 스킬, 서브에이전트, 슬래시 커맨드, 경량 Node 훅으로 동작합니다. 모든 Git 및 GitHub 변경 작업은 메인 에이전트(오케스트레이터)가 맡고, 병렬 워커는 격리된 워크트리에서 구현과 테스트만 수행합니다.

---

## v0.2.1 구조 요약

- **플러그인 네이티브 구조:** 별도 빌드나 외부 의존성 없이 `gh` CLI와 에이전트 네이티브 도구에 위임합니다.
- **Zero-Config 기본 동작:** `.github-convention/config.yaml`이 없는 일반 Git 저장소에서도 `.github/` 템플릿, 라벨, CI, 커밋 이력을 읽어 동작하며, 비기본 타깃 base 브랜치와 기존·신규 품질 게이트 실패 분리를 지원합니다.
- **단계별 스킬 분리 & 경량 부트스트랩:** 모든 `SKILL.md`를 8KB(8,192바이트) 이하로 분리하고, `SessionStart` 훅이 핵심 라우팅·가드레일 요약만 주입합니다(`dev-principles` 동반 감지 시 중복 자동 축소).
- **다중 하네스 결정론적 안전 훅:** Claude Code·Cursor([`hooks/hooks.json`](hooks/hooks.json)) 및 Antigravity([`hooks.json`](hooks.json))에서 `--force` 단독 사용, 기본 브랜치 직접 푸시, `--no-verify`, CI 미통과/`--admin`/Draft 상태의 `gh pr merge`, `gh api` 머지 우회, 스테이징된 시크릿 커밋을 코드 수준에서 차단합니다.
- **CI 게이트 기반 PR 자동 머지:** `push` → PR 생성 후 테스트·CI가 모두 통과하면 기본 워크플로우로 PR을 자동 머지합니다(`.github-convention/config.yaml`에서 `github.auto_merge_on_ci_pass: false`로 수동 전환 가능).
- **동반 플러그인 호환성 & 소유권 검증:** `dev-principles`와 독립적으로 설치·업데이트·삭제되며, [`install.sh`](install.sh)/[`uninstall.sh`](uninstall.sh)가 소유권 매니페스트와 정규화 경로를 검증해 외부 파일을 덮어쓰거나 삭제하지 않습니다.

---

## 설치 방법

### 1. Claude Code 마켓플레이스 설치

```text
/plugin install github-convention --marketplace Dobbymin/github-convention
```

또는 마켓플레이스 등록 후 설치할 수 있습니다.

```text
/plugin marketplace add Dobbymin/github-convention
/plugin install github-convention
```

### 2. 지원 하네스 루트 매니페스트

저장소 루트에 플랫폼별 매니페스트와 훅 진입점을 함께 둡니다.

- Claude Code: [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json), [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json)
- Codex: [`.codex-plugin/plugin.json`](.codex-plugin/plugin.json), [`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json)
- Cursor: [`.cursor-plugin/plugin.json`](.cursor-plugin/plugin.json)
- Antigravity: [`.antigravity-plugin/plugin.json`](.antigravity-plugin/plugin.json), [`hooks.json`](hooks.json)
- Gemini CLI: [`gemini-extension.json`](gemini-extension.json) (`contextFileName`으로 저장소 내부 `GEMINI.md` 격리)

### 3. 셸 스크립트로 스킬만 설치 (`install.sh` / `uninstall.sh`)

`skills/` 아래 6개 스킬을 `.agents/skills/`(또는 지정한 경로)에 심링크하거나 복사합니다. 설치·삭제 전 소유권 사전 검증(Pre-flight)을 수행하며, 타 플러그인 심볼릭 링크·일반 파일·미관리 디렉터리와 충돌하면 변경 없이 중단합니다.

```bash
# 변경 없이 예상 작업 확인
./install.sh --scope project --dry-run

# 프로젝트 범위 심링크 설치 (.github-convention-install-manifest 기록)
./install.sh --scope project

# 전역 복사 설치 (.github-convention-script-managed 마커 기록) 및 제거
./install.sh --scope global --copy
./uninstall.sh --scope global

# Windows / 크로스플랫폼 (Node.js 22+)
node scripts/install.mjs --scope project --copy
node scripts/install.mjs --uninstall --scope project
```

---

## 구성 요소

### 스킬 (`skills/`)

세션 시작 시 `using-github-convention`이 작업 성격에 맞는 스킬로 안내합니다.

| 스킬 | 역할 |
| :--- | :--- |
| [`using-github-convention`](skills/using-github-convention/SKILL.md) | 워크플로 라우팅, Zero-Config 감지, 통합 출력/보고서 언어 정책, 승인·권한 경계, 동반 플러그인 경계 |
| [`issue-planning`](skills/issue-planning/SKILL.md) | 저장소 컨벤션 분석, Parent/Sub-issue 분해, `Blocked by` DAG, 라벨 우선순위 및 승인 후 이슈 생성 |
| [`parallel-execution`](skills/parallel-execution/SKILL.md) | 단독/순차/병렬 모드 선택, worktree 격리, Orchestrator 권한 계약, 요청 언어 기준 Worker Report |
| [`git-pr-workflow`](skills/git-pr-workflow/SKILL.md) | 브랜치/단위 커밋, 비기본 base 브랜치 및 기존/신규 게이트 분리, PR 전 7단계 검증, 템플릿 우선순위 |
| [`review-ci-loop`](skills/review-ci-loop/SKILL.md) | PR 리뷰 분류(자동 수정 vs 승인 요청), 스레드 해결, CI 실패 분류·재시도 |
| [`release-and-recovery`](skills/release-and-recovery/SKILL.md) | 시크릿 스캔, 훅/브랜치 보호, 배포 헬스체크, SemVer 릴리스, 중단 상태 복구 |

### 서브에이전트 (`agents/`)

Gemini CLI 등 다중 하네스 호환을 위해 플랫폼 종속 `tools` 프런트매터를 두지 않고, 역할 계약과 `guard-bash.mjs` 훅으로 읽기 전용·작업 범위 경계를 유지합니다.

- [`repo-analyzer`](agents/repo-analyzer.md) — 읽기 전용 GitHub 워크플로우 메타데이터 분석 (`github_workflow_context` 출력 계약)
- [`task-worker`](agents/task-worker.md) — 격리된 워크트리 내 구현·테스트 전용(커밋·푸시·`gh` 쓰기 차단, 요청 언어 기준 `Task Report` 출력)
- [`pr-reviewer`](agents/pr-reviewer.md) — 읽기 전용 PR 10개 항목·Secret Scan 검토 및 7개 섹션 보고(`dev-principles` 리뷰어 결과 연동 시 중복 감사·재귀 호출 없이 검증 반영)

### 슬래시 커맨드 (`commands/`)

| 커맨드 | 설명 |
| :--- | :--- |
| `/gh-plan` | 저장소 GitHub 컨벤션 분석 및 승인 기반 Parent/Sub-issue 초안 작성 |
| `/gh-pr` | 품질 게이트·시크릿 스캔·셀프리뷰 검증 후 PR 생성 또는 갱신 |
| `/gh-review` | PR 리뷰 코멘트 분류·수정 및 실패한 CI 점검·재시도 |
| `/gh-status` | 실시간 GitHub 상태와 로컬 worktree·상태 파일 대조 및 복구 안내 |
| `/gh-doctor` | `git`, `gh auth`, 기본 브랜치, 템플릿, 동반 플러그인 경계 읽기 전용 점검 |

### 훅 (`hooks/`)

Node.js 22 이상 표준 라이브러리만 사용하며 외부 의존성이 없습니다. Claude Code·Cursor용 [`hooks/hooks.json`](hooks/hooks.json)과 Antigravity용 루트 [`hooks.json`](hooks.json)을 함께 제공합니다.

- [`session-start.mjs`](hooks/session-start.mjs) — `SessionStart` 시 Git 저장소 또는 `.github-convention/config.yaml`을 감지해 핵심 라우팅·가드레일 요약을 주입합니다. `dev-principles` 동반 감지 시 중복을 자동 축소하며, `session.context_mode` 또는 `GITHUB_CONVENTION_CONTEXT_MODE`(`auto` | `compact` | `full`)로 모드를 제어할 수 있습니다.
- [`guard-bash.mjs`](hooks/guard-bash.mjs) — `PreToolUse` (`Bash` / `run_command`)에서 `--force` 단독 사용, 기본 브랜치 직접 푸시, `--no-verify`, CI 미통과·실패·Draft·`--admin` PR 머지, `gh api` 머지 우회, 스테이징된 시크릿을 차단합니다. 이슈/태그/릴리스 생성은 스킬의 사용자 승인 절차를 따릅니다.

---

## 동반 플러그인 호환성 (`dev-principles`)

`github-convention`은 단독으로 동작하며, `dev-principles`와 함께 설치해도 서로의 파일을 수정하거나 직접 의존하지 않습니다.

- **SessionStart 중복 최소화:** 동반 설치가 감지되면 GitHub 워크플로우와 Orchestrator 권한 경계 중심의 축약 컨텍스트를 주입합니다.
- **분석·리뷰 책임 분리:** `repo-analyzer`는 GitHub 메타데이터를, `pr-reviewer`는 PR/워크플로우·Secret Scan을 맡고, 코드 설계·아키텍처·보안 설계 감사는 `dev-principles`(`structure-analyzer`, `principles-reviewer`, `architecture-reviewer`, `security-reviewer`)에 둡니다.
- **단일 패스 & 권한 경계:** 외부 리뷰어 결과가 전달되면 원문을 임의 재작성하지 않고 diff 대조 후 7개 섹션 보고서에 반영하며, 미제공 시 `미검토 (Not provided)`로 표시합니다. 모든 Git/GitHub 변경 권한은 Orchestrator에만 있습니다.

자세한 내용은 [호환성 및 운영 가이드 (`docs/compatibility-and-operations.md`)](docs/compatibility-and-operations.md)를 참고하세요.

---

## 선택적 프로젝트 설정

대부분의 저장소는 별도 설정 없이 바로 동작합니다. 병렬 워커 상한이나 세션 컨텍스트 모드(`session.context_mode`) 등 프로젝트별 예외가 필요할 때만 `.github-convention/config.yaml`을 추가하세요.

- [설정 예시 (`examples/config.yaml`)](examples/config.yaml) · [설정 스키마 (`schemas/config.schema.json`)](schemas/config.schema.json)
- [로컬 상태 예시 (`examples/state.json`)](examples/state.json) · [상태 스키마 (`schemas/state.schema.json`)](schemas/state.schema.json)
- [이슈 템플릿 안내 (`docs/issue-templates.md`)](docs/issue-templates.md) · [라벨 정책 (`docs/label-policy.md`)](docs/label-policy.md) · [PR 기본 템플릿 (`templates/PULL_REQUEST_TEMPLATE.md`)](templates/PULL_REQUEST_TEMPLATE.md)
- [호환성 및 운영 가이드 (`docs/compatibility-and-operations.md`)](docs/compatibility-and-operations.md)

---

## 저장소 검증

Node.js 22 이상 환경에서 외부 패키지 설치 없이 바로 검증할 수 있습니다.

```bash
npm run validate   # 매니페스트 버전, frontmatter, 스킬 8KB 상한, 훅 경로(hooks.json 포함) 점검
npm run garden     # 깨진 마크다운 링크, 레거시 잔여 참조, 고아 파일 점검
npm test           # 다중 하네스 훅, 동반 호환성, 검증기, install.sh/uninstall.sh 소유권 테스트
npm run check      # 위 3가지 일괄 실행
```

## 라이선스

[MIT License](LICENSE)
