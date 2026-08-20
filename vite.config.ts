import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json" with { type: "json" };

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt 환경에서는 FSEvents 대신 폴링으로 미리보기 변경을 감지한다.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ mode }) => {
  const loadedEnv = loadEnv(mode, process.cwd(), "");
  const publicGameServerUrl = process.env.NEXT_PUBLIC_GAME_SERVER_URL
    ?? loadedEnv.NEXT_PUBLIC_GAME_SERVER_URL
    ?? "http://127.0.0.1:2567";
  const publicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL
    ?? loadedEnv.NEXT_PUBLIC_SITE_URL
    ?? "http://localhost:3000";
  // Wrangler와 Miniflare의 비밀이 아닌 도구 상태만 프로젝트 안에 보관한다.
  // 실제 환경 변수는 Git에서 제외한 `.env*` 파일에 둔다.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Cloudflare 플러그인을 불러오기 전에 로그 경로를 확정한다.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    // vinext의 클라이언트 번들에도 공개 접속 주소를 빌드 시점에 명시적으로 주입한다.
    define: {
      "process.env.NEXT_PUBLIC_GAME_SERVER_URL": JSON.stringify(publicGameServerUrl),
      "process.env.NEXT_PUBLIC_SITE_URL": JSON.stringify(publicSiteUrl),
    },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
