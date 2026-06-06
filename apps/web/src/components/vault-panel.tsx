"use client";

// 端到端加密保险库面板(支持多保险库)。助记词与派生密钥只在浏览器,绝不发服务端。
// 登录流:0 个库 → 创建;1 个库 → 直接解锁;≥2 个库 → 先选库,再输入该库助记词。
// 数据模型:keysark.json 注册表(明文元数据 + 密文校验块)+ 每个库各自的 index/items(见 @/lib/vault、@/lib/registry)。
// UI 参照 1Password:选择/解锁/创建为居中卡片,已解锁为「条目列 + 详情」两栏工作台。
import { useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Textarea,
} from "@keysark/ui";
import {
  checkVerifier,
  deriveKey,
  generateMnemonic,
  makeVerifier,
  validateMnemonic,
} from "@keysark/crypto";
import { newId } from "@keysark/db/id";
import { Logo, Wordmark } from "./brand";
import { HeaderControls } from "./controls";
import { UserMenu } from "./user-menu";
import { useT } from "./providers";
import { Vault, type EntryMeta } from "@/lib/vault";
import {
  b64decode,
  b64encode,
  saveRegistry,
  vaultDir,
  type Registry,
  type VaultDescriptor,
} from "@/lib/registry";

interface VaultUser {
  name: string;
  avatar: string | null;
}

type Phase = "select" | "unlock" | "create" | "unlocked";

