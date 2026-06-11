// 服务来源(service provider)的 web 展示层:品牌 icon 声明 + 行内图标 / 徽标组件。
// 基础元数据(id / 名称 / 网址 / 域名)与 CLI 共享自 @keysark/vault 的 SERVICE_PROVIDERS;
// 条目 provider 字段存已知 id(如 "github")或原始域名(未识别的自托管服务)。
import { Globe } from "lucide-react";
import { providerById } from "@keysark/vault";
import { testId } from "@/lib/test-id";

// 品牌 icon(simple-icons 路径,viewBox 0 0 24 24,fill=currentColor)
const ICON_PATHS: Record<string, string> = {
  github:
    "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  gitlab:
    "m23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z",
  bitbucket:
    "M.778 1.213a.768.768 0 00-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 00.77-.646l3.27-20.03a.768.768 0 00-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z",
  gitee:
    "M11.984 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.016 0zm6.09 5.333c.328 0 .593.266.592.593v1.482a.594.594 0 0 1-.593.592H9.777c-.982 0-1.778.796-1.778 1.778v5.63c0 .327.266.592.593.592h5.63c.982 0 1.778-.796 1.778-1.778v-.296a.593.593 0 0 0-.592-.593h-4.15a.592.592 0 0 1-.592-.592v-1.482a.593.593 0 0 1 .593-.592h6.815c.327 0 .593.265.593.592v3.408a4 4 0 0 1-4 4H5.926a.593.593 0 0 1-.593-.593V9.778a4.444 4.444 0 0 1 4.445-4.444h8.296Z",
  codeberg:
    "M11.955.49A12 12 0 0 0 0 12.49a12 12 0 0 0 1.832 6.373L11.838 5.928a.187.14 0 0 1 .324 0l10.006 12.935A12 12 0 0 0 24 12.49a12 12 0 0 0-12-12 12 12 0 0 0-.045 0zm.375 6.467l4.416 16.553a12 12 0 0 0 5.137-4.213z",
};

export interface ProviderDisplay {
  name: string;
  website: string;
  known: boolean; // 是否注册表内的已知服务(否则 provider 即原始域名)
}

/** 条目 provider 字段 → 展示信息;未识别时按原始域名兜底。 */
export function providerDisplay(provider: string): ProviderDisplay {
  const p = providerById(provider);
  if (p) return { name: p.name, website: p.website, known: true };
  return { name: provider, website: `https://${provider}`, known: false };
}

/** 行内小图标:已知服务用品牌 icon,未知域名用通用 Globe。 */
export function ServiceProviderIcon({
  provider,
  className,
}: {
  provider: string;
  className?: string;
}) {
  const path = ICON_PATHS[provider];
  if (!path) return <Globe className={className} aria-hidden />;
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d={path} />
    </svg>
  );
}

/** 条目详情用徽标:icon + 名称,点击打开服务官网。 */
export function ServiceProviderBadge({ provider }: { provider: string }) {
  const d = providerDisplay(provider);
  return (
    <a
      {...testId("vault-item-provider")}
      href={d.website}
      target="_blank"
      rel="noreferrer"
      title={d.website}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]"
    >
      <ServiceProviderIcon provider={provider} className="h-3.5 w-3.5" />
      <span className="max-w-[12rem] truncate">{d.name}</span>
    </a>
  );
}
