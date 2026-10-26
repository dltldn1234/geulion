# GEULION Language Specification v0.1

**상태: Specified** — 이 문서는 v0.1 언어 규칙의 규범적 진입점입니다. 구현 상태는 아닙니다.

## 적합성 범위

v0.1 적합성 대상은 유효한 UTF-8 단일 `.geul` 프로그램입니다. 소스는 정확히 하나의 `함수 시작() -> 없음`을 정의해야 합니다. 프로그램은 그 진입 함수에서 시작하며 모듈 import, 전역 실행문, 라이브러리 전용 모드는 포함하지 않습니다. 함수, 변수, 상수, 기본·컬렉션·선택 타입, 표현식, 조건문, `동안` 반복문 및 기본 진단 규칙은 각각 지정된 세부 문서의 규범을 따릅니다.

## 규범 문서와 우선순위

| 주제                                       | 규범 문서                                    |
| ------------------------------------------ | -------------------------------------------- |
| 설계 원칙, 범위, 결정 이력                 | [design-decisions.md](design-decisions.md)   |
| UTF-8, Unicode, 토큰, 줄바꿈, 주석, 리터럴 | [lexical-structure.md](lexical-structure.md) |
| 구문과 우선순위                            | [grammar.ebnf](grammar.ebnf)                 |
| 타입, 추론, 연산 허용 규칙                 | [type-system.md](type-system.md)             |
| 이름, 평가, 제어 흐름과 출력               | [semantics.md](semantics.md)                 |
| 진단 구조, 코드와 중단 규칙                | [diagnostics.md](diagnostics.md)             |
| 추적 가능한 예제                           | [examples.md](examples.md)                   |

각 세부 문서는 자신이 열거한 주제의 세부 규범을 정하고, 이 통합 문서는 범위와 문서 간 적용 순서를 정합니다. 문서가 실제 구현보다 우선합니다. 규범 문서끼리 충돌하면 구현자가 추측해서는 안 되며 명세 변경으로 충돌을 해결한 뒤 새 버전을 기록해야 합니다. 예제 문서는 규칙의 근거가 아닌 적합성 사례입니다.

## Lexer/Parser 구현 계약

아래는 다음 구현 단계의 입력·출력 경계입니다. 이는 public TypeScript API의 이름이나 구현을 강제하지 않으며, 언어 의미를 바꾸지 않는 한 내부 자료구조는 달라도 됩니다.

### 공통 원본 위치

각 토큰과 source 진단은 반열린 `[start, end)` span을 가져야 합니다. 각 끝점은 원본 UTF-8 바이트 offset, Unicode scalar/code point offset, UTF-16 code unit offset, 1 기반 line/column을 함께 표현합니다. offset은 각 단위에서 0 기반이며, line/column은 `lexical-structure.md`의 BOM, CRLF, UTF-16 규칙을 따릅니다. 토큰의 raw lexeme은 원본 철자를 보존합니다.

### Lexer 경계

- 입력: 파일 경로와 바이트 단위 UTF-8 source.
- 성공 결과: 원본 순서의 token 배열과 마지막 EOF token. 각 token은 `kind`, `rawLexeme`, `span`을 제공하고, 식별자는 추가로 NFC 정규화된 이름을 제공합니다. 문자열 token은 escape 해석을 마친 scalar 값, 숫자 token은 반올림 전 raw 숫자 철자를 제공해야 합니다.
- keyword는 별도 token kind를 사용합니다. prelude 함수명은 예약 keyword가 아니므로 identifier token입니다. 숫자 부호는 unary operator token으로 분리합니다. NEWLINE은 문법상 줄 구분자로 보존하되, 주석 내부 줄바꿈도 잃지 않습니다.
- 실패 결과: 정렬된 lex 진단. 하나 이상의 lex 오류가 있으면 parser를 실행하지 않습니다. `diagnostics.md`에 정의한 최대 수와 순서, GE0001–GE0003 의미를 따릅니다.

### Parser 경계

- 입력: lex 오류가 없는 token stream, EOF 포함.
- 성공 결과: `grammar.ebnf`를 따른 구문 트리 및 각 구문 노드의 원본 span. AST는 향후 `@geulion/ast`에 정의될 수 있지만, 이 문서는 AST 클래스/노드 이름을 지정하지 않습니다.
- 실패 결과: 첫 구문 진단 하나와 가능하면 문제 token의 span 및 기대 token 설명. GE1001/GE1002 규칙을 따릅니다. 의미 분석을 시도하지 않습니다.
- parser는 함수/선언/문장/표현식 구조만 판별합니다. 이름 해석, 정확히 하나인 시작 함수, 타입, 반환 완전성, 중복 사전 키는 각각 의미/타입 단계의 책임입니다.

### 구현 순서와 오류 경계

다음 단계는 이 계약을 기준으로 lexer, 그 다음 parser를 구현할 수 있습니다. 유효성 검사는 Lex → Parse → Resolve/Type 순서로 수행합니다. 앞 단계에 오류가 있으면 다음 단계를 실행하지 않습니다. 이 계약과 이 문서의 어떤 항목도 lexer, parser, compiler, JavaScript 출력기가 이미 구현되었다는 뜻이 아닙니다.

## 버전 관리

이 문서 세트는 GEULION Language Specification **v0.1**입니다. v0.x에서 규범 동작을 바꾸면 변경 이력과 호환성 영향을 기록합니다. 안정된 오류 코드는 원인을 재사용하지 않습니다. 향후 백엔드는 이 명세의 관찰 가능한 의미를 보존해야 합니다.

### 상태 요약

- **Specified:** 어휘 구조, 문법, 타입 체계, 실행 의미론, 진단, 이 문서의 구현 경계.
- **Deferred:** 클래스/상속, 사용자 정의 제네릭, 패턴 매칭, 매크로, 동시성/비동기, 사용자 정의 연산자, 수동 메모리 관리, FFI, 모듈 시스템, 함수 오버로딩/기본 인자.
- **Proposed:** 이 v0.1 범위 안에서 남은 규범 제안 없음.
- **Implemented:** 이 명세 문서 작업에서는 해당되는 기능 없음. 구현과 검증이 이루어지기 전에는 이 상태를 표시하지 않습니다.
