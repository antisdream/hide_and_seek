import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "눈숨 | 친구와 한 판, 별명 하나면 시작",
  description: "설치·회원가입 없이 모이는 사물 숨바꼭질. 혼자라면 AI 3명과, 친구와는 초대 링크로 함께하세요. 기본 무음으로 즐기는 무료 웹 파티게임입니다.",
};

const questions = [
  ["혼자 들어가도 바로 할 수 있나요?", "네. ‘혼자 먼저 해보기’를 선택하고 별명을 정하면 AI 3명과 시작합니다. 쉬움·보통·어려움 중 난이도를 고를 수 있어요."],
  ["친구들과는 어떻게 모이나요?", "친구방을 만든 뒤 초대 링크나 코드를 보내세요. 사람과 AI를 합쳐 4~10명이 참여하며, 부족한 인원은 방장이 AI로 채울 수 있습니다."],
  ["설치하거나 결제해야 하나요?", "설치·회원가입·결제 없이 브라우저에서 플레이합니다. 현재 게임에는 유료 기능이 없습니다."],
  ["한 판에 얼마나 걸리나요?", "한 경기는 3라운드입니다. 4명은 약 9분, 10명은 최대 13분 30초이며, 숨는 팀이 모두 발견되면 더 빨리 끝날 수 있어요."],
  ["마이크를 켜야 하나요?", "아니요. 소리는 기본으로 꺼져 있고 단서는 화면에도 표시됩니다. 대기실에서는 텍스트 채팅, 경기 중에는 짧은 팀 신호를 사용해요."],
];

