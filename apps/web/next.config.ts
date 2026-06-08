import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: [
    "@keysark/ui",
    "@keysark/db",
    "@keysark/baidupan",
    "@keysark/googledrive",
    "@keysark/crypto",
    "@keysark/vault",
  ],
  experimental: { typedRoutes: true },
  // 桌面 sidecar 打包用 standalone 产物(.next/standalone/server.js);
  // 云端默认不开,避免影响现有部署。由 KEYSARK_STANDALONE=1 触发。
  ...(process.env.KEYSARK_STANDALONE ? { output: "standalone" as const } : {}),
};

export default config;
