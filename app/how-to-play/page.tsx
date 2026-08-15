import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "게임 방법 | 눈치숨",
  description: "틈새정령과 관찰자의 역할, 무음 신호, 조작 방법을 알아보세요.",
};

const phases = [
  { number: "01", title: "준비", copy: "별명을 정하고 친구방·공개방·연습방 중 하나에 입장해 준비를 누릅니다." },
  { number: "02", title: "숨기 25초", copy: "틈새정령은 문구류로 변해 자리를 잡습니다. 관찰자는 문 밖에서 기다립니다." },
  { number: "03", title: "수색 65초", copy: "관찰자는 수상한 사물에 가까이 가 확인 스티커를 붙이고, 틈새정령은 미션을 노립니다." },
  { number: "04", title: "결과와 순환", copy: "주요 장면을 함께 보고 다음 라운드에 역할을 다시 공정하게 나눕니다." },
];

export default function HowToPlayPage() {
  return (
    <main className="guide-page">
      <nav className="topbar">
        <Link className="brand" href="/" aria-label="눈치숨 홈"><span className="brand-mark" aria-hidden="true">눈</span><span>눈치숨</span></Link>
        <a className="primary-button small-button" href="/game">게임 시작</a>
      </nav>

      <header className="guide-hero">
        <p className="eyebrow">처음이어도 2분이면 충분해요</p>
        <h1>소리 없이 즐기는<br /><em>사물 숨바꼭질</em></h1>
        <p>화면의 파문, 테두리, 문구가 모든 상황을 알려줍니다. 음향은 승패 정보나 필수 단서로 사용하지 않습니다.</p>
      </header>

      <section className="phase-guide" aria-labelledby="phase-title">
        <div className="section-title"><span>한 경기의 흐름</span><h2 id="phase-title">3라운드, 라운드마다 두 역할</h2></div>
        <div className="phase-cards">{phases.map((phase) => <article key={phase.number}><span>{phase.number}</span><strong>{phase.title}</strong><p>{phase.copy}</p></article>)}</div>
      </section>

      <section className="roles-guide" aria-label="역할 설명">
        <article className="hider-guide"><span aria-hidden="true">▣</span><div><small>숨는 팀</small><h2>틈새정령</h2><p>잡화점 물건과 똑같은 모습으로 숨습니다. 이동을 멈추는 ‘사물 고정’, 가까운 같은 물건과 바꾸는 ‘자리바꿈’을 활용하세요.</p><ul><li>미션 구역에서 2초간 고정하면 추가 점수</li><li>이동할 때 남는 짧은 파문에 주의</li><li>발견된 뒤에도 팀 핑으로 동료 지원</li></ul></div></article>
        <article className="seeker-guide"><span aria-hidden="true">◎</span><div><small>찾는 팀</small><h2>관찰자</h2><p>밤지기 모루가 되어 배치와 움직임의 어색함을 관찰합니다. 가까운 사물을 클릭해 확인 스티커를 붙이세요.</p><ul><li>오답이면 집중력 25 감소와 재사용 대기</li><li>관찰 렌즈는 최근 움직임 구역만 표시</li><li>선반 너머나 먼 사물은 확인 불가</li></ul></div></article>
      </section>

      <section className="controls-guide">
        <div className="section-title"><span>조작과 접근성</span><h2>키보드와 터치 모두 지원</h2></div>
        <div className="control-grid">
          <article><kbd>W A S D</kbd><kbd>↑ ← ↓ →</kbd><strong>이동</strong><p>대각선 속도도 서버에서 같은 값으로 보정합니다.</p></article>
          <article><kbd>클릭</kbd><kbd>터치</kbd><strong>확인 스티커</strong><p>관찰자일 때 가까운 사물을 선택합니다.</p></article>
          <article><kbd>색 + 모양</kbd><kbd>문구</kbd><strong>무음 정보</strong><p>색만으로 상태를 구분하지 않고 항상 아이콘과 텍스트를 함께 제공합니다.</p></article>
        </div>
      </section>

      <section className="guide-cta"><h2>이제 가장 평범한 자리를 찾아볼까요?</h2><a className="primary-button" href="/game">별명 정하고 시작</a></section>
    </main>
  );
}
