// ark(KeysArk CLI)—— 完全独立的命令行客户端:设备码授权登录云端 web 接口,
// 本地派生主密钥、本地加解密,只把 envelope 密文经云端中转。
// 明文/助记词/主密钥/解锁密码绝不出 CLI 进程。
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkVerifier, deriveKey, validateMnemonic } from "@keysark/crypto";
import { b64decode } from "@keysark/vault";
import type { EntryMeta, StorageTransport, Vault, VaultDescriptor } from "@keysark/vault";
import { cliVersion, clearCloud, defaultServer, keysarkDir, loadCloud, resolveConn, saveCloud } from "./config";
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
import { folderPathById, lookupFolderPath, resolveFolderPath } from "./folders";
import { detectSourceProvider, parseSaveTarget, proposeSaveTarget, targetDisplay } from "./save-target";
import { fetchVaults, openVault, pickVault } from "./vault-select";

interface Args {
  cmd: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  // flag 位置无关:`ark --server <url> ls` 与 `ark ls --server <url>` 等价;
  // 第一个非 flag 的 token 即子命令。
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
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
  const [cmd = "help", ...rest] = positionals;
  return { cmd, positionals: rest, flags };
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
  if (!conn.token) fail(`尚未在 ${conn.baseUrl} 登录。先运行 \`ark login\`。`);
  return httpTransport(conn.baseUrl, conn.token!);
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
        : "本机没有助记词。先运行 `ark import` 导入,或设 KEYSARK_MNEMONIC。",
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

const HELP = `ark —— KeysArk E2E 网盘文本保管库 CLI(独立程序,直连云端)

账号:
  ark login              设备码授权登录(浏览器完成,可跨机器;server 用默认或 --server)
  ark logout             登出:吊销令牌、清本机登录态(已导入的助记词凭据保留)
  ark status             显示登录与助记词导入状态
  ark info               显示版本、默认/当前 server 及其来源、配置目录

助记词(只能导入,不能创建;创建请去网页端):
  ark import             导入 12 词助记词:在线校验匹配保险库 → 设置解锁密码(本机加密保存)
  ark forget             忘记本机助记词(删除加密凭据与解锁缓存)

条目:
  ark vaults             列出保险库及匹配情况
  ark ls                 列出当前保险库的条目
  ark get <id>           解密并打印某条目
  ark new --title T [--content C] [--folder a/b]   新建条目(无 --content 时读 stdin)
  ark set <id> [--title T] [--content C] [--folder a/b]   更新条目
                             --folder 为文件夹路径,缺失层级自动创建;"/" 表示根目录
  ark save <source> [target]   上传文本文件为条目;target 形如 a/b/标题(末尾 "/" 表示
                             文件夹,标题用文件名)。省略 target 时自动推导并询问确认:
                             git 仓库内 → origin 去协议 + 仓库内相对路径
                             (如 github.com/me/repo/.env),否则根目录 + 文件名。
                             目标路径已有条目时,保存为该条目的最新版本
  ark rm <id>            删除条目(从索引摘除)
  ark sync               重推本地待同步项

解锁机制(与网页端一致):
  导入时强制设置解锁密码(≥12 位 + ≥3 类字符);助记词经 Argon2id 派生密钥加密存本机。
  输对密码后 15 分钟内免重输(有操作自动续期);过期需重新输入密码。

全局选项(位置无关,可放在子命令前后):
  --server <url>       覆盖云端接口地址;不传时:KEYSARK_SERVER > 登录态 > 内置默认
                       (内置默认 build 时按环境注入:生产 https://keysark.com,本地 dev 端口)
  --vault <id|label>   指定保险库
环境变量:
  KEYSARK_SERVER     云端接口(优先级高于登录态与内置默认)
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
      console.log(cloud ? `登录:✓ ${cloud.server}(${cloud.provider ?? "?"})` : "登录:✗(ark login)");
      console.log(hasCredential() ? "助记词:✓ 已导入(密码加密)" : "助记词:✗(ark import)");
      return;
    }

    case "info": {
      const cloud = loadCloud();
      const conn = resolveConn(flagStr(args.flags, "server"));
      const sourceLabel = {
        "--server": "--server 覆盖",
        KEYSARK_SERVER: "环境变量 KEYSARK_SERVER",
        "cloud.json": "登录态 cloud.json",
        default: "内置默认",
      }[conn.source];
      console.log(`版本:${cliVersion()}`);
      console.log(`默认 server:${defaultServer()}`);
      console.log(`当前 server:${conn.baseUrl}(来源:${sourceLabel})`);
      console.log(cloud ? `登录:✓ ${cloud.server}(${cloud.provider ?? "?"})` : "登录:✗(ark login)");
      console.log(`配置目录:${keysarkDir()}`);
      return;
    }

    case "login": {
      // 设备码授权:生成链接让用户去网页登录确认,本地轮询感知授权完成。
      const server = (
        flagStr(args.flags, "server") ??
        process.env.KEYSARK_SERVER ??
        loadCloud()?.server ??
        defaultServer()
      ).replace(/\/+$/, "");

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
          if (!hasCredential()) console.log("  下一步:ark import 导入助记词。");
          return;
        }
        if (pd.status === "denied") fail("授权被网页侧拒绝。");
        fail("授权已过期或失效,请重新 ark login。");
      }
      console.log();
      fail("等待授权超时,请重新 ark login。");
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
      if (hasCredential()) console.log("  本机助记词凭据保留;如需删除运行 ark forget。");
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
      if (!idArg) fail("用法:ark get <id>");
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
      const fileArg = args.positionals[0];
      const targetArg = args.positionals[1];
      if (!fileArg) fail("用法:ark save <source> [target](target 形如 a/b/标题,可省略)");
      const abs = resolve(fileArg!);
      let bytes: Buffer;
      try {
        bytes = readFileSync(abs);
      } catch (err) {
        fail(`读不到文件 ${abs}:${err instanceof Error ? err.message : err}`);
      }
      if (bytes!.includes(0)) fail(`${abs} 是二进制文件,save 目前只支持文本。`);
      const content = bytes!.toString("utf8");

      // 目标:显式 target 直接解析;省略则自动推导(git origin / 根目录)并征求确认。
      const explicit = targetArg !== undefined;
      const target = explicit ? parseSaveTarget(targetArg!, abs) : proposeSaveTarget(abs);
      if (!target) fail(`target 无效:${targetArg}`);
      // 显式 target 未带出 provider(首段不是已知域名)时,仍按源文件的 git origin 识别。
      if (target!.provider === undefined) target!.provider = detectSourceProvider(abs);
      const { folderPath, title, provider } = target!;

      const { vault } = await ready(args);
      // 只查不建:确认前不能动保险库;任一级文件夹缺失即视为目标不存在。
      const lookedUp = folderPath !== undefined ? lookupFolderPath(vault, folderPath) : null;
      const existing =
        lookedUp !== undefined
          ? vault.entries.find((e) => e.folderId === lookedUp && e.title === title)
          : undefined;

      const display = targetDisplay(target!);
      console.log(`源文件:${abs}`);
      console.log(`目标:${display}${target!.note ? `(${target!.note})` : ""}`);
      if (existing) {
        console.log(
          `目标路径已有条目 [${existing.id.slice(0, 8)}](${existing.versions ?? 1} 个版本),将保存为该条目的最新版本。`,
        );
      }
      if (!explicit) {
        if (process.stdin.isTTY) {
          const a = (await promptVisible("确认保存?[Y/n] ")).trim().toLowerCase();
          if (a && a !== "y" && a !== "yes") {
            console.log("已取消。");
            return;
          }
        } else {
          console.log("(非交互环境,自动确认)");
        }
      }

      const folderId = folderPath !== undefined ? await resolveFolderPath(vault, folderPath) : null;
      const res = await vault.save({ id: existing?.id, title, content, folderId, provider });
      console.log(
        `✓ ${existing ? "更新" : "新建"} ${display} [${res.id.slice(0, 8)}]${provider ? ` (${provider})` : ""}${res.synced ? " 已同步" : ` (本地,同步失败:${res.syncError})`}`,
      );
      return;
    }

    case "set": {
      const idArg = args.positionals[0];
      if (!idArg) fail("用法:ark set <id> [--title T] [--content C] [--folder a/b]");
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
      if (!idArg) fail("用法:ark rm <id>");
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
      fail(`未知命令:${args.cmd}\n运行 \`ark help\` 查看用法。`);
  }
}

main().catch((err) => fail(String(err instanceof Error ? err.message : err)));
