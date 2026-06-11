// 服务来源(service provider)注册表:CLI 按域名识别,web 按 id 叠加 icon 展示。
// 不含 icon(UI 资产留给 web 层声明),这里只有跨端共享的元数据。

export interface ServiceProvider {
  id: string; // 稳定 id,存进条目 provider 字段
  name: string; // 展示名
  website: string; // 官网
  domains: string[]; // 识别域名:精确匹配或其子域名
}

export const SERVICE_PROVIDERS: ServiceProvider[] = [
  { id: "github", name: "GitHub", website: "https://github.com", domains: ["github.com"] },
  { id: "gitlab", name: "GitLab", website: "https://gitlab.com", domains: ["gitlab.com"] },
  { id: "bitbucket", name: "Bitbucket", website: "https://bitbucket.org", domains: ["bitbucket.org"] },
  { id: "gitee", name: "Gitee", website: "https://gitee.com", domains: ["gitee.com"] },
  { id: "codeberg", name: "Codeberg", website: "https://codeberg.org", domains: ["codeberg.org"] },
];

/** 按 id 取已知 provider;未知返回 undefined。 */
export function providerById(id: string): ServiceProvider | undefined {
  return SERVICE_PROVIDERS.find((p) => p.id === id);
}

/** 按主机名识别 provider(host 本身或其子域名);未识别返回 undefined。 */
export function providerForHost(host: string): ServiceProvider | undefined {
  const h = host.trim().toLowerCase();
  if (!h) return undefined;
  return SERVICE_PROVIDERS.find((p) => p.domains.some((d) => h === d || h.endsWith(`.${d}`)));
}
