# github-convention

[![npm version](https://img.shields.io/npm/v/@dobbymin/github-convention-cli)](https://www.npmjs.com/package/@dobbymin/github-convention-cli)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[한국어](README.md) | [English](README.en.md)

**저장소의 기존 컨벤션을 훼손하지 않고, 이슈 중심의 안전한 GitHub 개발 워크플로를 적용하는 AI 에이전트 스킬 및 CLI 도구입니다.**

메인 에이전트(오케스트레이터)가 저장소 분석, 이슈 계획·승인, 상태 관리, PR·릴리스 흐름을 전담하고, 병렬 워커는 격리된 작업 공간에서 구현과 테스트만 수행하도록 역할을 분리합니다.

---

## 빠른 시작

자세한 플랫폼별 설치와 제거 방법은 [`INSTALL.md`](INSTALL.md)를 참고하세요.

### 1. 마켓플레이스 직접 설치 (Claude Code 등)

```text
/plugin marketplace add Dobbymin/github-convention
/plugin install github-convention
```

### 2. Node CLI로 프로젝트 적용 (`Node >= 22`)

```bash
npx @dobbymin/github-convention-cli doctor --project .
npx @dobbymin/github-convention-cli init --project .
npx @dobbymin/github-convention-cli install --project .
```

### 3. 경량 셸 스크립트로 스킬만 설치

```bash
./install.sh --scope project
```

---

## 슬래시 커맨드 & 조건부 세션 훅

- **`commands/` 슬래시 커맨드:** `skills/github-convention/SKILL.md` 및 `references/`로 연결되는 진입 커맨드 4종을 제공합니다.
  - `gh-plan`: 저장소 컨벤션 분석 및 이슈 의존성 DAG 초안 작성
  - `gh-pr`: 브랜치·품질 게이트·시크릿 스캔 검증 후 PR 생성/갱신
  - `gh-status`: 실시간 GitHub 상태와 로컬 실행 상태 동기화·복구
  - `gh-doctor`: 읽기 전용 진단(`doctor`, `validate`) 실행
- **`hooks/` 조건부 `SessionStart` 훅:** 작업 디렉토리에 `.github-convention/config.yaml`이 있는 프로젝트에서만 짧은 워크플로 안내를 출력하며, 일반 저장소에서는 아무 출력 없이 종료합니다.

---

## 워크플로 & 승인 경계

1. **분석 (Analyze):** 기존 이슈·PR 템플릿, 라벨, 브랜치·커밋 규칙, CI 게이트를 읽어 로컬 캐시에 반영합니다.
2. **이슈 계획 (Plan):** 구현 가능한 단위로 이슈와 `Blocked by` 의존성을 제안하며, 사용자 승인 전에는 원격 이슈를 생성하지 않습니다.
3. **구현 및 검증 (Execute):** 독립 태스크만 격리된 워크트리에서 병렬 실행하고, 워커의 커밋·푸시·머지는 차단합니다.
4. **PR · 릴리스 (PR & Release):** 빌드·린트·타입·테스트·시크릿 스캔을 통과한 뒤에만 PR을 올리며, 릴리스 발행·태그 생성·머지는 항상 명시적 승인 후 실행합니다.

---

## 주요 CLI 명령어

| 명령어                             | 설명                                               | 비고                      |
| :--------------------------------- | :------------------------------------------------- | :------------------------ |
| `doctor`                           | `git`, `gh`, 에이전트, 스킬 무결성 점검            | 읽기 전용                 |
| `init`                             | `.github-convention/config.yaml` 및 정규 스킬 준비 | `--dry-run` 지원          |
| `install` / `update` / `uninstall` | 에이전트별 스킬 설치·갱신·제거                     | `--scope`, `--agent` 지원 |
| `list` / `validate`                | 설치 목록 및 설정·상태 스키마 검증                 | `--output json` 지원      |
| `plan validate` / `plan apply`     | 이슈 계획 검증 및 승인된 이슈 생성                 | `--yes` 필요              |
| `status` / `state` / `cleanup`     | 실행 상태 조회·복구·아카이브 정리                  | `--output json` 지원      |

전체 명령어·종료 코드·JSON 계약은 [`docs/cli-contract.md`](docs/cli-contract.md)를 확인하세요.

---

## 문서 및 스키마 안내

- [설치 가이드 (`INSTALL.md`)](INSTALL.md) — 마켓플레이스, Node CLI, 셸 스크립트 상세 설치 안내
- [스킬 원본 (`skills/github-convention/SKILL.md`)](skills/github-convention/SKILL.md) — 에이전트 지침 및 `references/`
- [CLI 계약 (`docs/cli-contract.md`)](docs/cli-contract.md) — 명령어, 플래그, JSON 출력, 종료 코드
- [에이전트 어댑터 (`docs/agent-adapters.md`)](docs/agent-adapters.md) — 7종 에이전트 감지 기준 및 스킬 경로
- [마켓플레이스 어댑터 (`docs/marketplace-adapters.md`)](docs/marketplace-adapters.md) — 루트 매니페스트 및 로컬 스테이징 경계
- [배포 및 릴리스 (`docs/distribution.md`)](docs/distribution.md) · [릴리스 절차 (`docs/release-workflow.md`)](docs/release-workflow.md)
- [이슈 형식 (`docs/issue-templates.md`)](docs/issue-templates.md) · [라벨 정책 (`docs/label-policy.md`)](docs/label-policy.md) · [PR 템플릿 (`templates/PULL_REQUEST_TEMPLATE.md`)](templates/PULL_REQUEST_TEMPLATE.md)
- [설정 예시 (`examples/config.yaml`)](examples/config.yaml) · [실행 상태 예시 (`examples/state.json`)](examples/state.json)
- [설정 스키마 (`schemas/config.schema.json`)](schemas/config.schema.json) · [상태 스키마 (`schemas/state.schema.json`)](schemas/state.schema.json)

---

## 로컬 개발 및 검증

Node.js 22 이상이 필요합니다.

```bash
npm ci
npm run build
npm run format:check
npm run lint
npm run typecheck
npm test
npm run verify:manifests
npm run test:scripts
```

## 라이선스

[MIT License](LICENSE)
