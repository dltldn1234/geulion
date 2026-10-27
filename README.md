# GEULION (글리온)

GEULION은 한국어를 우선으로 설계하는 범용 프로그래밍 언어 프로젝트입니다.

## 개발 목표

- 한국어 사용자가 자연스럽게 읽고 작성할 수 있는 언어를 설계합니다.
- 범용 목적에 맞는 명확하고 일관된 문법을 지향합니다.
- 언어의 규칙과 도구를 단계적으로 정의하고 구현합니다.

## 현재 상태

Language Specification v0.1의 단일 `.geul` 프로그램을 정적 검사하고 Node.js에서 실행할 수 있는 JavaScript로 컴파일합니다. UTF-8·Unicode Lexer, Parser, 이름 해석, 타입·제어 흐름 검사와 JavaScript 백엔드를 제공합니다. 생성 코드에는 signed 64-bit 정수, 불변 컬렉션, 선택값과 한국어 실행 오류를 처리하는 최소 runtime이 포함됩니다.

언어 규칙은 [공식 명세](docs/language/README.md), 컴파일러 구조와 API는 [컴파일러 안내](docs/compiler.md)를 참고하세요.

## 사용하기

저장소의 `package.json`에 지정된 Node.js·pnpm 버전 조건을 충족한 환경에서 실행합니다.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm exec geulion check main.geul
pnpm exec geulion emit-js main.geul > main.mjs
node main.mjs
```

`check`는 정적 검사만 수행하고, `emit-js`는 JavaScript를 표준 출력으로 내보냅니다. 진단은 표준 오류로 출력합니다. `--help`, `--version`, `tokens`, `parse`도 지원합니다. `geulion run`과 `geulion build` 명령은 후속 Phase의 개발 범위입니다.

개발 작업은 GitHub Issue에서 목표와 완료 조건을 정한 뒤 진행합니다. 자세한 참여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

## License

GEULION은 Apache License 2.0으로 배포됩니다. 자세한 내용은 [LICENSE](LICENSE)를 확인하세요.
