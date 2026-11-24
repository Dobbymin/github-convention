# 호환성 및 운영 가이드

`github-convention`은 단독으로 동작하는 GitHub 워크플로우 플러그인입니다. `dev-principles` 같은 코드 원칙 플러그인을 함께 설치해도 서로의 코드를 복사하거나 직접 의존하지 않으며, 각자 맡은 범위만 담당합니다.

---

## 1. 플러그인의 책임과 역할

`github-convention`은 Git과 GitHub 개발 워크플로우 전반을 다룹니다.

- 저장소 GitHub 메타데이터 파악(Git Root, 기본 브랜치, Remote, Issue/PR 템플릿, Labels, Branch Protection, CI 설정)
- Parent/Sub-issue 분해, 의존성 DAG 설계, 사용자 승인 후 Issue 생성
- Worktree 격리 실행, 단위 커밋, Pre-PR 품질 게이트, 시크릿 스캔, PR 생성·갱신
- PR 리뷰 분류와 CI 실패 재시도, SemVer 릴리스 준비와 중단 작업 복구
- `guard-bash.mjs` 훅을 통한 기본 브랜치 직접 푸시, `--force` 단독 사용, `--no-verify`, `gh pr merge`, 스테이징 시크릿 차단

코드 아키텍처, SoC, 타입 안정성, Rule ID 기반 코드 감사는 `github-convention`의 고유 영역이 아니므로 `dev-principles`가 설치되어 있다면 해당 플러그인에 맡깁니다.

---

## 2. 단독 설치 및 공동 설치 방법

### 단독 설치

Claude Code 마켓플레이스 또는 셸 스크립트로 설치할 수 있습니다.

```bash
# Claude Code 마켓플레이스
/plugin install github-convention --marketplace Dobbymin/github-convention

# 셸 스크립트 (프로젝트 범위 심링크)
./install.sh --scope project

# 셸 스크립트 (전역 복사)
./install.sh --scope global --copy
```

### `dev-principles`와 공동 설치

두 플러그인은 독립적으로 설치·업데이트·삭제할 수 있습니다. 같은 스킬 디렉터리(`.agents/skills/` 등)나 마켓플레이스에 함께 설치해도 충돌하지 않습니다.

```bash
# 예시: 같은 대상 디렉터리에 두 플러그인 스킬을 함께 설치
/path/to/dev-principles/install.sh --target .agents/skills
/path/to/github-convention/install.sh --target .agents/skills

# Windows / 크로스플랫폼 (Node.js 22+)
node /path/to/github-convention/scripts/install.mjs --target .agents/skills
```

삭제할 때도 각자 자신이 설치한 스킬만 제거합니다.

```bash
/path/to/github-convention/uninstall.sh --target .agents/skills
node /path/to/github-convention/scripts/install.mjs --uninstall --target .agents/skills
```

---

## 3. 다른 개발 플러그인과의 협업 원칙

### SessionStart 중복 컨텍스트 주입 최소화

`hooks/session-start.mjs`는 세션 시작 시 프로젝트 루트(`.dev-principles.yaml`, `.agents|claude|cursor|gemini/skills/dev-principles/SKILL.md`)와 사용자 홈(`~/.agents|claude|cursor|gemini/skills/dev-principles/SKILL.md`, `~/.claude/plugins/installed_plugins.json`, `~/.gemini/extensions/dev-principles/gemini-extension.json`)을 읽기 전용으로 확인합니다.

- **단독 설치(`auto`)**: 전체 `SKILL.md`를 매번 그대로 넣는 대신 핵심 가드레일과 단계별 스킬 라우팅 요약만 주입합니다.
- **공동 설치(`auto` + `dev-principles` 감지)**: 중복 설명을 빼고 워크플로우 책임 경계, 우선순위, 핵심 불변 규칙만 담은 축약 컨텍스트를 주입합니다.
- **강제 전환**: `.github-convention/config.yaml`의 `session.context_mode` 또는 환경 변수 `GITHUB_CONVENTION_CONTEXT_MODE`로 `auto`, `compact`, `full` 중 하나를 지정할 수 있습니다. 환경 변수가 설정 파일보다 우선합니다.

```yaml
# .github-convention/config.yaml
schema_version: 1
session:
  context_mode: auto # auto | compact | full
```

