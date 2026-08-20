import assert from "node:assert/strict";
import test from "node:test";
import { createInviteUrl, resolveGameServerEndpoint } from "../../shared/network-url";

test("게임 서버 주소는 웹페이지에 접속한 사설 IP를 자동으로 따른다", () => {
  assert.equal(
    resolveGameServerEndpoint("http://192.168.0.41:3000/game"),
    "http://192.168.0.41:2567",
  );
  assert.equal(
    resolveGameServerEndpoint("http://192.168.35.77:3000/game"),
    "http://192.168.35.77:2567",
  );
});

test("외부 배포용 명시 주소가 있으면 자동 주소보다 우선한다", () => {
  assert.equal(
    resolveGameServerEndpoint("http://192.168.0.41:3000/game", "https://game.example.com/"),
    "https://game.example.com",
  );
});

test("초대 링크도 현재 접속한 호스트를 유지한다", () => {
  assert.equal(
    createInviteUrl("http://192.168.35.77:3000/game", "Room_42-x"),
    "http://192.168.35.77:3000/game?room=Room_42-x",
  );
});
