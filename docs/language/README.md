# GEULION Language Specification

GEULION(글리온)은 한국어 사용자가 읽고 작성할 수 있는 정적 타입 범용 프로그래밍 언어를 목표로 합니다. 이 디렉터리는 구현보다 먼저 고정해야 하는 언어 규칙을 버전별로 정의합니다.

## 상태

Language Specification v0.1의 규칙은 **Specified**입니다. 명세 문서의 상태와 구현 상태는 별도로 관리합니다.

문서의 기능 상태는 다음 뜻으로 사용합니다.

| 상태            | 의미                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------- |
| **Specified**   | 해당 버전의 규범 규칙으로 정의되어 있습니다.                                             |
| **Proposed**    | 검토 중인 제안이며 구현자가 규칙으로 간주하면 안 됩니다.                                 |
| **Deferred**    | 현재 버전 범위에서 제외했으며 향후 결정합니다.                                           |
| **Implemented** | 코드에 구현되어 명시된 검증으로 동작을 확인했습니다. 문서만 존재하면 이 상태가 아닙니다. |

## 문서 구성

- `specification-v0.1.md` — 버전별 규범 명세, 문서 우선순위, Lexer/Parser 경계
- `design-decisions.md` — 설계 원칙과 결정 근거
- `lexical-structure.md` — 문자, 식별자, 리터럴, 주석, 토큰과 위치 규칙
- `grammar.ebnf` — 형식 문법과 표현식 우선순위
- `type-system.md` — 타입, 추론, 타입 검사 규칙
- `semantics.md` — 스코프, 평가 순서, 제어 흐름과 값 의미론
- `diagnostics.md` — 진단 데이터와 오류 코드
- `examples.md` — 적합/비적합 예제와 향후 적합성 검사 분류

각 문서는 같은 규칙을 중복 정의하지 않습니다. `specification-v0.1.md`가 규범 문서의 목차와 우선순위를 정하고, 세부 규칙은 해당 전문 문서에서 정의합니다. 모순이 발견되면 추측으로 구현하지 않고 명세 변경으로 해결합니다.

## 범위

v0.1은 단일 `.geul` 프로그램, 기본 자료형과 컬렉션, 변수/상수, 함수, 조건문, 반복문, 기본 스코프, 정적 타입 검사와 오류 진단을 우선합니다. JavaScript는 초기 출력 백엔드이며 언어 의미론의 기준이 아닙니다.

## 구현 상태

| 구성 요소                         | 상태            | 확인 범위                                                           |
| --------------------------------- | --------------- | ------------------------------------------------------------------- |
| Source 및 위치 정보               | **Implemented** | UTF-8 검증, BOM, LF/CRLF/CR, byte/code point/UTF-16 offset 테스트   |
| Lexer 및 AST                      | **Implemented** | Unicode 18.0.0 고정 데이터, 어휘 진단, 위치 및 단위 테스트          |
| Parser 및 프런트엔드 API          | **Implemented** | v0.1 문법 파싱, 구문 진단, 공식 예제 및 통합 테스트                 |
| `tokens` / `parse` CLI            | **Implemented** | 실제 `.geul` 파일, 오류 종료 코드와 출력 검증                       |
| 이름 해석, 타입·제어 흐름 검사    | **Implemented** | Symbol/Scope ID, 정적 타입·추론, 진입점·반환·진단 테스트            |
| JavaScript 백엔드 및 최소 runtime | **Implemented** | 실제 Node.js 프로세스에서 정수·실수·컬렉션·선택·출력·실행 오류 검증 |
| `check` / `emit-js` CLI           | **Implemented** | 정적 검사 및 JavaScript 출력, 오류 시 이후 단계 중단                |
| 정식 `run` / `build` CLI workflow | **Deferred**    | 다음 Phase의 실행 환경 및 개발자 경험 범위                          |

**Implemented**는 현재 코드와 저장소 검증이 확인된 범위만 뜻합니다. 생성된 JavaScript는 Node.js로 실행하며, GEULION CLI 자체의 실행·빌드 workflow는 별도입니다. 컴파일러 패키지 경계, 사용법 및 Source Map 지원 범위는 [컴파일러 안내](../compiler.md)에 기록합니다.