우선순위는 항상 `안전·보안 불변 규칙 > 프로젝트 설정(.github-convention/config.yaml, 저장소 문서) > 사용자 설정 > 플러그인 기본값` 순서를 따릅니다.

### 하네스별 훅·컨텍스트 지원 현황

| 하네스 | 훅 진입점 | 자동 컨텍스트 / 폴백 |
| :--- | :--- | :--- |
| Claude Code | `hooks/hooks.json` | `SessionStart` / `PreToolUse(Bash)` 자동 실행 |
| Antigravity | 루트 `hooks.json` | `SessionStart` (`injectSteps`) / `PreToolUse(run_command)` 자동 실행 |
| Cursor | `hooks/hooks.json` | `SessionStart` (`additional_context`) / `PreToolUse` 실행 |
| Gemini CLI | — | `gemini-extension.json`의 `contextFileName`으로 `skills/using-github-convention/SKILL.md` 직접 로드 |
| Codex / `install.sh` 단독 설치 | — | 훅 미실행 시 `skills/using-github-convention/SKILL.md`를 직접 진입점으로 사용 |

> 참고: `agy plugin validate . --strict`에서 보이는 `AGENTS.md`, `GEMINI.md`, `commands/`, `hooks/hooks.json` 경고는 Claude Code·Cursor·Gemini CLI·개발자 규칙 파일이 같은 저장소에 공존하기 때문이며, Antigravity 런타임은 `skills 6 · agents 3 · hooks 1`을 오류 없이 로드합니다.

### Repository 분석 책임 분리

- `agents/repo-analyzer.md`는 `git_root`, `default_branch`, `remote`, `templates`, `labels`, `branch_protection`, `ci_checks`, `conventions`, `config_overrides`, `conflicts` 필드로 구성된 `github_workflow_context` 요약만 수집합니다.
- 코드 구조와 설계 원칙 분석은 `dev-principles`의 `structure-analyzer`에 둡니다.
- `dev-principles`가 없거나 감지에 실패하더라도 `repo-analyzer`는 Issue 계획과 게이트 확인에 필요한 최소 분석을 자체적으로 마칩니다. 두 플러그인은 임시 파일이나 내부 구현에 의존하지 않습니다.

---

## 4. Reviewer 역할 분리

`agents/pr-reviewer.md`는 PR 전 읽기 전용 검토 시 다음 10가지에 집중합니다.

1. Issue Acceptance Criteria 충족 여부
2. PR 범위와 Issue 목적의 일치 여부
3. 변경 범위의 적절성
4. 브랜치 및 커밋 규칙 준수 여부
5. PR 제목 및 본문 규칙 준수 여부
6. Issue 연결 및 Closing Keyword(`Closes #...`) 검증
7. GitHub 템플릿 준수 여부
8. 필수 CI 및 Check 상태 확인
9. 민감 정보 노출 여부(PR·Git 변경분 Secret Scan은 `github-convention` 책임 유지)
10. PR 생성 준비 상태

### `dev-principles` 전문 Reviewer와 협업

- 일반 코드 품질·Rule ID 검사, 아키텍처·의존성 방향, 타입 안정성·코드 구조, XSS/Injection/인증·보안 설계는 `dev-principles`의 `principles-reviewer`, `architecture-reviewer`, `security-reviewer`가 담당합니다.
- 외부 Reviewer 결과가 전달되면 원문 지적·Rule ID·심각도를 임의로 재작성하지 않고 실제 diff와 대조한 뒤 반영하며, 해결되지 않은 Blocker를 무시하지 않습니다.
- 상대 Reviewer가 없어도 `pr-reviewer`는 PR 검토를 생략하지 않고 단독으로 수행하며, 외부 Reviewer 결과가 제공되지 않으면 해당 영역을 `미검토 (Not provided)`로 명시합니다.
- 두 플러그인의 Reviewer는 서로를 재귀 호출하지 않으며, Orchestrator가 단일 패스로 조율합니다.

### 리뷰 결과 구분 형식 (7개 섹션)

`pr-reviewer`는 다음 7개 항목을 구분해 보고합니다.

