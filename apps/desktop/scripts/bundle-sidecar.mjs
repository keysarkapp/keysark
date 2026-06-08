// 把 Next.js standalone 产物 + sidecar launcher 收拢到 src-tauri/sidecar/,
// 供 Tauri 作为资源打包、运行时由 node 拉起。
// 运行前置:已 `KEYSARK_STANDALONE=1 next build`(产出 apps/web/.next/standalone)。
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "..");
const web = join(desktop, "..", "web");
const standalone = join(web, ".next", "standalone");
const out = join(desktop, "src-tauri", "sidecar");

if (!existsSync(standalone)) {
  console.error(`[bundle-sidecar] 缺少 standalone 产物:${standalone}\n  先跑:pnpm --filter @keysark/desktop build:web`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// standalone server + 依赖(含 server.js、node_modules、.next 等)。
cpSync(standalone, out, { recursive: true });
// 静态资源(standalone 不含 .next/static 与 public,需手动并入)。
cpSync(join(web, ".next", "static"), join(out, "apps", "web", ".next", "static"), { recursive: true });
const pub = join(web, "public");
if (existsSync(pub)) cpSync(pub, join(out, "apps", "web", "public"), { recursive: true });

// launcher + 路径工具。
cpSync(join(desktop, "sidecar", "launch.mjs"), join(out, "launch.mjs"));
cpSync(join(desktop, "sidecar", "paths.mjs"), join(out, "paths.mjs"));

console.log(`[bundle-sidecar] 完成 → ${out}`);
console.log("  注:server.js 位于 monorepo 布局下,launcher 用 KEYSARK_SERVER_ENTRY 指向 apps/web/server.js");
