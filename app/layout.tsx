import type { Metadata } from "next";
import "./globals.css";

// 사이트 주소를 지정하지 않은 로컬·Docker 실행에서는 메타데이터 생성만 안전한 기본값을 사용한다.
const metadataBase = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(metadataBase),
  title: "눈숨 | 눈치 보며 숨바꼭질",
  description: "물건 사이에 숨고, 숨어 있는 친구를 찾아봐요. 설치 없이 즐기는 무료 웹 숨바꼭질 게임이에요.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    title: "눈숨 | 눈치 보며 숨바꼭질",
    description: "혼자라면 AI와, 친구와는 초대 링크로 함께해요. 마이크 없이도 즐거운 숨바꼭질.",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "밤의 잡화점에서 문구류 정령을 찾는 밤지기 모루" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "눈숨 | 눈치 보며 숨바꼭질",
    description: "혼자 또는 친구들과, 마이크 없이 즐기는 무료 웹 숨바꼭질.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