export default function Home() {
  return (
    <main className="landing-shell night-landing">
      <a className="skip-link" href="#start">시작 방법으로 건너뛰기</a>
      <nav className="topbar" aria-label="주요 메뉴">
        <a className="brand" href="#top" aria-label="눈숨 홈"><span className="brand-mark" aria-hidden="true">눈</span><span>눈숨</span></a>
        <div className="nav-actions"><a className="text-button" href="#play-scene">어떤 게임인가요?</a><a className="text-button" href="/how-to-play">게임 방법</a><a className="primary-button small-button" href="/game">플레이하기</a></div>
      </nav>

      <section className="night-hero" id="top" aria-labelledby="home-title">
        <div className="night-hero-copy">
          <p className="eyebrow">가볍게 모여, 진지하게 의심하는 밤</p>
          <h1 id="home-title">친구와 한 판,<br /><em>별명 하나면 시작.</em></h1>
          <p className="night-description">친구가 연필과 노트로 숨어 있는 잡화점.<br />평범한 물건 사이에서 수상한 움직임을 찾아보세요.</p>
          <div className="hero-actions" id="start"><a className="primary-button" href="/game?play=solo">혼자 먼저 해보기 <span aria-hidden="true">→</span></a><a className="secondary-button" href="/game?play=friends">친구와 방 만들기</a></div>
          <p className="entry-assurance">무료 · 설치·가입 없음 · 혼자면 AI 3명과</p>
          <ul className="game-facts" aria-label="플레이 조건"><li><strong>4~10명</strong><span>사람과 AI 함께</span></li><li><strong>3라운드</strong><span>4인 기준 약 9분</span></li><li><strong>마이크 없이</strong><span>화면 단서와 팀 신호</span></li></ul>
        </div>
        <figure className="night-hero-art"><img src="/og.png" alt="한밤의 잡화점에서 밤지기 모루와 연필·노트·테이프 정령이 숨바꼭질하는 눈숨 일러스트" width={1731} height={909} fetchPriority="high" /><figcaption><span className="art-label">눈숨의 세계</span><span>가장 평범한 것이, 가장 수상한 밤.</span></figcaption></figure>
      </section>

      <section className="play-reasons" aria-label="이럴 때 함께해요">
        <article><span className="reason-number">01</span><div><h2>친구가 아직 안 왔나요?</h2><p>AI와 한 판 먼저 시작하세요. 인원을 모으는 동안 조작을 익힐 수 있어요.</p></div></article>
        <article><span className="reason-number">02</span><div><h2>목소리를 못 내도 괜찮아요.</h2><p>움직임은 파문으로, 위험은 팀 신호로. 화면을 읽으며 함께 플레이해요.</p></div></article>
        <article><span className="reason-number">03</span><div><h2>긴 설명부터 읽지 않아도 돼요.</h2><p>역할이 정해지면 지금 할 일을 알려줘요. 도움말은 경기 중에도 다시 열 수 있어요.</p></div></article>
      </section>

      <section className="play-scene-section" id="play-scene" aria-labelledby="scene-title">
        <div className="section-heading"><p className="eyebrow">실제로는 이렇게 플레이해요</p><h2 id="scene-title">숨을 때도, 찾을 때도<br /><em>눈치가 한 수.</em></h2><p>그냥 멈춰 있는 물건일까요, 움직일 타이밍을 재는 친구일까요?</p></div>
        <figure className="real-game-shot"><img src="/how-to-play/06-seeking.jpg" alt="문구점 맵에서 술래가 움직임과 사물 배치를 살피는 실제 게임 수색 화면" width={1265} height={712} loading="lazy" /><figcaption>실제 플레이 캡처 · 이전 버전의 UI이며, 조작 화면은 계속 개선되고 있습니다.</figcaption></figure>
        <div className="role-stories"><article><span className="role-story-label hider">숨는 팀</span><h3>태연하게 숨다가,<br />들키기 전에 바꿔치기.</h3><p>같은 물건 옆에서 위치를 고정하세요. 위험해지면 포탈로 달아나거나, 한 번의 자리바꿈으로 기억을 흔들 수 있어요.</p><strong>욕심이 난다면? 위치를 알리고 6초 버티면 +20점.</strong></article><article><span className="role-story-label seeker">술래</span><h3>아까 없던 물건,<br />방금 움직인 흔적.</h3><p>먼저 진열대를 기억하고 달라진 점을 찾으세요. 가까이 다가가 수상한 물건을 확인하고, 막힐 땐 관찰 렌즈로 범위를 좁혀요.</p><strong>무작정 누르면 집중력이 줄어요. 관찰부터 시작하세요.</strong></article></div>
      </section>

      <section className="first-round-section" aria-labelledby="first-round-title"><div className="section-heading"><p className="eyebrow">첫 판까지, 복잡한 준비 없이</p><h2 id="first-round-title">별명 정하고. 모이고. 숨기.</h2></div><ol className="first-round-steps"><li><span>1</span><h3>어떻게 할지 고르세요</h3><p>혼자면 AI와 바로 시작하고, 친구와는 초대방을 만들어요.</p></li><li><span>2</span><h3>별명 하나면 준비 끝</h3><p>친구방에서는 링크를 보내고, 인원이 모이면 준비를 눌러요.</p></li><li><span>3</span><h3>내 역할대로 한 판</h3><p>숨는 팀과 술래의 목표를 확인하세요. 세 라운드 뒤에는 같은 방에서 다시 할 수 있어요.</p></li></ol><a className="night-text-link" href="/how-to-play">이동·위치 고정·포탈 조작 자세히 보기 <span aria-hidden="true">↗</span></a></section>

      <section className="play-faq" aria-labelledby="faq-title"><div className="section-heading"><p className="eyebrow">시작 전에 궁금할 것들</p><h2 id="faq-title">처음이어도 괜찮아요.</h2></div><div>{questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>

      <section className="night-final-cta"><p className="eyebrow">오늘의 눈치왕은 누구일까요?</p><h2>친구가 오기 전에,<br />먼저 감을 잡아볼까요.</h2><a className="primary-button" href="/game?play=solo">AI와 먼저 한 판 <span aria-hidden="true">→</span></a><p className="entry-assurance">별명만 정하면 AI 3명과 시작합니다.</p><a className="night-text-link" href="/game?play=friends">이미 모였다면 친구방 만들기</a></section>
      <footer className="landing-footer"><a className="brand" href="#top"><span className="brand-mark" aria-hidden="true">눈</span><span>눈숨</span></a><p>소리 없이도 함께하는 사물 숨바꼭질</p><div><a href="/how-to-play">게임 방법</a><a href="https://github.com/antisdream/hide_and_seek">GitHub</a></div></footer>
    </main>
  );
}
