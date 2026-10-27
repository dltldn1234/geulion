# GEULION 컴파일러 안내

GEULION 컴파일러는 [Language Specification v0.1](language/specification-v0.1.md)의 단일 프로그램을 검사하고 Node.js 호환 ES Module JavaScript를 생성합니다. 이 문서는 구현 구조와 사용법을 설명하며, 언어 규칙의 기준은 `docs/language`의 규범 문서입니다.

## 사용법

저장소 루트에서 의존성과 TypeScript 출력을 준비합니다.

```bash
pnpm install --frozen-lockfile
pnpm build
```

다음 내용을 `main.geul`로 저장합니다.

```geul
함수 더하기(가: 정수, 나: 정수) -> 정수 {
    반환 가 + 나
}

함수 시작() -> 없음 {
    출력(더하기(40, 2))
}
```

```bash
pnpm exec geulion tokens main.geul
pnpm exec geulion parse main.geul
pnpm exec geulion check main.geul
pnpm exec geulion emit-js main.geul > main.mjs
node --enable-source-maps main.mjs
```

마지막 명령의 표준 출력은 `42`와 줄바꿈입니다. `tokens`는 토큰을, `parse`는 AST JSON을 표시합니다. `check`는 성공 시 표준 출력 없이 종료 코드 0을 반환합니다. `emit-js`는 검사에 성공한 경우에만 JavaScript를 표준 출력으로 내보냅니다. 진단은 표준 오류로 전달하며 실패 시 0이 아닌 종료 코드를 반환합니다. `--help`, `--version`은 기존대로 사용할 수 있습니다.

생성된 `.mjs`에는 runtime helper가 포함되며 Node.js 기본 모듈만 사용합니다. 실행 시 GEULION 패키지 설치가 필요하지 않습니다. 진입 함수는 생성 코드에서 정확히 한 번 호출합니다.

## 패키지와 파이프라인

```text
UTF-8 bytes
  → @geulion/lexer
  → @geulion/parser → @geulion/ast
  → @geulion/semantic: 이름 해석 → 타입·제어 흐름 검사
  → TypedProgram
  → @geulion/codegen-js: JavaScript + inline Source Map
```

`@geulion/compiler`가 단계를 연결하고 `@geulion/cli`가 파일 입출력과 명령을 제공합니다. 어휘 오류는 파싱을, 구문 오류는 의미 분석을 중단합니다. 의미·타입 오류가 있으면 typed 성공 결과와 JavaScript를 반환하지 않습니다. 예상하지 못한 내부 실패는 사용자 소스 오류와 구별해 `GE9001`로 전달합니다.

## 이름 해석과 타입 정보

이름 해석은 세 prelude 함수와 모든 사용자 함수의 시그니처를 먼저 수집합니다. 함수와 지역 값에는 Symbol ID, lexical scope에는 Scope ID를 부여합니다. `ResolvedProgram`의 `references`는 선언·사용 위치의 식별자를 해당 Symbol ID에 연결합니다. 중첩 block의 동명 변수도 서로 다른 ID를 가지며, 초기화 식은 새 binding 등록 전에 해석합니다. 함수 본문은 매개변수 scope를 공유합니다.

타입 검사는 AST를 변경하지 않고 `TypedProgram`의 side table에 결과를 기록합니다.

| 정보                                              | 저장 위치               |
| ------------------------------------------------- | ----------------------- |
| 함수 시그니처, 선언 위치, 종류, mutability, scope | Symbol 및 scope table   |
| 식별자와 binding의 연결                           | `references`            |
| 각 표현식의 확정 타입                             | `expressionTypes`       |
| 매개변수·지역 binding의 타입                      | `symbolTypes`           |
| 정수 최솟값의 특별한 직접 단항 음수               | `signedMinimumLiterals` |
| 검증한 진입 함수                                  | `entrypoint`            |

타입은 기본 타입 또는 불변 `목록[T]`·`사전[T]`·`선택[T]`로 표현합니다. 오류 타입은 파생 진단을 억제하는 내부 상태입니다. 기대 타입은 주석, 함수 인자·반환 및 컬렉션 원소 문맥에서 전달합니다. 주석 없는 동종 컬렉션은 확정 가능한 형제 원소의 타입을 사용해 빈 원소를 검사하므로 `[[], [1]]`처럼 순서에 의존하지 않는 추론을 제공합니다. 모든 원소가 문맥을 요구하면 타입을 추론하지 못합니다. 이 동작을 일반 연산자 피연산자 사이의 타입 추론이나 숫자 승격으로 확대하지 않습니다.

Code Generator는 이 메타데이터를 소비하며 이름을 다시 찾거나 타입을 다시 추론하지 않습니다. 내부 JavaScript 이름은 Symbol ID에서 생성해 사용자 이름과 runtime helper가 충돌하지 않게 합니다. 표현식은 명시적인 괄호와 helper 호출로 생성하고, 단락 연산의 오른쪽은 필요할 때만 평가합니다.

## 생성 코드와 runtime

runtime은 생성 프로그램 안에 포함되는 helper 함수입니다. 독립 VM이나 별도 실행 엔진이 아닙니다.

