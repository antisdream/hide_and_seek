export const SAME_HOST_ORIGIN = "same-host";

/**
 * 정확히 등록한 Origin 또는 요청을 받은 서버와 호스트명이 같은 Origin만 허용한다.
 * `same-host`는 웹 포트와 게임 포트가 달라도 IP·도메인이 같으면 허용한다.
 */
export function isAllowedRequestOrigin(
  origin: string | null | undefined,
  requestHost: string | null | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (!origin || allowedOrigins.length === 0) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (!allowedOrigins.includes(SAME_HOST_ORIGIN) || !requestHost) return false;

  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(`http://${requestHost}`);
    if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") return false;
    return originUrl.hostname.toLowerCase() === requestUrl.hostname.toLowerCase();
  } catch {
    return false;
  }
}
