# github-convention

저장소 컨벤션 분석, 이슈·PR 자동화, 에이전트별 스킬 설치 생명주기를 결정적으로 다루는 CLI 및 스킬 도메인.

## Language

**Canonical Skill Source**:
프로젝트 내 `.agents/skills/github-convention/`에 두는 단일 정규 스킬 원본.
_Avoid_: 원본 스킬 사본, 스킬 미러

**Agent Adapter**:
각 코딩 에이전트의 실행 파일·설정 경로를 탐지하고 프로젝트·전역 스킬 경로를 매핑하는 어댑터.
_Avoid_: 에이전트 드라이버, 플러그인 로더

**Managed Install**:
심볼릭 링크 또는 해시 매니페스트(`.manifest.json`)로 소유권과 무결성을 추적해 설치·갱신·제거하는 대상.
_Avoid_: 단순 복사, 수동 설치본

**Execution State**:
오케스트레이터만 원자적 잠금으로 기록하며 실행 진행률·승인 이력·작업 그래프를 보관하는 상태 스냅샷.
_Avoid_: 로컬 캐시, 실행 로그
