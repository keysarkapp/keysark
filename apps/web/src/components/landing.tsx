"use client";

// 未登录落地页:营销 hero(原创 CSS 背景)+「连接百度网盘」CTA。多语言 + 主题切换。
import { Button } from "@keysark/ui";
import { Logo, Wordmark } from "./brand";
import { HeaderControls } from "./controls";
import { useT } from "./providers";
import type { MsgKey } from "@/lib/i18n";
import { testId } from "@/lib/test-id";

const FEATURES: { title: MsgKey; body: MsgKey }[] = [
  { title: "feat_1_title", body: "feat_1_body" },
  { title: "feat_2_title", body: "feat_2_body" },
  { title: "feat_3_title", body: "feat_3_body" },
];

export function Landing({ error, hideBaidu }: { error?: string; hideBaidu?: boolean }) {
  const t = useT();
  const errMsg = error
    ? error === "oauth_state"
      ? t("err_state")
      : error === "oauth_exchange"
        ? t("err_exchange")
        : t("err_default")
    : null;

  return (
    <div {...testId("landing")} className="relative flex min-h-screen flex-col">
      {/* 背景层 */}
      <div className="hero-aurora" aria-hidden="true" />
      <div className="hero-grid" aria-hidden="true" />

      <div className="relative z-10 flex min-h-screen flex-col">
        {/* 顶栏 */}
        <header {...testId("landing-header")} className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <Wordmark className="text-lg" />
          <div className="flex items-center gap-3">
            <HeaderControls />
            <a href="/api/auth/google">
              <Button variant="outline" size="sm">
                {t("nav_connect_google")}
              </Button>
            </a>
            {hideBaidu ? null : (
              <a href="/api/auth/login">
                <Button variant="outline" size="sm">
                  {t("nav_connect")}
                </Button>
              </a>
            )}
          </div>
        </header>

        {/* Hero */}
        <section {...testId("landing-hero")} className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-20 text-center">
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
            {t("hero_subtitle")}
          </p>
          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
            <a href="/api/auth/google">
              <Button size="lg" className="px-8">
                {t("cta_google")}
              </Button>
            </a>
            {hideBaidu ? null : (
              <a href="/api/auth/login">
                <Button size="lg" variant="outline" className="px-8">
                  {t("cta_primary")}
                </Button>
              </a>
            )}
            <a href="#how">
              <Button size="lg" variant="ghost">
                {t("cta_secondary")}
              </Button>
            </a>
          </div>
          {errMsg ? <p className="mt-6 text-sm text-[var(--color-danger)]">{errMsg}</p> : null}
        </section>

        {/* 三特性 */}
        <section
          id="how"
          {...testId("landing-features")}
          className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)]/70 backdrop-blur"
        >
          <div className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-16 sm:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-[calc(var(--radius)+0.25rem)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm"
              >
                <Logo className="h-7 w-7" />
                <h3 className="mt-4 text-base font-semibold tracking-tight">{t(f.title)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  {t(f.body)}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* 页脚 */}
        <footer {...testId("landing-footer")} className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-8 text-xs text-[var(--color-muted-foreground)]">
          <Wordmark className="text-sm font-medium" />
          <span>{t("footer_tagline")}</span>
        </footer>
      </div>
    </div>
  );
}