| 언어 기능     | JavaScript 구현                                                                 |
| ------------- | ------------------------------------------------------------------------------- |
| `정수`        | BigInt와 signed 64-bit 범위 검사. 산술 overflow와 0 제수를 명세 코드로 진단     |
| `실수`        | binary64 `number`. NaN, 무한대, signed zero, IEEE 비교 보존                     |
| `없음`·선택값 | 서로 구별되는 Unit·빈 선택·일부 값의 tag                                        |
| 목록·사전     | 외부 변경을 노출하지 않는 불변 tag/값 구조                                      |
| 동등 비교     | 컬렉션·선택값을 재귀 비교. 사전 삽입 순서를 무시하고 NaN 비교 규칙 보존         |
| 인덱싱        | 목록 범위 초과·음수·누락 사전 키에 빈 선택값 반환                               |
| `출력`        | 모든 v0.1 타입의 canonical 문자열과 LF 기록. 사전 키는 Unicode scalar 순서 정렬 |
| `정수로`      | 유한 실수의 범위를 확인한 뒤 0 방향으로 절삭                                    |
| `실수로`      | 정수를 binary64 최근접 값으로 명시 변환                                         |

인자·원소·사전 값·일반 이항식은 소스 순서대로 평가합니다. `그리고`, `또는`, `??`는 오른쪽의 부작용과 runtime 실패도 생략할 수 있는 단락 평가를 유지합니다. 이 동작은 생성 코드를 별도 Node.js 프로세스에서 실행하는 테스트로 검증합니다.

## 진단과 원본 위치

구조화된 진단은 코드, 단계, 한국어 설명·도움말, 경로, 원본 SourceSpan과 관련 선언 위치를 보존합니다. 위치에는 UTF-8 byte, 코드 포인트, UTF-16 offset 및 1 기반 UTF-16 줄·열이 포함됩니다.

| 단계                | 코드                                  |
| ------------------- | ------------------------------------- |
| Lex / Parse         | `GE0001`–`GE0003` / `GE1001`–`GE1002` |
| 이름·진입점 검사    | `GE2001`–`GE2003`                     |
| 타입·제어 흐름 검사 | `GE3001`–`GE3008`                     |
| Runtime             | `GE4001`–`GE4004`                     |
| 내부 실패           | `GE9001`                              |

Parser는 첫 오류에서 중단합니다. 이름 해석과 타입 검사의 독립 오류는 원본 시작 위치 순서로 정렬해 최대 100개를 제공합니다. 한도에 도달하면 코드 없는 추가 오류 억제 안내를 표시합니다. runtime은 첫 실패에서 프로그램을 중단하며, 정수 overflow·0 제수·변환 실패·표준 출력 실패는 실제 원인이 발생한 식의 span을 가리킵니다.

생성 코드의 Source Map은 inline 형식이며 선언·문장 단위의 생성 줄을 원본 시작 위치에 연결합니다. 모든 하위 표현식에 개별 Source Map segment를 생성하지는 않습니다. runtime 진단은 이 매핑과 별도로 원본 표현식 전체의 정확한 SourceSpan을 helper에 전달하므로 실패 위치를 보존합니다. Source Map 매핑은 Node.js `SourceMap` API로 검증합니다.

## 공용 API

```typescript
import { readFileSync } from "node:fs";
import { checkSource, compileSource } from "@geulion/compiler";

const input = { path: "main.geul", source: readFileSync("main.geul") };
const checked = checkSource(input); // 성공하면 program: TypedProgram
const compiled = compileSource({ ...input, target: "node" });

if (compiled.success) {
  process.stdout.write(compiled.code);
} else {
  console.error(compiled.diagnostics);
}
```

`compileSource` 성공 결과는 `code`, `sourceMap`, `mappings`를 포함합니다. 실패 결과는 `diagnostics`와 `suppressedCount`를 제공하며 생성 코드를 포함하지 않습니다. 하위 도구는 기존 `tokenizeSource`·`parseSource`, `resolveProgram`·`analyzeProgram`, `generateJavaScript`를 직접 사용할 수도 있습니다.

## 검증과 후속 범위

저장소 검사는 다음 명령으로 실행합니다.

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

테스트는 이름 해석·타입·프런트엔드 회귀, 공식 예제의 단계별 오류 코드, 실제 생성 JavaScript의 출력·종료 상태, runtime 원본 위치와 Source Map을 검증합니다. 표준 출력 실패는 주입한 host와 실제 쓰기 불가능한 stdout descriptor로 확인합니다. 특정 실행의 CI 성공 여부는 GitHub Actions 실행 결과에서 별도로 확인해야 합니다.

`geulion run`·`geulion build`, 다중 파일 모듈, 패키지 관리자, 사용자 정의 클래스·고급 제네릭, 비동기·동시성, Web Playground·VSCode Extension, LLVM·WebAssembly 백엔드는 현재 구현 범위 밖입니다. 다음 Phase에서는 기존 `checkSource`·`compileSource` 위에 실행 파일 관리와 CLI 실행·빌드 workflow를 추가할 수 있습니다.
