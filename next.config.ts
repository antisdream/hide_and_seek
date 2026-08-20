import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Docker 런타임은 빌드 결과만 복사해 가볍게 실행한다. */
  output: "standalone",
};

export default nextConfig;
