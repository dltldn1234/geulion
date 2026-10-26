# Contributing to GEULION

GEULION의 모든 개발 작업은 작은 단위로 나누고, 작업 목적과 완료 조건을 먼저 합의합니다.

## Issue Convention

- 개발을 시작하기 전에 GitHub Issue를 생성합니다. 저장소 초기화와 같이 프로젝트를 처음 만드는 작업은 예외입니다.
- Issue에는 제목, 목적, 작업 내용, 완료 조건을 작성합니다.
- Issue 번호를 Branch와 PR에 연결합니다.

## Branch Convention

Branch 이름은 다음 형식을 사용합니다.

```text
(이슈번호)-(작업유형)/(작업명)
```

예시:

```text
1-feat/lexer
```

작업유형은 `feat`, `fix`, `docs`, `refactor`, `chore` 등으로 작성합니다.

## Commit Convention

Commit 메시지는 다음 형식을 사용합니다.

```text
(gitmoji) (작업유형): (작업 내용)
```

예시:

```text
🎉 chore: initialize GEULION repository
```

- 작업 단위별로 목적이 분명한 Atomic Commit을 작성합니다.
- 무의미하거나 서로 다른 작업을 섞은 Commit은 만들지 않습니다.

## Pull Request Convention

- PR은 관련 Issue를 필수로 연결합니다.
- 변경 내용과 테스트 또는 검증 결과를 작성합니다. 실행하지 않은 검증은 통과한 것처럼 쓰지 않습니다.
- 기본 병합 방식은 Merge Commit입니다.
- 향후 CI를 도입하면 CI 통과를 병합 조건으로 적용합니다.
