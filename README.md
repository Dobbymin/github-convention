# GitHub Convention

**에이전트 독립형 GitHub 워크플로 스킬 + CLI**
설계 명세 및 구현 · `v0.1.1`

`github-convention`은 여러 AI 코딩 에이전트와 프로젝트에 일관된 이슈 기반(Issue-first) GitHub 개발 워크플로를 적용하는 스킬 패키지와 CLI(`@dobbymin/github-convention-cli`)입니다.

모든 설계는 한 가지 원칙에서 출발합니다.

> **Main Agent(오케스트레이터)가 계획, 조율, Git 및 GitHub 상태 변경을 전담합니다.**
> Worker/Sub Agent는 격리된 작업 공간에서 구현과 테스트만 맡고 직접 커밋·푸시·PR 생성·GitHub 상태 변경을 하지 않습니다.

---

## 목차

1. [구성 요소와 동작 경계](#1-구성-요소와-동작-경계)
2. [사전 준비](#2-사전-준비)
3. [빠른 시작 (설치 및 프로젝트 적용)](#3-빠른-시작-설치-및-프로젝트-적용)
4. [지원 에이전트 및 설치 경로](#4-지원-에이전트-및-설치-경로)
5. [AI 에이전트에서 스킬 사용하는 법](#5-ai-에이전트에서-스킬-사용하는-법)
6. [승인 필수 경계 (Approval Boundaries)](#6-승인-필수-경계-approval-boundaries)
7. [CLI 명령어 및 옵션 레퍼런스](#7-cli-명령어-및-옵션-레퍼런스)
8. [프로젝트 설정 커스터마이징](#8-프로젝트-설정-커스터마이징)
9. [문서 및 스키마 안내](#9-문서-및-스키마-안내)
10. [로컬 개발 및 검증](#10-로컬-개발-및-검증)

---

## 1. 구성 요소와 동작 경계

### 구성 요소

- **Skill (`SKILL.md` + `references/` + `templates/`):** AI 에이전트에게 이슈 계획, 브랜치·PR 규칙, 워커 조율, 보안·릴리스 판단 기준을 제공합니다.
- **CLI (`@dobbymin/github-convention-cli`):** 에이전트 감지, 스킬 설치·업데이트·제거, 프로젝트 초기화, 설정·스키마·무결성 검증, 실행 계획 및 로컬 상태를 관리하는 TypeScript/Node.js 도구입니다.
- **Adapters:** 에이전트별 설치 경로, 심볼릭 링크/복사 전략, 지원 기능을 매핑합니다. GitHub 연동은 사용자의 기존 `gh` 인증 세션을 우선 사용합니다.

### 주요 동작 경계

- 텔레메트리나 사용량 수집을 하지 않습니다.
- 백그라운드 데몬 없이 온디맨드 CLI와 로컬 상태 파일로만 동작합니다.
- 비대화형(`--non-interactive`) 모드나 `--yes` 플래그로 사용자 승인을 추론하거나 우회하지 않습니다.
- 프로젝트 내 스킬 원본(Canonical Source)은 `.agents/skills/github-convention/` 한 곳에서 Git으로 추적합니다. 에이전트별 호환 경로(예: `.claude/skills/`)는 심볼릭 링크나 매니페스트 추적 복사본으로 관리하고 Git 추적에서 제외합니다.

---

## 2. 사전 준비

스킬과 CLI를 사용하기 전에 아래 환경을 먼저 확인하세요.

- **Node.js:** `22` 이상 (`node -v`)
- **Git:** 작업할 로컬 Git 저장소 (`git status`)
- **GitHub CLI (`gh`):** 설치 및 로그인 완료 상태

```bash
# gh 로그인 상태 확인
gh auth status
```

---

## 3. 빠른 시작 (설치 및 프로젝트 적용)

### 3-1. CLI 실행 또는 전역 설치

npm에서 바로 실행하거나 전역에 설치해 `github-convention` 명령어로 사용할 수 있습니다.

```bash
# npx로 바로 실행
npx @dobbymin/github-convention-cli --version

# 또는 전역 설치 후 사용
npm install -g @dobbymin/github-convention-cli
github-convention --version
```

### 3-2. 환경 진단 (`doctor`)

현재 OS, Node 버전, Git 저장소, `gh` 인증 상태, 로컬에 설치된 AI 에이전트를 점검합니다.

```bash
npx @dobbymin/github-convention-cli doctor
# JSON 출력이 필요할 때
npx @dobbymin/github-convention-cli doctor --output json
```

### 3-3. 대상 프로젝트 초기화 (`init`)

적용할 프로젝트 루트에서 `init`을 실행하면 기본 설정(`.github-convention/config.yaml`), 프로젝트 정규 스킬 폴더(`.agents/skills/github-convention/`), `.gitignore` 규칙이 준비됩니다. 먼저 `--dry-run`으로 변경 예정 내역을 확인할 수 있습니다.

```bash
# 변경 내역 미리보기 (파일을 실제로 수정하지 않음)
npx @dobbymin/github-convention-cli init --dry-run

# 실제 초기화 적용
npx @dobbymin/github-convention-cli init
```

### 3-4. 에이전트에 스킬 설치 (`install`)

사용 중인 AI 에이전트에 스킬을 설치합니다. `--scope`에 따라 세 가지 방식으로 설치할 수 있습니다.

- **`--scope project`:** 현재 저장소에만 스킬을 설치합니다. (`.agents/skills/github-convention/`을 기준으로 에이전트별 경로 연결)
- **`--scope global`:** 사용자 홈 디렉터리의 에이전트 전역 스킬 경로에 설치하여 모든 프로젝트에서 스킬을 불러올 수 있게 합니다.
- **`--scope both`:** 프로젝트와 전역 경로 양쪽에 설치합니다.

```bash
# 대화형 설치 (감지된 에이전트를 선택해 설치)
npx @dobbymin/github-convention-cli install

# 원하는 에이전트를 지정해 전역(global)에 설치
npx @dobbymin/github-convention-cli install \
  --agent codex,claude-code,antigravity,copilot \
  --scope global

# 현재 프로젝트(project) 범위에 설치 (미리보기 후 적용)
npx @dobbymin/github-convention-cli install \
  --agent codex,claude-code \
  --scope project \
  --dry-run

npx @dobbymin/github-convention-cli install \
  --agent codex,claude-code \
  --scope project
```

### 3-5. 설치 목록 확인 및 무결성 검증 (`list`, `validate`)

설치된 에이전트 어댑터 상태와 `SKILL.md` 프론트매터, 설정 스키마, 파일 해시 매니페스트를 검증합니다.

```bash
# 설치된 에이전트 및 범위, 링크/복사 상태 조회
npx @dobbymin/github-convention-cli list

# 프로젝트 설정 및 스킬 무결성 검사
npx @dobbymin/github-convention-cli validate
```

---

## 4. 지원 에이전트 및 설치 경로

7종 에이전트 어댑터를 기본 지원합니다. 워크플로 규칙은 모든 에이전트에서 동일하게 유지되며, 어댑터는 경로 매핑과 설치 방식(`native`, `symlink`, `copy`)만 담당합니다.

| 어댑터 ID     | 에이전트             | 프로젝트 스킬 경로                                                             | 전역 스킬 경로                                                                            |
| ------------- | -------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `codex`       | OpenAI Codex         | `.agents/skills/github-convention/`                                            | `~/.agents/skills/github-convention/`                                                     |
| `claude-code` | Claude Code          | `.claude/skills/github-convention/`                                            | `~/.claude/skills/github-convention/`                                                     |
| `gemini-cli`  | Gemini CLI           | `.agents/skills/github-convention/` 또는 `.gemini/skills/github-convention/`   | `~/.agents/skills/github-convention/` 또는 `~/.gemini/skills/github-convention/`          |
| `antigravity` | Google Antigravity   | `.agents/skills/github-convention/`                                            | `~/.gemini/config/skills/github-convention/`                                              |
| `opencode`    | OpenCode             | `.agents/skills/github-convention/` 또는 `.opencode/skills/github-convention/` | `~/.agents/skills/github-convention/` 또는 `~/.config/opencode/skills/github-convention/` |
| `kilo`        | Kilo Code / Kilo CLI | `.agents/skills/github-convention/` 또는 `.kilo/skills/github-convention/`     | `~/.agents/skills/github-convention/` 또는 `~/.kilo/skills/github-convention/`            |
| `copilot`     | GitHub Copilot CLI   | `.github/skills/github-convention/` 또는 `.agents/skills/github-convention/`   | `~/.copilot/skills/github-convention/`                                                    |

- 프로젝트 범위 설치 시 `.agents/skills/github-convention/`이 정규 원본(Canonical Source)이 됩니다.
- `claude-code`나 `copilot`처럼 별도 폴더를 읽는 에이전트는 가능한 경우 정규 원본을 가리키는 심볼릭 링크로 연결하고, 심볼릭 링크를 쓸 수 없는 환경에서는 해시 매니페스트가 기록된 복사본을 생성합니다.

---

## 5. AI 에이전트에서 스킬 사용하는 법

스킬을 설치한 뒤 AI 에이전트(Claude Code, Codex, Antigravity, Gemini CLI, Copilot 등)에게 작업을 요청하면, 에이전트는 `SKILL.md`와 필요한 세부 레퍼런스(`references/*.md`)를 읽고 아래 순서로 워크플로를 진행합니다.

### 5-1. 에이전트 프롬프트 예시

에이전트 대화창에서 평소처럼 작업을 지시하거나 `github-convention` 스킬 적용을 명시할 수 있습니다.

- **기능 개발 및 이슈 먼저 생성하기:**
  > "`github-convention` 스킬 규칙에 따라 로그인 세션 갱신 기능을 이슈로 먼저 초안을 잡아주고, 승인하면 브랜치 만들어서 구현과 PR까지 진행해줘."
- **큰 작업을 부모/하위 이슈로 나누기:**
  > "결제 모듈 리팩터링 작업을 `github-convention`으로 분석해서 Parent Issue와 독립 실행 가능한 Sub-issue 계획으로 나눠줘."
- **기존 이슈 이어서 작업하기:**
  > "이슈 `#12` 요구사항과 완료 기준을 확인하고 `github-convention` 절차대로 브랜치 생성 후 구현해줘."
- **PR 리뷰 및 CI 실패 대응하기:**
  > "현재 열린 PR의 리뷰 코멘트와 실패한 CI 로그를 확인해서 수정하고 재검증해줘."

### 5-2. 단계별 워크플로 동작

1. **초기 점검 및 재개 (`First-run & Resume`):**
   - 저장소 루트와 기본 브랜치(`main` 등)를 확인합니다.
   - `.github-convention/config.yaml`과 저장소의 기존 이슈/PR 템플릿, 커밋·브랜치 컨벤션, 테스트 스크립트를 분석합니다.
   - 원격 GitHub 상태(이슈, 의존성, PR, CI)는 항상 실시간으로 조회합니다.
2. **이슈 계획 및 승인 (`Planning`):**
   - 작업을 독립적으로 구현·검증할 수 있는 단위로 나누고, 선행 작업이 반드시 필요한 경우에만 `Blocked by` 의존성(DAG)을 설정합니다.
   - 이슈를 실제로 생성하기 전 **초안을 사용자에게 먼저 보여주고 승인**을 받습니다.
   - 사용자가 한국어로 요청하면 이슈 제목/본문, 커밋 메시지 본문, PR 제목/본문을 모두 한국어로 작성합니다. (단, `feat:`, `fix:` 같은 Conventional Commit 타입 접두사, 코드 식별자, `Closes #123` 키워드는 원형 유지)
3. **실행 및 워커 격리 (`Execution`):**
   - 단일 에이전트 순차 실행을 기본으로 하되, 독립된 작업이 여러 개이고 런타임이 서브 에이전트를 지원하면 설정된 한도(`max_parallel_agents`) 안에서 병렬 워커를 격리된 워크스페이스(또는 Git Worktree)로 실행합니다.
   - 워커는 코드 수정과 테스트만 수행하고, 오케스트레이터가 실제 `git diff`와 테스트 통과 여부를 직접 재검증합니다.
4. **Git 브랜치 및 PR 생성 (`Git & PR`):**
   - 보호된 기본 브랜치에 직접 푸시하지 않으며, 작업 이슈마다 별도 브랜치(예: `feat/12-login-session`)와 PR을 생성합니다.
   - PR을 열기 전 최신 기본 브랜치 리베이스, 테스트·린트·타입·빌드 실행, 셀프 리뷰, 시크릿 스캔을 거칩니다.
   - **PR 병합(Merge)은 에이전트가 임의로 수행하지 않고 사용자가 최종 결정합니다.**
5. **리뷰 및 CI 대응 (`Review & CI`):**
   - 단순 네이밍·스타일·누락된 테스트 보강은 자동으로 반영하고 재검증 후 푸시합니다.
   - 아키텍처, 비즈니스 로직, 요구사항 변경을 수반하는 리뷰는 사용자에게 먼저 확인합니다.

---

## 6. 승인 필수 경계 (Approval Boundaries)

에이전트와 CLI는 아래 작업을 수행하기 전에 **반드시 사용자의 명시적 승인**을 요청합니다.

- 초안으로 작성한 새 GitHub 이슈를 원격 저장소에 생성할 때
- 시크릿 스캐너 등 새 프로젝트 도구를 설치하거나 Git 훅/CI 설정을 변경할 때
- GitHub Branch Protection 또는 Ruleset 설정을 변경할 때
- 코드 리뷰 중 아키텍처, 비즈니스 로직, 핵심 요구사항 변경이 필요할 때
- 배포 실패 또는 헬스체크 실패 후 롤백(Rollback)을 실행할 때
- Git 태그(`v*`)나 GitHub Release를 생성할 때
- 소유권이나 데이터 안전성이 불분명한 파괴적 작업을 수행할 때

비대화형 모드(`--non-interactive`)에서 위 작업이 필요하면 CLI는 작업을 즉시 멈추고 종료 코드 `3`(`status: "approval_required"`)을 반환합니다.

---

## 7. CLI 명령어 및 옵션 레퍼런스

### 명령어 요약

| 명령어                          | 설명                                                                       |    상태 변경    |
| ------------------------------- | -------------------------------------------------------------------------- | :-------------: |
| `install`                       | 에이전트를 감지/선택하여 프로젝트 또는 전역 스킬 설치                      |       Yes       |
| `update`                        | 무결성 검사 및 3-way 병합으로 CLI/스킬 업데이트 미리보기 및 적용           |       Yes       |
| `uninstall`                     | 사용자가 수동 수정하지 않은 CLI 관리 설치 파일만 안전하게 제거             |       Yes       |
| `list`                          | 설치된 에이전트, 범위, 버전, 심볼릭 링크/복사 상태 조회                    |       No        |
| `doctor`                        | OS, Node, Git, `gh` 인증, 에이전트 경로, 스키마, 매니페스트 무결성 진단    |       No        |
| `init`                          | `.github-convention/config.yaml`, 정규 스킬 폴더, `.gitignore` 규칙 초기화 |       Yes       |
| `validate`                      | 설정 파일, `SKILL.md` 메타데이터, 매니페스트, 로컬 상태 및 컨벤션 검증     |       No        |
| `status`                        | 현재 실행 상태, 이슈, PR, 에이전트 현황 조회                               |       No        |
| `cleanup`                       | 만료된 아카이브 및 검증된 임시 아티팩트 정리                               |       Yes       |
| `plan validate`                 | 생성된 워크플로/이슈 실행 계획의 유효성 및 DAG 의존성 검증                 |       No        |
| `plan apply`                    | 승인된 이슈 계획을 멱등성(idempotent) 있게 GitHub에 반영                   |       Yes       |
| `state list \| show \| restore` | 아카이브된 로컬 실행 상태 목록 조회, 상세 확인 및 복원                     | `restore`만 Yes |

### 공통 옵션

```text
--agent <id[,id...]>          대상 에이전트 어댑터 ID (예: codex,claude-code)
--scope <global|project|both> 설치/작업 범위 지정
--non-interactive             프롬프트 없이 실행 (승인 필요 시 approval_required 반환)
--output <text|json>          출력 형식 (기본값: text, 기계 파싱 시 json 권장)
--dry-run                     실제 파일/원격 변경 없이 예정된 작업만 계산해 출력
--yes                         일반 확인 프롬프트 자동 수락 (보호된 승인 경계는 우회하지 않음)
--project <path>              프로젝트 루트 경로 명시 (생략 시 현재 Git 루트 자동 감지)
--config <path>               진단/검증할 설정 파일 경로 명시
--verbose                     상세 진단 메시지 출력 (시크릿 값은 자동 마스킹)
```

---

## 8. 프로젝트 설정 커스터마이징

`github-convention init`을 실행하면 `.github-convention/config.yaml`을 통해 프로젝트별 동작을 조정할 수 있습니다. 전역 기본값을 상속하며, 필요한 항목만 덮어씁니다. (전체 예시는 [`examples/config.yaml`](examples/config.yaml), 스키마는 [`schemas/config.schema.json`](schemas/config.schema.json) 참고)

```yaml
schema_version: 1

execution:
  sub_agents: auto # auto | enabled | disabled
  max_parallel_agents: 3 # 동시 실행 가능한 최대 서브 에이전트 수
  retry:
    worker_max_retries: 2 # 워커 초기 실패 후 재시도 횟수
    code_ci_max_retries: 2 # 코드 원인 CI 실패 재시도 횟수
    transient_ci_max_retries: 3 # 일시적 네트워크/외부 오류 재시도 횟수

github:
  auth_preference: gh # gh 세션을 우선 사용
  default_branch: detect # 저장소 기본 브랜치 자동 감지
  create_draft_pr: false # 기본으로 일반 PR 생성
  require_issue_approval: true
  require_release_approval: true

quality:
  reuse_existing_tools: true
  require_secret_scan: true
  secret_scanner_install_requires_approval: true
  self_review_required_before_pr: true
```

설정을 수정한 뒤에는 항상 `validate` 명령으로 스키마 적합성을 확인하세요.

```bash
npx @dobbymin/github-convention-cli validate --project .
```

---

## 9. 문서 및 스키마 안내

- [스킬 패키지 원본 (`skills/github-convention/SKILL.md`)](skills/github-convention/SKILL.md) — 에이전트에 설치되는 `SKILL.md` 및 `references/`
- [CLI 계약 (`docs/cli-contract.md`)](docs/cli-contract.md) — 명령어, 플래그, JSON 출력 봉투(envelope), 종료 코드, 승인 동작
- [에이전트 어댑터 (`docs/agent-adapters.md`)](docs/agent-adapters.md) — 에이전트 감지 기준, 기능 모델, 스킬 경로
- [배포 및 릴리스 아키텍처 (`docs/distribution.md`)](docs/distribution.md) — npm 패키지 및 독립 실행 아티팩트 배포 구조
- [저장소 이슈 및 PR 템플릿 (`.github/ISSUE_TEMPLATE/`)](.github/ISSUE_TEMPLATE/01-parent-issue.md) — GitHub UI 이슈 템플릿 및 [`.github/pull_request_template.md`](.github/pull_request_template.md)
- [재사용 가능한 이슈 구조 (`docs/issue-templates.md`)](docs/issue-templates.md) — 대상 저장소용 부모/하위/후속 이슈 기본 형식
- [재사용 가능한 PR 본문 템플릿 (`templates/PULL_REQUEST_TEMPLATE.md`)](templates/PULL_REQUEST_TEMPLATE.md)
- [설정 예시 (`examples/config.yaml`)](examples/config.yaml) 및 [실행 상태 예시 (`examples/state.json`)](examples/state.json)
- [설정 스키마 (`schemas/config.schema.json`)](schemas/config.schema.json) 및 [상태 스키마 (`schemas/state.schema.json`)](schemas/state.schema.json)

---

## 10. 로컬 개발 및 검증

이 저장소는 npm 워크스페이스 구조로 되어 있으며 Node.js 22 이상이 필요합니다.

```bash
npm ci
npm run build
npm run format:check
npm run lint
npm run typecheck
npm test
```

로컬에서 빌드한 CLI를 직접 실행할 때는 `node packages/cli/dist/index.js <command>` 형태를 사용할 수 있습니다. `packages/cli`와 `packages/skill`은 독립된 패키지 버전을 유지하며, CLI는 실행 전 스킬 호환 범위를 검증합니다.

## 라이선스

[MIT](LICENSE)