export function VaultPanel({
  vaults: initialVaults,
  user,
}: {
  vaults: VaultDescriptor[];
  user: VaultUser;
}) {
  const t = useT();
  // 默认库:无名或 label 为 "default"(创建首个库时的占位)。一律不显示 "default" 字样。
  const isDefaultVault = (v: VaultDescriptor): boolean => {
    const l = v.label.trim().toLowerCase();
    return l === "" || l === "default";
  };
  const vaultName = (v: VaultDescriptor): string =>
    isDefaultVault(v) ? t("default_vault") : v.label.trim();

  // 注册表(随新建保险库增长)
  const [vaults, setVaults] = useState<VaultDescriptor[]>(initialVaults);
  const [selectedVault, setSelectedVault] = useState<VaultDescriptor | null>(
    initialVaults.length === 1 ? initialVaults[0]! : null,
  );
  const [phase, setPhase] = useState<Phase>(
    initialVaults.length === 0 ? "create" : initialVaults.length === 1 ? "unlock" : "select",
  );

  const vaultRef = useRef<Vault | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 解锁输入
  const [mnemonicInput, setMnemonicInput] = useState("");

  // 创建流程
  const [newLabel, setNewLabel] = useState("");
  const [newMnemonic, setNewMnemonic] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const challengeIdx = useMemo(() => {
    const idx = new Set<number>();
    while (idx.size < 3) idx.add(Math.floor(Math.random() * 12));
    return [...idx].sort((a, b) => a - b);
  }, [newMnemonic]);
  const [challengeInput, setChallengeInput] = useState<Record<number, string>>({});

  // 已解锁 / 工作台
  const [entries, setEntries] = useState<EntryMeta[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(0);
  // 详情区两种模式:打开已有条目为只读 preview;新建/点击编辑进入 edit。
  const [mode, setMode] = useState<"preview" | "edit">("preview");

  const filtered = useMemo(
    () =>
      entries.filter((e) =>
        (e.title || "").toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [entries, query],
  );

  async function enterVault(key: CryptoKey, descriptor: VaultDescriptor) {
    const v = new Vault(key, { id: descriptor.id, dir: descriptor.dir });
    vaultRef.current = v;
    setSelectedVault(descriptor);
    setPhase("unlocked");
    setLoadingEntries(true);
    setStatus(null);
    try {
      const list = await v.load();
      setEntries(list);
      setPending(v.pendingCount());
    } catch (err) {
      setStatus(t("st_load_fail", String(err)));
    } finally {
      setLoadingEntries(false);
    }
  }

  // ---- 选择保险库 ----
  function pickVault(v: VaultDescriptor) {
    setSelectedVault(v);
    setMnemonicInput("");
    setStatus(null);
    setPhase("unlock");
  }

  // ---- 解锁(对选中的保险库校验助记词) ----
  async function unlock() {
    const m = mnemonicInput.trim().replace(/\s+/g, " ");
    if (!validateMnemonic(m)) return setStatus(t("st_invalid_mnemonic"));
    if (!selectedVault) return setStatus(t("st_missing_meta"));
    setBusy(true);
    setStatus(t("st_unlocking"));
    try {
      const k = await deriveKey(m);
      const verifierBytes = b64decode(selectedVault.verifier);
      if (!(await checkVerifier(k, verifierBytes))) {
        setStatus(t("st_mismatch"));
        return;
      }
      setMnemonicInput("");
      await enterVault(k, selectedVault);
    } catch (err) {
      setStatus(t("st_unlock_fail", String(err)));
    } finally {
      setBusy(false);
    }
  }

  // ---- 创建(新建保险库,追加进注册表) ----
  function genMnemonic() {
    setNewMnemonic(generateMnemonic());
    setConfirming(false);
    setChallengeInput({});
    setStatus(null);
  }

  async function finishCreate() {
    if (!newMnemonic) return;
    const words = newMnemonic.split(" ");
    for (const i of challengeIdx) {
      if ((challengeInput[i] ?? "").trim() !== words[i]) {
        setStatus(t("st_word_mismatch", i + 1));
        return;
      }
    }
    setBusy(true);
    setStatus(t("st_creating"));
    try {
      const k = await deriveKey(newMnemonic);
      const verifier = await makeVerifier(k);
      const id = newId();
      // 第一个保险库无需取名,默认为 "default";后续保险库用用户输入的名字。
      const label = vaults.length === 0 ? "default" : newLabel.trim();
      const descriptor: VaultDescriptor = {
        id,
        label,
        dir: vaultDir(id),
        verifier: b64encode(verifier),
        createdAt: Date.now(),
      };
      const nextRegistry: Registry = { v: 1, vaults: [...vaults, descriptor] };
      await saveRegistry(nextRegistry);
      setVaults(nextRegistry.vaults);
      setNewMnemonic(null);
      setNewLabel("");
      await enterVault(k, descriptor);
    } catch (err) {
      setStatus(t("st_create_fail", String(err)));
    } finally {
      setBusy(false);
    }
  }

  // ---- 各登录界面之间切换 ----
  function goCreate() {
    setNewMnemonic(null);
    setNewLabel("");
    setConfirming(false);
    setChallengeInput({});
    setMnemonicInput("");
    setStatus(null);
    setPhase("create");
  }
  /** 返回「选择/解锁」:多库回到选择,单库回到解锁,无库回到创建。 */
  function goPick() {
    setStatus(null);
    setMnemonicInput("");
    if (vaults.length > 1) setPhase("select");
    else if (vaults.length === 1) {
      setSelectedVault(vaults[0]!);
      setPhase("unlock");
    } else setPhase("create");
  }

  // ---- 工作台:读写 ----
  async function openEntry(meta: EntryMeta) {
    const v = vaultRef.current;
    if (!v) return;
    setBusy(true);
    setStatus(t("st_decrypting", meta.title || t("untitled")));
    try {
      const doc = await v.open(meta.id);
      setSelectedId(doc.id);
      setTitle(doc.title);
      setContent(doc.content);
      setMode("preview");
      setStatus(null);
    } catch (err) {
      setStatus(t("st_open_fail", String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const v = vaultRef.current;
    if (!v) return;
    setBusy(true);
    setStatus(t("st_saving"));
    try {
      const result = await v.save({ id: selectedId, title: title.trim(), content });
      setEntries(result.entries);
      setSelectedId(result.id);
      setPending(v.pendingCount());
      setMode("preview"); // 保存后回到只读预览
      setStatus(result.synced ? t("st_saved") : t("st_saved_local", result.syncError ?? ""));
    } catch (err) {
      setStatus(t("st_save_fail", String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    const v = vaultRef.current;
    if (!v) return;
    setBusy(true);
    setStatus(t("st_syncing"));
    try {
      const { remaining } = await v.sync();
      setPending(remaining);
      setStatus(remaining === 0 ? t("st_sync_ok") : t("pending_count", remaining));
    } catch (err) {
      setPending(v.pendingCount());
      setStatus(t("st_sync_fail", String(err)));
    } finally {
      setBusy(false);
    }
  }

  function newItem() {
    setSelectedId(null);
    setTitle("");
    setContent("");
    setMode("edit"); // 新建直接进编辑
    setStatus(null);
  }

  function editEntry() {
    setMode("edit");
    setStatus(null);
  }

  async function cancelEdit() {
    setStatus(null);
    // 编辑已有条目 → 放弃改动,重新读回原文进入预览;新建未保存 → 清空回到空预览。
    const meta = selectedId ? entries.find((e) => e.id === selectedId) : null;
    if (meta) {
      await openEntry(meta);
    } else {
      setSelectedId(null);
      setTitle("");
      setContent("");
      setMode("preview");
    }
  }

  function lock() {
    // 清内存密钥后整页刷新:让服务端重新读取注册表(含新建后的保险库)。
    vaultRef.current = null;
    setContent("");
    setTitle("");
    window.location.reload();
  }

  // ============================ 选择保险库 ============================
  if (phase === "select") {
    return (
      <CenteredShell user={user}>
        <Card className="w-full">
          <CardHeader>
            <CardTitle>{t("select_title")}</CardTitle>
            <CardDescription>{t("select_desc")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <ul className="flex flex-col gap-2">
              {vaults.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => pickVault(v)}
                    disabled={busy}
                    className="flex w-full items-center gap-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3 text-left transition-colors hover:bg-[var(--color-accent)]"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent)] text-[var(--color-accent-foreground)]">
                      <Logo className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{vaultName(v)}</span>
                      <span className="block text-xs text-[var(--color-muted-foreground)]">
                        {t("select_enter_phrase")}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-[var(--color-border)] pt-3 text-center">
              <Button variant="link" size="sm" onClick={goCreate} disabled={busy}>
                {t("new_vault")}
              </Button>
            </div>
            <StatusLine status={status} />
          </CardContent>
        </Card>
      </CenteredShell>
    );
  }

  // ============================ 创建保险库 ============================
  if (phase === "create") {
    return (
      <CenteredShell user={user}>
        <Card className="w-full">
          <CardHeader>
            <CardTitle>{t("create_title")}</CardTitle>
            <CardDescription>
              {t("create_desc_a")}
              <b>{t("create_desc_strong")}</b>
              {t("create_desc_b")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* 第一个保险库无需取名(默认 default);新增保险库时才让用户命名以便区分 */}
            {vaults.length > 0 ? (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
                  {t("create_label")}
                </span>
                <Input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={t("create_label_ph")}
                  disabled={busy || !!newMnemonic}
                />
              </label>
            ) : null}
            {!newMnemonic ? (
              <>
                <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm text-[var(--color-muted-foreground)]">
                  {t("create_warn_a")}
                  <b className="text-[var(--color-danger)]">{t("create_warn_strong")}</b>
                  {t("create_warn_b")}
                </div>
                <Button onClick={genMnemonic} disabled={busy} size="lg">
                  {t("btn_generate")}
                </Button>
              </>
            ) : !confirming ? (
              <>
                <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {newMnemonic.split(" ").map((w, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 font-mono text-sm"
                    >
                      <span className="text-[var(--color-muted-foreground)] tabular-nums">
                        {i + 1}.
                      </span>
                      <span className="font-medium">{w}</span>
                    </li>
                  ))}
                </ol>
                <p className="text-xs text-[var(--color-muted-foreground)]">{t("copy_hint")}</p>
                <Button onClick={() => setConfirming(true)} disabled={busy} size="lg">
                  {t("btn_copied")}
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm">{t("confirm_prompt")}</p>
                <div className="flex flex-col gap-3">
                  {challengeIdx.map((i) => (
                    <label key={i} className="flex items-center gap-3 text-sm">
                      <span className="w-16 shrink-0 text-[var(--color-muted-foreground)]">
                        {t("word_nth", i + 1)}
                      </span>
                      <Input
                        value={challengeInput[i] ?? ""}
                        onChange={(e) =>
                          setChallengeInput((prev) => ({ ...prev, [i]: e.target.value }))
                        }
                        className="font-mono"
                      />
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Button onClick={finishCreate} disabled={busy}>
                    {t("btn_confirm_create")}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                    {t("btn_review_again")}
                  </Button>
                </div>
              </>
            )}
            {vaults.length > 0 ? (
              <div className="border-t border-[var(--color-border)] pt-3 text-center">
                <Button variant="link" size="sm" onClick={goPick} disabled={busy}>
                  {t("back_to_unlock")}
                </Button>
              </div>
            ) : null}
            <StatusLine status={status} />
          </CardContent>
        </Card>
      </CenteredShell>
    );
  }

  // ============================ 解锁保险库 ============================
  if (phase === "unlock") {
    return (
      <CenteredShell user={user}>
        <Card className="w-full">
          <CardHeader>
            <CardTitle>{t("unlock_title")}</CardTitle>
            <CardDescription>
              {selectedVault ? t("unlock_desc_named", vaultName(selectedVault)) : t("unlock_desc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Textarea
              value={mnemonicInput}
              onChange={(e) => setMnemonicInput(e.target.value)}
              placeholder="word1 word2 … word12"
              rows={3}
              className="font-mono"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) unlock();
              }}
            />
            <Button onClick={unlock} disabled={busy} size="lg">
              {t("btn_unlock")}
            </Button>
            <div className="flex flex-col gap-1 border-t border-[var(--color-border)] pt-3 text-center">
              {vaults.length > 1 ? (
                <Button variant="link" size="sm" onClick={goPick} disabled={busy}>
                  {t("switch_vault")}
                </Button>
              ) : null}
              <Button variant="link" size="sm" onClick={goCreate} disabled={busy}>
                {t("new_vault")}
              </Button>
            </div>
            <StatusLine status={status} />
          </CardContent>
        </Card>
      </CenteredShell>
    );
  }

  // ============================ 工作台:两栏(条目列 + 详情) ============================
  const selected = entries.find((e) => e.id === selectedId) ?? null;
  const currentName = selectedVault ? vaultName(selectedVault) : t("default_vault");
  const currentIsDefault = selectedVault ? isDefaultVault(selectedVault) : true;

  return (
    <div className="grid h-screen grid-cols-[20rem_1fr] overflow-hidden">
      {/* 条目列(含品牌 / 当前保险库 / 锁定) */}
      <section className="flex flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex h-14 items-center border-b border-[var(--color-border)] px-4">
          <Wordmark className="text-base" />
        </div>
        {/* 默认库不显示名称(顶部已有 KeysArk 字标);具名库才显示名称 */}
        {!currentIsDefault ? (
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3 text-sm font-semibold">
            <Logo className="h-4 w-4 shrink-0" />
            <span className="truncate">{currentName}</span>
          </div>
        ) : null}
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] p-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search_placeholder")}
            className="h-9 flex-1"
          />
          <Button variant="default" size="sm" onClick={newItem} disabled={busy}>
            {t("btn_new")}
          </Button>
        </div>
        <ul className="flex-1 overflow-y-auto p-2">
          {loadingEntries ? (
            <li className="px-3 py-8 text-center text-sm text-[var(--color-muted-foreground)]">
              {t("loading_entries")}
            </li>
          ) : filtered.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-[var(--color-muted-foreground)]">
              {entries.length === 0 ? t("empty_vault") : t("empty_search")}
            </li>
          ) : (
            filtered.map((e) => {
              const active = e.id === selectedId;
              const label = e.title || t("untitled");
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => openEntry(e)}
                    disabled={busy}
                    className={`flex w-full items-center gap-3 rounded-[var(--radius)] px-3 py-2.5 text-left transition-colors ${
                      active
                        ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                        : "hover:bg-[var(--color-accent)]"
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
                        active
                          ? "bg-[var(--color-primary-foreground)]/20"
                          : "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]"
                      }`}
                    >
                      {label.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{label}</span>
                      <span
                        className={`block text-xs ${active ? "opacity-80" : "text-[var(--color-muted-foreground)]"}`}
                      >
                        {t("bytes_cipher", e.size)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
        {/* 列脚:解锁状态 + 条目数 */}
        <div className="flex items-center gap-1.5 border-t border-[var(--color-border)] px-4 py-2.5 text-xs text-[var(--color-muted-foreground)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
          {t("status_unlocked")} · {t("items_count", entries.length)}
        </div>
      </section>

      {/* 详情 / 编辑 */}
      <section className="flex flex-col bg-[var(--color-background)]">
        {/* 头部:左侧为同步状态,右侧语言/主题切换在头像左侧 */}
        <div className="flex h-14 items-center justify-between gap-3 border-b border-[var(--color-border)] px-6">
          <div className="flex min-w-0 items-center gap-3">
            {pending > 0 ? (
              <Button variant="secondary" size="sm" onClick={syncNow} disabled={busy}>
                {t("btn_sync")} · {t("pending_count", pending)}
              </Button>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
                {t("synced")}
              </span>
            )}
            <StatusLine status={status} inline />
          </div>
          <div className="flex items-center gap-3">
            <HeaderControls />
            <UserMenu name={user.name} avatar={user.avatar} onLock={lock} />
          </div>
        </div>
        {mode === "edit" ? (
          // ---- 编辑模式:标题输入与 保存/取消 同一行,内容在下 ----
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
            <div className="flex items-center gap-3">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("field_title_ph")}
                className="min-w-0 flex-1"
              />
              <Button size="sm" onClick={save} disabled={busy}>
                {t("btn_save")}
              </Button>
              <Button size="sm" variant="outline" onClick={cancelEdit} disabled={busy}>
                {t("btn_cancel")}
              </Button>
            </div>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t("content_ph")}
              className="min-h-[18rem] flex-1 resize-none font-mono leading-relaxed"
            />
          </div>
        ) : selectedId ? (
          // ---- 预览模式:只读 ----
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
            <div className="flex items-center gap-3">
              <h2 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
                {selected ? selected.title || t("untitled") : t("untitled")}
              </h2>
              <Button size="sm" onClick={editEntry} disabled={busy}>
                {t("btn_edit")}
              </Button>
            </div>
            <article className="flex-1 whitespace-pre-wrap break-words rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 font-mono text-sm leading-relaxed">
              {content ? (
                content
              ) : (
                <span className="text-[var(--color-muted-foreground)]">{t("content_empty")}</span>
              )}
            </article>
          </div>
        ) : (
          // ---- 无选中:空态 ----
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-[var(--color-muted-foreground)]">
            {t("preview_empty")}
          </div>
        )}
      </section>
    </div>
  );
}

// 居中外壳:选择/解锁/创建页用,顶栏带品牌 + 语言/主题切换 + 用户菜单。
function CenteredShell({ children, user }: { children: React.ReactNode; user: VaultUser }) {
  return (
    <main className="relative flex min-h-screen flex-col bg-[var(--color-background)]">
      <div className="hero-aurora" aria-hidden="true" />
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-6 py-5">
        <Wordmark className="text-lg" />
        <div className="flex items-center gap-3">
          <HeaderControls />
          <UserMenu name={user.name} avatar={user.avatar} />
        </div>
      </header>
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-8 px-4 pb-16">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </main>
  );
}

function StatusLine({ status, inline }: { status: string | null; inline?: boolean }) {
  if (!status) return null;
  return (
    <span className={`text-xs text-[var(--color-muted-foreground)] ${inline ? "truncate" : ""}`}>
      {status}
    </span>
  );
}
