# 눈치숨: 수상한 잡화점

![밤의 잡화점에서 문구류 정령을 찾는 밤지기 모루](public/og.png)

**눈치숨**은 음성 대화 없이 PC와 모바일 웹에서 즐기는 실시간 사물 숨바꼭질 게임입니다. 틈새정령은 연필·노트·테이프 같은 사물로 숨어 진열 미션을 수행하고, 밤지기 관찰자는 배치의 어색함과 움직임 흔적을 살펴 수상한 사물을 찾아냅니다.

## 주요 기능

- 4~10명 공개 빠른 매칭
- 초대 링크로 참여하는 친구방
- 이용자 1명과 서버 봇 3명이 함께하는 연습방
- 3라운드마다 바뀌는 `밤의 문구점`, `달빛 물류창고`, `별빛 포장공방`
- 기존보다 넓어진 맵, 다양한 구조물과 양방향 문·포탈 이동
- 숨는 이용자는 감춘 채 관찰자만 기준 사물 배치를 미리 탐색하는 기억 단계
- 사물 고정, 자리바꿈, 진열 미션과 관찰 렌즈
- 자유 채팅 없이 사용하는 역할별 무음 팀 핑
- 빨라진 키보드·터치 이동과 서버 좌표 화면 보간
- 10초 재접속 유예와 방장 이전

## 빠른 실행

### 준비물

- Node.js `22.13.0` 이상, 권장 `24.x`
- npm `10` 이상

```bash
git clone https://github.com/antisdream/hide_and_seek.git
cd hide_and_seek
npm ci
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
npm run dev:all
```

macOS 또는 Linux:

```bash
cp .env.example .env.local
npm run dev:all
```

브라우저에서 `http://localhost:3000`을 엽니다. 웹은 기본 `3000`, 게임 서버는 기본 `2567` 포트를 사용합니다.

두 프로세스를 별도로 실행할 수도 있습니다.

```bash
# 터미널 1: 웹
npm run dev

# 터미널 2: 게임 서버
npm run dev:server
```

## 게임 시작 방법

1. `/game`에서 별명을 입력합니다.
2. 혼자 확인하려면 `혼자 연습`을 선택합니다.
3. `준비 완료`를 누르면 봇이 합류하고 경기가 시작됩니다.
4. 친구와 플레이하려면 `친구 초대방`을 만든 뒤 표시되는 링크를 공유합니다.
5. 공개 이용자와 플레이하려면 `빠른 매칭`을 선택합니다.

### 라운드별 맵

| 라운드 | 맵 | 특징 |
|---:|---|---|
| 1 | 밤의 문구점 | 긴 진열대와 계산대·창고 연결 |
| 2 | 달빛 물류창고 | 상자 더미와 선반 사이의 넓은 통로 |
| 3 | 별빛 포장공방 | 작업대와 리본 통로가 나뉜 구조 |

각 맵의 문과 포탈에 들어가면 연결된 다른 구역으로 즉시 이동합니다. 관찰자는 숨기 25초 동안 숨는 이용자를 볼 수 없지만 맵, 구조물, 기본 사물과 포탈을 직접 돌아보며 기준 배치를 기억할 수 있습니다.

## 기본 규칙

| 역할 | 목표 | 주요 행동 |
|---|---|---|
| 틈새정령 | 수색 종료까지 한 명 이상 생존 | 이동, 사물 고정, 자리바꿈 1회, 진열 미션, 팀 핑 |
| 밤지기 관찰자 | 제한시간 안에 모든 틈새정령 발견 | 기준 맵 탐색, 포탈 이동, 사물 확인, 관찰 렌즈, 팀 핑 |
| 발견된 틈새정령 | 남은 팀 지원 | 무음 팀 핑 |

한 라운드는 기본적으로 카운트다운 5초, 숨기 25초, 수색 65초, 결과 12초로 진행합니다. 게임 수치의 기준은 [`shared/game-rules.ts`](shared/game-rules.ts)입니다.

## 기술 구성

- React 19 및 vinext 기반 웹 화면
- Phaser 기반 2D 게임 렌더링
- Colyseus 기반 실시간 멀티플레이
- 서버 권위 이동·충돌·시야·태그·점수 판정
- SQLite 경기 결과 저장
- TypeScript, ESLint, Node.js Test Runner

### 주요 경로

| 경로 | 역할 |
|---|---|
| `app/` | 랜딩, 게임 입장, 대기실과 HUD |
| `app/game/game-renderer.ts` | 맵, 캐릭터, 사물과 효과 렌더링 |
| `server/NunchisoomRoom.ts` | 방 생명주기와 게임 판정 |
| `server/index.ts` | 게임 서버와 상태 확인 API |
| `server/persistence.ts` | SQLite 결과 저장 |
| `shared/` | 웹과 서버가 공유하는 타입과 규칙 |
| `shared/map-generator.ts` | 3개 맵, 구조물·사물 배치와 포탈 연결 |
| `tests/` | 단위 및 멀티플레이 통합 테스트 |

## 환경 변수

필요한 값은 [`.env.example`](.env.example)을 복사해 설정합니다.

| 이름 | 기본값 | 설명 |
|---|---:|---|
| `NEXT_PUBLIC_GAME_SERVER_URL` | `http://127.0.0.1:2567` | 브라우저가 연결할 게임 서버 주소 |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | 웹 기준 주소 |
| `GAME_PORT` | `2567` | 게임 서버 포트 |
| `GAME_HOST` | `0.0.0.0` | 게임 서버 바인딩 주소 |
| `ALLOWED_ORIGINS` | 로컬 웹 주소 | 허용할 웹 Origin 목록 |
| `FAST_GAME` | `0` | `1`일 때 개발용 짧은 라운드 사용 |

비밀값, `.env.local`, 로컬 데이터베이스는 Git에 포함하지 않습니다.

## 검증

```bash
npm run verify
```

이 명령은 린트, 엄격한 TypeScript 검사, 단위 테스트, 실제 WebSocket 다중 클라이언트 통합 테스트와 프로덕션 웹 빌드를 순서대로 실행합니다.

개별 명령은 다음과 같습니다.

```bash
npm run lint
npm run build:server
npm run test:unit
npm run test:integration
npm run build
```

## Docker로 게임 서버 실행

```bash
docker compose up --build game-server
```

서버 상태는 `http://localhost:2567/health`에서 확인할 수 있습니다.

## 독립 창작과 라이선스

이 프로젝트는 숨바꼭질 장르의 일반적인 규칙과 실시간 멀티플레이 기술을 바탕으로 독립 구현했습니다. 다른 게임이나 참고 저장소의 코드, 캐릭터, 맵, UI, 문구와 에셋을 복제하지 않습니다.

`눈치숨`, `수상한 잡화점`, 밤지기 `모루`와 문구류 틈새정령은 이 프로젝트를 위해 만든 오리지널 설정입니다.

프로젝트 코드는 [MIT License](LICENSE)를 따릅니다. 외부 패키지 고지는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 확인하세요.
