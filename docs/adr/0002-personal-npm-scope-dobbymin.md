# 개인 npm 스코프 `@dobbymin/github-convention-*` 전환 결정

기존 패키지명 `@github-convention/*`는 npm 레지스트리에 `github-convention` 조직(Organization)이 생성되지 않아 `npm publish`가 불가했다. 별도 조직을 새로 만들어 관리하는 대안도 있었으나, 개인 오픈소스 도구 규모에서는 조직 운영 부담보다 즉시 발행과 유지보수 단순성이 중요하므로 개인 npm 계정 스코프인 `@dobbymin/github-convention-{cli,core,agent-adapters,github-adapter,skill}`로 5개 워크스페이스 패키지명을 일괄 전환했다. 이로써 패키지명·import 경로와 향후 호환성 마이그레이션 비용을 감수하는 대신 추가 조직 관리 없이 바로 공개 발행이 가능하다.