1. `GitHub Convention 검사` (`GitHub Convention Check`)
2. `Issue Acceptance Criteria 검사` (`Issue Acceptance Criteria Check`)
3. `Secret Scan`
4. `CI 및 Check 검사` (`CI & Checks`)
5. `외부 Reviewer 결과` (`External Reviewer Results`)
6. `최종 Blocker / Warning` (`Final Blockers / Warnings`)
7. `PR 진행 가능 여부` (`PR Readiness Verdict`: `READY_FOR_PR` | `BLOCKED`)

---

## 5. Orchestrator 권한 정책

Git과 GitHub 상태를 바꾸는 모든 작업의 최종 권한은 **Orchestrator(메인 에이전트)** 에 있습니다.

- **Orchestrator 전용 변경 작업**: Issue 생성·수정, Branch 생성·변경, Worktree 관리, Commit, Push, PR 생성·수정, PR 충돌 해결, 리뷰 스레드 해결, CI 검증 후 PR Merge, Release·Tag 생성, Rollback
- **Worker와 Reviewer 제한**: `agents/task-worker.md`, `agents/pr-reviewer.md`, `agents/repo-analyzer.md`는 물론 `dev-principles`의 Reviewer를 포함한 외부 리뷰어도 명시적 위임 없이 Git/GitHub 변경 작업을 수행할 수 없습니다.
- **6상태 CI 분류, PR 충돌 자동 해결 및 `merge_method` 정책**:
  - 보호된 기본 브랜치에 직접 Push할 수 없습니다.
  - PR에 충돌(`CONFLICTING` / `DIRTY`)이 발생하면 10단계 충돌 해결 절차(대상 base 브랜치 확인 → 최신 원격 base fetch → 변경 비교 → 원인 분석 → 충돌 해결 → 기존 변경·Issue 요구사항 보존 확인 → 테스트·품질 게이트 실행 → Commit & Push → 충돌 해소 재확인 → 새 커밋 기준 CI 및 자동 머지 조건 재평가)를 따릅니다. `git reset --hard`나 무조건적인 `git checkout --ours`/`--theirs`는 금지하며, 복잡한 설계 충돌은 사용자에게 확인합니다.
  - CI 상태는 `FAIL > PENDING > UNKNOWN > UNAVAILABLE > NO_TESTS > PASS` 우선순위로 구분합니다(`PASS + UNAVAILABLE`은 `UNAVAILABLE`, `FAIL + UNAVAILABLE`은 `FAIL`, `PENDING + UNAVAILABLE`은 `PENDING`으로 분류).
  - Actions Job 조회 시 Job 응답의 `check_run_url`에서 실제 Check Run ID를 추출해 조회하며, Check Run/Job ID 누락·형식 오류·인증 실패(401/403)·404·네트워크/타임아웃·응답 파싱 오류는 `UNAVAILABLE`이나 `FAIL`로 단정하지 않고 `UNKNOWN`으로 처리합니다(다른 Check에서 실제 `FAIL`이 확인된 경우에만 `FAIL` 우선).
  - 충돌 평가 시 CI 상태가 누락(`null`/`undefined`)되거나 이전 커밋 SHA의 결과만 남아 있으면 `UNKNOWN`으로 차단합니다.
  - PR이 `OPEN` 상태이고 Draft가 아니며, 충돌과 미해결 Blocker가 없고 `PASS` / `NO_TESTS` / `UNAVAILABLE`이면 우선순위(`저장소 허용 방식 > 명시적 프로젝트 설정 github.merge_method > 명시적 CLI 플래그 > 기본값 squash`)에 따라 `gh pr merge <PR> --<method> --delete-branch`를 실행합니다(`github.auto_merge_on_ci_pass: false` 설정 시 수동 머지 유지). `guard-bash.mjs`가 `FAIL`, `PENDING`, `UNKNOWN`, `CLOSED`, `MERGED`, `Draft`, 충돌 상태, `--admin`, `gh api` 우회 머지를 차단합니다.
- **언어 정책**: Issue, PR, 커밋, Worker Report, PR 리뷰 보고서 모두 사용자의 요청 언어를 따릅니다(한국어 요청 시 한국어, 영어 요청 시 영어, 별도 지정 시 해당 언어 우선). 기술 식별자, 코드, Git 명령어, Conventional Commit 접두사, 상태 토큰(`READY_FOR_PR`, `BLOCKED`, `PASS`, `FAIL`)은 원문을 유지합니다.

