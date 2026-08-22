import type { Metadata } from "next";
import GameClient from "./GameClient";

export const metadata: Metadata = {
  title: "게임하기 | 눈치숨",
  description: "공개 대기실 빠른 매칭과 친구 초대, 방장 AI 관리로 함께 즐기는 무음 중심 웹 숨바꼭질",
};

export default function GamePage() {
  return <GameClient />;
}
