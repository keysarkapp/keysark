// 加密 HTML 备份 —— 纯客户端生成的自解密单文件。
//
// 文件内嵌:Argon2id(m=64MB/t=3/p=1,与解锁密码同参)+ AES-256-GCM 加密的助记词密文
// + 内联 argon2 wasm(hash-wasm UMD,从 /argon2.umd.min.js 取)+ 解密 UI。
// 恢复:离线双击用任意浏览器打开(file:// 是安全上下文,WebCrypto 可用),输备份密码即见助记词。
// 双语:中英文案全部内嵌,右上角可切换,默认为导出时语言。品牌 logo 内联 SVG(brand.tsx 同源)。
// 不依赖 KeysArk 在线、不发任何网络请求;加密复用 @keysark/crypto 同一套实现。
import {
  DEFAULT_ARGON2ID_PARAMS,
  deriveWrappingKey,
  encrypt,
  generateWrappingSalt,
} from "@keysark/crypto";
import { BUILD_COMMIT, BUILD_REPO, BUILD_VERSION, commitUrl } from "@/lib/build-info";
import { translate, type Locale, type MsgKey } from "@/lib/i18n";

export type EncryptedBackupInput = {
  mnemonic: string;
  vaultName: string;
  url: string;
  locale: Locale;
  password: string;
};