---

## 6. 설치 경로와 소유권 관리

`install.sh`, `uninstall.sh`, `scripts/install.mjs`는 기존 파일이나 다른 플러그인의 자산을 덮어쓰거나 삭제하지 않도록 2단계 사전 검증(Pre-flight)과 삭제 직전 독립 재검증을 수행합니다.

- **지원 범위**: `--scope project`(`$(pwd)/.agents/skills`), `--scope global`(`${HOME}/.agents/skills`), `--target <dir>`, `--copy`, `--dry-run`
- **소유권 매니페스트**: 설치 완료 시 대상 디렉터리에 `.github-convention-install-manifest`를 기록해 스키마 버전(`schema_version=1`), 플러그인 식별자(`plugin=github-convention`), 설치 범위·경로·방식, 관리 대상 스킬 목록(`entry|<skill>|<mode>|<dest>|<source>`)을 엄격히 검증합니다.
- **심볼릭 링크 소유권 확인**: 단순 경로 접미사(`*/skills/<name>`) 비교를 쓰지 않고, 상대/절대 링크 대상을 기준 디렉터리와 함께 정규화(`pwd -P` / `realpathSync`)해 현재 저장소의 `skills/<name>`과 정확히 일치할 때만 소유한 링크로 인정합니다.
- **복사 디렉터리 소유권 및 파일 목록 검증**: `--copy` 설치 시 대상 디렉터리에 `plugin=github-convention`, `skill=<name>`, `install-path=<경로>`, `source=<원본경로>`, `files=<파일목록>`이 모두 기록된 `.github-convention-script-managed` 마커를 생성합니다. 필수 필드가 하나라도 누락되거나 불일치하면 소유권을 인정하지 않으며, 마커가 존재하더라도 디렉터리 내부 파일 구성이 원본 스킬 디렉터리와 다르거나 사용자가 추가한 파일·심볼릭 링크가 섞여 있으면 덮어쓰거나 `rm -rf`로 삭제하지 않고 보존합니다.
- **삭제 직전 독립 재검증 및 원자적 중단**: 6개 스킬 중 하나라도 소유하지 않은 파일, 마커가 없거나 불완전한 디렉터리, 외부 심볼릭 링크, 경로 이탈, 매니페스트 변조가 감지되면 실제 변경 없이 즉시 중단합니다. 삭제 직전에도 `if ! ... exit 1` 독립 가드로 경로와 소유권을 재검증합니다.

---

## 7. 오류 발생 시 복구 방법

### 설치·삭제 충돌 오류 (`Conflict: refusing to ...`)

1. `--dry-run`으로 충돌 경로와 원인을 먼저 확인합니다.
   ```bash
   ./install.sh --target <경로> --dry-run
   ./uninstall.sh --target <경로> --dry-run
   ```
2. 충돌 경로가 사용자 파일이나 다른 플러그인 심볼릭 링크라면 해당 경로를 백업·정리하거나 `--target`으로 다른 디렉터리를 지정한 뒤 다시 실행합니다.

### 설치 중단 후 재실행

일부 스킬만 설치된 상태에서 중단되었더라도 소유권 마커나 심볼릭 링크 대상이 `github-convention`과 일치하면 `./install.sh`를 다시 실행해 나머지 스킬을 이어서 설치할 수 있습니다.

### SessionStart 컨텍스트가 너무 짧거나 길 때

- 전체 `using-github-convention` 지침이 필요하면 환경 변수 `GITHUB_CONVENTION_CONTEXT_MODE=full`을 설정하거나 `.github-convention/config.yaml`에 `session.context_mode: full`을 지정합니다.
- 항상 최소 요약만 주입하려면 `compact`를 사용합니다.

### Hook(`guard-bash.mjs`) 차단 대응

- 기본 브랜치 직접 푸시 또는 `gh pr merge` 차단은 의도된 보호 동작이므로 피처 브랜치와 PR 워크플로우를 사용합니다.
- 진단된 훅/도구 장애로 `--no-verify`가 불가피한 경우에만 사유를 남기고 `GITHUB_CONVENTION_ALLOW_NO_VERIFY=1`을 일시적으로 적용합니다.
