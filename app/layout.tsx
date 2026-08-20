import type { Metadata } from "next";
import "./globals.css";

// 사이트 주소를 지정하지 않은 로컬·Docker 실행에서는 메타데이터 생성만 안전한 기본값을 사용한다.
const metadataBase = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(metadataBase),
  title: "눈치숨 | 수상한 잡화점",
  description: "사물의 어색함을 찾아내는 무음 중심 웹 멀티플레이 파티게임",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    title: "눈치숨 | 가장 평범한 것이 가장 수상하다",
    description: "별명 하나로 시작하는 무음 중심 웹 멀티플레이 사물 숨바꼭질",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "밤의 잡화점에서 문구류 정령을 찾는 밤지기 모루" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "눈치숨 | 수상한 잡화점",
    description: "소리 없이도 완전히 즐기는 웹 멀티플레이 사물 숨바꼭질",
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
