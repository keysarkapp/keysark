// CLI 打包:按 build 时环境注入默认 server(生产 → https://keysark.com,否则本地 dev 端口)。
// 用法:node scripts/build.mjs(NODE_ENV=production 时打生产包)。
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const production = process.env.NODE_ENV === "production";
const defaultServer = production ? "https://keysark.com" : "http://localhost:6134";
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: {
    // ESM 产物里给 CJS 依赖(如 inquirer 的 mute-stream)补 require(node 内置模块)能力
    js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);',
  },
  outfile: "dist/ark.mjs",
  define: {
    __KEYSARK_DEFAULT_SERVER__: JSON.stringify(defaultServer),
    __KEYSARK_VERSION__: JSON.stringify(version),
  },
});
console.log(`built dist/ark.mjs (${production ? "production" : "development"}, default server ${defaultServer})`);
