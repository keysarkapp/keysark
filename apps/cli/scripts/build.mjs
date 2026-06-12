// CLI 打包:注入版本号。默认 server 固定为 https://keysark.com(本地开发用
// KEYSARK_SERVER / --server 覆盖),不再按 build 环境区分。
import { readFileSync } from "node:fs";
import { build } from "esbuild";

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
    __KEYSARK_VERSION__: JSON.stringify(version),
  },
});
console.log(`built dist/ark.mjs (v${version})`);
