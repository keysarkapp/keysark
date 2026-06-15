// 博客文章的社交分享卡片:用 next/og 在服务端把文章标题渲染成 1200×630 的品牌图。
// opengraph-image / twitter-image 两个约定文件都复用这里的渲染,Next 会据此自动注入
// og:image 与 twitter:image,覆盖根布局的静态 banner。
// 字体随仓库打包(_card/*.woff),不依赖任何运行时外网请求。
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ImageResponse } from "next/og";
import { formatPostDate, getPost } from "@/lib/content/blog";

export const SIZE = { width: 1200, height: 630 };
export const CONTENT_TYPE = "image/png";
export const ALT = "KeysArk — end-to-end encrypted vault";

// 卡片标题统一用英文(Latin 字体子集即可,无需打包庞大的 CJK 字体)。
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://keysark.com";
const DOMAIN = (() => {
  try {
    const host = new URL(SITE_URL).host;
    return host.includes("localhost") ? "keysark.com" : host;
  } catch {
    return "keysark.com";
  }
})();

const AMBER = "#f5b53d";

// 字体只读一次,跨请求复用。import.meta.url 让 Turbopack 把 woff 当作相邻 asset 追踪输出;
// node runtime 下用 fs 读本地文件(file: URL 不支持 fetch),不依赖任何运行时外网请求。
let fontsPromise: Promise<{ name: string; data: Buffer; weight: 400 | 700; style: "normal" }[]> | null = null;
function loadFonts() {
  fontsPromise ??= Promise.all([
    readFile(fileURLToPath(new URL("./inter-700.woff", import.meta.url))),
    readFile(fileURLToPath(new URL("./inter-400.woff", import.meta.url))),
  ]).then(([bold, regular]) => [
    { name: "Inter", data: bold, weight: 700 as const, style: "normal" as const },
    { name: "Inter", data: regular, weight: 400 as const, style: "normal" as const },
  ]);
  return fontsPromise;
}

// 标题越长字号越小,保证不溢出卡片。
function titleSize(len: number): number {
  if (len > 64) return 52;
  if (len > 44) return 60;
  return 70;
}

/** 渲染某篇文章(slug)的分享卡片;slug 未命中时回退为通用品牌卡。 */
export async function renderCard(slug: string): Promise<ImageResponse> {
  const post = getPost(slug);
  const title = post?.en.title ?? "End-to-end encrypted vault for your keys";
  const dateLabel = post ? formatPostDate(post.date, "en") : "";
  const fonts = await loadFonts();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          backgroundColor: "#211D52",
          backgroundImage:
            "radial-gradient(900px 600px at 12% 6%, rgba(245,181,61,0.16), transparent 60%), linear-gradient(135deg, #211D52 0%, #14112e 100%)",
          fontFamily: "Inter",
          color: "#ffffff",
        }}
      >
        {/* 品牌行 */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              display: "flex",
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: AMBER,
            }}
          />
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.5 }}>KeysArk</div>
        </div>

        {/* 文章标题 */}
        <div
          style={{
            display: "flex",
            fontSize: titleSize(title.length),
            fontWeight: 700,
            lineHeight: 1.12,
            letterSpacing: -1,
            maxWidth: 980,
          }}
        >
          {title}
        </div>

        {/* 底部:日期 + 域名 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 400, color: "rgba(255,255,255,0.72)" }}>
            {dateLabel}
          </div>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: AMBER }}>{DOMAIN}</div>
        </div>
      </div>
    ),
    { ...SIZE, fonts },
  );
}
