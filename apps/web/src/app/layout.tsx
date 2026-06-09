import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { Providers } from "@/components/providers";
import { providerFlags, storageLabel } from "@/lib/providers";
import {
  htmlLang,
  LOCALE_COOKIE,
  THEME_COOKIE,
  type Locale,
  type Theme,
} from "@/lib/i18n";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const APP_TITLE = "KeysArk — 端到端加密保管库 / End-to-end encrypted vault";
// 描述里的存储后端名随入口开关联动(默认仅 Google Drive)。
const APP_DESCRIPTION = `端到端加密的文本保管库。内容在你的浏览器里用 BIP39 助记词派生密钥加密,服务端与${storageLabel(
  providerFlags(),
  { google: "Google Drive", baidu: "百度网盘" },
)}只经手密文。`;

export const metadata: Metadata = {
  // 用于把 OG / favicon 的相对路径解析成绝对 URL;部署时设 NEXT_PUBLIC_SITE_URL。
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:6134"),
  title: APP_TITLE,
  description: APP_DESCRIPTION,
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/keysark-favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16.png", type: "image/png", sizes: "16x16" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    images: [{ url: "/keysark-og-banner.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    images: ["/keysark-og-banner.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#211D52",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === "en" ? "en" : "zh") as Locale;
  const themeRaw = store.get(THEME_COOKIE)?.value;
  const theme: Theme = themeRaw === "light" || themeRaw === "dark" ? themeRaw : "system";
  // light/dark → 给 <html> 加 class;system → 不加,交给 CSS 媒体查询。
  const themeClass = theme === "system" ? "" : theme;

  return (
    <html
      lang={htmlLang(locale)}
      className={`${inter.variable} ${themeClass}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">
        <Providers initialLocale={locale} initialTheme={theme}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
