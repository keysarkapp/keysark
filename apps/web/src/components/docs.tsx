"use client";

// CLI 使用文档页:双语(随 locale 切换)介绍 ark 命令行客户端的安装、配置、命令与示例。
// 命令片段为纯文本展示 + 复制,不涉及任何密钥/明文。布局沿用落地页的极光背景与配色。
import { Button } from "@keysark/ui";
import { ArrowLeft, Check, Copy, Terminal, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Wordmark } from "./brand";
import { HeaderControls } from "./controls";
import { useT } from "./providers";
import { CLI_VERSION } from "@/lib/build-info";
import type { MsgKey } from "@/lib/i18n";
import { testId } from "@/lib/test-id";

// 命令一览(命令字面量不翻译,描述走 i18n)
const COMMANDS: { cmd: string; desc: MsgKey }[] = [
  { cmd: "ark login", desc: "docs_cmd_login" },
  { cmd: "ark import", desc: "docs_cmd_import" },
  { cmd: "ark status", desc: "docs_cmd_status" },
  { cmd: "ark info", desc: "docs_cmd_info" },
  { cmd: "ark vaults", desc: "docs_cmd_vaults" },
  { cmd: "ark ls", desc: "docs_cmd_ls" },
  { cmd: "ark get <path|id> [file]", desc: "docs_cmd_get" },
  { cmd: "ark new --title <T> [--content <C>] [--folder <p>]", desc: "docs_cmd_new" },
  { cmd: "ark set <id> [--title <T>] [--content <C>] [--folder <p>]", desc: "docs_cmd_set" },
  { cmd: "ark save <file> [target]", desc: "docs_cmd_save" },
  { cmd: "ark rm <id>", desc: "docs_cmd_rm" },
  { cmd: "ark sync [folder]", desc: "docs_cmd_sync" },
  { cmd: "ark logout", desc: "docs_cmd_logout" },
  { cmd: "ark forget", desc: "docs_cmd_forget" },
];

const OPTIONS: { flag: string; desc: MsgKey }[] = [
  { flag: "--server <url>", desc: "docs_opt_server" },
  { flag: "--vault <id|label>", desc: "docs_opt_vault" },
  { flag: "--no-browser", desc: "docs_opt_no_browser" },
];

const ENV_VARS: { name: string; desc: MsgKey }[] = [
  { name: "KEYSARK_SERVER", desc: "docs_env_server" },
  { name: "KEYSARK_MNEMONIC", desc: "docs_env_mnemonic" },
  { name: "KEYSARK_HOME", desc: "docs_env_home" },
  { name: "KEYSARK_NO_BROWSER", desc: "docs_env_no_browser" },
];

// 示例:每条一段说明 + 一段命令(命令字面量不翻译)
const EXAMPLES: { cap: MsgKey; code: string }[] = [
  { cap: "docs_ex_get", code: "ark get github.com/me/app/.env .env" },
  { cap: "docs_ex_save", code: "cd ~/my-project\nark save .env" },
  { cap: "docs_ex_new", code: 'echo "my secret" | ark new --title "Notes" --folder personal' },
  {
    cap: "docs_ex_ci",
    code: 'export KEYSARK_MNEMONIC="word1 word2 … word12"\nark get secure/api-key > key.txt',
  },
];

