// ark(KeysArk CLI)—— 完全独立的命令行客户端:设备码授权登录云端 web 接口,
// 本地派生主密钥、本地加解密,只把 envelope 密文经云端中转。
// 明文/助记词/主密钥/解锁密码绝不出 CLI 进程。
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { checkVerifier, deriveKey, sha256Hex, validateMnemonic } from "@keysark/crypto";
import { b64decode, vaultVerifierAad } from "@keysark/vault";
import type { EntryMeta, StorageTransport, Vault, VaultDescriptor } from "@keysark/vault";
import { openLocalSource } from "./local";
import { renderVaultHtml, type ExportData, type ExportItem } from "./export-html";
import { cliVersion, clearCloud, defaultServer, keysarkDir, loadCloud, normalizeServer, resolveConn, saveCloud } from "./config";
import { checkSecurePerms, fixCommands } from "./fsperm";
import { httpTransport } from "./transport";
import {
  acquireMnemonic,
  clearCredential,
  hasCredential,
  promptNewPassword,
  saveCredential,
  writeUnlockCache,
} from "./credential";
import { ERR, OK, bold, cyan, dim, green, red, yellow } from "./colors";
import { folderPathById, lookupFolderPath, resolveFolderPath } from "./folders";
import { gitContext } from "./git";
import { detectSourceProvider, parseSaveTarget, proposeSaveTarget, targetDisplay } from "./save-target";
import { askConfirm, askSecretText, askSelect, askText, note, spinner } from "./ui";
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
  console.error(red(`✗ ${msg}`));
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
  if (!conn.token) fail(`Not logged in to ${conn.baseUrl}. Run \`ark login\`.`);
  // token 绑定 issuer:不把它发往别的 server(防发到错误/恶意服务端)。
  if (!conn.tokenUsableHere) {
    if (!conn.issuer) {
      fail(
        `Saved login is from an older KeysArk CLI and is not bound to a server. ` +
          `Re-run \`ark login\` for ${conn.baseUrl}.`,
      );
    }
    fail(
      `Token was issued for ${conn.issuer}, not ${conn.baseUrl}. ` +
        `Re-run \`ark login\` for ${conn.baseUrl}, or target the original server.`,
    );
  }
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

/** 取 (key, vault, transport):env/会话助记词 → 派生 → 匹配保险库。
 *  forcePassword=true 跳过解锁缓存、每次强制输密码(敏感操作如 get)。 */
async function ready(
  args: Args,
  allowPrompt = true,
  forcePassword = false,
): Promise<{ key: CryptoKey; descriptor: VaultDescriptor; vault: Vault; transport: StorageTransport }> {
  const transport = transportFrom(args);
  const mnemonic = await acquireMnemonic(allowPrompt, forcePassword);
  if (!mnemonic) {
    fail(
      hasCredential()
        ? "Locked (wrong password or non-interactive). Or set KEYSARK_MNEMONIC."
        : "No mnemonic on this machine. Run `ark import` or set KEYSARK_MNEMONIC.",
    );
  }
  if (!validateMnemonic(mnemonic!)) fail("Invalid mnemonic (check the words).");
  const key = await deriveKey(mnemonic!);
  const vaults = await fetchVaults(transport);
  if (vaults.length === 0) fail("No vaults found. Create one on the web first.");
  const descriptor = await pickVault(vaults, key, flagStr(args.flags, "vault"));
  if (!descriptor) fail("Mnemonic does not match any vault.");
  const vault = openVault(key, descriptor!, transport);
  await vault.load();
  return { key, descriptor: descriptor!, vault, transport };
}

function fmtEntry(e: EntryMeta, folderPath?: string): string {
  const id = cyan(e.id.slice(0, 8));
  const when = dim(e.updatedAt ? new Date(e.updatedAt).toISOString().slice(0, 16).replace("T", " ") : "");
  const loc = folderPath ? dim(`  [${folderPath}]`) : "";
  const src = e.provider ? yellow(`  (${e.provider})`) : "";
  return `${id}  ${when}  ${e.title || "(untitled)"}${loc}${src}`;
}

/** 把短 id / 全 id 解析成条目。 */
function findEntry(vault: Vault, idArg: string): EntryMeta {
  const matches = vault.entries.filter((e) => e.id === idArg || e.id.startsWith(idArg));
  if (matches.length === 0) fail(`No item: ${idArg}`);
  if (matches.length > 1) fail(`Ambiguous id prefix: ${idArg}`);
  return matches[0]!;
}

/** 按文件路径(a/b/title;末段为标题)找条目;路径中任一级文件夹不存在则视为无匹配。 */
function findByPath(vault: Vault, path: string): EntryMeta[] {
  const segs = path
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segs.length === 0) return [];
  const title = segs.pop()!;
  const folderId = segs.length ? lookupFolderPath(vault, segs.join("/")) : null;
  if (folderId === undefined) return [];
  return vault.entries.filter((e) => e.folderId === folderId && e.title === title);
}

/**
 * get 的条目定位:优先按路径;无匹配再按 id/前缀回退(兼容旧脚本)。
 * 路径并非强约束唯一(网页端可建同名),撞名时 TTY 让用户挑,非 TTY 报错列出 id。
 */
