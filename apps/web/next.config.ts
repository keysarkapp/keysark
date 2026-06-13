import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

// 注入应用版本号(加密 HTML 备份的元信息等处使用)。
const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  version?: string;
};

const config: NextConfig = {
  env: { NEXT_PUBLIC_KEYSARK_VERSION: pkg.version ?? "0.0.0" },
  transpilePackages: [
    "@keysark/ui",
    "@keysark/db",
    "@keysark/baidupan",
    "@keysark/googledrive",
    "@keysark/crypto",
    "@keysark/vault",
  ],
  typedRoutes: true,
};

export default config;
