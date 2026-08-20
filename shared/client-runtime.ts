interface ClientCrypto {
  randomUUID?: () => string;
  getRandomValues?: (values: Uint8Array) => Uint8Array;
}

/**
 * localhost가 아닌 일반 HTTP LAN 주소에서도 사용할 수 있는 클라이언트 ID를 만든다.
 * 보안 컨텍스트에서는 표준 UUID를, 그 밖에서는 난수 바이트 기반 UUID를 사용한다.
 */
export function createClientId(source: ClientCrypto | undefined = globalThis.crypto as ClientCrypto): string {
  if (typeof source?.randomUUID === "function") return source.randomUUID.call(source);

  const bytes = new Uint8Array(16);
  if (typeof source?.getRandomValues === "function") {
    source.getRandomValues.call(source, bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 최신 클립보드 API가 제한된 LAN HTTP에서도 기존 브라우저 복사 기능으로 보완한다. */
export async function copyTextToClipboard(value: string): Promise<boolean> {
  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // 권한이나 보안 컨텍스트 제한이면 아래의 호환 경로를 사용한다.
  }

  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
