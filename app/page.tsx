import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "눈치숨 | 수상한 잡화점",
  description: "소리 없이도 완전히 즐기는 웹 멀티플레이 사물 숨바꼭질",
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
          <span className="quiet-badge">소리 없이 완전 플레이</span>
          <a className="text-button" href="/how-to-play">게임 방법</a>
        </div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">4~10명 · 설치 없음 · 3라운드 약 9~14분</p>
          <h1>가장 평범한 것이<br /><em>가장 수상하다.</em></h1>
          <p className="hero-description">
            잡화점 물건으로 숨어 시각 미션을 수행하거나, 진열대의 작은
            어색함을 찾아 확인 스티커를 붙이세요.
          </p>
          <div className="hero-actions">
            <a className="primary-button" href="/game">친구방 만들기</a>
            <a className="secondary-button" href="/game">빠른 매칭</a>
          </div>
          <p className="helper-copy">회원가입·설치·음성채팅 없이 바로 플레이</p>
          <a className="hero-guide-link" href="/how-to-play">실제 게임 화면으로 역할과 조작 먼저 보기 →</a>
        </div>

        <div className="game-preview" aria-label="한밤의 문구점 게임 화면 미리보기">
          <div className="preview-header">
            <div>
              <span className="phase-dot" aria-hidden="true" />
              <strong>수색 중</strong>
            </div>
            <span className="timer">00:42</span>
            <span className="role-chip">관찰자</span>
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
              <p><strong>배치 힌트</strong><br />테이프는 항상 노트 오른쪽</p>
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
        <article><span>01</span><strong>보고 추리해요</strong><p>발소리 대신 바닥 파문과 배치 규칙을 읽어요.</p></article>
        <article><span>02</span><strong>들켜도 함께해요</strong><p>탈락 뒤에도 미니 퍼즐로 다음 라운드를 준비해요.</p></article>
        <article><span>03</span><strong>실력은 팔지 않아요</strong><p>결제는 프로필과 결과 연출처럼 표현에만 사용해요.</p></article>
      </section>

      <section className="landing-details">
        <div>
          <p className="eyebrow">밤지기 모루의 잡화점</p>
          <h2>보이는 모든 것이<br />게임의 언어예요.</h2>
        </div>
        <div className="detail-cards">
          <article><span aria-hidden="true">⌾</span><div><strong>움직임 렌즈</strong><p>정답 대신 최근 움직임이 있었던 넓은 구역만 보여줘 추리를 돕습니다.</p></div></article>
          <article><span aria-hidden="true">⇄</span><div><strong>딱 한 번 자리바꿈</strong><p>같은 종류의 사물과 위치를 바꿔 관찰자의 기억을 흔들 수 있습니다.</p></div></article>
          <article><span aria-hidden="true">◫</span><div><strong>무음 팀 신호</strong><p>“여기 확인”, “관찰자 주의”를 모양과 문구로 빠르게 공유합니다.</p></div></article>
          <article><span aria-hidden="true">✦</span><div><strong>3라운드 역할 순환</strong><p>역할 이력을 반영해 특정 사람만 계속 관찰자가 되지 않게 합니다.</p></div></article>
        </div>
      </section>

      <section className="landing-cta">
        <div><small>4인 9분 · 10인 최대 13분 30초</small><h2>별명 하나면 준비 끝.</h2><p>실제 화면 안내를 본 뒤 난이도별 AI 방을 만들거나, 친구와 공개방에 합류하세요.</p></div>
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
