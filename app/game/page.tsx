import type { Metadata } from "next";
import GameClient from "./GameClient";

export const metadata: Metadata = {
  title: "게임하기 | 눈숨",
  description: "혼자라면 AI와, 친구와는 초대방에서 만나요. 별명만 정하면 시작할 수 있어요.",
};

export default async function GamePage({ searchParams }: { searchParams: Promise<{ play?: string | string[] }> }) {
  const { play } = await searchParams;
  const initialPlay = play === "friends" || play === "public" ? play : "solo";
  return <GameClient initialPlay={initialPlay} />;
}
