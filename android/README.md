# 눈숨 PC 연결 테스트 APK

`com.antisdream.nunsum` / **눈숨 테스트** / `versionCode 20` / `0.020-test`

이 앱은 PC에서 실행 중인 눈숨을 휴대전화의 네이티브 WebView로 여는 테스트용 앱이다. APK에 웹 서버나 멀티플레이 서버가 포함되지는 않는다. 앱의 시작 주소는 `http://localhost:3100/`이며, USB `adb reverse`로 PC의 웹 포트 3100과 게임 포트 2568에 연결한다. USB 연결이 끊기거나 PC 서버가 꺼지면 게임에 연결할 수 없다.

## 빌드

Android SDK 36, Build Tools 36.0.0, JDK 17을 사용한다. Gradle 9.5.0 wrapper 기반이며 Android Gradle Plugin은 9.3.0이다. `minSdk 26`, `targetSdk 36`으로 설정했다. Java Activity와 기본 WebView만 사용하고 AndroidX·Compose 의존성은 추가하지 않았다.

Windows에서는 다음처럼 현재 PowerShell 프로세스의 도구 경로를 지정한다. JDK 예제 경로를 설치된 JDK 17의 실제 위치로 바꾸고, 아래 명령은 `android` 폴더에서 실행한다.

```powershell
$env:JAVA_HOME = 'C:\path\to\jdk-17'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
.\gradlew.bat --no-daemon --console=plain :app:assembleDebug :app:lintDebug
```

생성 APK는 `app/build/outputs/apk/debug/app-debug.apk`, lint 결과는 `app/build/reports/lint-results-debug.html`이다. 최초 빌드에서는 선언된 Google/Maven Central 저장소의 빌드 의존성을 내려받을 수 있어야 한다. 의존성이 모두 캐시에 준비된 뒤에는 `--offline`을 추가할 수 있다. 제한된 실행 환경에서 `native-platform.dll` 초기화 오류가 나면 도구 설치 실패로 단정하지 말고 빌드 프로세스의 캐시·네이티브 라이브러리 접근 권한을 확인한다.

Debug APK는 Android 기본 개발용 서명으로 빌드된다. 개발·서명 키와 `local.properties`, Gradle 캐시, APK, 빌드 결과물은 Git에서 제외한다. 스토어 출시용 서명과 배포 설정은 포함하지 않는다.

## 지정 기기에 설치

PC에서 별도 PowerShell 터미널 두 개를 열고, 둘 다 저장소 루트 `hide_and_seek`에서 시작한다. 첫 번째 터미널은 웹 서버를 실행한다.

```powershell
$env:NEXT_PUBLIC_GAME_SERVER_URL = 'http://localhost:2568'
npm run dev -- --hostname 127.0.0.1 --port 3100
```

두 번째 터미널은 게임 서버를 실행한다.

```powershell
$env:GAME_PORT = '2568'
$env:GAME_HOST = '127.0.0.1'
npm run dev:server
```

USB reverse는 PC의 IPv4 loopback에 연결하므로 웹 서버를 `127.0.0.1`에 연다. `localhost`가 IPv6 `::1`로만 열리면 PC에서는 보여도 APK는 연결하지 못할 수 있다. vinext의 바인딩 옵션 이름은 `--hostname`이다.

웹 서버 `localhost:3100`과 게임 서버 `localhost:2568`이 실행되면 USB 디버깅을 허용한다. `adb devices -l`로 대상 기기의 serial을 확인하고, `android` 폴더에서 명시적으로 전달한다.

```powershell
.\install-on-device.ps1 -Serial 'YOUR_DEVICE_SERIAL'
```

스크립트는 APK의 패키지 이름과 지정 기기를 확인한 다음 해당 기기에만 두 포트를 reverse하고 `adb install -r`로 설치한 뒤 `com.antisdream.nunsum/.MainActivity`를 연다. 다른 기기·패키지·서버 프로세스는 조작하지 않는다. 기존 앱과 서명 키가 다르면 설치가 실패하며, 스크립트가 기존 앱을 삭제하지는 않는다.

## 앱 동작과 확인 범위

- `sensorLandscape`로 일반 회전잠금과 관계없이 좌·우 가로 화면을 사용한다. `appCategory="game"`을 선언해 Android 16의 대화면 방향 제한 해제 정책에서 게임 예외에 해당한다. 분할 화면·제조사 호환 모드까지 모든 창 배치를 보장하는 설정은 아니다.
- 이동은 원형 아날로그 조이스틱으로 조작한다. 방향과 밀어낸 거리를 사용하며, 중앙 손떨림은 무시하고 손을 떼거나 고정·연결 종료·화면 크기 변경이 발생하면 이동을 초기화한다. 기존 WASD·방향키·숫자 단축키는 PC에서 계속 사용한다.

