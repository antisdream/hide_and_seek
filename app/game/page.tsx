import type { Metadata } from "next";
import GameClient from "./GameClient";

export const metadata: Metadata = {
  title: "게임하기 | 눈치숨",
  description: "빠른 매칭 또는 난이도별 AI와 친구가 함께하는 통합 방으로 즐기는 무음 중심 웹 숨바꼭질",
};

export default function GamePage() {
  return <GameClient />;
}
