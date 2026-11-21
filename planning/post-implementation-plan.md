# Implementation Graph 이후 후속 작업 계획

## 현재 기준선

- 기준 브랜치·커밋: `main` (`f2f89c7`)
- Implementation Graph 상태: `N01`–`N21` 전체 완료 (`planning/implementation/graph.json`, `.harness/state/active/graph-initialization.json` 모두 `21/21 passed`)
- GitHub 상태: 오픈 Issue·PR 없음
- 운영 결정: 최소화 방침에 따라 현시점에는 운영·위생 항목에 대한 추가 Issue를 열지 않는다. 실제 `v0.1.0` 외부 배포를 진행할 때만 릴리스 Issue 1개를 생성한다.

## 보류 항목 참고 기록

- 정책상 미실행 항목:
  - 실제 `npm publish`, `gh release create`, Git 태그 생성 (`v0.1.0` 배포 결정 시 실행)
  - 라이브 `main` 브랜치 보호 규칙 변경
- 로컬 잔여물:
  - untracked `.DS_Store` 및 이전 서브에이전트 로컬 브랜치 `subagent-N*` (원격 `main` 및 테스트와 무관하며, 필요 시 로컬 워크트리와 브랜치만 정리)
- 원격 저장소 추적 파일:
  - 기존 커밋에 포함된 `github-convention/.DS_Store`, `skills/.DS_Store`, `skills/github-convention/.DS_Store` 3건 (기능·테스트 영향 없음, 배포·위생 정리 시 선택적으로 제거)

## 후속 실행 단계

### Phase 1 — CLI 스텁 커맨드 실배선 (최우선)

핵심 모듈은 구현됐으나 `packages/cli/src/commands.ts` 진입점이 아직 스텁인 명령 3종을 실제 구현체에 연결한다.

1. `install` (`packages/cli/src/commands.ts` L32–L59) → `packages/cli/src/install/` 실제 설치 로직 연결
2. `list` (`packages/cli/src/commands.ts` L170–L181) → `detectAllAgents` 및 설치 매니페스트 조회 연결 (`agents: []` 고정 반환 제거)
3. `status` (`packages/cli/src/commands.ts` L275–L288) → `StateManager` 현재 실행 상태 조회 연결 (`state: "idle"` 고정 반환 제거)

- **검증 기준**:
  - `install`, `list`, `status` 각각의 `text` / `json` / `--dry-run` 통합 테스트 추가 및 통과
  - `npm test && npm run typecheck && npm run lint && npm run format:check` 통과

### Phase 2 — 샌드박스 저장소 E2E 실전 검증

mock `gh` 러너 기반 단위 테스트를 넘어, `ROADMAP.md`에 명시된 사용자 소유 테스트 저장소에서 실제 `gh` CLI·Git 환경으로 전체 흐름을 검증한다.

- 실행 순서: `doctor` → `init` → `install --dry-run` → `plan validate` → `plan apply --dry-run` → `validate`
- **검증 기준**:
  - 실제 `gh` 출력 파싱 오류 0건
  - `--dry-run` 실행 시 파일시스템·Git·원격 저장소 무변경 보장
  - `--output json` 모드에서 stdout 단일 유효 JSON 출력 유지

### Phase 3 — 로컬 Dogfooding

완성된 CLI로 `.agents/skills/github-convention/`을 로컬 에이전트(Claude Code, Codex, Antigravity 등)에 `github-convention install`로 설치해 다른 프로젝트에 직접 적용한다.

- **검증 기준**:
  - 실제 작업 중 불편한 출력 형식, 누락된 옵션, 알림 UX 피드백 수집 및 개선 목록 도출

### Phase 4 — `v0.1.0` 첫 배포 및 운영 설정 (외부 공개 결정 시)

외부 공개 배포를 결정한 시점에 아래 체크리스트를 릴리스 Issue 1건으로 묶어 실행한다.

1. `README.md`에 실제 CLI 설치·실행 예제 보강 및 `CHANGELOG.md` 정리
2. `@github-convention/*` npm scope 발행 권한과 `NPM_TOKEN` 시크릿 확인
3. 릴리스 Issue 생성 후 `v0.1.0` 태그 생성, `gh release create`, `npm publish` 실행
4. (선택) `main` 라이브 브랜치 보호 규칙 활성화(CI 6개 체크 필수, force-push 금지) 및 원격 추적 `.DS_Store` 3개 `git rm --cached` 제거
