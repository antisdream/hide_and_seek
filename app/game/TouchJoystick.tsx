"use client";

import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import type { Point } from "../../shared/game-types";
import { JoystickGesture, joystickInput } from "../../shared/joystick-input";

export default function TouchJoystick({ onMove, onStart, disabled, resetKey }: {
  onMove: (direction: Point) => void;
  onStart: () => void;
  disabled: boolean;
  resetKey: number;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const gestureRef = useRef(new JoystickGesture());
  const originRef = useRef({ x: 0, y: 0, radius: 1 });

  const reset = useCallback(() => {
    const pointerId = gestureRef.current.pointerId;
    gestureRef.current.reset();
    const pad = padRef.current;
    if (pad) {
      pad.dataset.active = "false";
      if (pointerId !== undefined && pad.hasPointerCapture(pointerId)) pad.releasePointerCapture(pointerId);
    }
    if (thumbRef.current) thumbRef.current.style.transform = "translate(0px, 0px)";
    onMove({ x: 0, y: 0 });
  }, [onMove]);

  useEffect(() => {
    reset();
  }, [disabled, resetKey, reset]);

  useEffect(() => {
    const hidden = () => { if (document.visibilityState === "hidden") reset(); };
    window.addEventListener("blur", reset);
    window.addEventListener("resize", reset);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", reset);
      window.removeEventListener("resize", reset);
      document.removeEventListener("visibilitychange", hidden);
      reset();
    };
  }, [reset]);

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || !gestureRef.current.owns(event.pointerId)) return;
    event.preventDefault();
    event.stopPropagation();
    const origin = originRef.current;
    const { direction, offset } = joystickInput(event.clientX - origin.x, event.clientY - origin.y, origin.radius);
    if (thumbRef.current) thumbRef.current.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
    onMove(direction);
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!gestureRef.current.end(event.pointerId)) return;
    event.preventDefault();
    event.stopPropagation();
    reset();
  };

  return (
    <div ref={padRef} className="touch-joystick" role="group" aria-label="이동 조이스틱" aria-disabled={disabled}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (disabled || (event.pointerType === "mouse" && event.button !== 0) || !gestureRef.current.begin(event.pointerId)) return;
        onStart();
        const bounds = event.currentTarget.getBoundingClientRect();
        originRef.current = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, radius: bounds.width * 0.32 };
        event.currentTarget.dataset.active = "true";
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event);
      }}
      onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
      <span className="joystick-track" aria-hidden="true" />
      <span ref={thumbRef} className="joystick-thumb" aria-hidden="true"><span /></span>
    </div>
  );
}