function CodeBlock({ code, id }: { code: string; id: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div className="relative min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-accent)]">
      <pre className="overflow-x-auto px-3 py-2.5 pr-10 font-mono text-xs leading-relaxed">{code}</pre>
      <button
        type="button"
        onClick={copy}
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-foreground)]"
        aria-label={`copy ${id}`}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-[var(--color-success)]" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function Section({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <section id={id} {...testId(`docs-section-${id}`)} className="scroll-mt-24">
      <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
        {Icon ? <Icon className="h-5 w-5 text-[var(--color-primary)]" aria-hidden="true" /> : null}
        {title}
      </h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function Docs() {
  const t = useT();

  return (
    <div {...testId("docs")} className="relative flex min-h-screen flex-col">
      {/* 背景层(与落地页一致) */}
      <div className="hero-aurora" aria-hidden="true" />
      <div className="hero-grid" aria-hidden="true" />

      <div className="relative z-10 flex min-h-screen flex-col">
        {/* 顶栏 */}
        <header
          {...testId("docs-header")}
          className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-5"
        >
          <a href="/" className="transition-opacity hover:opacity-80">
            <Wordmark className="text-lg" />
          </a>
          <div className="flex items-center gap-3">
            <HeaderControls />
            <a href="/">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                {t("docs_nav_back")}
              </Button>
            </a>
          </div>
        </header>

        {/* 正文 */}
        <main
          {...testId("docs-main")}
          className="mx-auto w-full max-w-4xl flex-1 px-6 py-12"
        >
          {/* Hero */}
          <div {...testId("docs-hero")} className="mb-14">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/80 px-4 py-1.5 text-xs font-medium text-[var(--color-muted-foreground)] shadow-sm backdrop-blur">
              <Terminal className="h-3.5 w-3.5 text-[var(--color-primary)]" />
              ark CLI
            </span>
            <h1 className="mt-5 text-balance text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              {t("docs_title")}
            </h1>
            <p className="mt-4 max-w-2xl text-balance text-lg text-[var(--color-muted-foreground)]">
              {t("docs_subtitle")}
            </p>
          </div>

          <div {...testId("docs-body")} className="space-y-14">
            {/* 这是什么 */}
            <Section id="intro" title={t("docs_intro_title")}>
              <p className="text-[var(--color-muted-foreground)] leading-relaxed">
                {t("docs_intro_body")}
              </p>
            </Section>

            {/* 安装 */}
            <Section id="install" title={t("docs_install_title")}>
              <span
                {...testId("docs-cli-version")}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 font-mono text-xs text-[var(--color-muted-foreground)]"
              >
                <Terminal className="h-3.5 w-3.5" />
                @keysark/cli@{CLI_VERSION}
              </span>
              <CodeBlock code="npm install -g @keysark/cli" id="install" />
              <p className="text-sm text-[var(--color-muted-foreground)]">{t("docs_install_note")}</p>
            </Section>

            {/* 首次配置 */}
            <Section id="setup" title={t("docs_setup_title")}>
              <p className="text-[var(--color-muted-foreground)] leading-relaxed">{t("docs_setup_body")}</p>
              <div className="space-y-1.5">
                <CodeBlock code="ark login" id="login" />
                <p className="text-sm text-[var(--color-muted-foreground)]">{t("docs_setup_login_note")}</p>
              </div>
              <div className="space-y-1.5">
                <CodeBlock code="ark import" id="import" />
                <p className="text-sm text-[var(--color-muted-foreground)]">{t("docs_setup_import_note")}</p>
              </div>
            </Section>

            {/* 命令一览 */}
            <Section id="commands" title={t("docs_commands_title")}>
              <div
                {...testId("docs-commands-table")}
                className="overflow-hidden rounded-[calc(var(--radius)+0.25rem)] border border-[var(--color-border)] bg-[var(--color-surface)]/70 backdrop-blur"
              >
                <ul className="divide-y divide-[var(--color-border)]">
                  {COMMANDS.map((c) => (
                    <li key={c.cmd} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                      <code className="shrink-0 font-mono text-xs text-[var(--color-primary)] sm:w-[19rem]">
                        {c.cmd}
                      </code>
                      <span className="text-sm text-[var(--color-muted-foreground)]">{t(c.desc)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Section>

            {/* 全局选项 */}
            <Section id="options" title={t("docs_options_title")}>
              <div
                {...testId("docs-options-table")}
                className="overflow-hidden rounded-[calc(var(--radius)+0.25rem)] border border-[var(--color-border)] bg-[var(--color-surface)]/70 backdrop-blur"
              >
                <ul className="divide-y divide-[var(--color-border)]">
                  {OPTIONS.map((o) => (
                    <li key={o.flag} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                      <code className="shrink-0 font-mono text-xs text-[var(--color-primary)] sm:w-[19rem]">
                        {o.flag}
                      </code>
                      <span className="text-sm text-[var(--color-muted-foreground)]">{t(o.desc)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Section>

            {/* 常用示例 */}
            <Section id="examples" title={t("docs_examples_title")}>
              {EXAMPLES.map((ex) => (
                <div key={ex.cap} className="space-y-1.5">
                  <p className="text-sm text-[var(--color-muted-foreground)]">{t(ex.cap)}</p>
                  <CodeBlock code={ex.code} id={ex.cap} />
                </div>
              ))}
            </Section>

            {/* 环境变量 */}
            <Section id="env" title={t("docs_env_title")}>
              <div
                {...testId("docs-env-table")}
                className="overflow-hidden rounded-[calc(var(--radius)+0.25rem)] border border-[var(--color-border)] bg-[var(--color-surface)]/70 backdrop-blur"
              >
                <ul className="divide-y divide-[var(--color-border)]">
                  {ENV_VARS.map((e) => (
                    <li key={e.name} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                      <code className="shrink-0 font-mono text-xs text-[var(--color-primary)] sm:w-[19rem]">
                        {e.name}
                      </code>
                      <span className="text-sm text-[var(--color-muted-foreground)]">{t(e.desc)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Section>

            {/* 安全说明 */}
            <Section id="security" title={t("docs_security_title")}>
              <p className="rounded-[calc(var(--radius)+0.25rem)] border border-[var(--color-success)]/30 bg-[var(--color-success)]/8 p-4 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                {t("docs_security_body")}
              </p>
            </Section>
          </div>
        </main>

        {/* 页脚 */}
        <footer
          {...testId("docs-footer")}
          className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-8 text-xs text-[var(--color-muted-foreground)]"
        >
          <Wordmark className="text-sm font-medium" />
          <a href="/" className="transition-colors hover:text-[var(--color-foreground)]">
            {t("docs_nav_back")}
          </a>
        </footer>
      </div>
    </div>
  );
}
