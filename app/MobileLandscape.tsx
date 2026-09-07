"use client";

import { useSyncExternalStore, type ReactNode } from "react";

const query = "(pointer: coarse) and (orientation: portrait)";
function subscribe(callback: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

export default function MobileLandscape({ children }: { children: ReactNode }) {
  const portrait = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
  return (
    <>
      <div className="landscape-content" inert={portrait}>{children}</div>
      {portrait && <div className="rotate-screen" role="alert">
        <span className="rotate-phone" aria-hidden="true">↻</span>
        <strong>휴대전화를 가로로 돌려 주세요</strong>
        <p>눈숨은 가로 화면으로 플레이해요.<br />왼손은 조이스틱, 오른손은 스킬과 사물 터치!</p>
      </div>}
    </>
  );
}
