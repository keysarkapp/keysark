// keysark —— 完全独立的命令行客户端:设备码授权登录云端 web 接口,
// 本地派生主密钥、本地加解密,只把 envelope 密文经云端中转。
// 明文/助记词/主密钥/解锁密码绝不出 CLI 进程。
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { checkVerifier, deriveKey, validateMnemonic } from "@keysark/crypto";
import { b64decode, providerForHost } from "@keysark/vault";
import type { EntryMeta, StorageTransport, Vault, VaultDescriptor } from "@keysark/vault";
import { clearCloud, loadCloud, resolveConn, saveCloud } from "./config";
import { httpTransport } from "./transport";
import {
  acquireMnemonic,
  clearCredential,
  hasCredential,
  promptNewPassword,
  promptVisible,
  saveCredential,
  writeUnlockCache,
} from "./credential";
import { folderPathById, resolveFolderPath } from "./folders";
import { gitContext } from "./git";
import { fetchVaults, openVault, pickVault } from "./vault-select";

interface Args {
  cmd: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const [cmd = "help", ...rest] = argv;
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(a);
    }
  }
  return { cmd, positionals, flags };
}

function flagStr(flags: Args["flags"], key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function transportFrom(args: Args): StorageTransport {
  const conn = resolveConn(flagStr(args.flags, "server"));
  if (!conn) fail("未登录。先运行 `keysark login --server <url>` 完成登录。");
  if (!conn.token) fail(`尚未在 ${conn.baseUrl} 登录。先运行 \`keysark login\`。`);
  return httpTransport(conn.baseUrl, conn.token);
}

/** best-effort 打开系统浏览器;失败不报错(用户可手动复制链接)。 */
function tryOpenBrowser(url: string): void {
  const [cmd, cmdArgs] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd as string, cmdArgs as string[], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* 无图形环境等,忽略 */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 取 (key, vault, transport):env/会话助记词 → 派生 → 匹配保险库。 */
async function ready(
  args: Args,
  allowPrompt = true,
): Promise<{ key: CryptoKey; descriptor: VaultDescriptor; vault: Vault; transport: StorageTransport }> {
  const transport = transportFrom(args);
  const mnemonic = await acquireMnemonic(allowPrompt);
  if (!mnemonic) {
    fail(
      hasCredential()
        ? "未解锁(密码未通过或非交互环境)。也可设 KEYSARK_MNEMONIC。"
        : "本机没有助记词。先运行 `keysark import` 导入,或设 KEYSARK_MNEMONIC。",
    );
  }
  if (!validateMnemonic(mnemonic!)) fail("助记词无效(检查 12 词与拼写)。");
  const key = await deriveKey(mnemonic!);
  const vaults = await fetchVaults(transport);
  if (vaults.length === 0) fail("网盘里没有保险库(先在桌面/网页创建)。");
  const descriptor = await pickVault(vaults, key, flagStr(args.flags, "vault"));
  if (!descriptor) fail("助记词不匹配任何保险库(verifier 校验失败)。");
  const vault = openVault(key, descriptor!, transport);
  await vault.load();
  return { key, descriptor: descriptor!, vault, transport };
}

function fmtEntry(e: EntryMeta, folderPath?: string): string {
  const id = e.id.slice(0, 8);
  const when = e.updatedAt ? new Date(e.updatedAt).toISOString().slice(0, 16).replace("T", " ") : "";
  const loc = folderPath ? `  [${folderPath}]` : "";
  const src = e.provider ? `  (${e.provider})` : "";
  return `${id}  ${when}  ${e.title || "(无标题)"}${loc}${src}`;
}

/** 把短 id / 全 id 解析成条目。 */
function findEntry(vault: Vault, idArg: string): EntryMeta {
  const matches = vault.entries.filter((e) => e.id === idArg || e.id.startsWith(idArg));
  if (matches.length === 0) fail(`找不到条目:${idArg}`);
  if (matches.length > 1) fail(`id 前缀 ${idArg} 不唯一,请给更长的 id。`);
  return matches[0]!;
}

const HELP = `keysark —— E2E 网盘文本保管库 CLI(独立程序,直连云端)

账号:
  keysark login [--server <url>]   设备码授权登录(浏览器完成,可跨机器)
  keysark logout                   登出:吊销令牌、清本机登录态(已导入的助记词凭据保留)
  keysark status                   显示登录与助记词导入状态

助记词(只能导入,不能创建;创建请去网页端):
  keysark import             导入 12 词助记词:在线校验匹配保险库 → 设置解锁密码(本机加密保存)
  keysark forget             忘记本机助记词(删除加密凭据与解锁缓存)

条目:
  keysark vaults             列出保险库及匹配情况
  keysark ls                 列出当前保险库的条目
  keysark get <id>           解密并打印某条目
  keysark new --title T [--content C] [--folder a/b]   新建条目(无 --content 时读 stdin)
  keysark set <id> [--title T] [--content C] [--folder a/b]   更新条目
                             --folder 为文件夹路径,缺失层级自动创建;"/" 表示根目录
  keysark save <file> [--git] [--folder a/b] [--title T]   上传文本文件为条目;默认存根目录、
                             标题为文件名;同文件夹同标题则更新(写新版本)
                             --git:按所在仓库 origin 去协议作为文件夹路径
                             (如 github.com/me/repo),标题为仓库内相对路径
  keysark rm <id>            删除条目(从索引摘除)
  keysark sync               重推本地待同步项

解锁机制(与网页端一致):
  导入时强制设置解锁密码(≥12 位 + ≥3 类字符);助记词经 Argon2id 派生密钥加密存本机。
  输对密码后 15 分钟内免重输(有操作自动续期);过期需重新输入密码。

全局选项:
  --server <url>       覆盖云端接口地址
  --vault <id|label>   指定保险库
环境变量:
  KEYSARK_SERVER     云端接口(login 的默认 --server)
  KEYSARK_MNEMONIC   助记词(跳过本机凭据,脚本/CI 用)
  KEYSARK_NO_BROWSER login 时不自动打开浏览器`;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  switch (args.cmd) {
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;

    case "import": {
      // 导入助记词:在线校验必须匹配已有保险库(CLI 不能创建)→ 强制设置解锁密码 → 本机加密保存。
      const transport = transportFrom(args);
      if (!process.stdin.isTTY) fail("import 需要交互终端。");

      const raw = (await promptVisible("输入 12 词助记词(空格分隔):")).trim().replace(/\s+/g, " ");
      if (!validateMnemonic(raw)) fail("助记词无效(检查 12 个词与拼写)。");

      console.log("在线校验中 …");
      const key = await deriveKey(raw);
      const vaults = await fetchVaults(transport);
      if (vaults.length === 0) fail("网盘里没有保险库。CLI 不能创建助记词,请先在网页端创建。");
      const matches: VaultDescriptor[] = [];
      for (const v of vaults) {
        if (await checkVerifier(key, b64decode(v.verifier))) matches.push(v);
      }
      if (matches.length === 0) fail("助记词不匹配任何保险库(verifier 校验失败)。CLI 只能导入已有助记词。");

      const pw = await promptNewPassword();
      await saveCredential(raw, pw);
      writeUnlockCache(raw); // 刚导入视同刚解锁:15 分钟内免密
      const names = matches.map((v) => `${v.label || "(默认)"} [${v.id.slice(0, 8)}]`).join("、");
      console.log(`✓ 已导入并加密保存。匹配保险库:${names}`);
      console.log("  之后的命令会要求解锁密码;输对后 15 分钟内免重输。");
      return;
    }

    case "forget":
      clearCredential();
      console.log("✓ 已忘记本机助记词(凭据与解锁缓存已删除)。");
      return;

    case "status": {
      const cloud = loadCloud();
      console.log(cloud ? `登录:✓ ${cloud.server}(${cloud.provider ?? "?"})` : "登录:✗(keysark login)");
      console.log(hasCredential() ? "助记词:✓ 已导入(密码加密)" : "助记词:✗(keysark import)");
      return;
    }

    case "login": {
      // 设备码授权:生成链接让用户去网页登录确认,本地轮询感知授权完成。
      const server = (
        flagStr(args.flags, "server") ??
        process.env.KEYSARK_SERVER ??
        loadCloud()?.server ??
        ""
      ).replace(/\/+$/, "");
      if (!server) fail("用法:keysark login --server https://your-keysark.example(或设 KEYSARK_SERVER)");

      const res = await fetch(`${server}/api/cli/device`, { method: "POST" }).catch((e) => {
        fail(`无法连接 ${server}:${e instanceof Error ? e.message : e}`);
      });
      if (!res.ok) fail(`发起授权失败:HTTP ${res.status}`);
      const d = (await res.json()) as {
        device_code: string;
        user_code: string;
        verification_url: string;
        interval?: number;
        expires_in?: number;
      };

      console.log(`在浏览器中打开以下链接完成授权(可在任何设备打开):\n`);
      console.log(`  ${d.verification_url}\n`);
      console.log(`核对码:${d.user_code}(请确认网页显示的码与此一致)\n`);
      if (!args.flags["no-browser"] && !process.env.KEYSARK_NO_BROWSER) {
        tryOpenBrowser(d.verification_url);
      }

      const intervalMs = Math.max(2, d.interval ?? 3) * 1000;
      const deadline = Date.now() + (d.expires_in ?? 600) * 1000;
      process.stdout.write("等待网页授权 ");
      while (Date.now() < deadline) {
        await sleep(intervalMs);
        let pd: { status?: string; token?: string; provider?: string } = {};
        try {
          const pr = await fetch(`${server}/api/cli/device/token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device_code: d.device_code }),
          });
          pd = (await pr.json()) as typeof pd;
        } catch {
          process.stdout.write("!"); // 网络抖动,继续轮询
          continue;
        }
        if (pd.status === "pending") {
          process.stdout.write(".");
          continue;
        }
        console.log();
        if (pd.status === "approved" && pd.token) {
          saveCloud({ server, token: pd.token, provider: pd.provider });
          console.log(`✓ 登录成功:${server}(${pd.provider ?? "?"})。`);
          if (!hasCredential()) console.log("  下一步:keysark import 导入助记词。");
          return;
        }
        if (pd.status === "denied") fail("授权被网页侧拒绝。");
        fail("授权已过期或失效,请重新 keysark login。");
      }
      console.log();
      fail("等待授权超时,请重新 keysark login。");
      return;
    }

    case "logout": {
      const cloud = loadCloud();
      if (!cloud) {
        console.log("(未登录)");
        return;
      }
      try {
        // best-effort 吊销服务端令牌;失败也照常清本地登录态。
        await fetch(`${cloud.server}/api/cli/token`, {
          method: "DELETE",
          headers: { "x-keysark-token": cloud.token },
        });
      } catch {
        /* 服务端不可达,本地仍登出 */
      }
      clearCloud();
      console.log(`✓ 已登出 ${cloud.server}(令牌已吊销)。`);
      if (hasCredential()) console.log("  本机助记词凭据保留;如需删除运行 keysark forget。");
      return;
    }

    case "vaults": {
      const transport = transportFrom(args);
      const mnemonic = await acquireMnemonic(true);
      if (!mnemonic || !validateMnemonic(mnemonic)) fail("没有可用/有效助记词。");
      const key = await deriveKey(mnemonic!);
      const vaults = await fetchVaults(transport);
      if (vaults.length === 0) {
        console.log("(无保险库)");
        return;
      }
      for (const v of vaults) {
        const ok = await checkVerifier(key, b64decode(v.verifier));
        console.log(`${ok ? "●" : "○"} ${v.label || "(默认)"}  [${v.id.slice(0, 8)}]  dir=${v.dir || "/"}`);
      }
      return;
    }

    case "ls": {
      const { vault } = await ready(args);
      const entries = vault.entries;
      if (entries.length === 0) {
        console.log("(空)");
        return;
      }
      const paths = folderPathById(vault);
      for (const e of entries) console.log(fmtEntry(e, e.folderId ? paths.get(e.folderId) : undefined));
      return;
    }

    case "get": {
      const idArg = args.positionals[0];
      if (!idArg) fail("用法:keysark get <id>");
      const { vault } = await ready(args);
      const meta = findEntry(vault, idArg!);
      const doc = await vault.open(meta.id);
      console.log(`# ${doc.title || "(无标题)"}\n`);
      console.log(doc.content);
      return;
    }

    case "new": {
      const title = flagStr(args.flags, "title") ?? "";
      let content = flagStr(args.flags, "content");
      if (content === undefined) content = await readStdin();
      const { vault } = await ready(args);
      const folderPath = flagStr(args.flags, "folder");
      const folderId = folderPath !== undefined ? await resolveFolderPath(vault, folderPath) : null;
      const res = await vault.save({ title, content: content ?? "", folderId });
      console.log(
        `✓ 新建 [${res.id.slice(0, 8)}]${res.synced ? " 已同步" : ` (本地,同步失败:${res.syncError})`}`,
      );
      return;
    }

    case "save": {
      const gitRaw = args.flags["git"];
      let fileArg = args.positionals[0];
      // parseArgs 会把 `--git ./.env` 里的文件名吃成 --git 的值,这里收回来。
      if (fileArg === undefined && typeof gitRaw === "string") fileArg = gitRaw;
      if (!fileArg) fail("用法:keysark save <file> [--git] [--folder a/b] [--title T]");
      const abs = resolve(fileArg!);
      let bytes: Buffer;
      try {
        bytes = readFileSync(abs);
      } catch (err) {
        fail(`读不到文件 ${abs}:${err instanceof Error ? err.message : err}`);
      }
      if (bytes!.includes(0)) fail(`${abs} 是二进制文件,save 目前只支持文本。`);
      const content = bytes!.toString("utf8");

      // 文件夹路径:--folder 优先;--git 时探测所在仓库 origin(去协议);默认根目录。
      // 标题:--title 优先;--git 命中仓库时用相对仓库根的路径;默认文件名。
      let folderPath = flagStr(args.flags, "folder");
      let title = flagStr(args.flags, "title");
      let provider: string | undefined;
      if (folderPath === undefined && gitRaw !== undefined) {
        const git = gitContext(dirname(abs));
        if (git) {
          folderPath = git.originPath;
          title ??= relative(git.repoRoot, abs);
          // 来源服务:按 origin 域名识别(github/gitlab/…);未识别存原始域名。
          const host = git.originPath.split("/")[0]!;
          provider = providerForHost(host)?.id ?? host;
        } else {
          console.error("! --git:文件不在 git 仓库内或无 origin,存入根目录。");
        }
      }
      title ??= basename(abs);

      const { vault } = await ready(args);
      const folderId = folderPath !== undefined ? await resolveFolderPath(vault, folderPath) : null;
      // 同文件夹同标题 → 更新该条目(写新版本);否则新建。
      const existing = vault.entries.find((e) => e.folderId === folderId && e.title === title);
      const res = await vault.save({ id: existing?.id, title, content, folderId, provider });
      const where = folderPath ? `${folderPath}/` : "/";
      console.log(
        `✓ ${existing ? "更新" : "新建"} ${where}${title} [${res.id.slice(0, 8)}]${provider ? ` (${provider})` : ""}${res.synced ? " 已同步" : ` (本地,同步失败:${res.syncError})`}`,
      );
      return;
    }

    case "set": {
      const idArg = args.positionals[0];
      if (!idArg) fail("用法:keysark set <id> [--title T] [--content C] [--folder a/b]");
      const { vault } = await ready(args);
      const meta = findEntry(vault, idArg!);
      const cur = await vault.open(meta.id);
      const title = flagStr(args.flags, "title") ?? cur.title;
      let content = flagStr(args.flags, "content");
      if (content === undefined) content = process.stdin.isTTY ? cur.content : await readStdin();
      const folderPath = flagStr(args.flags, "folder");
      const folderId =
        folderPath !== undefined ? await resolveFolderPath(vault, folderPath) : cur.folderId;
      const res = await vault.save({ id: meta.id, title, content, folderId });
      console.log(`✓ 更新 [${meta.id.slice(0, 8)}]${res.synced ? " 已同步" : ` (本地:${res.syncError})`}`);
      return;
    }

    case "rm": {
      const idArg = args.positionals[0];
      if (!idArg) fail("用法:keysark rm <id>");
      const { vault } = await ready(args);
      const meta = findEntry(vault, idArg!);
      const res = await vault.remove(meta.id);
      console.log(`✓ 删除 [${meta.id.slice(0, 8)}]${res.synced ? " 已同步" : ` (本地:${res.syncError})`}`);
      return;
    }

    case "sync": {
      const { vault } = await ready(args);
      const { remaining } = await vault.sync();
      console.log(remaining === 0 ? "✓ 全部已同步" : `还剩 ${remaining} 项待同步`);
      return;
    }

    default:
      fail(`未知命令:${args.cmd}\n运行 \`keysark help\` 查看用法。`);
  }
}

main().catch((err) => fail(String(err instanceof Error ? err.message : err)));