async function resolveEntryArg(vault: Vault, arg: string): Promise<EntryMeta> {
  let matches = findByPath(vault, arg);
  if (matches.length === 0) {
    matches = vault.entries.filter((e) => e.id === arg || e.id.startsWith(arg));
  }
  if (matches.length === 0) fail(`No item at: ${arg}`);
  if (matches.length === 1) return matches[0]!;
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const picked = await askSelect(
      `${matches.length} items match — pick one`,
      matches.map((m) => ({
        value: m.id,
        label: `${m.title || "(untitled)"}  [${m.id.slice(0, 8)}]`,
        hint: `updated ${new Date(m.updatedAt).toISOString().slice(0, 16).replace("T", " ")}`,
      })),
    );
    return matches.find((m) => m.id === picked)!;
  }
  fail(`Ambiguous path: ${matches.length} items match (${matches.map((m) => m.id.slice(0, 8)).join(", ")})`);
}

// ── 批量同步清单(.keysark) ───────────────────────────────────────────────────
// 在云端 <git-origin>/.keysark(每行一个仓库内相对路径)里声明「这个项目要同步哪些文件」。
// `ark save`(无参)按清单把本地文件批量加密上传;`ark get`(无参)按清单批量拉回本地。
// 清单只列路径、不含密钥,可安全提交进仓库;用 `ark save .keysark` 把它本身存上云端。
const MANIFEST_NAMES = [".keysark", ".ark"];
const MANIFEST_DOCS = "https://keysark.com/docs#batch-sync";

/** 清单解析:逐行 trim,跳过空行与 `#` 注释,去掉前导 ./ 与 /。 */
function parseManifest(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .map((l) => l.replace(/^\.?\/+/, ""))
    .filter(Boolean);
}

/** 条目按「文件夹 + 标题」直接定位(与 save 的存法一致:标题可含 `/`,不拆成多级文件夹)。 */
function entryAt(vault: Vault, folderId: string | null | undefined, title: string): EntryMeta | undefined {
  if (folderId === undefined) return undefined;
  return vault.entries.find((e) => e.folderId === folderId && e.title === title);
}

/** 在 <origin> 文件夹下找清单条目(.keysark 优先,.ark 兼容)。 */
function findManifestEntry(vault: Vault, originPath: string): EntryMeta | undefined {
  const folderId = lookupFolderPath(vault, originPath);
  if (folderId === undefined) return undefined;
  for (const name of MANIFEST_NAMES) {
    const e = entryAt(vault, folderId, name);
    if (e) return e;
  }
  return undefined;
}

/** 提示用户定义清单(并给出文档链接)。 */
function manifestHint(cmd: "save" | "get", originPath: string): void {
  note(
    `No ${bold(".keysark")} found for ${bold(originPath)}.\n` +
      `List the files to sync (one repo-relative path per line) in a ${bold(".keysark")},\n` +
      `then run ${cyan("ark save .keysark")} to define it. After that:\n` +
      `  ${cyan("ark save")}  ${dim("syncs all listed files up")}\n` +
      `  ${cyan("ark get")}   ${dim("pulls them all back down")}\n` +
      `${dim(MANIFEST_DOCS)}`,
    `ark ${cmd}`,
  );
}

