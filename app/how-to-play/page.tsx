import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "게임 방법 | 눈치숨",
  description: "실제 게임 화면으로 배우는 틈새정령과 관찰자의 역할, 라운드 흐름과 무음 조작 방법",
};

const phases = [
  { number: "01", title: "역할 확인 10초", copy: "내가 틈새정령인지 관찰자인지 확인하고 화면에 나온 첫 행동 세 가지를 읽습니다." },
  { number: "02", title: "숨기·기억 35초", copy: "틈새정령은 사물로 숨고, 관찰자는 숨는 장면 없이 기준 맵과 포탈을 둘러봅니다." },
  { number: "03", title: "인원별 수색", copy: "4인은 125초이며 참가자가 한 명 늘 때마다 수색 시간이 15초 추가됩니다." },
  { number: "04", title: "결과 10초", copy: "승패와 20점 단위 생존 점수를 확인한 뒤 직전 관찰자를 제외하고 다음 역할을 나눕니다." },
];

const playerTimings = [
  [4, "3분", "9분"],
  [5, "3분 15초", "9분 45초"],
  [6, "3분 30초", "10분 30초"],
  [7, "3분 45초", "11분 15초"],
  [8, "4분", "12분"],
  [9, "4분 15초", "12분 45초"],
  [10, "4분 30초", "13분 30초"],
];

// 아래 이미지는 실제 로컬 멀티플레이에서 테스트용 별명으로 촬영한 화면이다.
const guideShots = [
  {
    image: "/how-to-play/01-entry.jpg",
    capturedAt: "2026-08-20",
    eyebrow: "게임 전",
    title: "별명과 플레이 방식을 선택합니다",
    copy: "회원가입 없이 별명만 정하면 됩니다. 무작위 이용자는 빠른 매칭, 친구는 초대방, 처음이라면 난이도를 고르는 AI 방이 편합니다.",
    notes: ["경기에서 부를 1~12자 별명", "빠른 매칭·친구방·AI 방 버튼 위치", "친구가 보낸 코드나 링크로 직접 참가", "처음 이용자를 위한 세 줄 핵심 안내"],
    markers: [[75, 48], [75, 67], [75, 94], [28, 79]],
    tip: "처음 한 판은 ‘쉬움’ AI 방을 권장합니다. 혼자 시작하면 AI 세 명이 참여하고, 친구가 들어오면 AI가 한 명씩 빠집니다.",
  },
  {
    image: "/how-to-play/02-lobby.jpg",
    capturedAt: "2026-08-20",
    eyebrow: "대기실",
    title: "모두 모이면 준비 완료를 누릅니다",
    copy: "왼쪽에서 참가자와 준비 상태를 확인합니다. 친구에게는 상단의 방 코드 복사 버튼으로 현재 접속 주소가 포함된 링크를 보낼 수 있습니다.",
    notes: ["현재 참가자와 준비 상태", "준비 완료 및 방장 시작", "이번 라운드 맵 미리보기", "초대 링크 복사와 나가기"],
    markers: [[9, 25], [9, 55], [50, 30], [88, 7]],
    tip: "공개방은 최소 4명, 최대 10명입니다. AI 방은 사람과 AI를 합쳐 네 자리를 유지하며 같은 초대 링크로 친구도 참여할 수 있습니다.",
  },
  {
    image: "/how-to-play/03-role-seeker.jpg",
    capturedAt: "2026-08-21",
    eyebrow: "역할 공개",
    title: "큰 역할표에서 내 목표부터 확인합니다",
    copy: "10초 동안 역할 이름, 승리 조건과 첫 행동을 보여줍니다. 다른 참가자의 역할과 위치는 이 화면에서 공개되지 않습니다.",
    notes: ["현재 라운드와 남은 준비 시간", "내 역할 이름과 역할 전용 색상", "곧 해야 할 첫 행동 세 가지", "오른쪽에 계속 남는 현재 역할·목표"],
    markers: [[50, 7], [50, 38], [50, 62], [87, 21]],
    tip: "관찰자는 틈새정령보다 약 46% 빠릅니다. 두 역할 모두 빨라졌으므로 직선 추격보다 포탈과 구조물을 함께 읽어야 합니다.",
  },
  {
    image: "/how-to-play/04-hider-hiding.jpg",
    capturedAt: "2026-08-20",
    eyebrow: "틈새정령",
    title: "사물 사이에서 자연스러운 자리를 만듭니다",
    copy: "WASD·방향키 또는 화면 이동키로 움직입니다. 자리를 정했으면 사물 고정으로 파문을 숨기고, 필요할 때 자리바꿈과 포탈로 빠져나갑니다.",
    notes: ["내 사물은 ‘나’ 표시로 구분", "처음 한 번 자동으로 열리는 숨기 안내", "사물 고정과 1회 자리바꿈", "표시된 구역에서 수행하는 시각 미션"],
    markers: [[38, 73], [64, 67], [87, 52], [87, 72]],
    tip: "벽에 어색하게 겹치거나 홀로 떨어진 자리는 눈에 띕니다. 같은 종류가 모인 진열대 옆에서 방향까지 맞추는 것이 좋습니다.",
  },
  {
    image: "/how-to-play/05-seeker-preview.jpg",
    capturedAt: "2026-08-21",
    eyebrow: "관찰자 준비",
    title: "숨는 장면이 아닌 기준 배치를 기억합니다",
    copy: "숨기 시간에 틈새정령은 보이지 않습니다. 마우스로 맵을 끌고 휠로 확대하거나 직접 이동해 구조물, 기본 사물과 포탈 도착점을 확인합니다.",
    notes: ["기준 맵 탐색 중이라는 안전 표시", "숨는 이용자가 제거된 기본 사물 배치", "입구와 도착지가 함께 적힌 양방향 포탈", "드래그·확대·이동키 안내"],
    markers: [[50, 8], [53, 39], [31, 70], [86, 50]],
    tip: "사물 하나하나를 외우기보다 ‘이 선반에는 테이프 두 개’, ‘이 통로는 비어 있음’처럼 묶음과 빈 공간을 기억하세요.",
  },
  {
    image: "/how-to-play/06-seeking.jpg",
    capturedAt: "2026-08-21",
    eyebrow: "관찰자 수색",
    title: "차이를 찾고 가까이에서 확인합니다",
    copy: "기준 배치와 달라 보이는 사물에 2.6칸 안까지 다가가 클릭합니다. 막힐 때는 관찰 렌즈와 팀 신호로 후보 구역을 좁힙니다.",
    notes: ["상단의 수색 남은 시간", "현재 위치와 포탈 연결 방향", "첫 수색을 돕는 단계별 말풍선", "마우스·키보드·터치로 여는 스킬 설명"],
    markers: [[53, 6], [31, 73], [64, 66], [88, 49]],
    tip: "오답은 집중력 25 감소와 3초 대기입니다. 집중력이 바닥나면 6.5초 동안 확인할 수 없으므로 연속 클릭보다 관찰이 중요합니다.",
  },
  {
    image: "/how-to-play/07-result.jpg",
    capturedAt: "2026-08-21",
    eyebrow: "라운드 결과",
    title: "승패와 주요 장면을 확인합니다",
    copy: "모든 틈새정령을 찾으면 관찰자 승리, 한 명이라도 시간 끝까지 살아남으면 틈새정령 승리입니다. 각 틈새정령은 버틴 시간에 따라 20·40·60·80점 중 하나를 받습니다.",
    notes: ["승리 팀과 종료 이유", "이번 경기의 주요 행동 기록", "공개된 역할과 누적 점수", "같은 방에서 다시 시작하는 준비 버튼"],
    markers: [[50, 36], [50, 61], [10, 36], [10, 58]],
    tip: "0.010부터 참가자 줄에 ‘생존 +20·40·60·80’이 함께 표시됩니다. 직전 라운드 관찰자는 다음 라운드에 연속 배정되지 않습니다.",
  },
];

