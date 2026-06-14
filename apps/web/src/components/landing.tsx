"use client";

// 未登录落地页:营销 hero(原创 CSS 背景)+「连接百度网盘」CTA。多语言 + 主题切换。
import { Button } from "@keysark/ui";
import {
  ArrowRight,
  Binary,
  CloudUpload,
  FileText,
  GitBranch,
  KeyRound,
  LockKeyhole,
  MonitorSmartphone,
  ShieldCheck,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { Wordmark } from "./brand";
import { AndroidMark, AppleMark, LinuxMark, WindowsMark } from "./platform-marks";
import { DocsButton, HeaderControls, RepoButton } from "./controls";
import { useLocale } from "./providers";
import { BUILD_REPO, CLI_VERSION } from "@/lib/build-info";
import { localeHref, type MsgKey } from "@/lib/i18n";
import { storageLabel, type ProviderFlags } from "@/lib/providers";
import { testId } from "@/lib/test-id";

// 第一屏三特性:安全 / 免费 / 开源。
const FEATURES: { tag: MsgKey; title: MsgKey; body: MsgKey; icon: LucideIcon }[] = [
  { tag: "feat_1_tag", title: "feat_1_title", body: "feat_1_body", icon: ShieldCheck },
  { tag: "feat_3_tag", title: "feat_3_title", body: "feat_3_body", icon: CloudUpload },
  { tag: "feat_os_tag", title: "feat_os_title", body: "feat_os_body", icon: GitBranch },
];

// 工作原理示意图:浏览器边界内的三步(slug 稳定,供 testId 用),边界外是云端存储。
const HOW_STEPS: { id: string; title: MsgKey; body: MsgKey; icon: LucideIcon }[] = [
  { id: "phrase", title: "how_s1_title", body: "how_s1_body", icon: KeyRound },
  { id: "derive", title: "how_s2_title", body: "how_s2_body", icon: Binary },
  { id: "encrypt", title: "how_s3_title", body: "how_s3_body", icon: LockKeyhole },
];

// 全平台客户端:CLI 已上线(点进文档安装页);其余为占位,hover 满 1 秒提示 TODO。
type PlatformIcon = (props: { className?: string }) => React.ReactNode;
const PLATFORMS: { id: string; label: string; icon: PlatformIcon }[] = [
  { id: "cli", label: "CLI", icon: Terminal },
  { id: "ios", label: "iOS", icon: AppleMark },
  { id: "android", label: "Android", icon: AndroidMark },
  { id: "macos", label: "macOS", icon: AppleMark },
  { id: "windows", label: "Windows", icon: WindowsMark },
  { id: "linux", label: "Linux", icon: LinuxMark },
];

const PLATFORM_BASE =
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors";

/** 平台徽标:有 href 即 CLI,可点击进文档;否则占位,hover 满 1 秒浮出 TODO。 */
function PlatformBadge({
  label,
  icon: Icon,
  href,
}: {
  label: string;
  icon: PlatformIcon;
  href?: string;
}) {
  const [showTip, setShowTip] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);

  if (href) {
    return (
      <a
        href={href}
        {...testId("landing-platform-cli")}
        className={`${PLATFORM_BASE} border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] shadow-sm hover:border-[var(--color-primary)]/50 hover:text-[var(--color-primary)]`}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
      </a>
    );
  }

  const open = () => {
    timer.current = setTimeout(() => setShowTip(true), 1000);
  };
  const close = () => {
    clearTimeout(timer.current ?? undefined);
    setShowTip(false);
  };
  return (
    <span className="relative inline-flex" onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={close}>
      <span
        aria-disabled="true"
        className={`${PLATFORM_BASE} cursor-default border-dashed border-[var(--color-border)] text-[var(--color-muted-foreground)]/70`}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      {showTip ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--color-foreground)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-background)] shadow"
        >
          TODO
        </span>
      ) : null}
    </span>
  );
}

