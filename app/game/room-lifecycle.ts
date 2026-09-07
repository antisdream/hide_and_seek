import type { Room } from "@colyseus/sdk";

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