- WebView 안에서는 `http://localhost:3100`과 `http://127.0.0.1:3100` 페이지만 열린다. 사용자가 누른 외부 HTTPS 링크는 브라우저로 전달한다.
- 평문 HTTP/WS는 `localhost`와 `127.0.0.1`에만 허용한다. JavaScript·DOM storage를 켜고 파일·콘텐츠 접근, 혼합 콘텐츠, JavaScript 인터페이스는 허용하지 않는다.
- Android 16의 edge-to-edge 정책에 맞춰 root에 실제 상태 표시줄·내비게이션·화면 cutout·키보드 여백을 적용한다. 회전·폴딩 시 WebView를 유지하고 남은 영역으로 다시 배치하도록 구성했다.
- Android 13 이상은 `OnBackInvokedDispatcher`, 이전 버전은 `onBackPressed`로 웹 기록을 돌아간다. 돌아갈 기록이 없으면 앱을 닫는다.
- 메인 페이지 연결 실패 시 네이티브 재시도 화면을 표시한다. 자동 재시도 타이머나 페이지에 주입하는 보정 코드는 없다.
- 빌드·lint 성공과 실제 기기 플레이 검증은 아래처럼 구분한다.

런처 아이콘은 제공된 1254×1254 모루 이미지 원본을 그대로 사용하고 adaptive·round·legacy 아이콘을 함께 선언했다. Adaptive foreground는 XML에서 각 방향에 5% 여백을 두어 원본을 90% 크기로 표시하고, 마스크가 달라져도 모자·귀가 안전 영역에 들어가도록 했다. Legacy bitmap은 원본 비율을 유지한다. Wrapper 기반 파일은 같은 작업공간의 `CueFlowSubscription`에서 복사했으며 다른 앱 소스나 서명 자료는 가져오지 않았다. Windows wrapper 복사본은 Java 실행 실패 코드를 호출자에게 전달하도록 보완했다.

구현 참고: [Android WebView](https://developer.android.com/develop/ui/views/layout/webapps/webview), [WindowInsets](https://developer.android.com/reference/android/view/WindowInsets), [OnBackInvokedDispatcher](https://developer.android.com/reference/android/window/OnBackInvokedDispatcher), [Network security configuration](https://developer.android.com/privacy-and-security/security-config).

## 실제 확인한 범위

2026-09-08의 `0.020-test` APK를 Galaxy Z Flip4(SM-F721N, Android 16/API 36)에 업데이트 설치해 PC 서버와 USB 연결로 확인했다. APK의 `versionCode=20`, `screenOrientation=6(sensorLandscape)`, `appCategory=0(game)`도 확인했다.

| 구분 | 확인 결과 |
|---|---|
| 빌드 | `assembleDebug`·`lintDebug` 성공. lint 오류 0·경고 9, 서명·정렬 검사 통과 |
| 입장 | 가로 랜딩과 별명·난이도·시작 버튼이 함께 보이는 2열 입장 화면, AI 게임 입장 |
| 숨는 팀 조작 | 원형 조이스틱의 대각선 이동, 원 밖에서 손을 떼었을 때 중앙 복귀와 정지, 위치 고정 |
| 동시 터치 | 첫 손가락으로 조이스틱을 유지한 채 두 번째 손가락으로 자리바꿈 실행. 버튼의 `사용 완료` 상태·자리바꿈 효과·계속 밀린 조이스틱을 함께 확인하고, 첫 손가락 해제 후 중앙 복귀·정지 확인 |
| 가로 고정 | 최소 너비 `sw360dp` 기기에서 일반 회전잠금을 켠 채 가로 `w880dp/h360dp`로 실행. 세로 회전값 `lock 0` 요청 후에도 가로 유지 |
| 기존 버전 확인 범위 | `0.019-test`에서 별명 키보드·뒤로가기·연결 재시도와 자리바꿈·도발 실행 확인. 이번 버전의 모든 실패 상황을 재검증했다는 뜻은 아님 |

술래 렌즈의 기존 실제 실행과 모바일 배치는 웹 브라우저에서 확인했다. 이번 동시 터치는 Android 입력 이벤트로 실제 WebView 화면에 보내 자리바꿈까지 확인했으며, 장시간 손으로 플레이한 사용성 평가와 구분한다. 실기기 폴딩·커버 화면, 여러 스킬의 모든 동시 입력 조합, 진행 중 앱 전환 후 복귀, USB 재연결, 여러 기기·외부망·장시간 플레이는 추가 검증이 필요하다.

현재 lint 경고 9개는 SDK·Gradle 새 버전 권고, 하위 API에서 무시되는 속성, annotation·리소스 구성 권고, monochrome 아이콘 미제공과 고정 방향 사용 권고다. 가로 고정은 요청한 게임 동작이며 [Android 공식 게임 예외](https://developer.android.com/develop/adaptive-apps/guides/app-orientation-aspect-ratio-resizability#exceptions)를 적용했다. 앱은 개발용 debug APK이며, 스토어 배포 검증은 포함하지 않는다.
