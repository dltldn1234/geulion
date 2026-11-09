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

`file://` 직접 열기는 ES module 및 저장소 정책 차이로 지원하지 않습니다. 앱 의존성이나 프레임워크는 필요하지 않습니다.

## 경계와 저장

`game.geul`은 초기 상태, 클릭 보상, 자동 생산, 업그레이드 비용/효과, 여섯 개 통계 값을 계산합니다. `app.js`는 v0.3 `createModule` ABI 호출, 화면 이벤트/표시, 브라우저 시계와 `localStorage` byte adapter를 맡습니다. 브라우저 API를 GEULION 코드에서 직접 사용하지 않습니다.

저장 envelope는 v0.3 규약(`geulion-save`, envelope 버전 1, 언어 버전 0.3, 앱 버전 1.0.0)을 사용합니다. 저장은 한 브라우저 프로필 안의 동기 `localStorage` 쓰기이며 장치 간 동기화, 브라우저 데이터 삭제 복구, 다중 탭 동시 쓰기 원자성은 제공하지 않습니다. 쓰기 실패는 화면에 표시하고 현재 탭의 메모리 상태는 유지합니다. 손상되거나 호환되지 않는 저장은 자동 초기화하거나 덮어쓰지 않습니다.

게임 초기화는 확인 대화상자 뒤 명시적으로 현재 저장을 새 게임 상태로 바꿉니다. 기본 경제는 클릭당 별가루 1개, 제련기 첫 가격 10개, 구매 시 매초 생산 1개와 다음 제련기 가격 5개 증가입니다.