/** `ark save`(无参):读云端 <origin>/.keysark,把清单里每个本地文件批量加密上传。 */
async function runSaveManifest(args: Args): Promise<void> {
  const git = gitContext(process.cwd());
  if (!git) {
    fail(
      "Not in a git repo — specify a file to save: `ark save <source> [target]`.\n" +
        "(Batch sync without arguments only works inside a git repo, where the project\n" +
        " is detected from its origin to find .keysark in the vault.)",
    );
  }
  const { originPath, repoRoot } = git!;
  const { vault } = await ready(args);

  const manifest = findManifestEntry(vault, originPath);
  if (!manifest) {
    manifestHint("save", originPath);
    return;
  }
  const paths = parseManifest((await vault.open(manifest.id)).content);
  if (paths.length === 0) {
    console.log(yellow(".keysark is empty; nothing to sync."));
    return;
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let missing = 0;
  for (const rel of paths) {
    const abs = join(repoRoot, rel);
    if (!existsSync(abs) || statSync(abs).isDirectory()) {
      console.log(`${ERR} ${rel} ${dim("(not found locally)")}`);
      missing++;
      continue;
    }
    const bytes = readFileSync(abs);
    if (bytes.includes(0)) {
      console.log(`${yellow("!")} ${rel} ${dim("(binary; skipped)")}`);
      skipped++;
      continue;
    }
    const content = bytes.toString("utf8");
    const target = proposeSaveTarget(abs);
    target.provider ??= detectSourceProvider(abs);
    const { folderPath, title, provider } = target;
    const folderId = folderPath !== undefined ? lookupFolderPath(vault, folderPath) : null;
    const existing = entryAt(vault, folderId, title);
    if (
      existing?.contentHash &&
      existing.contentHash === (await sha256Hex(new TextEncoder().encode(content)))
    ) {
      console.log(`${dim("=")} ${targetDisplay(target)} ${dim("(up to date)")}`);
      unchanged++;
      continue;
    }
    const resolvedFolder = folderPath !== undefined ? await resolveFolderPath(vault, folderPath) : null;
    const res = await vault.save({ id: existing?.id, title, content, folderId: resolvedFolder, provider });
    if (existing) updated++;
    else created++;
    console.log(
      `${OK} ${existing ? "updated" : "created"} ${bold(targetDisplay(target))}${res.synced ? "" : red(" (local; sync failed)")}`,
    );
  }
  console.log(
    dim(`— ${created} created · ${updated} updated · ${unchanged} up-to-date · ${skipped} skipped · ${missing} missing`),
  );
}

/** `ark get`(无参):读云端 <origin>/.keysark,把清单里的条目批量拉回本地仓库对应路径。 */
async function runGetManifest(args: Args): Promise<void> {
  const git = gitContext(process.cwd());
  if (!git) {
    fail(
      "Not in a git repo — specify a path to get: `ark get <path> [local-file]`.\n" +
        "(Batch pull without arguments only works inside a git repo, where the project\n" +
        " is detected from its origin to find .keysark in the vault.)",
    );
  }
  const { originPath, repoRoot } = git!;
  const force = args.flags.force === true || args.flags.force === "true";
  // get 是敏感读取:整批只解锁一次,强制密码。
  const { vault } = await ready(args, true, true);

  const manifest = findManifestEntry(vault, originPath);
  if (!manifest) {
    manifestHint("get", originPath);
    return;
  }
  const paths = parseManifest((await vault.open(manifest.id)).content);
  if (paths.length === 0) {
    console.log(yellow(".keysark is empty; nothing to pull."));
    return;
  }

  const folderId = lookupFolderPath(vault, originPath);
  let written = 0;
  let upToDate = 0;
  let differ = 0;
  let missing = 0;
  for (const rel of paths) {
    const entry = entryAt(vault, folderId, rel);
    if (!entry) {
      console.log(`${ERR} ${rel} ${dim("(not in vault)")}`);
      missing++;
      continue;
    }
    const doc = await vault.open(entry.id);
    const dest = join(repoRoot, rel);
    if (existsSync(dest)) {
      if (readFileSync(dest).toString("utf8") === doc.content) {
        console.log(`${dim("=")} ${rel} ${dim("(up to date)")}`);
        upToDate++;
        continue;
      }
      if (!force) {
        console.log(`${yellow("!")} ${rel} ${dim("(differs; --force to overwrite)")}`);
        differ++;
        continue;
      }
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, doc.content);
    console.log(`${OK} ${bold(rel)} ${dim(`(${Buffer.byteLength(doc.content)} B)`)}`);
    written++;
  }
  console.log(
    dim(`— ${written} written · ${upToDate} up-to-date · ${differ} differ (skipped) · ${missing} missing`),
  );
}

/** 文件名安全化:去掉路径分隔符与控制字符,空则回退。 */
function safeName(name: string, fallback: string): string {
  const s = name.replace(/[\/\\]+/g, "_").replace(/[\x00-\x1f]/g, "").trim();
  return s || fallback;
}

/**
 * 本地模式:把一份从网盘下载的备份(.zip 或解压目录)在本机离线解密,
 * 把每个条目导出为 JSON,并生成一个自包含的可视化 HTML。明文只落到本机输出目录。
 */
async function runLocal(srcArg: string, args: Args): Promise<void> {
  const src = resolve(srcArg);
  if (!existsSync(src)) fail(`No such file or directory: ${src}`);

  let source: ReturnType<typeof openLocalSource>;
  try {
    source = openLocalSource(src);
  } catch (err) {
    fail(`Cannot read backup: ${err instanceof Error ? err.message : err}`);
  }
  const { transport, kind } = source!;

  const vaults = await fetchVaults(transport).catch((err) => {
    fail(`Not a KeysArk backup: ${err instanceof Error ? err.message : err}`);
  });
  if (vaults!.length === 0) fail("No vaults found in this backup.");

  // 助记词:env(脚本)优先,否则交互输入。绝不落盘、绝不出本进程。
  const env = process.env.KEYSARK_MNEMONIC?.trim();
  let mnemonic = env ? env.replace(/\s+/g, " ") : "";
  if (!mnemonic) {
    if (!process.stdin.isTTY) fail("Set KEYSARK_MNEMONIC or run in an interactive terminal.");
    note(
      `${dim("backup")}  ${src} ${dim(`(${kind})`)}\n${dim("vaults")}  ${vaults!
        .map((v) => `${v.label || "(default)"} [${v.id.slice(0, 8)}]`)
        .join(", ")}`,
      "ark local",
    );
    mnemonic = (
      await askSecretText("Enter the vault's recovery phrase (mnemonic)", (v) =>
        validateMnemonic(v.trim().replace(/\s+/g, " ")) ? undefined : "Invalid mnemonic (check the words)",
      )
    )
      .trim()
      .replace(/\s+/g, " ");
  }
  if (!validateMnemonic(mnemonic)) fail("Invalid mnemonic (check the words).");

  const key = await deriveKey(mnemonic);
  const descriptor = await pickVault(vaults!, key, flagStr(args.flags, "vault"));
  if (!descriptor) fail("Mnemonic does not match any vault in this backup.");
  const vault = openVault(key, descriptor!, transport);
  await vault.load();

  // 输出目录:--out,否则在源旁建 <名字>-decrypted。
  const defaultBase = `${basename(src, kind === "zip" ? extname(src) : "")}-decrypted`;
  const outDir = resolve(flagStr(args.flags, "out") ?? join(dirname(src), defaultBase));
  const itemsDir = join(outDir, "items");
  const filesDir = join(outDir, "files");
  mkdirSync(itemsDir, { recursive: true });

  const paths = folderPathById(vault);
  const entries = vault.entries;
  const sp = process.stdout.isTTY ? spinner() : null;
  if (sp) sp.start(`Decrypting ${entries.length} items…`);

  const exported: ExportItem[] = [];
  const docsForJson: unknown[] = [];
  const failures: { id: string; title: string; error: string }[] = [];

  for (const meta of entries) {
    const folderPath = meta.folderId ? paths.get(meta.folderId) ?? "" : "";
    if (sp) sp.message(`Decrypting ${meta.title || meta.id.slice(0, 8)}…`);
    try {
      const doc = await vault.open(meta.id); // 解密当前版元信息/文本正文
      const base: ExportItem = {
        id: meta.id,
        title: doc.title ?? meta.title ?? "",
        folderPath,
        kind: meta.kind === "file" ? "file" : "text",
        createdAt: doc.createdAt ?? meta.createdAt,
        updatedAt: doc.updatedAt ?? meta.updatedAt,
        provider: meta.provider,
        versions: meta.versions,
      };

      if (meta.kind === "file") {
        const bytes = await vault.openFile(meta.id);
        mkdirSync(filesDir, { recursive: true });
        const fname = `${meta.id.slice(0, 8)}-${safeName(doc.filename ?? meta.filename ?? "file", "file")}`;
        writeFileSync(join(filesDir, fname), bytes);
        base.filename = doc.filename ?? meta.filename;
        base.mimeType = doc.mimeType ?? meta.mimeType;
        base.fileSize = doc.fileSize ?? meta.fileSize ?? bytes.byteLength;
        base.fileHref = `files/${fname}`;
      } else {
        base.content = doc.content ?? "";
      }

      exported.push(base);
      const jsonDoc = { ...doc, folderPath };
      docsForJson.push(jsonDoc);
      writeFileSync(join(itemsDir, `${meta.id}.json`), JSON.stringify(jsonDoc, null, 2));
    } catch (err) {
      failures.push({ id: meta.id, title: meta.title, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const data: ExportData = {
    vaultLabel: descriptor!.label,
    vaultId: descriptor!.id,
    source: src,
    exportedAt: Date.now(),
    version: cliVersion(),
    items: exported,
  };
  const htmlPath = join(outDir, "index.html");
  writeFileSync(htmlPath, renderVaultHtml(data));
  writeFileSync(join(outDir, "items.json"), JSON.stringify(docsForJson, null, 2));

  if (sp) sp.stop();
  console.log(`${OK} Decrypted ${green(String(exported.length))} item${exported.length === 1 ? "" : "s"} → ${bold(outDir)}`);
  console.log(`  ${dim("items:")} ${cyan(`${outDir}/items/*.json`)} ${dim("(+ items.json)")}`);
  console.log(`  ${dim("html: ")} ${cyan(htmlPath)}`);
  if (failures.length) {
    console.log(red(`  ${failures.length} item(s) failed to decrypt:`));
    for (const f of failures) console.log(red(`    [${f.id.slice(0, 8)}] ${f.title || "(untitled)"}: ${f.error}`));
  }
}

const HELP = `ark — KeysArk end-to-end encrypted vault CLI

Account:
  ark login              Device-code login via browser
  ark logout             Revoke token, clear local login (mnemonic credential kept)
  ark status             Show login and mnemonic status
  ark info               Show version, server (and its source), config dir

Mnemonic (import only; create one on the web):
  ark import             Import recovery phrase (mnemonic) and set an unlock password
  ark forget             Remove local mnemonic credential and unlock cache

Items:
  ark vaults             List vaults and key match
  ark ls                 List items
  ark get <path> [local]   Decrypt an item by path (a/b/title; id prefix also works).
                         Always prompts for the unlock password (ignores the 5-min
                         cache); KEYSARK_MNEMONIC still bypasses for scripts.
                         No local: prints to stdout. But when the path belongs to the
                         git repo you're in (github.com/owner/repo/<rel>), it restores
                         the file to that repo-relative path instead — so you can omit
                         the local arg. Pipe/redirect still streams to stdout for scripts.
                         With local: write the file — asks before overwriting a
                         different file, skips when identical; a directory keeps
                         the item's filename
  ark get                Batch pull: inside a git repo, reads <origin>/.keysark in the
                         vault and writes every listed file into the repo. Skips files
                         that already match; --force overwrites ones that differ.
  ark new --title T [--content C] [--folder a/b]   Create item (no --content: reads stdin)
  ark set <id> [--title T] [--content C] [--folder a/b]   Update item
                         --folder is a path; missing levels are created; "/" = root
  ark save <source> [target]   Upload a text file. target = a/b/title; trailing "/"
                         keeps the filename. Without target: detected from git origin
                         (e.g. github.com/me/repo/.env) or root + filename —
                         Enter to accept, or type a custom target (q cancels).
                         Existing target → new version; identical content → skipped
  ark save               Batch sync: inside a git repo, reads <origin>/.keysark in the
                         vault (one repo-relative path per line) and uploads every
                         listed file. Unchanged files are skipped. Define the manifest
                         once with \`ark save .keysark\`.
  ark rm <id>            Delete item
  ark sync               Re-push pending local changes

Local (offline; no login):
  ark local <zip|dir> [--out <dir>]   Decrypt a backup downloaded from your netdisk
                         (a .zip of the KeysArk folder, or its extracted directory).
                         Prompts for the vault's recovery phrase, then writes one
                         JSON per item plus a self-contained index.html. Everything
                         stays on this machine — nothing is uploaded.
  ark <zip|dir>          Shorthand: a path argument runs \`ark local\` directly.

Unlock (same rules as the web app):
  Mnemonic is stored encrypted with an unlock password (12+ chars, 3+ char classes,
  Argon2id). A correct password unlocks until 5 min of inactivity (sliding renewal).

Global options (position-independent):
  --server <url>       API base; default: KEYSARK_SERVER, else https://keysark.com
  --vault <id|label>   Select vault
Env:
  KEYSARK_SERVER     API base (overrides the built-in default)
  KEYSARK_MNEMONIC   Mnemonic (skips local credential; for scripts/CI)
  KEYSARK_NO_BROWSER Don't auto-open the browser on login`;

/** 打印帮助:节标题加粗,命令、选项与环境变量名上色(HELP 文本本身保持纯文本)。 */
function printHelp(): void {
  for (const line of HELP.split("\n")) {
    if (line.startsWith("ark — ")) {
      console.log(bold("ark") + line.slice(3));
    } else if (/^\S.*:$/.test(line)) {
      console.log(bold(line));
    } else {
      console.log(
        line
          .replace(/^(  ark(?: \S+)+?)(  )/, (_m, a: string, sp: string) => cyan(a) + sp)
          .replace(/^(  (?:--\S+|KEYSARK_\S+))/, (_m, a: string) => cyan(a)),
      );
    }
  }
}

// ~/.keysark 下的敏感本地文件:启动守卫每次复核并修正权限(目录 0700 / 文件 0600)。
const SENSITIVE_FILES = ["credential.json", "unlock-cache.json", "cloud.json", "device.key"];

// 每条命令执行前统一加固本地权限;改不动则给出 chmod 命令、要求用户修好后重跑。
function guardLocalPerms(): void {
  const dir = keysarkDir();
  const fails = checkSecurePerms(
    dir,
    SENSITIVE_FILES.map((f) => join(dir, f)),
  );
  if (fails.length === 0) return;
  console.error(red(`✗ Insecure permissions under ${dir} and they couldn't be fixed automatically.`));
  console.error(dim("  Run these, then re-run your command:"));
  for (const cmd of fixCommands(fails)) console.error(`    ${cyan(cmd)}`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  switch (args.cmd) {
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
  }

  guardLocalPerms(); // help 之外的命令都先复核本地文件权限

  switch (args.cmd) {
    case "import": {
      // 导入助记词:在线校验必须匹配已有保险库(CLI 不能创建)→ 强制设置解锁密码 → 本机加密保存。
      const transport = transportFrom(args);
      if (!process.stdin.isTTY) fail("import requires an interactive terminal.");

      const raw = (
        await askSecretText("Enter recovery phrase (mnemonic)", (v) =>
          validateMnemonic(v.trim().replace(/\s+/g, " ")) ? undefined : "Invalid mnemonic (check the words)",
        )
      )
        .trim()
        .replace(/\s+/g, " ");

      console.log(dim("Verifying…"));
      const key = await deriveKey(raw);
      const vaults = await fetchVaults(transport);
      if (vaults.length === 0) fail("No vaults found. Create one on the web first.");
      const matches: VaultDescriptor[] = [];
      for (const v of vaults) {
        if (await checkVerifier(key, b64decode(v.verifier), vaultVerifierAad(v.id, v.dir))) matches.push(v);
      }
      if (matches.length === 0) fail("Mnemonic does not match any vault.");

      const pw = await promptNewPassword();
      const spSave = process.stdout.isTTY ? spinner() : null;
      spSave?.start("Encrypting credential…"); // Argon2id(512MB)~1-2s
      await saveCredential(raw, pw);
      spSave?.stop();
      writeUnlockCache(raw); // 刚导入视同刚解锁:5 分钟无操作内免密
      const names = matches.map((v) => `${v.label || "(default)"} [${v.id.slice(0, 8)}]`).join(", ");
      console.log(`${OK} Imported. Matched vaults: ${names}`);
      console.log(dim("  Commands will ask for the unlock password (cached, 5-min idle)."));
      return;
    }

    case "forget":
      clearCredential();
      console.log(`${OK} Local mnemonic credential removed.`);
      return;

    case "status": {
      const cloud = loadCloud();
      console.log(cloud ? `Login: ${OK} ${dim(`(${cloud.provider ?? "?"})`)}` : `Login: ${ERR} ${dim("(run `ark login`)")}`);
      console.log(hasCredential() ? `Mnemonic: ${OK} ${dim("imported (encrypted)")}` : `Mnemonic: ${ERR} ${dim("(run `ark import`)")}`);
      return;
    }

    case "info": {
      const cloud = loadCloud();
      const conn = resolveConn(flagStr(args.flags, "server"));
      const sourceLabel = {
        "--server": "--server flag",
        KEYSARK_SERVER: "KEYSARK_SERVER env",
        default: "built-in default",
      }[conn.source];
      console.log(`${dim("Version:")} ${cliVersion()}`);
      console.log(`${dim("Server:")} ${conn.baseUrl} ${dim(`(${sourceLabel})`)}`);
      if (cloud) {
        const bind = conn.tokenUsableHere
          ? dim(`(${cloud.provider ?? "?"}${conn.issuer ? `, issued by ${conn.issuer}` : ""})`)
          : yellow(`(issued by ${conn.issuer}; not usable for ${conn.baseUrl} — re-login)`);
        console.log(`Login: ${OK} ${bind}`);
      } else {
        console.log(`Login: ${ERR} ${dim("(run `ark login`)")}`);
      }
      console.log(`${dim("Config dir:")} ${keysarkDir()}`);
      return;
    }

    case "login": {
      // 设备码授权:生成链接让用户去网页登录确认,本地轮询感知授权完成。
      const server = (
        flagStr(args.flags, "server") ??
        process.env.KEYSARK_SERVER ??
        defaultServer()
      ).replace(/\/+$/, "");

      const res = await fetch(`${server}/api/cli/device`, { method: "POST" }).catch((e) => {
        fail(`Cannot reach ${server}: ${e instanceof Error ? e.message : e}`);
      });
      if (!res.ok) fail(`Authorization request failed: HTTP ${res.status}`);
      const d = (await res.json()) as {
        device_code: string;
        user_code: string;
        verification_url: string;
        interval?: number;
        expires_in?: number;
      };

      const tty = process.stdout.isTTY === true;
      if (tty) {
        note(`${cyan(d.verification_url)}\n\nCode: ${bold(yellow(d.user_code))} ${dim("(must match the browser)")}`, "Authorize in browser");
      } else {
        console.log(`Open this link in a browser to authorize (any device):\n`);
        console.log(`  ${cyan(d.verification_url)}\n`);
        console.log(`Code: ${bold(yellow(d.user_code))} ${dim("(must match the one shown in the browser)")}\n`);
      }
      if (!args.flags["no-browser"] && !process.env.KEYSARK_NO_BROWSER) {
        tryOpenBrowser(d.verification_url);
      }

      const intervalMs = Math.max(2, d.interval ?? 3) * 1000;
      const deadline = Date.now() + (d.expires_in ?? 600) * 1000;
      const sp = tty ? spinner() : null;
      if (sp) sp.start("Waiting for approval");
      else process.stdout.write(dim("Waiting for approval "));
      const stop = (msg: string) => {
        if (sp) sp.stop(msg);
        else console.log();
      };
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
          if (!sp) process.stdout.write("!"); // 网络抖动,继续轮询
          continue;
        }
        if (pd.status === "pending") {
          if (!sp) process.stdout.write(".");
          continue;
        }
        if (pd.status === "approved" && pd.token) {
          saveCloud({ token: pd.token, provider: pd.provider, issuer: server });
          stop(`${OK} Logged in: ${server} ${dim(`(${pd.provider ?? "?"})`)}`);
          if (!hasCredential()) console.log(dim("  Next: ark import"));
          return;
        }
        stop("");
        if (pd.status === "denied") fail("Authorization denied.");
        fail("Authorization expired. Run `ark login` again.");
      }
      stop("");
      fail("Timed out. Run `ark login` again.");
      return;
    }

    case "logout": {
      const cloud = loadCloud();
      if (!cloud) {
        console.log(dim("(not logged in)"));
        return;
      }
      // 先清本机状态(绝不被网络问题阻塞);远端令牌随后 best-effort 吊销并如实报告。
      clearCloud();
      console.log(`${OK} Logged out locally.`);
      // 吊销目标用 token 的 issuer(签发它的 server 才认得它);旧版无 issuer 则回退解析出的 server。
      const conn = resolveConn(flagStr(args.flags, "server"));
      const revokeAt = cloud.issuer ? normalizeServer(cloud.issuer) : conn.baseUrl;
      try {
        const res = await fetch(`${revokeAt}/api/cli/token`, {
          method: "DELETE",
          headers: { "x-keysark-token": cloud.token },
          signal: AbortSignal.timeout(5000),
        });
        console.log(
          res.ok
            ? `${OK} Token revoked at ${revokeAt}.`
            : dim(`Token not revoked at ${revokeAt} (HTTP ${res.status}); it will expire on its own.`),
        );
      } catch {
        console.log(dim(`Could not reach ${revokeAt}; token not revoked (will expire on its own).`));
      }
      if (hasCredential()) console.log(dim("  Mnemonic credential kept; run `ark forget` to remove."));
      return;
    }

    case "vaults": {
      const transport = transportFrom(args);
      const mnemonic = await acquireMnemonic(true);
      if (!mnemonic || !validateMnemonic(mnemonic)) fail("No usable mnemonic.");
      const key = await deriveKey(mnemonic!);
      const vaults = await fetchVaults(transport);
      if (vaults.length === 0) {
        console.log(dim("(no vaults)"));
        return;
      }
      for (const v of vaults) {
        const ok = await checkVerifier(key, b64decode(v.verifier), vaultVerifierAad(v.id, v.dir));
        console.log(`${ok ? green("●") : dim("○")} ${v.label || "(default)"}  ${cyan(`[${v.id.slice(0, 8)}]`)}  ${dim(`dir=${v.dir || "/"}`)}`);
      }
      return;
    }

    case "ls": {
      const { vault } = await ready(args);
      const entries = vault.entries;
      if (entries.length === 0) {
        console.log(dim("(empty)"));
        return;
      }
      const paths = folderPathById(vault);
      for (const e of entries) console.log(fmtEntry(e, e.folderId ? paths.get(e.folderId) : undefined));
      return;
    }

    case "get": {
      const pathArg = args.positionals[0];
      const localArg = args.positionals[1];
      // 无路径 → 批量模式:按云端 <origin>/.keysark 把整个项目拉回本地。
      if (!pathArg) {
        await runGetManifest(args);
        return;
      }
      // get 是敏感读取:每次都强制输密码,不吃解锁缓存。
      const { vault } = await ready(args, true, true);

      // git-origin 感知:路径属于当前所在仓库时,既能解析嵌套条目(标题含 "/"),
      // 也能在缺省本地目标时,自动把文件还原到仓库内相对路径。
      const git = gitContext(process.cwd());
      let inferredRel: string | undefined;
      let meta: EntryMeta | undefined;
      if (git && pathArg!.startsWith(`${git.originPath}/`)) {
        const rel = pathArg!.slice(git.originPath.length + 1);
        const e = entryAt(vault, lookupFolderPath(vault, git.originPath), rel);
        if (e) {
          meta = e;
          inferredRel = rel;
        }
      }
      if (!meta) meta = await resolveEntryArg(vault, pathArg!);
      const doc = await vault.open(meta.id);

      // 本地目标:显式 local 优先;否则若路径属于当前仓库且输出到终端,缺省落到仓库内相对路径
      //(管道/重定向时仍走 stdout,脚本不受影响)。
      let dest: string | undefined =
        localArg !== undefined
          ? resolve(localArg)
          : inferredRel && git && process.stdout.isTTY
            ? join(git.repoRoot, inferredRel)
            : undefined;

      if (dest === undefined) {
        // stdout(管道/重定向,或无法从路径推断本地目标)。TTY 才带标题头。
        if (process.stdout.isTTY) console.log(`${bold(`# ${doc.title || "(untitled)"}`)}\n`);
        console.log(doc.content);
        return;
      }

      // 目标是已存在的目录 → 取标题末段做文件名。
      if (existsSync(dest) && statSync(dest).isDirectory()) {
        dest = join(dest, basename(doc.title || "item.txt"));
      }
      if (existsSync(dest)) {
        const local = readFileSync(dest);
        if (local.toString("utf8") === doc.content) {
          console.log(`${OK} ${dest} already up to date.`);
          return;
        }
        // 内容不同 → 必须用户确认;非交互环境拒绝覆盖。
        if (process.stdin.isTTY && process.stdout.isTTY) {
          const ok = await askConfirm(
            `${dest} exists (${local.byteLength} B, differs). Overwrite?`,
          );
          if (!ok) {
            console.log(yellow("Cancelled."));
            return;
          }
        } else {
          fail(`${dest} exists and differs; refusing to overwrite (non-interactive).`);
        }
      }
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, doc.content);
      console.log(`${OK} Saved ${bold(dest)} ${dim(`(${Buffer.byteLength(doc.content)} B)`)}`);
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
        `${OK} Created ${cyan(`[${res.id.slice(0, 8)}]`)}${res.synced ? dim(", synced") : red(` (local; sync failed: ${res.syncError})`)}`,
      );
      return;
    }

    case "save": {
      const fileArg = args.positionals[0];
      const targetArg = args.positionals[1];
      // 无源文件 → 批量模式:按云端 <origin>/.keysark 同步整个项目。
      if (!fileArg) {
        await runSaveManifest(args);
        return;
      }
      const abs = resolve(fileArg!);
      let bytes: Buffer;
      try {
        bytes = readFileSync(abs);
      } catch (err) {
        fail(`Cannot read ${abs}: ${err instanceof Error ? err.message : err}`);
      }
      if (bytes!.includes(0)) fail(`${abs} is binary; only text is supported.`);
      const content = bytes!.toString("utf8");

      // 目标:显式 target 直接解析;省略则自动推导(git origin / 根目录),
      // 并把检测结果给用户过目——回车采用,或当场输入自定义 target。
      const explicit = targetArg !== undefined;
      let target = explicit ? parseSaveTarget(targetArg!, abs) : proposeSaveTarget(abs);
      if (!target) fail(`Invalid target: ${targetArg}`);
      // target 未带出 provider(首段不是已知域名)时,仍按源文件的 git origin 识别。
      target!.provider ??= detectSourceProvider(abs);

      const { vault } = await ready(args);

      if (explicit) {
        console.log(`${dim("Source:")} ${abs}`);
        console.log(`${dim("Target:")} ${bold(targetDisplay(target!))}`);
      } else if (process.stdin.isTTY && process.stdout.isTTY) {
        // 醒目的目标确认:框出 源 → 目标,单选采用 / 改 / 取消。
        note(
          `${dim("source")}  ${abs}\n${dim("target")}  ${bold(targetDisplay(target!))}${target!.note ? dim(`  (${target!.note})`) : ""}`,
          "ark save",
        );
        const choice = await askSelect("Save to this target?", [
          { value: "use", label: `Use ${targetDisplay(target!)}`, hint: target!.note },
          { value: "custom", label: "Enter a different target…" },
          { value: "cancel", label: "Cancel" },
        ]);
        if (choice === "cancel") {
          console.log(yellow("Cancelled."));
          return;
        }
        if (choice === "custom") {
          const input = await askText("Target", {
            placeholder: 'a/b/title (trailing "/" keeps the filename)',
            validate: (v) => (parseSaveTarget(v.trim(), abs) ? undefined : "Invalid target"),
          });
          const custom = parseSaveTarget(input.trim(), abs)!;
          custom.provider ??= detectSourceProvider(abs);
          target = custom;
        }
      } else {
        console.log(`${dim("Source:")} ${abs}`);
        console.log(`${dim("Target:")} ${bold(targetDisplay(target!))}${target!.note ? dim(` (${target!.note})`) : ""}`);
        console.log(dim("(non-interactive: using detected target)"));
      }
      const { folderPath, title, provider } = target!;

      // 只查不建:任一级文件夹缺失即视为目标不存在,保存时才真正创建。
      const lookedUp = folderPath !== undefined ? lookupFolderPath(vault, folderPath) : null;
      const existing =
        lookedUp !== undefined
          ? vault.entries.find((e) => e.folderId === lookedUp && e.title === title)
          : undefined;
      const display = targetDisplay(target!);

      // 与线上最新版本一致 → 提示并跳过(不写新版本)。
      if (
        existing?.contentHash &&
        existing.contentHash === (await sha256Hex(new TextEncoder().encode(content)))
      ) {
        console.log(`${OK} Up to date with the latest version (${existing.versions ?? 1} total); nothing to save.`);
        if (provider && provider !== existing.provider) {
          // 内容不动,仅补来源标记(元数据更新,不产生新版本)。
          const res = await vault.save({ id: existing.id, title, content, folderId: existing.folderId, provider });
          console.log(`  Provider tag set ${yellow(`(${provider})`)}${res.synced ? dim(", synced") : red(` (local; sync failed: ${res.syncError})`)}`);
        }
        return;
      }

      if (existing) {
        console.log(
          yellow(`Target exists [${existing.id.slice(0, 8)}] (${existing.versions ?? 1} versions); will save as its latest version.`),
        );
      }

      const folderId = folderPath !== undefined ? await resolveFolderPath(vault, folderPath) : null;
      const res = await vault.save({ id: existing?.id, title, content, folderId, provider });
      console.log(
        `${OK} ${existing ? "Updated" : "Created"} ${bold(display)} ${cyan(`[${res.id.slice(0, 8)}]`)}${provider ? yellow(` (${provider})`) : ""}${res.synced ? dim(", synced") : red(` (local; sync failed: ${res.syncError})`)}`,
      );
      return;
    }

    case "set": {
      const idArg = args.positionals[0];
      if (!idArg) fail("usage: ark set <id> [--title T] [--content C] [--folder a/b]");
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
      console.log(`${OK} Updated ${cyan(`[${meta.id.slice(0, 8)}]`)}${res.synced ? dim(", synced") : red(` (local; ${res.syncError})`)}`);
      return;
    }

    case "rm": {
      const idArg = args.positionals[0];
      if (!idArg) fail("usage: ark rm <id>");
      const { vault } = await ready(args);
      const meta = findEntry(vault, idArg!);
      const res = await vault.remove(meta.id);
      console.log(`${OK} Deleted ${cyan(`[${meta.id.slice(0, 8)}]`)}${res.synced ? dim(", synced") : red(` (local; ${res.syncError})`)}`);
      return;
    }

    case "sync": {
      const { vault } = await ready(args);
      const { remaining } = await vault.sync();
      console.log(remaining === 0 ? `${OK} All synced` : yellow(`${remaining} pending`));
      return;
    }

    case "local": {
      const src = args.positionals[0];
      if (!src) fail("usage: ark local <zip-or-dir> [--out <dir>]");
      await runLocal(src!, args);
      return;
    }

    default:
      // 直接把路径当命令:`ark ./backup.zip` 等价于 `ark local ./backup.zip`。
      if (existsSync(args.cmd)) {
        await runLocal(args.cmd, args);
        return;
      }
      // 看起来是个路径(含分隔符或 .zip 后缀)但不存在 → 给路径相关提示,而非「未知命令」。
      if (/[\/\\]/.test(args.cmd) || args.cmd.toLowerCase().endsWith(".zip")) {
        fail(`No such file or directory: ${resolve(args.cmd)}`);
      }
      fail(`Unknown command: ${args.cmd}. See \`ark help\`.`);
  }
}

main().catch((err) => fail(String(err instanceof Error ? err.message : err)));
