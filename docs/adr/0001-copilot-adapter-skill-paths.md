# GitHub Copilot CLI 스킬 경로 매핑 결정

GitHub Copilot CLI(`copilot`)는 프로젝트 스킬을 `.github/skills/<name>/`에서, 전역 스킬을 `~/.copilot/skills/<name>/`에서 우선 탐색하며 `.agents/skills/<name>/`도 호환 경로로 지원한다. 이미 다른 에이전트용 정규 원본이 `.agents/skills/github-convention/`에 존재하므로 모든 에이전트를 `.agents/skills`로 통일하는 대안도 있었으나, Copilot 네이티브 규약과 기존 호환성을 함께 맞추기 위해 기본 경로는 `.github/skills`와 `~/.copilot/skills`로 두고 `.agents/skills`는 보조 탐색 경로(`AlternateSkillDirs`)로 등록했다. 이로써 기존 심볼릭 링크/관리형 복사 설치 정책과 충돌 없이 Copilot 전용 프로젝트·전역 스킬을 안전하게 탐지하고 관리할 수 있다.
