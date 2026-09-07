"use client";

import { useRef, type ButtonHTMLAttributes } from "react";
import { TouchActionGesture } from "../../shared/touch-action";

export default function TouchActionButton({ onAction, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & { onAction: () => void }) {
  const gesture = useRef(new TouchActionGesture());
  return <button {...props}
    onPointerDown={(event) => {
      if (event.pointerType === "mouse") { gesture.current.allowNextClick(); return; }
      if (event.currentTarget.matches(":disabled")) return;
      if (!gesture.current.begin(event.pointerId)) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerUp={(event) => {
      if (event.pointerType === "mouse") return;
      const rect = event.currentTarget.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (gesture.current.release(event.pointerId, inside, event.currentTarget.matches(":disabled"), performance.now())) {
        event.preventDefault();
        onAction();
      }
    }}
    onPointerCancel={(event) => gesture.current.cancel(event.pointerId)}
    onLostPointerCapture={(event) => gesture.current.cancel(event.pointerId)}
    onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") gesture.current.allowNextClick();
      props.onKeyDown?.(event);
    }}
    onClick={() => {
      // WebView가 합성 클릭을 mouse/detail=0으로 표시해도 중복 실행하지 않는다.
      if (gesture.current.allowsClick(performance.now())) onAction();
    }} />;
}