export default function HowToPlayPage() {
  return (
    <main className="guide-page">
      <nav className="topbar">
        <Link className="brand" href="/" prefetch={false} aria-label="눈치숨 홈"><span className="brand-mark" aria-hidden="true">눈</span><span>눈치숨</span></Link>
        <a className="primary-button small-button" href="/game">게임 시작</a>
      </nav>

      <header className="guide-hero">
        <p className="eyebrow">실제 화면을 순서대로 따라오세요</p>
        <h1>처음이어도 역할이 보이는<br /><em>사물 숨바꼭질</em></h1>
        <p>역할표, 단계별 말풍선과 도움말이 첫 행동을 안내합니다. 화면의 파문·테두리·문구가 모든 상황을 알려주므로 소리는 필요하지 않습니다.</p>
      </header>

      <section className="phase-guide" aria-labelledby="phase-title">
        <div className="section-title"><span>한 라운드의 흐름</span><h2 id="phase-title">4인 기준 3분, 3라운드 진행</h2></div>
        <div className="phase-cards">{phases.map((phase) => <article key={phase.number}><span>{phase.number}</span><strong>{phase.title}</strong><p>{phase.copy}</p></article>)}</div>
        <div className="timing-table-wrap">
          <table><caption>참가 인원별 최대 이용 시간</caption><thead><tr><th>참가자</th><th>한 라운드</th><th>3라운드</th></tr></thead><tbody>{playerTimings.map(([players, round, match]) => <tr key={players}><th>{players}명</th><td>{round}</td><td>{match}</td></tr>)}</tbody></table>
          <p>모든 틈새정령을 먼저 찾으면 남은 시간과 관계없이 즉시 결과로 넘어갑니다.</p>
        </div>
      </section>

      <section className="screenshot-guide" aria-labelledby="screen-guide-title">
        <div className="section-title"><span>화면별 따라하기</span><h2 id="screen-guide-title">입장부터 결과까지</h2></div>
        <div className="screenshot-steps">
          {guideShots.map((shot, index) => (
            <article className="screenshot-step" key={shot.image}>
              <header><span>{String(index + 1).padStart(2, "0")} · {shot.eyebrow}</span><h3>{shot.title}</h3><p>{shot.copy}</p></header>
              <figure>
                <div className="screenshot-frame">
                  <Image src={shot.image} alt={`${shot.title} 실제 게임 화면`} width={1280} height={720} sizes="(max-width: 900px) 100vw, 720px" />
                  {shot.markers.map(([left, top], markerIndex) => <i key={`${left}-${top}`} style={{ left: `${left}%`, top: `${top}%` }} aria-hidden="true">{markerIndex + 1}</i>)}
                </div>
                <figcaption>{shot.capturedAt} 로컬 멀티플레이 검증 화면 · 테스트용 별명 사용</figcaption>
              </figure>
              <div className="shot-notes"><strong>화면에서 확인할 것</strong><ol>{shot.notes.map((note) => <li key={note}>{note}</li>)}</ol><p><b>도움말</b>{shot.tip}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section className="roles-guide" aria-label="역할 설명">
        <article className="hider-guide"><span aria-hidden="true">▣</span><div><small>숨는 팀</small><h2>틈새정령</h2><p>이동속도 6.5로 잡화점 물건과 똑같은 모습으로 숨습니다. 빨라진 이동, 사물 고정과 한 번뿐인 자리바꿈을 활용하세요.</p><ul><li>미션 구역에서 2초간 고정하면 25점</li><li>이동할 때 남는 짧은 파문에 주의</li><li>발견된 뒤에도 팀 신호로 동료 지원</li></ul></div></article>
        <article className="seeker-guide"><span aria-hidden="true">☾</span><div><small>찾는 팀</small><h2>밤지기 관찰자</h2><p>이동속도 9.5로 틈새정령보다 약 46% 빠릅니다. 위협적인 밤지기 외형으로 기준 배치를 비교한 뒤 수상한 사물에 확인 스티커를 붙이세요.</p><ul><li>오답이면 집중력 25 감소와 재사용 대기</li><li>관찰 렌즈는 최근 움직임 구역만 표시</li><li>선반 너머나 먼 사물은 확인 불가</li></ul></div></article>
      </section>

      <section className="controls-guide" aria-labelledby="ai-guide-title">
        <div className="section-title"><span>AI 방</span><h2 id="ai-guide-title">실력과 인원에 맞춰 함께 플레이</h2></div>
        <div className="control-grid">
          <article><kbd>쉬움</kbd><strong>처음 역할 익히기</strong><p>AI가 천천히 반응하고 움직임 단서를 자주 놓칩니다. 첫 판에서 맵과 행동 버튼을 익힐 때 적합합니다.</p></article>
          <article><kbd>보통</kbd><strong>균형 있는 기본 경기</strong><p>시야, 짧은 기억과 실수가 고르게 적용됩니다. 혼자 또는 친구와 AI를 섞어 플레이할 때 기본 선택입니다.</p></article>
          <article><kbd>어려움</kbd><strong>빠른 단서 추적</strong><p>AI가 움직임을 빨리 포착하고 오래 기억합니다. 그래도 벽 너머 정답을 알거나 사람의 최고 속도를 넘지는 않습니다.</p></article>
        </div>
        <div className="timing-table-wrap"><p>AI 방은 항상 사람과 AI 합계 네 명입니다. 초대 링크로 친구 한 명이 들어올 때마다 AI 한 명이 자동으로 빠지며, 사람과 AI 모두 같은 역할 순환·점수 규칙을 사용합니다.</p></div>
      </section>

      <section className="controls-guide">
        <div className="section-title"><span>조작과 접근성</span><h2>마우스·키보드·터치 모두 지원</h2></div>
        <div className="control-grid">
          <article><kbd>W A S D</kbd><kbd>↑ ← ↓ →</kbd><strong>이동과 포탈</strong><p>대각선 속도는 서버에서 보정되며 포탈에 닿으면 표시된 짝 포탈로 이동합니다.</p></article>
          <article><kbd>클릭</kbd><kbd>터치</kbd><strong>확인과 행동</strong><p>관찰자는 가까운 사물을 클릭하고, 틈새정령은 행동 패널에서 고정·자리바꿈을 사용합니다.</p></article>
          <article><kbd>?</kbd><kbd>Tab</kbd><strong>도움말 열기</strong><p>도움말은 마우스 올리기뿐 아니라 키보드 포커스와 터치로도 열 수 있습니다.</p></article>
        </div>
      </section>

      <section className="guide-cta"><h2>이제 가장 평범한 자리를 찾아볼까요?</h2><a className="primary-button" href="/game">별명 정하고 시작</a></section>
    </main>
  );
}
