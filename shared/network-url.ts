const DEFAULT_GAME_SERVER_PORT = "2567";

/**
 * 별도 주소가 설정되지 않으면 이용자가 웹페이지에 접속한 호스트를 게임 서버에도 사용한다.
 * 따라서 공유기나 네트워크가 바뀌어 PC의 사설 IP가 달라져도 이미지를 다시 만들 필요가 없다.
 */
export function resolveGameServerEndpoint(
  pageUrl: string,
  configuredEndpoint?: string,
  gameServerPort = DEFAULT_GAME_SERVER_PORT,
): string {
  const explicitEndpoint = configuredEndpoint?.trim();
  if (explicitEndpoint) return explicitEndpoint.replace(/\/+$/, "");

  const endpoint = new URL(pageUrl);
  endpoint.port = gameServerPort;
  endpoint.pathname = "/";
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.origin;
}

/** 현재 접속 주소를 기준으로 방 코드를 포함한 초대 링크를 만든다. */
export function createInviteUrl(pageUrl: string, roomId: string): string {
  const inviteUrl = new URL("/game", pageUrl);
  inviteUrl.searchParams.set("room", roomId);
  return inviteUrl.toString();
}
