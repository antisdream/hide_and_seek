import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "게임 방법 | 눈숨",
  description: "물건 사이에 숨고, 숨어 있는 친구를 찾아요. 실제 화면으로 눈숨의 시작 방법과 조작을 알아보세요.",
};

const guideShots = [
  { image: "/how-to-play/01-entry.jpg", title: "먼저, 어떻게 놀지 골라요", description: "혼자라면 AI와 바로 시작해요. 친구와 함께라면 방을 만들고 초대해 주세요.", notes: ["‘혼자 하기’에서 AI 난이도를 고를 수 있어요.", "별명은 1~12자로 정해 주세요.", "초대 코드는 ‘친구랑 하기’에서 입력할 수 있어요."], width: 1280, height: 960 },
  { image: "/how-to-play/02-lobby.jpg", title: "친구들이 모이면 준비해요", description: "친구 방에서는 모두 ‘준비 완료’를 누른 뒤 방장이 게임을 시작해요.", notes: ["사람과 AI를 합쳐 4명부터 10명까지 함께해요.", "방장은 난이도별 AI를 추가하거나 내보낼 수 있어요.", "채팅으로 인사를 나누고 초대 링크를 보내 보세요."], width: 1265, height: 949 },
  { image: "/how-to-play/03-role.jpg", title: "이번에는 어떤 역할일까요?", description: "라운드가 시작되면 내 역할과 할 일을 알려드려요. 역할 안내는 10초 동안 나와요.", notes: ["숨는 팀은 다른 물건처럼 숨어요.", "술래는 숨어 있는 친구들을 찾아요.", "내 역할과 상태는 게임 화면 위에서도 볼 수 있어요."], width: 1280, height: 960 },
  { image: "/how-to-play/04-hiding.jpg", title: "다른 물건 옆에 쏙 숨어요", description: "같은 종류의 물건 옆에 자리 잡고 ‘위치 고정’을 눌러 보세요. 움직임을 멈춰 눈에 덜 띄게 숨을 수 있어요.", notes: ["다시 움직이려면 ‘고정 해제’를 눌러요.", "자리바꿈은 라운드마다 한 번 쓸 수 있어요.", "미션과 도발은 수색이 시작된 뒤에 할 수 있어요."], width: 1280, height: 960 },
  { image: "/how-to-play/05-preview.jpg", title: "술래는 가게 모습을 기억해요", description: "친구들이 숨는 동안, 술래에게는 원래 가게 모습만 보여요. 물건이 몇 개였는지, 어디가 비어 있었는지 살펴봐요.", notes: ["마우스로 화면을 끌고 휠로 확대할 수 있어요.", "방향키로 움직여 포탈 반대편도 둘러보세요.", "이 시간에는 숨어 있는 친구들이 보이지 않아요."], width: 1280, height: 960 },
  { image: "/how-to-play/06-seeking.jpg", title: "어? 아까와 달라졌는데?", description: "수상한 물건이 보이면 가까이 다가가 눌러 보세요. 움직인 흔적도 좋은 힌트예요.", notes: ["‘관찰 렌즈’로 최근 움직임이 있었던 구역을 볼 수 있어요.", "틀리면 집중력이 줄고 잠시 기다려야 해요.", "같은 팀에게만 보이는 신호로 힌트를 나눌 수 있어요."], width: 1280, height: 960 },
  { image: "/how-to-play/07-result.jpg", title: "한 판 더 할까요?", description: "세 라운드가 끝나면 내 점수와 순위를 볼 수 있어요. 같은 방에서 다시 시작해도 좋아요.", notes: ["친구들이 준비되면 방장이 ‘같은 방에서 한 판 더’를 눌러요.", "AI의 수와 난이도는 그대로 이어져요.", "내 결과와 초대 링크를 함께 복사할 수 있어요."], width: 1265, height: 949 },
  { image: "/how-to-play/08-mobile.jpg", title: "휴대폰에서도 편하게", description: "맵 왼쪽 아래 WASD 버튼으로 움직이고, 맵 아래 행동 버튼을 눌러요. 버튼 옆 물음표를 누르면 설명이 나와요.", notes: ["숨는 팀은 위치 고정·자리바꿈·여기 있었지!, 술래는 관찰 렌즈와 사물 터치로 놀아요.", "위치를 고정했거나 들킨 뒤에는 이동할 수 없어요.", "팀 신호와 참가자 목록은 위쪽 ‘참가자·팀’에서 확인해요."], width: 390, height: 844 },
];

