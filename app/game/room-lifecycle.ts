import { CloseCode, type Room } from "@colyseus/sdk";

export const SNAPSHOT_STALE_MS = 4_000;

/** 소켓이 열린 채 상태만 끊겨 00:00에 남는 경우에도 기존 재접속 경로를 시작한다. */
export function reconnectStalledRoom(room: Room | undefined, lastSnapshotAt: number, now: number): boolean {
  if (!room?.connection.isOpen || !room.reconnection.enabled || room.reconnection.isReconnecting
    || lastSnapshotAt <= 0 || !Number.isFinite(lastSnapshotAt) || !Number.isFinite(now)
    || now - lastSnapshotAt < SNAPSHOT_STALE_MS) return false;
  // 이 코드는 닫기 응답을 기다리지 않고 SDK의 onDrop·자동 재접속을 시작한다.
  room.connection.close(CloseCode.MAY_TRY_RECONNECT, "game state timeout");
  return true;
}

/** 닫힌 소켓의 leave 응답을 기다리지 않고 UI를 즉시 정리할 수 있게 한다. */
export function leaveGameRoom(room: Room | undefined): void {
  if (!room) return;
  room.reconnection.enabled = false;
  room.reconnection.enqueuedMessages.length = 0;
  // 현재 SDK는 이미 예약된 retry 타이머를 취소하는 API가 없다.
  // 이 연결 인스턴스의 재진입을 막아 나간 방이 뒤늦게 다시 열리지 않게 한다.
  room.connection.reconnect = () => undefined;
  if (!room.connection.isOpen) {
    room.connection.close();
    room.removeAllListeners();
    return;
  }
  const forceClose = setTimeout(() => room.connection.close(), 1_500);
  void room.leave(true).catch(() => room.connection.close()).finally(() => clearTimeout(forceClose));
}
