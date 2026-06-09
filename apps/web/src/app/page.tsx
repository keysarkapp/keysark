import { getConnectedStorage } from "@/lib/storage";
import { providerFlags } from "@/lib/providers";
import { Landing } from "@/components/landing";
import { VaultPanel } from "@/components/vault-panel";
import {
  LEGACY_META_NAME,
  LEGACY_VAULT_ID,
  REGISTRY_NAME,
  type Registry,
  type VaultDescriptor,
} from "@/lib/registry";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const conn = await getConnectedStorage();
  const { error } = await searchParams;

  if (!conn) {
    // 登录入口由环境变量开关决定(默认仅 Google Drive),详见 @/lib/providers。
    return <Landing error={error} providers={providerFlags()} />;
  }

  let vaults: VaultDescriptor[] = [];
  let user = { name: "", avatar: null as string | null };

  // 用户信息(头像/名称)与存储根文件列表并行拉取。
  // 服务端只读「注册表(明文元数据 + 密文校验块)」用于决定登录界面;
  // 条目本身在客户端解锁后从各库 index.json 解密加载(见 VaultPanel / @/lib/vault)。
  const [infoRes, listRes] = await Promise.allSettled([
    conn.client.userInfo(),
    conn.client.list(""),
  ]);

  if (infoRes.status === "fulfilled") {
    user = infoRes.value;
  }

  if (listRes.status === "fulfilled") {
    const files = listRes.value;
    const regFile = files.find((f) => f.name === REGISTRY_NAME);
    if (regFile) {
      try {
        const bytes = await conn.client.download(regFile.id);
        const reg = JSON.parse(Buffer.from(bytes).toString("utf8")) as Registry;
        if (Array.isArray(reg.vaults)) vaults = reg.vaults;
      } catch (err) {
        console.error("registry read failed", err);
      }
    } else {
      // 历史单库迁移:无注册表但有旧 .keysark.json → 合成一个根目录(dir="")保险库。
      // 旧数据(根 index.json + items/)原样可读;用户新建第二个库时再持久化注册表。
      const legacy = files.find((f) => f.name === LEGACY_META_NAME);
      if (legacy) {
        try {
          const bytes = await conn.client.download(legacy.id);
          vaults = [
            {
              id: LEGACY_VAULT_ID,
              label: "",
              dir: "",
              verifier: Buffer.from(bytes).toString("base64"),
              createdAt: 0,
            },
          ];
        } catch (err) {
          console.error("legacy meta read failed", err);
        }
      }
    }
  }

  return (
    <VaultPanel vaults={vaults} user={user} provider={conn.provider} storageRoot={conn.root} />
  );
}
