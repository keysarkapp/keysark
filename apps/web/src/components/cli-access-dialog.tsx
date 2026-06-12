"use client";

// 「通过 CLI 下载」对话框:展示 ark CLI 的安装、首次配置与下载当前条目的命令。
// 命令是纯文本展示 + 复制,不涉及任何密钥/明文;解密仍只发生在用户本地。
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@keysark/ui";
import { Check, Copy } from "lucide-react";
import { useT } from "./providers";
import { testId } from "@/lib/test-id";

function CodeBlock({ code, copyKey, copied, onCopy }: { code: string; copyKey: string; copied: boolean; onCopy: (key: string, code: string) => void }) {
  return (
    <div className="relative min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-accent)]">
      <pre className="overflow-x-auto px-3 py-2.5 pr-10 font-mono text-xs leading-relaxed">{code}</pre>
      <button
        type="button"
        onClick={() => onCopy(copyKey, code)}
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-foreground)]"
        aria-label="copy"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-[var(--color-success)]" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export function CliAccessDialog({
  open,
  onOpenChange,
  itemPath,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 条目的完整路径(文件夹路径/标题),ark get 用 */
  itemPath: string;
  title: string;
}) {
  const t = useT();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function copy(key: string, code: string) {
    void navigator.clipboard.writeText(code).then(() => {
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((p) => (p === key ? null : p)), 1500);
    });
  }

  const origin = typeof window === "undefined" ? "https://keysark.com" : window.location.origin;
  const filename = title.split("/").filter(Boolean).pop() || "item.txt";
  const installCmd = "npm install -g @keysark/cli";
  const setupCmd = `ark login --server ${origin}\nark import`;
  // 写到本地文件:已存在且内容不同时 CLI 会要求确认,内容一致则跳过
  const downloadCmd = `ark get '${itemPath}' '${filename}'`;

  const section = "text-xs font-medium text-[var(--color-muted-foreground)]";
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {/* grid 布局下子项默认 min-width:auto,长命令的 <pre> 会把卡片撑爆;min-w-0 让横向滚动接管 */}
      <AlertDialogContent {...testId("vault-cli-access-dialog")} className="sm:max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("cli_dialog_title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("cli_dialog_desc")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div {...testId("vault-cli-access-steps")} className="min-w-0 space-y-3">
          <div className="space-y-1.5">
            <div className={section}>1 · {t("cli_step_install")}</div>
            <CodeBlock code={installCmd} copyKey="install" copied={copiedKey === "install"} onCopy={copy} />
          </div>
          <div className="space-y-1.5">
            <div className={section}>2 · {t("cli_step_setup")}</div>
            <CodeBlock code={setupCmd} copyKey="setup" copied={copiedKey === "setup"} onCopy={copy} />
          </div>
          <div className="space-y-1.5">
            <div className={section}>3 · {t("cli_step_download")}</div>
            <CodeBlock code={downloadCmd} copyKey="download" copied={copiedKey === "download"} onCopy={copy} />
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("btn_close")}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
