import type { Metadata } from "next";
import GameClient from "./GameClient";

export const metadata: Metadata = {
  title: "게임하기 | 눈치숨",
  description: "친구 초대방, 공개 매칭, 난이도별 AI 방으로 즐기는 무음 중심 웹 숨바꼭질",
};

export default function GamePage() {
  return <GameClient />;
}
