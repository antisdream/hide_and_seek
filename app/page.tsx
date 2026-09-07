import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "눈숨 | 눈치 보며 숨바꼭질",
  description: "물건 사이에 숨어 있는 친구를 찾아보세요. 혼자라면 AI와, 친구와는 초대 링크로 함께하는 무료 웹 숨바꼭질 게임이에요.",
};

const questions = [
  ["혼자서도 할 수 있나요?", "네! ‘혼자 해보기’에서 별명을 정하고 시작하면 AI 3명과 함께해요. 처음이라면 쉬움 난이도로 가볍게 연습해 보세요."],
  ["친구는 어떻게 초대하나요?", "‘친구랑 하기’에서 방을 만들고 초대 링크나 코드를 보내 주세요. 사람과 AI를 합쳐 4명부터 10명까지 함께할 수 있어요."],
  ["한 판에 얼마나 걸리나요?", "세 라운드를 해요. 4명일 때 약 9분, 10명일 때는 최대 13분 30초예요. 숨은 친구들을 일찍 찾으면 더 빨리 끝나요. 대기실에서 기다리는 시간은 별도예요."],
  ["설치하거나 마이크를 켜야 하나요?", "설치나 회원가입 없이 무료로 즐길 수 있어요. 마이크도 필요 없어요. 대기실에서는 채팅으로, 게임 중에는 팀 신호로 이야기해요."],
];

export default function Home() {
  return (
    <main className="landing-shell gentle-landing">
      <a className="skip-link" href="#home-start">게임 시작으로 건너뛰기</a>
      <header className="home-header home-width">
        <Link className="brand" href="/" prefetch={false} aria-label="눈숨 홈"><span className="brand-mark" aria-hidden="true">눈</span><span>눈숨</span></Link>
        <nav aria-label="주요 메뉴"><a href="/how-to-play">게임 방법</a><a className="home-nav-play" href="/game">게임하기 <span aria-hidden="true">↗</span></a></nav>
      </header>

      <section className="home-hero home-width" aria-labelledby="home-title">
        <div className="home-intro">
          <p className="home-kicker">친구랑 가볍게 한 판</p>
          <h1 id="home-title">눈치 보며<br /><em>숨바꼭질.</em></h1>
          <p className="home-description">연필, 노트, 테이프 사이에 친구가 숨어 있어요.<br className="desktop-break" /> 물건인 척 숨어보고, 술래가 되면 친구를 찾아봐요.</p>
          <div className="home-start-actions" id="home-start">
            <a className="home-button" href="/game?play=solo">혼자 해보기 <span aria-hidden="true">→</span></a>
            <a className="home-button secondary" href="/game?play=friends">친구랑 하기</a>
          </div>
          <p className="home-small-note">무료 · 설치·가입 없이 · 혼자라면 AI와 함께</p>
        </div>
        <figure className="home-art">
          <Image src="/og.png" alt="문구점에서 연필과 노트 친구들을 찾는 모루" width={1731} height={909} sizes="(max-width: 720px) 100vw, 48vw" priority />
          <figcaption>오늘은 어떤 물건으로 숨어볼까요?</figcaption>
        </figure>
      </section>

      <div className="home-facts home-width" aria-label="플레이 안내">
        <span><strong>4~10명</strong> 사람과 AI 함께</span>
        <span><strong>약 9분</strong> 4명 기준, 세 라운드</span>
        <span><strong>마이크 없이</strong> 편하게 즐겨요</span>
      </div>

      <section className="home-play home-width" aria-labelledby="home-play-title">
        <div className="home-section-heading"><div><p className="home-kicker">이렇게 놀아요</p><h2 id="home-play-title">숨는 재미도, 찾는 재미도.</h2></div><a href="/how-to-play">게임 방법 더 보기 <span aria-hidden="true">→</span></a></div>
        <figure className="home-game-image"><Image src="/how-to-play/06-seeking.jpg" alt="눈숨에서 술래가 문구점의 사물들을 살펴보는 게임 화면" width={1280} height={960} sizes="(max-width: 720px) 100vw, 1080px" /><figcaption>눈숨 플레이 화면</figcaption></figure>
        <div className="home-roles">
          <article><span className="home-role-tag">숨는 친구</span><h3>아무 일 없는 척, 가만히.</h3><p>다른 물건 옆에 자연스럽게 숨어요. 들킬 것 같으면 도망가거나, 다른 물건과 자리를 바꿔 보세요.</p></article>
          <article><span className="home-role-tag seeker">찾는 친구</span><h3>어? 저 물건, 방금 움직였는데?</h3><p>처음 가게 모습과 달라진 곳을 찾아요. 수상한 물건이 보이면 가까이 다가가 눌러 보세요.</p></article>
        </div>
      </section>

      <section className="home-steps home-width" aria-labelledby="home-steps-title">
        <h2 id="home-steps-title">시작은 간단해요.</h2>
        <ol><li><span>1</span><div><h3>별명을 정해요</h3><p>게임에서 부를 이름이면 돼요.</p></div></li><li><span>2</span><div><h3>함께할 친구를 골라요</h3><p>혼자라면 AI와, 친구와는 초대방에서.</p></div></li><li><span>3</span><div><h3>내 역할을 확인해요</h3><p>숨는 팀인지 술래인지 알려드릴게요.</p></div></li></ol>
      </section>

      <section className="home-faq home-width" aria-labelledby="home-faq-title">
        <h2 id="home-faq-title">궁금한 게 있나요?</h2>
        <div>{questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
      </section>

      <footer className="home-footer home-width"><div><Link className="brand" href="/" prefetch={false}>눈숨</Link><p>눈치 보며 숨바꼭질</p></div><div><a href="/how-to-play">게임 방법</a><a href="https://github.com/antisdream/hide_and_seek">GitHub</a></div></footer>
    </main>
  );
}