export function Landing({ error, providers }: { error?: string; providers: ProviderFlags }) {
  const { t, locale } = useLocale();
  const { google: showGoogle, baidu: showBaidu } = providers;
  // 联动主页文案:存储后端展示名随启用的入口变化。
  const store = storageLabel(providers, { google: t("store_google"), baidu: t("store_baidu") });
  // 站内链接随当前语言加前缀(默认英文无前缀);外链(GitHub、/api/*)不加。
  const homeHref = localeHref("/", locale);
  const docsHref = localeHref("/docs", locale);
  const repo = BUILD_REPO;

  // 结构化数据:帮助搜索引擎理解这是一款开源免费的密码/密钥管理软件。
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "KeysArk",
    applicationCategory: "SecurityApplication",
    operatingSystem: "Web, macOS, Windows, Linux",
    description: t("meta_description", store),
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    isAccessibleForFree: true,
    ...(repo ? { codeRepository: repo, license: `${repo}/blob/main/LICENSE` } : {}),
  };
  const errMsg = error
    ? error === "oauth_state"
      ? t("err_state")
      : error === "oauth_exchange"
        ? t("err_exchange")
        : t("err_default")
    : null;

  return (
    <div {...testId("landing")} className="relative flex min-h-screen flex-col">
      {/* SEO 结构化数据 */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* 背景层(纯 CSS 动态:漂移极光 + 平移网格 + 扫描光束) */}
      <div className="hero-aurora" aria-hidden="true" />
      <div className="hero-grid" aria-hidden="true" />
      <div className="hero-scan" aria-hidden="true" />

      <div className="relative z-10 flex min-h-screen flex-col">
        {/* 顶栏 */}
        <header {...testId("landing-header")} className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <a href={homeHref} aria-label="KeysArk">
            <Wordmark className="text-lg" />
          </a>
          <div className="flex items-center gap-3">
            <RepoButton />
            <DocsButton />
            <HeaderControls />
            {showGoogle ? (
              <a href="/api/auth/google">
                <Button variant="outline" size="sm">
                  {t("nav_connect_google")}
                </Button>
              </a>
            ) : null}
            {showBaidu ? (
              <a href="/api/auth/login">
                <Button variant="outline" size="sm">
                  {t("nav_connect")}
                </Button>
              </a>
            ) : null}
          </div>
        </header>

        {/* Hero */}
        <section {...testId("landing-hero")} className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-6 py-20 text-center">
          {/* hero 文案收窄居中,特性网格则铺满整个中心区 */}
          <div {...testId("landing-hero-copy")} className="flex max-w-3xl flex-col items-center">
            <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/80 px-4 py-1.5 text-xs font-medium text-[var(--color-muted-foreground)] shadow-sm backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
              {t("hero_badge")}
            </span>
            <h1 className="text-balance text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
              {t("hero_title_1")}
              <br />
              {t("hero_title_2")}
            </h1>
            <p className="mt-6 max-w-xl text-balance text-lg text-[var(--color-muted-foreground)]">
              {t("hero_subtitle", store)}
            </p>
            <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
              {showGoogle ? (
                <a href="/api/auth/google">
                  <Button size="lg" className="px-8">
                    {t("cta_google")}
                  </Button>
                </a>
              ) : null}
              {showBaidu ? (
                <a href="/api/auth/login">
                  <Button size="lg" variant={showGoogle ? "outline" : "default"} className="px-8">
                    {t("cta_primary")}
                  </Button>
                </a>
              ) : null}
              <a href="#how">
                <Button size="lg" variant="ghost">
                  {t("cta_secondary")}
                </Button>
              </a>
            </div>

            {/* 全平台客户端:CLI 已上线,其余开发中 */}
            <div
              {...testId("landing-platforms")}
              className="mt-8 flex flex-wrap items-center justify-center gap-2"
            >
              {PLATFORMS.map((p) => (
                <PlatformBadge
                  key={p.id}
                  label={p.label}
                  icon={p.icon}
                  href={p.id === "cli" ? `${docsHref}#install` : undefined}
                />
              ))}
            </div>
            {errMsg ? <p className="mt-6 text-sm text-[var(--color-danger)]">{errMsg}</p> : null}
          </div>

          {/* 三特性:并入 hero,共用极光背景(半透明卡 + 模糊) */}
          <div
            {...testId("landing-features")}
            className="mt-24 grid w-full gap-6 text-left sm:grid-cols-3"
          >
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-[calc(var(--radius)+0.25rem)] border border-[var(--color-border)] bg-[var(--color-surface)]/70 p-6 shadow-sm backdrop-blur"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[calc(var(--radius)+0.125rem)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                    <f.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="text-base font-semibold tracking-tight">
                    <span className="text-[var(--color-primary)]">{t(f.tag)}</span>
                    <span className="mx-1.5 font-normal text-[var(--color-muted-foreground)]">·</span>
                    {t(f.title)}
                  </h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  {t(f.body, store)}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* 工作原理:浏览器边界示意图 */}
        <section
          id="how"
          {...testId("landing-how")}
          className="border-t border-[var(--color-border)]"
        >
          <div {...testId("landing-how-inner")} className="mx-auto w-full max-w-6xl px-6 py-16">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("how_title")}</h2>
              <p className="mt-3 text-[var(--color-muted-foreground)]">{t("how_subtitle")}</p>
            </div>

            <div
              {...testId("landing-how-diagram")}
              className="mt-12 flex flex-col items-stretch gap-4 lg:flex-row lg:items-center"
            >
              {/* 浏览器边界:明文与密钥只在这里 */}
              <div
                {...testId("landing-how-browser")}
                className="flex-1 rounded-[calc(var(--radius)+0.5rem)] border-2 border-dashed border-[var(--color-primary)]/40 bg-[var(--color-surface)]/60 p-5 backdrop-blur"
              >
                <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">
                  <MonitorSmartphone className="h-4 w-4" aria-hidden="true" />
                  {t("how_browser_label")}
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
                  {HOW_STEPS.map((s, i) => (
                    <Fragment key={s.id}>
                      <div
                        {...testId(`landing-how-${s.id}`)}
                        className="flex-1 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm"
                      >
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-[calc(var(--radius)+0.125rem)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                          <s.icon className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <div className="mt-3 text-sm font-semibold tracking-tight">{t(s.title)}</div>
                        <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
                          {t(s.body)}
                        </p>
                      </div>
                      {i < HOW_STEPS.length - 1 ? (
                        <div
                          className="flex items-center justify-center text-[var(--color-muted-foreground)]"
                          aria-hidden="true"
                        >
                          <ArrowRight className="h-4 w-4 rotate-90 sm:rotate-0" />
                        </div>
                      ) : null}
                    </Fragment>
                  ))}
                </div>
                <p className="mt-4 text-xs text-[var(--color-muted-foreground)]">
                  {t("how_browser_note")}
                </p>
              </div>

              {/* 跨越边界:只有密文离开设备 */}
              <div className="flex shrink-0 items-center justify-center gap-2 lg:flex-col">
                <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs font-medium text-[var(--color-muted-foreground)]">
                  {t("how_crossing_label")}
                </span>
                <ArrowRight
                  className="h-5 w-5 rotate-90 text-[var(--color-muted-foreground)] lg:rotate-0"
                  aria-hidden="true"
                />
              </div>

              {/* 云端:你的网盘只存密文 */}
              <div
                {...testId("landing-how-cloud")}
                className="rounded-[calc(var(--radius)+0.5rem)] border border-[var(--color-border)] bg-[var(--color-surface-2)]/70 p-5 backdrop-blur lg:w-72 lg:shrink-0"
              >
                <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  <CloudUpload className="h-4 w-4" aria-hidden="true" />
                  {t("how_cloud_label")}
                </div>
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-[calc(var(--radius)+0.125rem)] bg-[var(--color-success)]/12 text-[var(--color-success)]">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="mt-3 text-sm font-semibold tracking-tight">{store}</div>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
                  {t("how_cloud_note")}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 命令行 + 面向开发者(合并为一个 Block,左右布局,中间无分隔线) */}
        <section {...testId("landing-cli")} className="border-t border-[var(--color-border)]">
          <div {...testId("landing-cli-inner")} className="mx-auto w-full max-w-6xl px-6 py-16">
            {/* 命令行:左=文案,右=终端 */}
            <div className="grid items-center gap-10 lg:grid-cols-2">
              <div {...testId("landing-cli-copy")}>
                <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/80 px-4 py-1.5 text-xs font-medium text-[var(--color-primary)] shadow-sm backdrop-blur">
                  <Terminal className="h-3.5 w-3.5" />
                  {t("cli_home_tag")}
                </span>
                <h2 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">{t("cli_home_title")}</h2>
                <p className="mt-4 max-w-xl text-[var(--color-muted-foreground)] leading-relaxed">
                  {t("cli_home_body")}
                </p>
                <div className="mt-7">
                  <a href={docsHref}>
                    <Button size="lg" variant="outline" className="px-7">
                      {t("cli_home_cta")}
                      <ArrowRight className="ml-1.5 h-4 w-4" />
                    </Button>
                  </a>
                </div>
              </div>

              <div
                {...testId("landing-cli-terminal")}
                className="overflow-hidden rounded-[calc(var(--radius)+0.5rem)] border border-[var(--color-border)] bg-[var(--color-surface-2)]/80 shadow-sm backdrop-blur"
              >
                <div className="flex items-center gap-1.5 border-b border-[var(--color-border)] px-4 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-danger)]/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-warning,#f59e0b)]/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-success)]/60" />
                  <span className="ml-2 font-mono text-xs text-[var(--color-muted-foreground)]">
                    ark v{CLI_VERSION}
                  </span>
                </div>
                <div className="px-4 py-4 font-mono text-xs leading-relaxed">
                  <p className="text-[var(--color-muted-foreground)]"># {t("cli_home_install_hint")}</p>
                  <p>
                    <span className="text-[var(--color-success)]">$</span> npm install -g @keysark/cli
                  </p>
                  <p className="mt-3">
                    <span className="text-[var(--color-success)]">$</span> ark login
                  </p>
                  <p>
                    <span className="text-[var(--color-success)]">$</span> ark import
                  </p>
                  <p className="mt-3">
                    <span className="text-[var(--color-success)]">$</span> ark get github.com/me/app/.env .env
                  </p>
                </div>
              </div>
            </div>

            {/* 面向开发者:左=文案,右=.keysark → 命令(同一 Block,无分隔线) */}
            <div {...testId("landing-batch")} className="mt-16 grid items-center gap-10 lg:grid-cols-2">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/80 px-4 py-1.5 text-xs font-medium text-[var(--color-primary)] shadow-sm backdrop-blur">
                  <GitBranch className="h-3.5 w-3.5" />
                  {t("batch_tag")}
                </span>
                <h2 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">{t("batch_title")}</h2>
                <p className="mt-4 max-w-xl text-[var(--color-muted-foreground)] leading-relaxed">
                  {t("batch_body")}
                </p>
                <p className="mt-4 max-w-xl text-sm text-[var(--color-muted-foreground)] leading-relaxed">
                  {t("batch_note")}
                </p>
              </div>

              {/* 右栏:.keysark 清单 → 加密 → 命令(纵向堆叠) */}
              <div {...testId("landing-batch-diagram")} className="flex flex-col gap-3">
                <div
                  {...testId("landing-batch-manifest")}
                  className="overflow-hidden rounded-[calc(var(--radius)+0.5rem)] border border-[var(--color-border)] bg-[var(--color-surface-2)]/80 shadow-sm backdrop-blur"
                >
                  <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3 text-xs font-medium text-[var(--color-muted-foreground)]">
                    <FileText className="h-3.5 w-3.5 text-[var(--color-primary)]" aria-hidden="true" />
                    .keysark
                  </div>
                  <div className="px-4 py-4 font-mono text-xs leading-relaxed">
                    <p className="text-[var(--color-muted-foreground)]"># {t("batch_file_cmt")}</p>
                    <p>.env</p>
                    <p>.env.production</p>
                    <p>config/app.secret.json</p>
                  </div>
                </div>

                <div className="flex items-center justify-center gap-2">
                  <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs font-medium text-[var(--color-muted-foreground)]">
                    {t("batch_sync_label")}
                  </span>
                  <ArrowRight className="h-5 w-5 rotate-90 text-[var(--color-muted-foreground)]" aria-hidden="true" />
                </div>

                <div
                  {...testId("landing-batch-terminal")}
                  className="overflow-hidden rounded-[calc(var(--radius)+0.5rem)] border border-[var(--color-border)] bg-[var(--color-surface-2)]/80 shadow-sm backdrop-blur"
                >
                  <div className="flex items-center gap-1.5 border-b border-[var(--color-border)] px-4 py-3">
                    <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-danger)]/60" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-warning,#f59e0b)]/60" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-success)]/60" />
                    <span className="ml-2 font-mono text-xs text-[var(--color-muted-foreground)]">ark</span>
                  </div>
                  <div className="px-4 py-4 font-mono text-xs leading-relaxed">
                    <p>
                      <span className="text-[var(--color-success)]">$</span> ark save{" "}
                      <span className="text-[var(--color-muted-foreground)]"># {t("batch_save_cmt")}</span>
                    </p>
                    <p className="mt-2">
                      <span className="text-[var(--color-success)]">$</span> ark get{" "}
                      <span className="text-[var(--color-muted-foreground)]"># {t("batch_get_cmt")}</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 页脚 */}
        <footer {...testId("landing-footer")} className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-4 px-6 py-8 text-xs text-[var(--color-muted-foreground)] sm:flex-row sm:items-center">
          <Wordmark className="text-sm font-medium" />
          <div className="flex flex-wrap items-center gap-4">
            <a href={localeHref("/about", locale)} className="transition-colors hover:text-[var(--color-foreground)]">
              {t("nav_about")}
            </a>
            <a href={localeHref("/blog", locale)} className="transition-colors hover:text-[var(--color-foreground)]">
              {t("nav_blog")}
            </a>
            <a href={localeHref("/privacy", locale)} className="transition-colors hover:text-[var(--color-foreground)]">
              {t("nav_privacy")}
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
