import { pathToFileURL } from "node:url";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { DEFAULT_RULES, FAST_TEST_RULES } from "../shared/game-rules";
import type { GameRules } from "../shared/game-types";
import { createConfiguredNunchisoomRoom } from "./NunchisoomRoom";
import { isAllowedRequestOrigin, SAME_HOST_ORIGIN } from "./origin-policy";
import { SqliteMatchStore, type MatchStore } from "./persistence";

// 로컬 개발에서는 서버도 웹과 같은 `.env.local` 설정을 읽는다.
if (process.env.NODE_ENV !== "test") {
  try {
    process.loadEnvFile(".env.local");
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
}

export interface NunchisoomServerOptions {
  allowedOrigins?: string[];
  databasePath?: string;
  rules?: GameRules;
  greet?: boolean;
}

export interface NunchisoomServerRuntime {
  gameServer: Server;
  transport: WebSocketTransport;
  store: MatchStore;
  listen: (port: number, hostname?: string) => Promise<number>;
  shutdown: () => Promise<void>;
}

/**
 * 웹 클라이언트와 독립적으로 실행되는 권위형 게임 서버를 만든다.
 * 테스트에서는 메모리 DB와 빠른 규칙을 주입해 실제 소켓 흐름을 검증한다.
 */
export function createNunchisoomServer(options: NunchisoomServerOptions = {}): NunchisoomServerRuntime {
  const allowedOrigins = options.allowedOrigins ?? parseAllowedOrigins();
  const store = new SqliteMatchStore(options.databasePath);
  const transport = new WebSocketTransport({ maxPayload: 8 * 1024 });

  const ConfiguredNunchisoomRoom = createConfiguredNunchisoomRoom({
    allowedOrigins,
    rules: options.rules ?? DEFAULT_RULES,
    store,
  });

  const gameServer = new Server({
    transport,
    greet: options.greet ?? process.env.NODE_ENV !== "test",
    express: (app) => {
      app.use((request, response, next) => {
        const origin = request.headers.origin;
        if (origin) {
          if (!isAllowedRequestOrigin(origin, request.headers.host, allowedOrigins)) {
            response.removeHeader("Access-Control-Allow-Origin");
            response.removeHeader("Access-Control-Allow-Credentials");
            response.status(403).json({ error: "origin_not_allowed" });
            return;
          }
          response.header("Access-Control-Allow-Origin", origin);
          response.header("Vary", "Origin");
        }
        response.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
        response.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        if (request.method === "OPTIONS") {
          response.sendStatus(204);
          return;
        }
        next();
      });

      app.get("/health", (_request, response) => {
        response.json({
          ok: true,
          service: "nunchisoom-game-server",
          storedMatches: store.count(),
          serverTime: Date.now(),
        });
      });

      app.get("/api/config", (_request, response) => {
        response.json({
          roomName: "nunchisoom",
          minPlayers: (options.rules ?? DEFAULT_RULES).minPlayers,
          maxPlayers: (options.rules ?? DEFAULT_RULES).maxPlayers,
        });
      });
    },
  });
  gameServer.define("nunchisoom", ConfiguredNunchisoomRoom);

  return {
    gameServer,
    transport,
    store,
    async listen(port, hostname = "127.0.0.1") {
      await gameServer.listen(port, hostname);
      const address = transport.server?.address();
      if (!address || typeof address === "string") return port;
      return address.port;
    },
    async shutdown() {
      await gameServer.gracefullyShutdown(false);
      store.close();
    },
  };
}

function parseAllowedOrigins(): string[] {
  const configured = process.env.ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return configured?.length
    ? configured
    : [SAME_HOST_ORIGIN];
}

async function startStandaloneServer(): Promise<void> {
  const port = Number(process.env.GAME_PORT ?? 2_567);
  const hostname = process.env.GAME_HOST ?? "0.0.0.0";
  const runtime = createNunchisoomServer({
    rules: process.env.FAST_GAME === "1" ? FAST_TEST_RULES : DEFAULT_RULES,
  });
  const listeningPort = await runtime.listen(port, hostname);
  console.log(`[눈치숨 서버] ws://${hostname}:${listeningPort} 에서 실행 중`);

  const shutdown = async () => {
    console.log("[눈치숨 서버] 안전하게 종료합니다.");
    await runtime.shutdown();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const launchedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (launchedDirectly) {
  startStandaloneServer().catch((error: unknown) => {
    console.error("[눈치숨 서버] 시작하지 못했습니다.", error);
    process.exitCode = 1;
  });
}
