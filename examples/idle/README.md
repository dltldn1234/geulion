# GEULION Idle

GEULION v0.3 browser module을 실제로 호출하는 한국어 방치형 게임 예제입니다.

## 실행

저장소 루트에서 먼저 브라우저 모듈을 빌드합니다.

```sh
pnpm exec geulion build examples/idle/game.geul --target browser --language-version 0.3 --out-dir examples/idle/generated
```

그 다음 `examples/idle` 디렉터리를 정적 HTTP 서버로 제공하고 브라우저에서 엽니다. 예를 들어 Python이 설치된 환경에서는 다음과 같습니다.

```sh
cd examples/idle
python3 -m http.server 8000
```

`file://` 직접 열기는 ES module 및 저장소 정책 차이로 지원하지 않습니다. 앱 의존성이나 프레임워크는 필요하지 않습니다. 글꼴은 시스템 sans-serif/monospace 폴백을 사용합니다.

## 경계와 저장

`game.geul`은 초기 상태, 클릭 보상, 자동 생산, 업그레이드 비용/효과, 여섯 개 통계 값을 계산합니다. `app.js`와 `clock.js`는 v0.3 `createModule` ABI 호출, 화면 이벤트/표시, 브라우저 시계와 `localStorage` byte adapter를 맡습니다. 초보다 짧은 프레임 경과를 누적해 자동 생산에서 버리지 않습니다. 브라우저 API를 GEULION 코드에서 직접 사용하지 않습니다.

저장 envelope는 v0.3 규약(`geulion-save`, envelope 버전 1, 언어 버전 0.3, 앱 버전 1.1.0)을 사용합니다. 게임 상태와 마지막 정상 저장 시각을 함께 보관합니다. v1.0.0 저장은 게임 상태를 검증한 뒤 한 번 v1.1.0으로 이전합니다. 이전 데이터를 읽거나 새 저장을 쓰지 못하면 원본을 덮어쓰지 않습니다. 저장은 한 브라우저 프로필 안의 동기 `localStorage` 쓰기이며 장치 간 동기화, 브라우저 데이터 삭제 복구, 다중 탭 동시 쓰기 원자성은 제공하지 않습니다. 손상되거나 호환되지 않는 저장은 자동 초기화하거나 덮어쓰지 않습니다.

브라우저를 닫았거나 탭이 숨겨진 동안의 생산은 다시 열거나 돌아올 때 GEULION 게임 함수로 계산하며 최대 8시간까지만 반영합니다. 시계가 저장 시각보다 이전이거나 유효하지 않으면 오프라인 생산을 주지 않고 화면에 알립니다. 획득량과 계산한 경과 시간을 화면에 표시합니다.

게임 초기화는 확인 대화상자 뒤 명시적으로 현재 저장을 새 게임 상태로 바꿉니다. 기본 경제는 클릭당 별가루 1개, 제련기 첫 가격 10개, 구매 시 매초 생산 1개와 다음 제련기 가격 5개 증가입니다.
