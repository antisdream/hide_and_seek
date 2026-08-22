import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "눈치숨 | 수상한 잡화점",
  description: "소리 없이도 즐길 수 있는 웹 멀티플레이 사물 숨바꼭질",
};

const previewProps = [
  { icon: "✎", label: "연필", suspicious: false },
  { icon: "▣", label: "노트", suspicious: false },
  { icon: "◉", label: "테이프", suspicious: true },
  { icon: "▤", label: "상자", suspicious: false },
  { icon: "⌁", label: "리본", suspicious: false },
  { icon: "▰", label: "지우개", suspicious: false },
];

export default function Home() {
  return (
    <main className="landing-shell">
      <nav className="topbar" aria-label="주요 메뉴">
        <a className="brand" href="#top" aria-label="눈치숨 홈">
          <span className="brand-mark" aria-hidden="true">눈</span>
          <span>눈치숨</span>
        </a>
        <div className="nav-actions">
          <span className="quiet-badge">소리 없이도 플레이</span>
          <a className="text-button" href="/how-to-play">게임 방법</a>
        </div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">4~10명 · 설치 없음 · 3라운드 약 9~14분</p>
          <h1>가장 평범한 것이<br /><em>가장 수상하다.</em></h1>
          <p className="hero-description">
            숨는 팀 · 틈새정령은 잡화점 물건으로 숨어 진열 미션을 수행하고,
            술래 · 밤지기는 진열대의 작은 어색함을 찾아 확인 스티커를 붙입니다.
          </p>
          <div className="hero-actions">
            <a className="primary-button" href="/game">게임 입장</a>
            <a className="secondary-button" href="/how-to-play">게임 방법</a>
          </div>
          <p className="helper-copy">회원가입·설치 없이, 대기실 채팅과 경기 중 팀 신호로 소통</p>
          <a className="hero-guide-link" href="/how-to-play">실제 게임 화면으로 역할과 조작 먼저 보기 →</a>
        </div>

        <div className="game-preview" aria-label="한밤의 문구점 게임 화면 미리보기">
          <div className="preview-header">
            <div>
              <span className="phase-dot" aria-hidden="true" />
              <strong>수색 중</strong>
            </div>
            <span className="timer">00:42</span>
            <span className="role-chip">술래 · 밤지기</span>
          </div>
          <div className="preview-board">
            <div className="shelf shelf-one" />
            <div className="shelf shelf-two" />
            <div className="prop-grid">
              {previewProps.map((prop) => (
                <button
                  className={prop.suspicious ? "prop suspicious" : "prop"}
                  key={prop.label}
                  type="button"
                  aria-label={`${prop.label}${prop.suspicious ? ", 수상한 움직임 감지" : ""}`}
                >
                  <span aria-hidden="true">{prop.icon}</span>
                  <small>{prop.label}</small>
                </button>
              ))}
            </div>
            <div className="clue-card">
              <span aria-hidden="true">⌁</span>
              <p><strong>움직임 흔적</strong><br />최근 움직임은 넓은 구역으로만 보여요</p>
            </div>
            <div className="focus-meter" aria-label="집중력 75">
              <span>집중력</span>
              <div><i /></div>
              <strong>75</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="promise-strip" aria-label="핵심 특징">
        <article><span>01</span><strong>보고 추리해요</strong><p>발소리 대신 움직임 파문과 달라진 사물 배치를 살펴요.</p></article>
        <article><span>02</span><strong>상황에 맞게 소통해요</strong><p>대기실에서는 채팅하고, 경기 중에는 팀 신호로 동료를 도와요.</p></article>
        <article><span>03</span><strong>실력은 팔지 않아요</strong><p>현재 능력치나 승률을 판매하는 결제 기능은 없습니다.</p></article>
      </section>

      <section className="landing-details">
        <div>
          <p className="eyebrow">밤지기 모루의 잡화점</p>
          <h2>보이는 모든 것이<br />게임의 언어예요.</h2>
        </div>
        <div className="detail-cards">
          <article><span aria-hidden="true">⌾</span><div><strong>움직임 렌즈</strong><p>정답 대신 최근 움직임이 있었던 넓은 구역만 보여줘 추리를 돕습니다.</p></div></article>
          <article><span aria-hidden="true">⇄</span><div><strong>맵 전체에서 딱 한 번</strong><p>거리와 관계없이 같은 종류의 무작위 사물과 위치를 바꿔 술래 · 밤지기의 기억을 흔듭니다.</p></div></article>
          <article><span aria-hidden="true">◫</span><div><strong>팀 신호</strong><p>“여기 확인”, “술래 조심”을 모양과 문구로 빠르게 공유합니다.</p></div></article>
          <article><span aria-hidden="true">✦</span><div><strong>3라운드 역할 순환</strong><p>역할 이력을 반영해 특정 사람만 계속 술래가 되지 않게 합니다.</p></div></article>
        </div>
      </section>

      <section className="landing-cta">
        <div><small>4인 9분 · 10인 최대 13분 30초</small><h2>별명 하나면 준비 끝.</h2><p>방을 만든 뒤 대기실에서 AI를 조정하거나, 자리가 있는 공개 대기실에 빠른 매칭으로 합류하세요.</p></div>
        <a className="primary-button" href="/game">잡화점 입장하기</a>
      </section>

      <footer className="landing-footer">
        <a className="brand" href="#top"><span className="brand-mark" aria-hidden="true">눈</span><span>눈치숨</span></a>
        <p>독자 캐릭터와 규칙으로 만든 오픈소스 웹 파티게임</p>
        <div><a href="/how-to-play">게임 방법</a><a href="https://github.com/antisdream/hide_and_seek">GitHub</a></div>
      </footer>
    </main>
  );
}
