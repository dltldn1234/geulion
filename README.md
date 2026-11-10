# GEULION (글리온)

GEULION은 한국어를 우선으로 설계하는 범용 프로그래밍 언어 프로젝트입니다.

## 개발 목표

- 한국어 사용자가 자연스럽게 읽고 작성할 수 있는 언어를 설계합니다.
- 범용 목적에 맞는 명확하고 일관된 문법을 지향합니다.
- 언어의 규칙과 도구를 단계적으로 정의하고 구현합니다.

## 현재 상태

GEULION v0.1–v0.4 프로그램을 정적 검사하고 JavaScript로 컴파일합니다. v0.4는 명시적 별칭을 사용하는 다중 파일 모듈을 지원합니다. UTF-8·Unicode Lexer, Parser, 이름 해석, 타입·제어 흐름 검사와 JavaScript 백엔드를 제공합니다. 생성 코드에는 signed 64-bit 정수, 불변 컬렉션, 선택값과 한국어 실행 오류를 처리하는 최소 runtime이 포함됩니다.

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

직접 실행하거나 독립 실행 파일을 만들려면 다음 명령을 사용합니다.

```bash
pnpm exec geulion run main.geul
pnpm exec geulion build main.geul
pnpm exec geulion build main.geul --out-dir dist
node dist/main.mjs
```

`check`는 정적 검사만 수행하고, `emit-js`는 JavaScript를 표준 출력으로 내보냅니다. `run`은 생성한 JavaScript를 현재 Node.js 실행 파일로 실행하며 프로그램의 stdout, stderr, 종료 코드를 전달합니다. `build`는 compiler runtime helper가 포함된 독립 `.mjs` 파일을 `dist/`에 생성합니다. 컴파일 진단과 CLI 오류는 표준 오류로 출력합니다. `--help`, `--version`, `tokens`, `parse`도 지원합니다.

v0.3의 공개 함수를 브라우저 모듈로 만들려면 `emit-js` 또는 `build`에 `--target browser --language-version 0.3`을 지정합니다. 생성된 모듈은 `createModule(host)` 호출 전후에 `시작`을 자동 실행하지 않으며, 외부 호출은 tagged-value ABI를 따릅니다. 상세 규칙은 [브라우저 모듈 규격](docs/language/specification-v0.3-host-api.md)을 참고하세요.

v0.4 프로젝트는 진입 `.geul` 파일에서 시작합니다. import 경로는 프로젝트 root 안의 상대 `.geul` 파일을 가리켜야 합니다. 기본 root는 진입 파일이 있는 디렉터리이며, 상위 폴더까지 프로젝트에 포함하려면 `--root`를 지정합니다.

```bash
pnpm exec geulion check src/main.geul --language-version 0.4 --root .
pnpm exec geulion run src/main.geul --language-version 0.4 --root .
pnpm exec geulion build src/main.geul --language-version 0.4 --root . --out-dir dist
```

프로젝트 import는 심볼릭 링크를 따라가지 않으며, import된 함수는 `공개 함수`로 선언해야 합니다. 자세한 문법과 root 규칙은 [모듈 시스템 제안서](docs/language/module-system-proposal.md)를 참고하세요.

개발 작업은 GitHub Issue에서 목표와 완료 조건을 정한 뒤 진행합니다. 자세한 참여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

## License

GEULION은 Apache License 2.0으로 배포됩니다. 자세한 내용은 [LICENSE](LICENSE)를 확인하세요.
