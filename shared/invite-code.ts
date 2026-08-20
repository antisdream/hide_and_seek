const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{3,80}$/;

/**
 * 이용자가 붙여 넣은 초대 코드 또는 초대 링크에서 실제 방 ID만 꺼낸다.
 * Colyseus 방 ID는 대소문자를 구분할 수 있으므로 원래 표기를 유지한다.
 */
export function normalizeInviteCode(value: string): string | undefined {
  const input = value.normalize("NFKC").trim();
  if (!input) return undefined;

  let candidate = input;
  if (input.includes("?") || input.includes("/")) {
    try {
      const url = new URL(input, "https://invite.invalid");
      candidate = url.searchParams.get("room")?.trim() ?? "";
    } catch {
      return undefined;
    }
  }

  return INVITE_CODE_PATTERN.test(candidate) ? candidate : undefined;
}
