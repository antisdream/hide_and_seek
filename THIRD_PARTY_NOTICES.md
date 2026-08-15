# 제3자 소프트웨어 고지

> 확인 기준일: 2026-08-15<br>
> 이 문서는 직접 의존성의 대표 라이선스를 빠르게 검토하기 위한 안내입니다. 배포 전 `package-lock.json` 전체 전이 의존성을 자동 수집해 다시 확인해야 합니다.

## 실행 의존성

| 패키지 | 사용 목적 | 확인한 패키지 라이선스 |
|---|---|---|
| React, React DOM | 웹 UI | MIT |
| Phaser | 2D Canvas 게임 렌더링 | MIT |
| Colyseus Core, SDK, WebSocket Transport | 방·매칭·실시간 통신 | MIT |
| Express | 상태 확인과 매칭 HTTP 계층 | MIT |
| Zod | 수신 메시지 검증 | MIT |

## 개발·빌드 의존성

vinext, Vite, TypeScript, ESLint, Tailwind CSS, tsx, Cloudflare 개발 도구와 OpenAI Sites 빌드 플러그인을 사용합니다. 각 패키지의 배포본에 포함된 `package.json`과 라이선스 파일이 최종 기준입니다.

## 벤치마크 저장소

다음 저장소는 구조적 연구에만 사용했으며 코드나 에셋을 포함하지 않습니다.

- [franco-ortega/hide-and-seek](https://github.com/franco-ortega/hide-and-seek)
- [MIMUW-RL/unity-ml-agents_hide-and-seek](https://github.com/MIMUW-RL/unity-ml-agents_hide-and-seek)
- [DournauxNathan/Hide-n-Seek](https://github.com/DournauxNathan/Hide-n-Seek)

조사 당시 세 저장소 모두 명시적인 저장소 라이선스를 확인하지 못했습니다. 따라서 저장소의 파일을 재사용할 권한이 있다고 해석하지 않습니다.

## 생성 이미지

`public/og.png`는 이 프로젝트의 독자 캐릭터 설명으로 새로 생성한 래스터 이미지입니다. 외부 게임 로고, 캐릭터, 맵, 무기 이미지를 입력 자산으로 사용하지 않았습니다. 상용 공개 전 사용 중인 생성 서비스 약관과 브랜드·상표 검토를 다시 수행합니다.
