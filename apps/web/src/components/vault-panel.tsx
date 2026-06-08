"use client";

// 端到端加密保险库面板(支持多保险库)。助记词与派生密钥只在浏览器,绝不发服务端。
// 登录流:0 个库 → 创建;1 个库 → 直接解锁;≥2 个库 → 先选库,再输入该库助记词。
// 数据模型:keysark.json 注册表(明文元数据 + 密文校验块)+ 每个库各自的 index/items(见 @/lib/vault、@/lib/registry)。
// UI 参照 1Password:选择/解锁/创建为居中卡片,已解锁为「条目列 + 详情」两栏工作台。
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Textarea,
  Tooltip,
} from "@keysark/ui";
import {
  checkVerifier,
  deriveKey,
  generateMnemonic,
  makeVerifier,
  validateMnemonic,
} from "@keysark/crypto";
import { newId } from "@keysark/db/id";
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
  FolderTree,
  GripVertical,
  LayoutList,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Logo, Wordmark } from "./brand";
import { HeaderControls } from "./controls";
import { UserMenu } from "./user-menu";
import { useLocale, useT } from "./providers";
import { Vault, openBrowserVault, itemRelPath, type EntryMeta, type FolderMeta } from "@/lib/vault";
import type { MsgKey } from "@/lib/i18n";
import { saveKey, loadKey, deleteKey } from "@/lib/key-store";
import { testId } from "@/lib/test-id";
import type { StorageProvider } from "@/lib/storage";
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

// 条目列表的显示方式与排序(持久化到 localStorage,跨刷新保留)。
type ViewMode = "flat" | "folder";
type SortKey = "updated" | "created" | "title";
type SortDir = "asc" | "desc";
interface SortSpec {
  key: SortKey;
  dir: SortDir;
}
const DEFAULT_SORT: SortSpec = { key: "updated", dir: "desc" };
const VIEW_KEY = "keysark.vault.viewMode";
const SORT_KEY = "keysark.vault.sort";
// 排序下拉的固定选项(key+dir 组合),i18n 词条一一对应。
const SORT_OPTIONS: { key: SortKey; dir: SortDir; label: MsgKey }[] = [
  { key: "updated", dir: "desc", label: "sort_updated_desc" },
  { key: "updated", dir: "asc", label: "sort_updated_asc" },
  { key: "created", dir: "desc", label: "sort_created_desc" },
  { key: "created", dir: "asc", label: "sort_created_asc" },
  { key: "title", dir: "asc", label: "sort_title_asc" },
  { key: "title", dir: "desc", label: "sort_title_desc" },
];

function loadView(): ViewMode {
  if (typeof window === "undefined") return "flat";
  return window.localStorage.getItem(VIEW_KEY) === "folder" ? "folder" : "flat";
}
function loadSort(): SortSpec {
  if (typeof window === "undefined") return DEFAULT_SORT;
  try {
    const raw = window.localStorage.getItem(SORT_KEY);
    if (!raw) return DEFAULT_SORT;
    const s = JSON.parse(raw) as Partial<SortSpec>;
    const okKey = s.key === "updated" || s.key === "created" || s.key === "title";
    const okDir = s.dir === "asc" || s.dir === "desc";
    return okKey && okDir ? { key: s.key!, dir: s.dir! } : DEFAULT_SORT;
  } catch {
    return DEFAULT_SORT;
  }
}

