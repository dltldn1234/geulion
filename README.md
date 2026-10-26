# GEULION (글리온)

GEULION은 한국어를 우선으로 설계하는 범용 프로그래밍 언어 프로젝트입니다.

## 개발 목표

- 한국어 사용자가 자연스럽게 읽고 작성할 수 있는 언어를 설계합니다.
- 범용 목적에 맞는 명확하고 일관된 문법을 지향합니다.
- 언어의 규칙과 도구를 단계적으로 정의하고 구현합니다.

## 현재 상태

현재는 컴파일러 개발 기반 구성과 Language Specification v0.1 문서화를 마친 초기 단계입니다. pnpm 워크스페이스, TypeScript 패키지 경계, 개발 검사 도구와 CLI의 도움말·버전 명령이 준비되어 있고, 언어 규칙은 [명세 문서](docs/language/README.md)에 정의되어 있습니다. GEULION Lexer, Parser, Semantic Analysis, Compiler, JavaScript 코드 생성은 아직 구현하지 않았습니다.

개발 작업은 GitHub Issue에서 목표와 완료 조건을 정한 뒤 진행합니다. 자세한 참여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

## License

GEULION은 Apache License 2.0으로 배포됩니다. 자세한 내용은 [LICENSE](LICENSE)를 확인하세요.