function b64(u: Uint8Array): string {
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 与 brand.tsx 同源的品牌标识:盾形方舟外壳 + 琥珀钥匙孔(固定品牌色,不依赖主题变量)。
const LOGO_SVG = `<svg viewBox="0 0 100 100" fill="none" width="28" height="28" aria-hidden="true"><path d="M14 7 H86 Q95 7 95 18 V58 Q95 77 77 89 Q62 96 50 96 Q38 96 23 89 Q5 77 5 58 V18 Q5 7 14 7 Z" fill="#4F46E5"/><circle cx="50" cy="44" r="11" fill="#F59E0B"/><path d="M45.5 50 L42 72 H58 L54.5 50 Z" fill="#F59E0B"/></svg>`;

// 文件内双语文案用到的 i18n key(两种语言各生成一份内嵌)。
const STRING_KEYS = [
  "bk_title",
  "pdf_name_label",
  "pdf_url_label",
  "pdf_phrase_label",
  "bk_prompt",
  "bk_btn",
  "bk_decrypting",
  "bk_wrong",
  "bk_offline_note",
  "bk_hover_hint",
  "bk_relock",
  "pdf_risk_1",
  "pdf_source",
] as const satisfies readonly MsgKey[];

/** 生成自解密 HTML 字符串(导出供测试;下载入口用 exportEncryptedBackupHtml)。 */
export async function buildEncryptedBackupHtml(input: EncryptedBackupInput): Promise<string> {
  // 加密:与保险库解锁密码同一套 KDF + 信封。
  const salt = generateWrappingSalt();
  const params = DEFAULT_ARGON2ID_PARAMS;
  const key = await deriveWrappingKey(input.password, salt, params);
  const { iv, ct } = await encrypt(key, new TextEncoder().encode(input.mnemonic));

  const appVersion = BUILD_VERSION;
  const commit = BUILD_COMMIT;
  const repo = BUILD_REPO;
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const createdAt = new Date();
  const payload = {
    v: 1,
    kdf: "argon2id",
    salt: b64(salt),
    params,
    iv: b64(iv),
    ct: b64(ct),
    vault: input.vaultName,
    url: input.url,
    appVersion,
    commit,
    repo,
    userAgent,
    createdAt: createdAt.toISOString(),
    locale: input.locale,
  };

  // 源码出处:仓库地址 @ 提交;能拼出提交链接时渲染为可点击外链(用户点了才联网,文件本身仍零请求)。
  const cUrl = commitUrl();
  const sourceText = repo ? `${repo} @ ${commit}` : commit;
  const sourceHtml = cUrl
    ? `<a href="${escapeHtml(cUrl)}" target="_blank" rel="noreferrer noopener" style="color:#818CF8">${escapeHtml(
        sourceText,
      )}</a>`
    : escapeHtml(sourceText);

  // 双语文案:两种语言各一份内嵌,文件内可切换。
  const strings: Record<string, Record<string, string>> = {};
  for (const loc of ["zh", "en"] as const) {
    const dict: Record<string, string> = {};
    for (const k of STRING_KEYS) dict[k] = translate(loc, k);
    dict.exported_at = translate(
      loc,
      "bk_exported_at",
      createdAt.toLocaleString(loc === "zh" ? "zh-CN" : "en-US"),
    );
    strings[loc] = dict;
  }

  // 内联 argon2 wasm bundle(同源静态文件,hash-wasm UMD,~29KB)。
  const res = await fetch("/argon2.umd.min.js");
  if (!res.ok) throw new Error(`argon2 bundle fetch failed: HTTP ${res.status}`);
  const argon2Src = await res.text();

  // 模板:无外链、无网络请求;</script> 经 < 转义不会提前闭合。
  return `<!doctype html>
<html lang="${input.locale === "zh" ? "zh-CN" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KeysArk · ${escapeHtml(input.vaultName)}</title>
<style>
  body { font: 16px/1.6 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
         background: #111827; color: #E5E7EB; display: flex; justify-content: center; padding: 48px 16px; }
  main { width: 100%; max-width: 560px; }
  header { display: flex; align-items: center; gap: 10px; }
  header b { font-size: 20px; color: #fff; letter-spacing: -.02em; }
  header b i { color: #818CF8; font-style: normal; }
  .lang { margin-left: auto; display: flex; gap: 4px; }
  .lang button { width: auto; margin: 0; padding: 4px 10px; font-size: 12px; border-radius: 6px;
                 background: #1F2937; color: #9CA3AF; border: 1px solid #374151; }
  .lang button.on { background: #312E81; color: #fff; border-color: #4F46E5; }
  h1 { font-size: 17px; color: #fff; margin: 20px 0 4px; }
  .meta { color: #9CA3AF; font-size: 13px; margin: 0 0 20px; }
  .card { background: #1F2937; border: 1px solid #374151; border-radius: 12px; padding: 20px; }
  input { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px;
          border: 1px solid #4B5563; background: #111827; color: #fff; font-size: 15px; }
  button { margin-top: 12px; width: 100%; padding: 10px; border: 0; border-radius: 8px;
           background: #4F46E5; color: #fff; font-size: 15px; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  button.ghost { margin-top: 16px; background: #1F2937; color: #E5E7EB; border: 1px solid #4B5563; }
  .err { color: #F87171; font-size: 13px; margin-top: 10px; }
  .note { color: #6B7280; font-size: 12px; margin-top: 16px; }
  ol { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 0; margin: 16px 0 0;
       list-style: none; counter-reset: w; }
  li { background: #111827; border: 1px solid #374151; border-radius: 8px; padding: 8px 10px;
       font: 600 14px ui-monospace, Menlo, monospace; counter-increment: w; }
  li::before { content: counter(w) ". "; color: #6B7280; font-weight: 400; }
  /* 单词默认遮挡,悬停/触摸逐个显示(防旁人窥屏);遮挡时禁选,免得复制出明文 */
  li .w { filter: blur(6px); user-select: none; transition: filter .12s; }
  li:hover .w, li:active .w { filter: none; user-select: text; }
  .hint { color: #9CA3AF; font-size: 12px; margin: 10px 0 0; }
  .env { color: #4B5563; font-size: 11px; margin-top: 6px; word-break: break-all; }
  .risk { color: #FCA5A5; font-size: 13px; margin-top: 16px; }
</style>
</head>
<body>
<main>
  <header>
    ${LOGO_SVG}
    <b>Keys<i>Ark</i></b>
    <span class="lang">
      <button id="lang-zh" type="button">中文</button>
      <button id="lang-en" type="button">EN</button>
    </span>
  </header>
  <h1 data-t="bk_title"></h1>
  <p class="meta">
    <span data-t="pdf_name_label"></span>:${escapeHtml(input.vaultName)} · <span data-t="pdf_url_label"></span>:${escapeHtml(input.url)}<br>
    KeysArk v${escapeHtml(appVersion)} · <span id="exported"></span><br>
    <span data-t="pdf_source"></span>:${sourceHtml}
  </p>
  <div class="card">
    <div id="form">
      <p style="margin-top:0" data-t="bk_prompt"></p>
      <input id="pw" type="password" autocomplete="off">
      <button id="go" data-t="bk_btn"></button>
      <p id="msg" class="err" hidden></p>
    </div>
    <div id="out" hidden>
      <p style="margin:0;color:#9CA3AF;font-size:13px" data-t="pdf_phrase_label"></p>
      <ol id="words"></ol>
      <p class="hint" data-t="bk_hover_hint"></p>
      <p class="risk" data-t="pdf_risk_1"></p>
      <button id="relock" class="ghost" data-t="bk_relock"></button>
    </div>
  </div>
  <p class="note" data-t="bk_offline_note"></p>
  <p class="env">${escapeHtml(userAgent)}</p>
</main>
<script id="payload" type="application/json">${JSON.stringify(payload).replace(/</g, "\\u003c")}</script>
<script id="strings" type="application/json">${JSON.stringify(strings).replace(/</g, "\\u003c")}</script>
<script>${argon2Src}</script>
<script>
(function () {
  "use strict";
  var data = JSON.parse(document.getElementById("payload").textContent);
  var STRINGS = JSON.parse(document.getElementById("strings").textContent);
  var lang = data.locale === "en" ? "en" : "zh";
  var pw = document.getElementById("pw"), go = document.getElementById("go");
  var msg = document.getElementById("msg"), out = document.getElementById("out");
  var words = document.getElementById("words");
  var form = document.getElementById("form"), relock = document.getElementById("relock");
  var msgKey = null; // 当前状态消息的 key,切语言时跟着换

  function S() { return STRINGS[lang]; }
  function applyLang() {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    var nodes = document.querySelectorAll("[data-t]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = S()[nodes[i].getAttribute("data-t")] || "";
    }
    document.getElementById("exported").textContent = S().exported_at;
    document.getElementById("lang-zh").className = lang === "zh" ? "on" : "";
    document.getElementById("lang-en").className = lang === "en" ? "on" : "";
    if (msgKey) msg.textContent = S()[msgKey];
  }
  document.getElementById("lang-zh").addEventListener("click", function () { lang = "zh"; applyLang(); });
  document.getElementById("lang-en").addEventListener("click", function () { lang = "en"; applyLang(); });
  applyLang();

  function unb64(s) {
    var bin = atob(s), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  async function run() {
    if (!pw.value) return;
    go.disabled = true;
    msg.hidden = false;
    msgKey = "bk_decrypting";
    msg.textContent = S().bk_decrypting;
    try {
      var keyBytes = await hashwasm.argon2id({
        password: pw.value.normalize("NFKC"),
        salt: unb64(data.salt),
        memorySize: data.params.m,
        iterations: data.params.t,
        parallelism: data.params.p,
        hashLength: 32,
        outputType: "binary",
      });
      var key = await crypto.subtle.importKey("raw", keyBytes.slice().buffer, "AES-GCM", false, ["decrypt"]);
      var pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(data.iv).slice().buffer }, key, unb64(data.ct).slice().buffer);
      var mnemonic = new TextDecoder().decode(pt);
      words.innerHTML = "";
      mnemonic.split(" ").forEach(function (w) {
        var li = document.createElement("li");
        var span = document.createElement("span");
        span.className = "w";
        span.textContent = w;
        li.appendChild(span);
        words.appendChild(li);
      });
      // 解密成功:清掉输入框里的密码、隐藏表单,只留助记词区 + 「重新锁定」。
      pw.value = "";
      msgKey = null;
      msg.hidden = true;
      form.hidden = true;
      out.hidden = false;
    } catch (e) {
      msgKey = "bk_wrong";
      msg.textContent = S().bk_wrong;
    } finally {
      go.disabled = false;
    }
  }
  go.addEventListener("click", run);
  pw.addEventListener("keydown", function (e) { if (e.key === "Enter") run(); });
  // 重新锁定:清掉已解密的单词,回到密码输入(密文从未离开过文件,这里只清 DOM)。
  relock.addEventListener("click", function () {
    words.innerHTML = "";
    out.hidden = true;
    form.hidden = false;
    msg.hidden = true;
    msgKey = null;
    pw.focus();
  });
})();
</script>
</body>
</html>`;
}

/** 加密并触发下载(浏览器事件回调中调用)。 */
export async function exportEncryptedBackupHtml(input: EncryptedBackupInput): Promise<void> {
  const html = await buildEncryptedBackupHtml(input);
  const blob = new Blob([html], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  a.download = `keysark-backup-${input.vaultName || "vault"}-${date}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