export function VaultPanel({
  vaults: initialVaults,
  user,
  provider,
  storageRoot,
}: {
  vaults: VaultDescriptor[];
  user: VaultUser;
  provider: StorageProvider;
  storageRoot: string;
}) {
  const t = useT();
  const { locale } = useLocale();
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
  // 本设备记住:解锁/创建成功后,是否把 non-extractable 主密钥持久化到 IndexedDB(方案①)。
  const [rememberDevice, setRememberDevice] = useState(true);
  // 当前选中保险库在本设备是否有可用的记住密钥(解锁界面:决定是否显示「用本设备解锁」)。
  const [remembered, setRemembered] = useState(false);
  // 已进入的保险库在本设备是否记住了密钥(工作台菜单:决定是否显示「忘记本设备」)。
  const [enteredRemembered, setEnteredRemembered] = useState(false);
  // 手动「锁定」后置真,抑制 effect 立刻自动重入(整页刷新会重置 → 下次加载仍自动解锁)。
  const autoSuppress = useRef(false);
  // 已尝试过自动解锁的保险库 id(防 StrictMode 双调用重复 enterVault)。
  const autoTried = useRef<Set<string>>(new Set());

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
  const [folders, setFolders] = useState<FolderMeta[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 新建条目时立刻插入树里的占位条目 id(未保存草稿);取消/切走则移除。
  const [draftId, setDraftId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(0);
  // 详情区两种模式:打开已有条目为只读 preview;新建/点击编辑进入 edit。
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  // 编辑态的所属文件夹
  const [editFolderId, setEditFolderId] = useState<string | null>(null);

  // 条目列表显示方式(铺平 / 目录)与排序;均持久化,跨刷新保留。
  const [viewMode, setViewMode] = useState<ViewMode>(loadView);
  const [sort, setSort] = useState<SortSpec>(loadSort);
  function changeView(m: ViewMode) {
    setViewMode(m);
    // 铺平模式无目录导航,回到「全部」,新建条目落根目录而非残留的文件夹选择。
    if (m === "flat") setNav({ kind: "all" });
    try {
      window.localStorage.setItem(VIEW_KEY, m);
    } catch {
      /* 隐私模式忽略 */
    }
  }
  function changeSort(s: SortSpec) {
    setSort(s);
    try {
      window.localStorage.setItem(SORT_KEY, JSON.stringify(s));
    } catch {
      /* 隐私模式忽略 */
    }
  }
  // 月份分组表头格式化(铺平+按时间排序时使用):zh→「2026年6月」,en→「June 2026」。
  const monthFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
        year: "numeric",
        month: "long",
      }),
    [locale],
  );

  // 侧栏导航:全部 / 某文件夹
  type Nav = { kind: "all" } | { kind: "folder"; id: string };
  const [nav, setNav] = useState<Nav>({ kind: "all" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // 拖拽:被拖动的条目 id;当前悬停的放置目标(文件夹 id)。
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // 搜索结果(扁平):仅在搜索框非空时使用,跨所有文件夹按标题匹配。
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return entries.filter((e) => (e.title || "").toLowerCase().includes(q));
  }, [entries, query]);

  // 「在网盘中打开」链接:由相对路径直接拼出(不查网盘,无延时)。
  // 百度 → 文件所在文件夹的网页深链;Google 可见文件夹 → 按文件名搜索;Google appDataFolder 隐藏 → 无可打开链接。
  function netdiskUrl(relPath: string): string | null {
    const clean = relPath.replace(/^\/+/, "");
    if (provider === "baidu") {
      const abs = `${storageRoot}/${clean}`;
      const folderAbs = abs.slice(0, abs.lastIndexOf("/")) || "/";
      return `https://pan.baidu.com/disk/main#/index?category=all&path=${encodeURIComponent(folderAbs)}`;
    }
    if (provider === "google") {
      if (storageRoot === "appDataFolder") return null; // 隐藏沙盒,网页端打不开
      const name = clean.slice(clean.lastIndexOf("/") + 1);
      return `https://drive.google.com/drive/search?q=${encodeURIComponent(name)}`;
    }
    return null;
  }

  // 进入解锁界面时:探测本设备是否记住了该库密钥。记住且校验通过 →
  // 新鲜加载(未被手动锁定抑制)直接自动解锁;否则只点亮「用本设备解锁」按钮。
  useEffect(() => {
    if (phase !== "unlock" || !selectedVault) {
      setRemembered(false);
      return;
    }
    const v = selectedVault;
    let alive = true;
    setRemembered(false);
    (async () => {
      const k = await loadKey(v.id);
      if (!alive || !k) return;
      const ok = await checkVerifier(k, b64decode(v.verifier));
      if (!alive) return;
      if (!ok) {
        // 记住的密钥与当前校验块不符(库被重建等)→ 清掉失效密钥。
        await deleteKey(v.id);
        return;
      }
      setRemembered(true);
      if (!autoSuppress.current && !autoTried.current.has(v.id)) {
        autoTried.current.add(v.id);
        await enterVault(k, v);
      }
    })().catch(() => {
      /* 自动解锁失败不打扰用户,回退到手动输入 */
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, selectedVault]);

  async function enterVault(key: CryptoKey, descriptor: VaultDescriptor) {
    const v = openBrowserVault(key, { id: descriptor.id, dir: descriptor.dir });
    vaultRef.current = v;
    setSelectedVault(descriptor);
    setPhase("unlocked");
    // 记录该库在本设备是否记住了密钥(工作台据此展示「忘记本设备」)。
    loadKey(descriptor.id)
      .then((k) => setEnteredRemembered(!!k))
      .catch(() => setEnteredRemembered(false));
    setLoadingEntries(true);
    setStatus(null);
    try {
      const list = await v.load();
      setEntries(list);
      setFolders(v.folders);
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
      if (rememberDevice) {
        try {
          await saveKey(selectedVault.id, k);
        } catch {
          /* 持久化失败不阻断解锁;本次仍正常进入 */
        }
      }
      await enterVault(k, selectedVault);
    } catch (err) {
      setStatus(t("st_unlock_fail", String(err)));
    } finally {
      setBusy(false);
    }
  }

  // ---- 一键解锁(用本设备记住的密钥,免输助记词) ----
  async function unlockRemembered() {
    const v = selectedVault;
    if (!v) return;
    setBusy(true);
    setStatus(t("st_unlocking"));
    try {
      const k = await loadKey(v.id);
      if (!k) {
        setRemembered(false);
        setStatus(null);
        return;
      }
      if (!(await checkVerifier(k, b64decode(v.verifier)))) {
        await deleteKey(v.id);
        setRemembered(false);
        setStatus(t("st_mismatch"));
        return;
      }
      await enterVault(k, v);
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
      if (rememberDevice) {
        try {
          await saveKey(id, k);
        } catch {
          /* 持久化失败不阻断创建 */
        }
      }
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
  // 丢弃未保存的新建草稿(从树里移除占位条目)。
  function discardDraft() {
    if (!draftId) return;
    setEntries((prev) => prev.filter((e) => e.id !== draftId));
    setDraftId(null);
  }

  async function openEntry(meta: EntryMeta) {
    if (meta.id === draftId) return; // 点击正在编辑的草稿本身:保持编辑态
    discardDraft();
    const v = vaultRef.current;
    if (!v) return;
    setBusy(true);
    setStatus(t("st_decrypting", meta.title || t("untitled")));
    try {
      const doc = await v.open(meta.id);
      setSelectedId(doc.id);
      setTitle(doc.title);
      setContent(doc.content);
      // 文件夹以 index 元数据为准(文件夹增删后 doc 内可能已过期)
      setEditFolderId(meta.folderId);
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
      const result = await v.save({
        id: selectedId,
        title: title.trim(),
        content,
        folderId: editFolderId,
      });
      setEntries(result.entries);
      setSelectedId(result.id);
      setDraftId(null); // 草稿已落库,不再是草稿
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

  // 新建条目;不传 folderId 时默认归到当前选中的文件夹(或根)。
  // 立刻在树里插入一个未命名占位条目(草稿),保存后转为正式条目,取消则移除。
  function newItem(folderId: string | null = nav.kind === "folder" ? nav.id : null) {
    discardDraft();
    const id = newId();
    const now = Date.now();
    const draft: EntryMeta = { id, title: "", folderId, createdAt: now, updatedAt: now, size: 0 };
    setEntries((prev) => [...prev, draft]);
    setDraftId(id);
    setSelectedId(id);
    setTitle("");
    setContent("");
    setEditFolderId(folderId);
    if (folderId) setExpanded((prev) => new Set(prev).add(folderId)); // 在某文件夹下新建则展开它
    setMode("edit"); // 新建直接进编辑
    setStatus(null);
  }

  // 拖拽放置:把条目移动到某文件夹(null=根)。只改 index 元数据。
  async function moveItemToFolder(itemId: string, folderId: string | null) {
    const v = vaultRef.current;
    if (!v) return;
    if (itemId === draftId) return; // 未保存草稿不参与移动(尚未入库)
    const e = entries.find((x) => x.id === itemId);
    if (!e || e.folderId === folderId) return;
    setBusy(true);
    try {
      const res = await v.moveEntry(itemId, folderId);
      setEntries(res.entries);
      setPending(v.pendingCount());
      if (folderId) setExpanded((prev) => new Set(prev).add(folderId)); // 展开目标,移动后立即可见
      setStatus(res.synced ? t("st_saved") : t("st_saved_local", res.syncError ?? ""));
    } catch (err) {
      setStatus(t("st_save_fail", String(err)));
    } finally {
      setBusy(false);
    }
  }

  function editEntry() {
    setMode("edit");
    setStatus(null);
  }

  async function cancelEdit() {
    setStatus(null);
    // 新建未保存 → 移除树里的占位草稿,回到空预览。
    if (draftId) {
      discardDraft();
      setSelectedId(null);
      setTitle("");
      setContent("");
      setMode("preview");
      return;
    }
    // 编辑已有条目 → 放弃改动,重新读回原文进入预览。
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

  // ---- 文件夹管理 ----
  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runFolderOp(op: () => Promise<{ synced: boolean; syncError?: string }>) {
    const v = vaultRef.current;
    if (!v) return;
    setBusy(true);
    try {
      const res = await op();
      setFolders(v.folders);
      setEntries(v.entries);
      setPending(v.pendingCount());
      if (!res.synced) setStatus(t("st_saved_local", res.syncError ?? ""));
    } catch (err) {
      setStatus(t("st_save_fail", String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function addFolderUnder(parentId: string | null) {
    const v = vaultRef.current;
    if (!v) return;
    setBusy(true);
    try {
      const res = await v.addFolder(t("new_folder"), parentId);
      setFolders(res.folders);
      setPending(v.pendingCount());
      if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
      // 立即进入重命名
      setRenamingId(res.id);
      setRenameValue(t("new_folder"));
      if (!res.synced) setStatus(t("st_saved_local", res.syncError ?? ""));
    } catch (err) {
      setStatus(t("st_save_fail", String(err)));
    } finally {
      setBusy(false);
    }
  }

  function startRename(f: FolderMeta) {
    setRenamingId(f.id);
    setRenameValue(f.name);
  }
  async function commitRename() {
    const id = renamingId;
    if (!id) return;
    const name = renameValue.trim();
    setRenamingId(null);
    if (name) await runFolderOp(() => vaultRef.current!.renameFolder(id, name));
  }
  async function removeFolder(f: FolderMeta) {
    if (!window.confirm(t("confirm_delete_folder", f.name || t("new_folder")))) return;
    if (nav.kind === "folder" && nav.id === f.id) setNav({ kind: "all" });
    await runFolderOp(() => vaultRef.current!.deleteFolder(f.id));
  }

  // 锁定:清内存密钥 + 清工作台状态,回到选择/解锁界面。保留本设备记住的密钥,
  // 但抑制自动重入(本次需手动「用本设备解锁」)。整页刷新会重置 autoSuppress → 下次加载仍自动解锁。
  function lock() {
    vaultRef.current = null;
    setContent("");
    setTitle("");
    setEntries([]);
    setFolders([]);
    setSelectedId(null);
    setDraftId(null);
    setEnteredRemembered(false);
    autoSuppress.current = true;
    goPick();
  }

  // 忘记本设备:删除当前库在本机记住的密钥,然后锁定(下次必须重输助记词)。
  async function forgetDevice() {
    const v = selectedVault;
    if (v) {
      try {
        await deleteKey(v.id);
      } catch {
        /* 删除失败不阻断锁定 */
      }
      autoTried.current.delete(v.id);
    }
    setRemembered(false);
    lock();
  }

  // ============================ 选择保险库 ============================
  if (phase === "select") {
    return (
      <CenteredShell user={user}>
        <Card {...testId("vault-select")} className="w-full">
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
        <Card {...testId("vault-create")} className="w-full">
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
        <Card {...testId("vault-unlock")} className="w-full">
          <CardHeader>
            <CardTitle>{t("unlock_title")}</CardTitle>
            <CardDescription>
              {selectedVault ? t("unlock_desc_named", vaultName(selectedVault)) : t("unlock_desc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {remembered ? (
              <>
                <Button onClick={unlockRemembered} disabled={busy} size="lg">
                  {t("btn_unlock_remembered")}
                </Button>
                <Button variant="link" size="sm" onClick={forgetDevice} disabled={busy}>
                  {t("btn_forget_device")}
                </Button>
                <div className="border-t border-[var(--color-border)]" />
              </>
            ) : null}
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
            <label className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                className="h-4 w-4 accent-[var(--color-primary)]"
              />
              {t("remember_device")}
            </label>
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

  // ============================ 工作台:两栏(目录树 + 详情) ============================
  const selected = entries.find((e) => e.id === selectedId) ?? null;
  const searching = query.trim().length > 0;

  // 当前排序的条目比较器(铺平列表与目录内条目共用)。
  function cmpEntries(a: EntryMeta, b: EntryMeta): number {
    let d: number;
    if (sort.key === "title") d = (a.title || "").localeCompare(b.title || "");
    else if (sort.key === "created") d = a.createdAt - b.createdAt;
    else d = a.updatedAt - b.updatedAt;
    // 同值时用标题兜底,保证顺序稳定。
    if (d === 0) d = (a.title || "").localeCompare(b.title || "");
    return sort.dir === "asc" ? d : -d;
  }

  // 文件夹与条目合并为一棵目录树。
  const childFolders = (parentId: string | null) =>
    folders.filter((f) => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
  const entriesIn = (parentId: string | null) =>
    entries.filter((e) => e.folderId === parentId).sort(cmpEntries);

  // 铺平模式:忽略文件夹层级,所有条目按当前排序展开。
  // 按时间排序时(updated/created)再切成「按月」时间区域;按标题排序时为纯扁平列表。
  // 注:此处在解锁分支(早期 return 之后),不能用 hooks,直接计算即可。
  const flatSorted = [...entries].sort(cmpEntries);
  const flatGroups = (() => {
    if (sort.key === "title") return null; // 标题排序不分月
    const timeOf = (e: EntryMeta) => (sort.key === "created" ? e.createdAt : e.updatedAt);
    const groups: { key: string; label: string; items: EntryMeta[] }[] = [];
    for (const e of flatSorted) {
      const d = new Date(timeOf(e));
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(e);
      else groups.push({ key, label: monthFmt.format(d), items: [e] });
    }
    return groups;
  })();

  // 条目的文件夹路径面包屑(根 → "全部条目")。
  function folderPathOf(folderId: string | null): string {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const parts: string[] = [];
    let cur: string | null = folderId;
    while (cur) {
      const f = byId.get(cur);
      if (!f) break;
      parts.unshift(f.name || t("new_folder"));
      cur = f.parentId;
    }
    return parts.length ? parts.join(" / ") : t("all_items");
  }

  // 单个条目(树叶):点击在右侧详情打开;左侧句柄可拖动到文件夹。
  function itemRow(e: EntryMeta, depth: number): React.ReactNode {
    const active = e.id === selectedId;
    const label = e.title || t("untitled");
    return (
      <div
        key={`e:${e.id}`}
        className={`group/item flex items-center rounded-[var(--radius)] pr-2 ${
          dragId === e.id ? "opacity-50" : ""
        } ${
          active
            ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
            : "hover:bg-[var(--color-accent)]"
        }`}
        style={{ paddingLeft: depth * 14 }}
      >
        {/* 拖动到文件夹:仅目录模式有放置目标,铺平模式不显示句柄 */}
        {viewMode === "folder" ? (
          <Tooltip label={t("drag_to_move")}>
            <span
              draggable
              onDragStart={(ev) => {
                ev.dataTransfer.effectAllowed = "move";
                ev.dataTransfer.setData("text/plain", e.id);
                setDragId(e.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropTarget(null);
              }}
              className={`flex h-7 w-5 shrink-0 cursor-grab items-center justify-center opacity-0 transition-opacity group-hover/item:opacity-100 active:cursor-grabbing ${
                active ? "text-[var(--color-primary-foreground)]" : "text-[var(--color-muted-foreground)]"
              }`}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </span>
          </Tooltip>
        ) : (
          <span className="w-2 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => openEntry(e)}
          disabled={busy}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-sm"
        >
          <FileText
            className={`h-3.5 w-3.5 shrink-0 ${active ? "" : "text-[var(--color-muted-foreground)]"}`}
          />
          <span className="truncate">{label}</span>
        </button>
      </div>
    );
  }

  // 目录树递归:某父节点下「子文件夹(含其展开内容)+ 直属条目」。
  function treeRows(parentId: string | null, depth: number): React.ReactNode[] {
    const rows: React.ReactNode[] = [];
    for (const f of childFolders(parentId)) {
      const hasKids =
        folders.some((c) => c.parentId === f.id) || entries.some((e) => e.folderId === f.id);
      const open = expanded.has(f.id);
      const active = nav.kind === "folder" && nav.id === f.id;
      rows.push(
        <div
          key={`f:${f.id}`}
          onDragOver={(ev) => {
            if (!dragId) return;
            ev.preventDefault();
            ev.dataTransfer.dropEffect = "move";
            setDropTarget(f.id);
          }}
          onDragLeave={() => setDropTarget((p) => (p === f.id ? null : p))}
          onDrop={(ev) => {
            ev.preventDefault();
            const id = dragId ?? ev.dataTransfer.getData("text/plain");
            setDropTarget(null);
            setDragId(null);
            if (id) moveItemToFolder(id, f.id);
          }}
          className={`group flex items-center rounded-[var(--radius)] pr-1 ${
            dropTarget === f.id
              ? "ring-1 ring-[var(--color-primary)] ring-inset bg-[var(--color-accent)]"
              : active
                ? "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]"
                : "hover:bg-[var(--color-accent)]"
          }`}
          style={{ paddingLeft: depth * 14 }}
        >
          <button
            type="button"
            onClick={() => hasKids && toggleExpand(f.id)}
            className="flex h-7 w-5 shrink-0 items-center justify-center text-[var(--color-muted-foreground)]"
            aria-hidden={!hasKids}
          >
            {hasKids ? (
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
            ) : null}
          </button>
          <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
          {renamingId === f.id ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenamingId(null);
              }}
              className="ml-1.5 h-6 min-w-0 flex-1 rounded border border-[var(--color-input)] bg-[var(--color-surface)] px-1 text-sm"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setNav({ kind: "folder", id: f.id });
                if (hasKids && !open) toggleExpand(f.id);
              }}
              className="ml-1.5 min-w-0 flex-1 truncate py-1.5 text-left text-sm"
            >
              {f.name || t("new_folder")}
            </button>
          )}
          <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
            <Tooltip label={t("new_item")}>
              <button
                type="button"
                onClick={() => newItem(f.id)}
                disabled={busy}
                className="flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--color-surface)]"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <DropdownMenu>
              <Tooltip label={t("more_actions")}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={busy}
                    className="flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--color-surface)]"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => addFolderUnder(f.id)}>
                  <FolderPlus className="h-4 w-4" />
                  {t("add_subfolder")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => startRename(f)}>
                  <Pencil className="h-4 w-4" />
                  {t("rename")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => removeFolder(f)}>
                  <Trash2 className="h-4 w-4" />
                  {t("delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </div>,
      );
      if (open) rows.push(...treeRows(f.id, depth + 1));
    }
    for (const e of entriesIn(parentId)) rows.push(itemRow(e, depth));
    return rows;
  }

  // 条目图标:首字母 + 紫色渐变圆角方块(对齐 1Password 的条目头像)。
  function itemIcon(text: string) {
    const ch = (text || "").trim().slice(0, 1).toUpperCase() || "·";
    return (
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--color-primary)] to-[oklch(0.55_0.21_292)] text-2xl font-semibold text-[var(--color-primary-foreground)] shadow-sm">
        {ch}
      </span>
    );
  }

  const previewName = selected?.title || t("untitled");

  return (
    <div {...testId("vault-workbench")} className="grid h-screen grid-cols-[20rem_1fr] overflow-hidden">
      {/* 导航:文件夹 + 条目 合并的目录树 */}
      <aside {...testId("vault-nav")} className="flex flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <div {...testId("vault-nav-header")} className="flex h-14 items-center justify-between gap-2 border-b border-[var(--color-border)] px-4">
          <Wordmark className="text-base" />
          {/* 分体按钮:主体直接新建条目,右侧三角下拉提供「新建文件夹」 */}
          <div className="flex items-center">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => newItem()}
              disabled={busy}
              className="rounded-r-none"
            >
              {t("new_item")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  aria-label={t("more_actions")}
                  className="rounded-l-none border-l border-[var(--color-border)] px-1.5"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    // 文件夹只在目录模式可见,新建时顺带切过去
                    changeView("folder");
                    addFolderUnder(viewMode === "folder" && nav.kind === "folder" ? nav.id : null);
                  }}
                >
                  <FolderPlus className="h-4 w-4" />
                  {t("new_folder")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div {...testId("vault-nav-search")} className="border-b border-[var(--color-border)] p-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search_placeholder")}
            className="h-9"
          />
        </div>
        {/* 显示方式(铺平 / 目录)+ 排序;搜索时隐藏(搜索结果跨模式扁平展示) */}
        {!searching ? (
          <div
            {...testId("vault-view-controls")}
            className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-2 py-2"
          >
            <div className="inline-flex rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
              <Tooltip label={t("view_flat_hint")}>
                <button
                  type="button"
                  onClick={() => changeView("flat")}
                  aria-label={t("view_flat")}
                  className={`flex h-7 w-8 items-center justify-center rounded-[calc(var(--radius)-2px)] transition-colors ${
                    viewMode === "flat"
                      ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                      : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  }`}
                >
                  <LayoutList className="h-4 w-4" />
                </button>
              </Tooltip>
              <Tooltip label={t("view_folder_hint")}>
                <button
                  type="button"
                  onClick={() => changeView("folder")}
                  aria-label={t("view_folder")}
                  className={`flex h-7 w-8 items-center justify-center rounded-[calc(var(--radius)-2px)] transition-colors ${
                    viewMode === "folder"
                      ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                      : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  }`}
                >
                  <FolderTree className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
            <DropdownMenu>
              <Tooltip label={t("sort_label")}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("sort_label")}
                    className="flex h-7 items-center gap-1.5 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  >
                    <ArrowDownUp className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">
                      {t(
                        SORT_OPTIONS.find((o) => o.key === sort.key && o.dir === sort.dir)?.label ??
                          "sort_label",
                      )}
                    </span>
                  </button>
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent align="end">
                {SORT_OPTIONS.map((o) => {
                  const on = sort.key === o.key && sort.dir === o.dir;
                  return (
                    <DropdownMenuItem
                      key={`${o.key}:${o.dir}`}
                      onSelect={() => changeSort({ key: o.key, dir: o.dir })}
                    >
                      {on ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <span className="h-4 w-4" />
                      )}
                      {t(o.label)}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
        <div {...testId("vault-tree")} className="flex-1 overflow-y-auto p-2">
          {loadingEntries ? (
            <p className="px-3 py-8 text-center text-sm text-[var(--color-muted-foreground)]">
              {t("loading_entries")}
            </p>
          ) : searching ? (
            // 搜索:跨模式扁平结果
            <div {...testId("vault-tree-list")} className="flex flex-col">
              {filtered.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-[var(--color-muted-foreground)]">
                  {t("empty_search")}
                </p>
              ) : (
                filtered.map((e) => itemRow(e, 0))
              )}
            </div>
          ) : viewMode === "flat" ? (
            // ---- 铺平:忽略目录,按月时间区域 / 或纯排序列表 ----
            entries.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-[var(--color-muted-foreground)]">
                {t("empty_vault")}
              </p>
            ) : (
              <div {...testId("vault-flat-list")} className="flex flex-col">
                {flatGroups
                  ? flatGroups.map((g) => (
                      <section key={g.key} {...testId("vault-flat-group")} className="mb-1">
                        <h3 className="sticky top-0 z-[1] bg-[var(--color-surface-2)] px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                          {g.label}
                        </h3>
                        {g.items.map((e) => itemRow(e, 0))}
                      </section>
                    ))
                  : flatSorted.map((e) => itemRow(e, 0))}
              </div>
            )
          ) : (
            // ---- 目录:文件夹树 ----
            <div {...testId("vault-tree-list")} className="flex flex-col">
              {entries.length === 0 && folders.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-[var(--color-muted-foreground)]">
                  {t("empty_vault")}
                </p>
              ) : (
                treeRows(null, 0)
              )}
            </div>
          )}
        </div>
      </aside>

      {/* 详情 / 编辑(布局对齐 1Password) */}
      <section {...testId("vault-detail")} className="flex flex-col bg-[var(--color-surface-2)]">
        <div {...testId("vault-detail-scroll")} className="flex-1 overflow-y-auto">
          {/* 顶栏:同步状态 + 控件 + 用户菜单(编辑/预览共用) */}
          <div {...testId("vault-detail-header")} className="flex h-14 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-background)] px-6">
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
            <div className="flex items-center gap-2.5">
              <HeaderControls />
              <UserMenu
                name={user.name}
                avatar={user.avatar}
                onLock={lock}
                onForget={enteredRemembered ? forgetDevice : undefined}
              />
            </div>
          </div>

          {mode === "edit" ? (
            // ---- 编辑模式:满宽条目头(文件夹路径 + 取消/保存)+ 居中正文 ----
            <div {...testId("vault-item-edit")} className="w-full">
              <div
                {...testId("vault-item-edit-header")}
                className="flex items-center justify-between gap-3 px-6 py-3"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(45deg, color-mix(in oklch, var(--color-primary) 14%, transparent) 0, color-mix(in oklch, var(--color-primary) 14%, transparent) 10px, color-mix(in oklch, var(--color-primary) 5%, transparent) 10px, color-mix(in oklch, var(--color-primary) 5%, transparent) 20px)",
                }}
              >
                <div className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{folderPathOf(editFolderId)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={cancelEdit} disabled={busy}>
                    {t("btn_cancel")}
                  </Button>
                  <Button size="sm" onClick={save} disabled={busy}>
                    {t("btn_save")}
                  </Button>
                </div>
              </div>
              <div {...testId("vault-item-edit-body")} className="mx-auto w-full max-w-[640px] px-6 py-8">
                <div {...testId("vault-item-header")} className="mb-6 flex items-center gap-4">
                  {itemIcon(title)}
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t("field_title_ph")}
                    className="h-12 min-w-0 flex-1 text-lg font-semibold"
                  />
                </div>
                <div {...testId("vault-item-content-card")} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-sm">
                  <label className="block text-xs font-medium text-[var(--color-primary)]">
                    {t("field_content")}
                  </label>
                  <Textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={t("content_ph")}
                    className="mt-1 min-h-[18rem] resize-none border-0 bg-transparent p-0 text-sm leading-relaxed shadow-none focus-visible:ring-0"
                  />
                </div>
              </div>
            </div>
          ) : selectedId ? (
            // ---- 预览模式:满宽条目头(文件夹路径 + 编辑)+ 居中正文 ----
            <div {...testId("vault-item-preview")} className="w-full">
              <div
                {...testId("vault-item-preview-header")}
                className="flex items-center justify-between gap-3 px-6 py-3"
              >
                <div className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{folderPathOf(selected?.folderId ?? null)}</span>
                </div>
                <Button size="sm" variant="secondary" onClick={editEntry} disabled={busy}>
                  <Pencil className="h-3.5 w-3.5" />
                  {t("btn_edit")}
                </Button>
              </div>
              <div {...testId("vault-item-preview-body")} className="mx-auto w-full max-w-[640px] px-6 py-8">
                <div {...testId("vault-item-header")} className="mb-6 flex items-center gap-4">
                  {itemIcon(previewName)}
                  <h2 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">
                    {previewName}
                  </h2>
                </div>
                <div {...testId("vault-item-content-card")} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-accent)] px-4 py-3">
                  <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {content ? (
                      content
                    ) : (
                      <span className="text-[var(--color-muted-foreground)]">{t("content_empty")}</span>
                    )}
                  </div>
                </div>
                {selected ? (
                  <div className="mt-6 flex items-center justify-between gap-3 px-1 text-xs text-[var(--color-muted-foreground)]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {t("last_edited", new Date(selected.updatedAt).toLocaleString())}
                      </span>
                    </span>
                    {selectedVault && netdiskUrl(itemRelPath(selectedVault.dir, selected.id)) ? (
                      <a
                        href={netdiskUrl(itemRelPath(selectedVault.dir, selected.id))!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-[var(--color-primary)] hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {t(
                          "open_in_netdisk",
                          t(provider === "google" ? "provider_google" : "provider_baidu"),
                        )}
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            // ---- 无选中:空态 ----
            <div {...testId("vault-item-empty")} className="flex min-h-[50vh] items-center justify-center p-6 text-center text-sm text-[var(--color-muted-foreground)]">
              {t("preview_empty")}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// 居中外壳:选择/解锁/创建页用,顶栏带品牌 + 语言/主题切换 + 用户菜单。
function CenteredShell({ children, user }: { children: React.ReactNode; user: VaultUser }) {
  return (
    <main {...testId("vault-shell")} className="relative flex min-h-screen flex-col bg-[var(--color-background)]">
      <div className="hero-aurora" aria-hidden="true" />
      <header {...testId("vault-shell-header")} className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-6 py-5">
        <Wordmark className="text-lg" />
        <div className="flex items-center gap-3">
          <HeaderControls />
          <UserMenu name={user.name} avatar={user.avatar} />
        </div>
      </header>
      <div {...testId("vault-shell-body")} className="relative z-10 flex flex-1 flex-col items-center justify-center gap-8 px-4 pb-16">
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
