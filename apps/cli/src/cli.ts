// keysark —— 命令行管理 items。自带 E2E:本地派生主密钥、本地加解密,
// 只把 envelope 密文经 localhost:35291 中转。明文/助记词/主密钥绝不出 CLI 进程。
import { deriveKey, validateMnemonic } from "@keysark/crypto";
import type { EntryMeta, StorageTransport, Vault, VaultDescriptor } from "@keysark/vault";
import { resolveConn } from "./config";
import { httpTransport } from "./transport";
import { acquireMnemonic, clearSession, saveSession } from "./session";
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
  const portOverride = flagStr(args.flags, "port");
  const conn = resolveConn(portOverride ? Number(portOverride) : undefined);
  if (!conn.desktopRunning && !flagStr(args.flags, "port")) {
    console.error(
      `⚠ 未找到 ~/.keysark/local.json,默认连 ${conn.baseUrl}。桌面应用可能未运行。`,
    );
  }
  return httpTransport(conn.baseUrl, conn.token);
}

/** 取 (key, vault, transport):env/会话助记词 → 派生 → 匹配保险库。 */
async function ready(
  args: Args,
  allowPrompt = true,
): Promise<{ key: CryptoKey; descriptor: VaultDescriptor; vault: Vault; transport: StorageTransport }> {
  const transport = transportFrom(args);
  const mnemonic = await acquireMnemonic(allowPrompt);
  if (!mnemonic) fail("没有可用助记词。设 KEYSARK_MNEMONIC 或先 `keysark login`。");
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

function fmtEntry(e: EntryMeta): string {
  const id = e.id.slice(0, 8);
  const when = e.updatedAt ? new Date(e.updatedAt).toISOString().slice(0, 16).replace("T", " ") : "";
  return `${id}  ${when}  ${e.title || "(无标题)"}`;
}

/** 把短 id / 全 id 解析成条目。 */
function findEntry(vault: Vault, idArg: string): EntryMeta {
  const matches = vault.entries.filter((e) => e.id === idArg || e.id.startsWith(idArg));
  if (matches.length === 0) fail(`找不到条目:${idArg}`);
  if (matches.length > 1) fail(`id 前缀 ${idArg} 不唯一,请给更长的 id。`);
  return matches[0]!;
}

const HELP = `keysark —— E2E 网盘文本保管库 CLI

用法:
  keysark login              校验助记词并在本机记住(本机加密)
  keysark logout             忘记本机记住的助记词
  keysark vaults             列出保险库及匹配情况
  keysark ls                 列出当前保险库的条目
  keysark get <id>           解密并打印某条目
  keysark new --title T [--content C] [--folder F]   新建条目(无 --content 时读 stdin)
  keysark set <id> [--title T] [--content C]          更新条目
  keysark rm <id>            删除条目(从索引摘除)
  keysark sync               重推本地待同步项

全局选项:
  --port <n>     覆盖本地接口端口(默认读 ~/.keysark/local.json,回退 35291)
  --vault <id|label>   指定保险库
环境变量:
  KEYSARK_MNEMONIC   助记词(免交互/免 login)
  KEYSARK_PORT       本地接口端口`;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  switch (args.cmd) {
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;

    case "login": {
      // 校验助记词能匹配到保险库后才记住。
      const { descriptor } = await ready(args, true);
      const mnemonic = (await acquireMnemonic(true))!;
      saveSession(mnemonic);
      console.log(`✓ 已记住。匹配保险库:${descriptor.label || "(默认)"} [${descriptor.id.slice(0, 8)}]`);
      return;
    }

    case "logout":
      clearSession();
      console.log("✓ 已忘记本机助记词。");
      return;

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
      const { checkVerifier } = await import("@keysark/crypto");
      const { b64decode } = await import("@keysark/vault");
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
      for (const e of entries) console.log(fmtEntry(e));
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
      const folderSel = flagStr(args.flags, "folder") ?? null;
      const res = await vault.save({ title, content: content ?? "", folderId: folderSel });
      console.log(
        `✓ 新建 [${res.id.slice(0, 8)}]${res.synced ? " 已同步" : ` (本地,同步失败:${res.syncError})`}`,
      );
      return;
    }

    case "set": {
      const idArg = args.positionals[0];
      if (!idArg) fail("用法:keysark set <id> [--title T] [--content C]");
      const { vault } = await ready(args);
      const meta = findEntry(vault, idArg!);
      const cur = await vault.open(meta.id);
      const title = flagStr(args.flags, "title") ?? cur.title;
      let content = flagStr(args.flags, "content");
      if (content === undefined) content = process.stdin.isTTY ? cur.content : await readStdin();
      const res = await vault.save({ id: meta.id, title, content, folderId: cur.folderId });
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