const timings = [
  [4, "3분", "9분"], [5, "3분 15초", "9분 45초"], [6, "3분 30초", "10분 30초"],
  [7, "3분 45초", "11분 15초"], [8, "4분", "12분"], [9, "4분 15초", "12분 45초"], [10, "4분 30초", "13분 30초"],
];

export default function HowToPlayPage() {
  return (
    <main className="friendly-guide">
      <header className="home-header home-width">
        <Link className="brand" href="/" prefetch={false} aria-label="눈숨 홈"><span className="brand-mark" aria-hidden="true">눈</span><span>눈숨</span></Link>
        <nav aria-label="주요 메뉴"><Link href="/" prefetch={false}>홈으로</Link><a className="home-nav-play" href="/game">게임하기 ↗</a></nav>
      </header>
      <div className="guide-content">
        <section className="guide-welcome">
          <p className="home-kicker">처음이라면 이것만 알아두세요</p>
          <h1>숨거나, 찾아보세요.</h1>
          <p>세 라운드를 함께 놀아요. 라운드마다 술래를 새로 정해요.<br />설명을 다 외우지 않아도 괜찮아요. 게임 중에도 도움말을 볼 수 있어요.</p>
        </section>

        <section className="guide-role-pair" aria-label="두 가지 역할">
          <article><span className="home-role-tag">숨는 팀 · 틈새정령</span><h2>물건인 척, 가만히.</h2><p>다른 물건 옆에 자연스럽게 숨어요. 시간이 끝날 때까지 한 명이라도 남으면 숨는 팀이 이겨요.</p></article>
          <article><span className="home-role-tag seeker">술래 · 밤지기</span><h2>숨어 있는 친구를 찾아요.</h2><p>처음 가게 모습과 달라진 곳을 살펴봐요. 시간 안에 숨어 있는 친구들을 모두 찾으면 이겨요.</p></article>
        </section>

        <section className="guide-quick-controls" aria-label="기본 조작">
          <div><kbd>WASD · 방향키</kbd><span>움직이기 · 휴대폰은 화면의 WASD 버튼</span></div>
          <div><kbd>숫자 1 · 2 · 3</kbd><span>숨는 팀: 위치 고정 · 자리바꿈 · 여기 있었지!</span></div>
          <div><kbd>술래 숫자 1</kbd><span>관찰 렌즈 · 휴대폰은 같은 이름의 버튼</span></div>
          <div><kbd>클릭 · 터치</kbd><span>수상한 물건 확인하기 · 행동 버튼 누르기</span></div>
          <div><kbd>?</kbd><span>도움말 보기 · Tab 키로도 선택할 수 있어요</span></div>
        </section>

        <section className="guide-gallery" aria-labelledby="guide-gallery-title">
          <h2 id="guide-gallery-title">화면 보면서 따라 해요</h2>
          <p>궁금한 부분을 눌러 펼쳐 보세요.</p>
          {guideShots.map((shot, index) => (
            <details className="guide-chapter" key={shot.image} open={index === 0}>
              <summary><span>{String(index + 1).padStart(2, "0")}</span><strong>{shot.title}</strong><i aria-hidden="true">+</i></summary>
              <div className="guide-chapter-body">
                <p>{shot.description}</p>
                <figure className={index === 7 ? "guide-phone-shot" : ""}>
                  <Image src={shot.image} alt={shot.title + " — 눈숨 플레이 화면"} width={shot.width} height={shot.height} sizes={index === 7 ? "390px" : "(max-width: 900px) 100vw, 880px"} />
                  <figcaption>2026.09.07 플레이 화면</figcaption>
                </figure>
                <ul>{shot.notes.map(note => <li key={note}>{note}</li>)}</ul>
              </div>
            </details>
          ))}
        </section>

        <section className="guide-extra" aria-labelledby="guide-extra-title">
          <h2 id="guide-extra-title">조금 더 자세히 알고 싶다면</h2>
          <details><summary>라운드 순서와 걸리는 시간</summary><div><p>내 역할 확인 10초 → 숨기와 가게 살펴보기 35초 → 수색 → 결과 10초 순서예요. 수색은 4명일 때 125초이고, 한 명 늘 때마다 15초씩 늘어나요.</p><div className="guide-table-scroll"><table><thead><tr><th>인원</th><th>한 라운드</th><th>세 라운드</th></tr></thead><tbody>{timings.map(([players, round, match]) => <tr key={players}><th>{players}명</th><td>{round}</td><td>{match}</td></tr>)}</tbody></table></div><p>대기실에서 기다리는 시간은 제외한 안내예요. 숨어 있는 친구들을 일찍 찾으면 라운드가 더 빨리 끝나요.</p></div></details>
          <details><summary>숨는 팀의 행동과 점수</summary><div><ul><li><strong>위치 고정:</strong> 제자리에 멈춰요. 다시 움직이려면 ‘고정 해제’를 눌러 주세요.</li><li><strong>자리바꿈:</strong> 가게 안의 같은 종류 물건 하나와 무작위로 바꿔요. 라운드마다 한 번 쓸 수 있어요.</li><li><strong>진열 미션:</strong> 수색 중 미션 구역에서 2초 동안 고정하면 25점이에요.</li><li><strong>도발:</strong> ‘여기 있었지!’로 위치를 알린 뒤 6초 버티면 20점! 20초 간격으로 라운드마다 2번 쓸 수 있어요. 잡히거나 연결이 끊기면 점수를 받지 못해요.</li><li><strong>생존 점수:</strong> 수색 중 버틴 시간에 따라 20·40·60·80점을 받아요.</li></ul></div></details>
          <details><summary>술래의 행동과 집중력</summary><div><p>술래가 숨는 팀보다 빨라요. 수상한 물건에서 2.6칸 안으로 다가가 눌러 보세요. 선반에 가린 물건은 확인할 수 없어요.</p><p>틀리면 집중력이 25 줄고 3초를 기다려야 해요. 집중력을 모두 쓰면 6.5초 뒤에 다시 확인할 수 있어요.</p><p>관찰 렌즈는 최근 2초 동안 움직임이 있었던 구역을 1.8초간 보여줘요. 어떤 물건인지는 직접 찾아야 해요. 한 번 쓰면 30초 뒤에 다시 쓸 수 있어요.</p></div></details>
          <details><summary>AI 난이도 고르기</summary><div><ul><li><strong>쉬움:</strong> 천천히 반응해요. 처음 조작을 익힐 때 좋아요.</li><li><strong>보통:</strong> 숨고 찾기를 골고루 즐기기 좋은 난이도예요.</li><li><strong>어려움:</strong> 흔적을 빨리 알아채고 오래 기억해요. 그래도 벽 너머를 볼 수는 없어요.</li></ul><p>친구 방에서는 방장이 원하는 난이도의 AI를 한 명씩 불러올 수 있어요.</p></div></details>
          <details><summary>포탈과 팀 신호 사용하기</summary><div><p>포탈에 들어가면 연결된 다른 포탈로 이동해요. 대각선으로 움직여도 속도는 같아요.</p><p>‘참가자·팀’에서 보내는 팀 신호는 같은 팀에게만 보여요. 술래를 봤거나, 이동하려고 하거나, 확인을 마친 곳을 알려 주세요. 들킨 뒤에도 신호로 친구를 도울 수 있어요.</p><p>소리는 기본으로 꺼져 있어요. 원하면 위쪽 ‘메뉴’를 열어 ‘소리 켜기’를 눌러 주세요. 중요한 단서는 화면에도 보여요.</p></div></details>
        </section>
        <section className="guide-start"><p>이제 한 판 해볼까요?</p><a className="home-button" href="/game">눈숨 시작하기 →</a></section>
      </div>
    </main>
  );
}
