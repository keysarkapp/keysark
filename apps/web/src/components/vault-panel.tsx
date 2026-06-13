"use client";

// 端到端加密保险库面板(支持多保险库)。助记词与派生密钥只在浏览器,绝不发服务端。
// 登录流:0 个库 → 创建;1 个库 → 直接解锁;≥2 个库 → 先选库,再输入该库助记词。
// 数据模型:keysark.json 注册表(明文元数据 + 密文校验块)+ 每个库各自的 index/items(见 @/lib/vault、@/lib/registry)。
// UI 参照 1Password:选择/解锁/创建为居中卡片,已解锁为「条目列 + 详情」两栏工作台。
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
  scorePassword,
  validateMnemonic,
  type StrengthReason,
} from "@keysark/crypto";
import { newId } from "@keysark/db/id";
import {
  ArrowDownUp,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  File as FileIcon,
  FileText,
  Folder,
  FolderPlus,
  FolderTree,
  GripVertical,
  History,
  LayoutList,
  Loader2,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
  Upload,
} from "lucide-react";
import { Logo, Wordmark } from "./brand";
import { CliAccessDialog } from "./cli-access-dialog";
import { ServiceProviderBadge } from "./service-provider";
import { HeaderControls } from "./controls";
import { UserMenu } from "./user-menu";
import { useLocale, useT } from "./providers";
import { Vault, openBrowserVault, itemRelPath, type EntryMeta, type FolderMeta } from "@/lib/vault";
import type { MsgKey } from "@/lib/i18n";
import {
  changePassword,
  clearCredential,
  hasPassword,
  setPassword,
  unlock as unlockCredential,
} from "@/lib/vault-lock";
import {
  IDLE_OPTIONS,
  loadIdleMinutes,
  normalizeIdleMinutes,
  saveIdleMinutes,
  startIdleLock,
} from "@/lib/idle-lock";
import { exportVaultBackupPdf } from "@/lib/vault-pdf";
import { exportEncryptedBackupHtml } from "@/lib/vault-backup-html";
import { testId } from "@/lib/test-id";
import { FilePreview } from "./file-preview/FilePreview";
import { InlineHighlight } from "./file-preview/CodePreview";
import { previewSpecOf } from "@/lib/file-preview";
import { VersionHistory } from "./version-history/VersionHistory";
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

// 侧边栏宽度(px):拖右缘调整,双击恢复默认;持久化 localStorage。
const NAV_WIDTH_KEY = "keysark.vault.navWidth";
const NAV_WIDTH_DEFAULT = 320; // = 原 20rem
const NAV_WIDTH_MIN = 220;
const NAV_WIDTH_MAX = 560;
function clampNavWidth(w: number): number {
  return Math.min(NAV_WIDTH_MAX, Math.max(NAV_WIDTH_MIN, Math.round(w)));
}
function loadNavWidth(): number {
  if (typeof window === "undefined") return NAV_WIDTH_DEFAULT;
  const n = Number(window.localStorage.getItem(NAV_WIDTH_KEY));
  return Number.isFinite(n) && n > 0 ? clampNavWidth(n) : NAV_WIDTH_DEFAULT;
}

// 文件加密上传:单文件明文上限 100MB(对齐 proposal;加密一次性在内存做,不分片)。
const MAX_FILE_BYTES = 100 * 1024 * 1024;
function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || Number.isInteger(v) ? 0 : 1)} ${units[i]}`;
}
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
  // 存储后端展示名(同步状态文案用):Google Drive / 百度网盘。
  const storeName = t(provider === "google" ? "provider_google" : "provider_baidu");
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 上传文件时记住目标文件夹(隐藏 input 的 change 回调里取用)。
  const pendingUploadFolder = useRef<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 解锁输入
  const [mnemonicInput, setMnemonicInput] = useState("");
  // 当前选中保险库在本机是否已设解锁密码(null=探测中;决定解锁界面显示密码框还是助记词框)。
  const [credExists, setCredExists] = useState<boolean | null>(null);
  // 密码解锁输入;pwError = 密码错误等需要标红的提示(独立于灰色状态条)。
  const [passwordInput, setPasswordInput] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  // 有凭据但用户点了「忘记密码?用助记词解锁」:本次走助记词,验证后重新设密码。
  const [phraseFallback, setPhraseFallback] = useState(false);
  // 助记词验证通过 / 新库创建完成后,待设密码的 {主密钥, 助记词};设完密码才进库。
  const [setup, setSetup] = useState<{ key: CryptoKey; mnemonic: string } | null>(null);
  // 设置密码表单(二次确认)
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");

  // 修改密码弹窗(工作台;需当前密码,无「移除密码」)
  const [showChangePw, setShowChangePw] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [chPw, setChPw] = useState("");
  const [chPw2, setChPw2] = useState("");
  const [chError, setChError] = useState<string | null>(null);

  // 闲置自动锁定:时长(分钟)持久化 localStorage;弹窗里调,实时生效。
  const [idleMinutes, setIdleMinutes] = useState(loadIdleMinutes);
  const [showAutoLock, setShowAutoLock] = useState(false);
  const [idleCustom, setIdleCustom] = useState("");

  // 创建流程
  const [newLabel, setNewLabel] = useState("");
  const [newMnemonic, setNewMnemonic] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false); // 已下载备份(PDF 或加密 HTML)
  // 加密 HTML 备份弹窗(备份密码 + 二次确认)
  const [showHtmlExport, setShowHtmlExport] = useState(false);
  const [bkPw, setBkPw] = useState("");
  const [bkPw2, setBkPw2] = useState("");
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const challengeIdx = useMemo(() => {
    if (!newMnemonic) return [];
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
  // 最近一次「本地与网盘确认一致」的时刻(待同步清零时打点);顶栏显示相对时间。
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false); // 手动同步进行中(头部按钮转圈用)
  const [revealed, setRevealed] = useState(false); // 预览内容是否已揭开(默认渐变遮罩盖住,防旁人窥屏)
  const [showCliHowto, setShowCliHowto] = useState(false); // 「通过 CLI 下载」对话框
  // 相对时间显示的刷新节拍:每 1 分钟走一格,驱动「x 分钟前」重算。
  const [nowTick, setNowTick] = useState(() => Date.now());
  // 详情区两种模式:打开已有条目为只读 preview;新建/点击编辑进入 edit。
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [showHistory, setShowHistory] = useState(false); // 历史版本面板(冷路径,点开才拉)
  const [deleteTarget, setDeleteTarget] = useState<EntryMeta | null>(null); // 待确认删除的条目(打开 AlertDialog)
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

  // 侧边栏宽度:拖右缘实时调整(pointer capture),松手持久化,双击恢复默认。
  const [navWidth, setNavWidth] = useState<number>(loadNavWidth);
  function persistNavWidth(w: number) {
    try {
      window.localStorage.setItem(NAV_WIDTH_KEY, String(w));
    } catch {
      /* 隐私模式忽略 */
    }
  }
  function startNavResize(ev: React.PointerEvent<HTMLDivElement>) {
    ev.preventDefault();
    const el = ev.currentTarget;
    el.setPointerCapture(ev.pointerId);
    // 侧边栏从视口左缘起,clientX 即目标宽度。
    const onMove = (e: PointerEvent) => setNavWidth(clampNavWidth(e.clientX));
    const done = (e: PointerEvent) => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", done);
      el.removeEventListener("pointercancel", done);
      persistNavWidth(clampNavWidth(e.clientX));
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", done);
    el.addEventListener("pointercancel", done);
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

  // 进入解锁界面时:探测该库在本机是否已设解锁密码,决定显示密码框还是助记词框。
  useEffect(() => {
    setPhraseFallback(false);
    setPasswordInput("");
    setPwError(null);
    if (phase !== "unlock" || !selectedVault) {
      setCredExists(null);
      return;
    }
    let alive = true;
    setCredExists(null);
    hasPassword(selectedVault.id)
      .then((has) => {
        if (alive) setCredExists(has);
      })
      .catch(() => {
        if (alive) setCredExists(false);
      });
    return () => {
      alive = false;
    };
  }, [phase, selectedVault]);

  // 闲置自动锁定:只在已解锁阶段挂载;时长变更 → effect 重跑 → 计时器即时重置。
  useEffect(() => {
    if (phase !== "unlocked") return;
    return startIdleLock(idleMinutes * 60_000, lock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, idleMinutes]);

  // 每 1 分钟刷新一次「最近同步」的相对时间显示(只在工作台运行)。
  useEffect(() => {
    if (phase !== "unlocked") return;
    const iv = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(iv);
  }, [phase]);

  // 同步 pending 计数;清零即「本地与网盘一致」,顺手打点最近同步时刻。
  function updatePending(v: Vault) {
    const n = v.pendingCount();
    setPending(n);
    if (n === 0) {
      setLastSyncAt(Date.now());
      setNowTick(Date.now());
    }
  }

  // 相对时间:刚刚 / x 秒前 / x 分钟前 / x 小时前 / x 天前(随 nowTick 每分钟重算)。
  function formatAgo(ts: number): string {
    const s = Math.max(0, Math.floor((nowTick - ts) / 1000));
    if (s < 10) return t("time_just_now");
    if (s < 60) return t("time_sec_ago", s);
    if (s < 3600) return t("time_min_ago", Math.floor(s / 60));
    if (s < 86400) return t("time_hour_ago", Math.floor(s / 3600));
    return t("time_day_ago", Math.floor(s / 86400));
  }

  // 修改密码:当前密码错(GCM 失败)→ 拒绝;成功后旧密码失效、助记词不变。
  async function submitChangePassword() {
    const v = selectedVault;
    if (!v || !curPw || !scorePassword(chPw).ok || chPw !== chPw2) return;
    setBusy(true);
    setChError(null);
    try {
      await changePassword(v.id, curPw, chPw);
      closeChangePw();
      setStatus(t("pw_changed"));
    } catch {
      setChError(t("st_wrong_password"));
    } finally {
      setBusy(false);
    }
  }

  function closeChangePw() {
    setShowChangePw(false);
    setCurPw("");
    setChPw("");
    setChPw2("");
    setChError(null);
  }

  function applyIdleMinutes(n: number) {
    setIdleMinutes(n);
    saveIdleMinutes(n);
  }

  async function enterVault(key: CryptoKey, descriptor: VaultDescriptor) {
    const v = openBrowserVault(key, { id: descriptor.id, dir: descriptor.dir });
    vaultRef.current = v;
    setSelectedVault(descriptor);
    setPhase("unlocked");
    setLastSyncAt(null); // 换库/重进时清掉上个库的同步时刻
    setLoadingEntries(true);
    setStatus(null);
    try {
      const list = await v.load();
      setEntries(list);
      setFolders(v.folders);
      updatePending(v);
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

  // ---- 助记词验证(无本机凭据 / 忘记密码时):通过后进入「设置密码」步骤,不直接进库 ----
  async function verifyPhrase() {
    const m = mnemonicInput.trim().replace(/\s+/g, " ");
    if (!validateMnemonic(m)) return setStatus(t("st_invalid_mnemonic"));
    if (!selectedVault) return setStatus(t("st_missing_meta"));
    setBusy(true);
    setStatus(null); // loading 效果在按钮上(spinner),不占状态条
    try {
      const k = await deriveKey(m);
      const verifierBytes = b64decode(selectedVault.verifier);
      if (!(await checkVerifier(k, verifierBytes))) {
        setStatus(t("st_mismatch"));
        return;
      }
      setMnemonicInput("");
      setStatus(null);
      setSetup({ key: k, mnemonic: m });
    } catch (err) {
      setStatus(t("st_unlock_fail", String(err)));
    } finally {
      setBusy(false);
    }
  }

  // ---- 密码解锁(本机已有加密凭据):密码解封助记词 → 派生主密钥 → 校验 → 进库 ----
  async function unlockWithPassword() {
    const v = selectedVault;
    if (!v || !passwordInput) return;
    setBusy(true);
    setPwError(null);
    setStatus(null); // loading 效果在按钮上(spinner),不占状态条
    try {
      let mnemonic: string;
      try {
        mnemonic = await unlockCredential(v.id, passwordInput);
      } catch {
        // GCM 认证失败 = 密码错误;标红提示,不泄露其他信息。
        setStatus(null);
        setPwError(t("st_wrong_password"));
        return;
      }
      const k = await deriveKey(mnemonic);
      if (!(await checkVerifier(k, b64decode(v.verifier)))) {
        // 凭据里的助记词与当前库校验块不符(库被重建等)→ 清掉失效凭据,回助记词流程。
        await clearCredential(v.id);
        setCredExists(false);
        setStatus(t("st_mismatch"));
        return;
      }
      setPasswordInput("");
      await enterVault(k, v);
    } catch (err) {
      setStatus(t("st_unlock_fail", String(err)));
    } finally {
      setBusy(false);
    }
  }

  // ---- 设置密码(强制步骤):封装助记词落本机凭据 → 进库 ----
  async function finishSetup() {
    const v = selectedVault;
    if (!v || !setup) return;
    if (!scorePassword(newPw).ok || newPw !== newPw2) return;
    setBusy(true);
    setStatus(t("st_setting_password"));
    try {
      try {
        await setPassword(v.id, setup.mnemonic, newPw);
      } catch {
        /* 凭据落库失败(如隐私模式)不阻断进入;下次仍走助记词 */
      }
      const key = setup.key;
      setSetup(null);
      setNewPw("");
      setNewPw2("");
      await enterVault(key, v);
    } catch (err) {
      setStatus(t("st_unlock_fail", String(err)));
    } finally {
      setBusy(false);
    }
  }

  // ---- 创建(新建保险库,追加进注册表) ----
  function genMnemonic() {
    setNewMnemonic(generateMnemonic());
    setDownloaded(false);
    setConfirming(false);
    setChallengeInput({});
    setStatus(null);
  }

  // 下载保险库备份 PDF(完整助记词只在此文件里;纯客户端生成,不走服务端)。
  async function downloadBackup() {
    if (!newMnemonic) return;
    setExporting(true);
    try {
      const label = vaults.length === 0 ? "default" : newLabel.trim() || "default";
      await exportVaultBackupPdf({
        mnemonic: newMnemonic,
        vaultName: label,
        url: window.location.origin,
        locale,
      });
      setDownloaded(true);
    } catch (err) {
      setStatus(t("st_save_fail", String(err)));
    } finally {
      setExporting(false);
    }
  }

  // 加密 HTML 备份:备份密码经 Argon2id 加密助记词,生成自解密单文件下载。
  async function downloadEncryptedBackup() {
    if (!newMnemonic) return;
    if (!scorePassword(bkPw).ok || bkPw !== bkPw2) return;
    setBusy(true);
    try {
      const label = vaults.length === 0 ? "default" : newLabel.trim() || "default";
      await exportEncryptedBackupHtml({
        mnemonic: newMnemonic,
        vaultName: label,
        url: window.location.origin,
        locale,
        password: bkPw,
      });
      setDownloaded(true);
      setShowHtmlExport(false);
      setBkPw("");
      setBkPw2("");
      setStatus(null);
    } catch (err) {
      setStatus(t("st_html_export_fail", String(err)));
    } finally {
      setBusy(false);
    }
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
      // 创建完成后强制设置本机解锁密码(unlock 界面因 setup 存在直接显示「设置密码」)。
      setSelectedVault(descriptor);
      setSetup({ key: k, mnemonic: newMnemonic });
      setNewMnemonic(null);
      setNewLabel("");
      setStatus(null);
      setPhase("unlock");
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
    setDownloaded(false);
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
    setShowHistory(false); // 切换条目时收起历史面板
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
      setRevealed(false); // 每次打开条目都重新盖上遮罩
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
      updatePending(v);
      setMode("preview"); // 保存后回到只读预览
      setRevealed(true); // 内容是用户刚编辑的,无需再遮
      setStatus(result.synced ? t("st_saved", storeName) : t("st_saved_local", storeName, result.syncError ?? ""));
    } catch (err) {
      setStatus(t("st_save_fail", String(err)));
    } finally {
      setBusy(false);
    }
  }

  // 触发隐藏的文件选择框(上传文件条目)。
  function pickFile(folderId: string | null = nav.kind === "folder" ? nav.id : null) {
    pendingUploadFolder.current = folderId;
    fileInputRef.current?.click();
  }

  // 选中文件后:前端校验大小 → 读字节 → 浏览器内加密上传(saveFile)。明文/密钥不离开浏览器。
  async function onPickedFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允许重复选同一文件
    if (!file) return;
    const v = vaultRef.current;
    if (!v) return;
    if (file.size > MAX_FILE_BYTES) {
      setStatus(t("file_too_large", humanSize(MAX_FILE_BYTES)));
      return;
    }
    discardDraft();
    setBusy(true);
    setStatus(t("st_uploading", file.name));
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await v.saveFile({
        title: file.name,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes,
        folderId: pendingUploadFolder.current,
      });
      setEntries(result.entries);
      setSelectedId(result.id);
      setContent("");
      setMode("preview");
      updatePending(v);
      setStatus(result.synced ? t("st_uploaded", storeName) : t("st_uploaded_local", storeName, result.syncError ?? ""));
    } catch (err) {
      setStatus(t("st_upload_fail", String(err)));
    } finally {
      setBusy(false);
    }
  }

  // 下载文件条目:openFile 取回明文字节 → Blob → 触发浏览器下载。解密只在浏览器。
  async function downloadFile(meta: EntryMeta) {
    const v = vaultRef.current;
    if (!v) return;
    setBusy(true);
    setStatus(t("st_downloading"));
    try {
      const bytes = await v.openFile(meta.id);
      const blob = new Blob([bytes as unknown as BlobPart], {
        type: meta.mimeType || "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = meta.filename || meta.title || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url); // 100MB 用完即释放,避免内存泄漏
      setStatus(null);
    } catch (err) {
      setStatus(t("st_download_fail", String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    const v = vaultRef.current;
    if (!v) return;
    setBusy(true);
    setSyncing(true);
    setStatus(t("st_syncing"));
    try {
      const { remaining } = await v.sync();
      // 待同步清零且不在编辑态时,从网盘重拉 index,带回其它设备(如 CLI)的改动;
      // 有 pending 时跳过重拉,避免远端 index 盖掉本地未推送的条目。
      if (remaining === 0 && mode !== "edit" && !draftId) {
        const list = await v.load();
        setEntries(list);
        setFolders(v.folders);
        if (selectedId) {
          const cur = list.find((e) => e.id === selectedId);
          if (!cur) {
            // 选中条目已在远端被删除
            setSelectedId(null);
            setShowHistory(false);
            setTitle("");
            setContent("");
          } else {
            // 重开当前条目,带回远端的新内容(本地有缓存时开销很小)
            const doc = await v.open(cur.id);
            setTitle(doc.title);
            setContent(doc.content);
            setEditFolderId(cur.folderId);
          }
        }
      }
      updatePending(v);
      // 全部同步成功不弹文案,顶栏「已同步 · 刚刚」即状态;有剩余才提示。
      setStatus(remaining === 0 ? null : t("pending_count", remaining));
    } catch (err) {
      updatePending(v);
      setStatus(t("st_sync_fail", String(err)));
    } finally {
      setBusy(false);
      setSyncing(false);
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
      updatePending(v);
      if (folderId) setExpanded((prev) => new Set(prev).add(folderId)); // 展开目标,移动后立即可见
      setStatus(res.synced ? t("st_saved", storeName) : t("st_saved_local", storeName, res.syncError ?? ""));
    } catch (err) {
      setStatus(t("st_save_fail", String(err)));
    } finally {
      setBusy(false);
    }
  }

  function editEntry() {
    setShowHistory(false);
    setMode("edit");
    setRevealed(true); // 编辑态内容必然可见;取消/保存回到预览也不再遮
    setStatus(null);
  }

  // 永久删除条目(含全部历史版本)。确认在 AlertDialog 里完成,这里只执行删除;删后清空当前选中。
  async function removeEntry(meta: EntryMeta) {
    const v = vaultRef.current;
    if (!v) return;
    setBusy(true);
    setStatus(t("st_deleting", meta.title || t("untitled")));
    try {
      const res = await v.remove(meta.id);
      setEntries(res.entries);
      updatePending(v);
      if (selectedId === meta.id) {
        setSelectedId(null);
        setShowHistory(false);
        setTitle("");
        setContent("");
        setMode("preview");
      }
      setStatus(res.synced ? t("item_deleted") : t("st_saved_local", storeName, res.syncError ?? ""));
    } catch (err) {
      setStatus(t("st_save_fail", String(err)));
    } finally {
      setBusy(false);
    }
  }

  // 还原某历史版本为当前版:restoreVersion(追加新版,内容同当前则 no-op)→ 重载当前版。
  async function restoreEntryVersion(meta: EntryMeta, ts: number) {
    const v = vaultRef.current;
    if (!v) return;
    setBusy(true);
    setStatus(t("st_decrypting", meta.title || t("untitled")));
    try {
      const res = await v.restoreVersion(meta.id, ts);
      setEntries(res.entries);
      const doc = await v.open(meta.id);
      setSelectedId(doc.id);
      setTitle(doc.title);
      setContent(doc.content);
      setEditFolderId(doc.folderId);
      setShowHistory(false);
      setMode("preview");
      updatePending(v);
      setStatus(t("version_restored"));
    } catch (err) {
      setStatus(t("st_open_fail", String(err)));
    } finally {
      setBusy(false);
    }
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
      updatePending(v);
      if (!res.synced) setStatus(t("st_saved_local", storeName, res.syncError ?? ""));
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
      updatePending(v);
      if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
      // 立即进入重命名
      setRenamingId(res.id);
      setRenameValue(t("new_folder"));
      if (!res.synced) setStatus(t("st_saved_local", storeName, res.syncError ?? ""));
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

  // 锁定:清内存密钥 + 清工作台状态,回到选择/解锁界面。本机加密凭据保留,
  // 重新解锁只需输密码(主密钥仅内存,F5/关标签同样需要重输)。
  function lock() {
    vaultRef.current = null;
    setContent("");
    setTitle("");
    setEntries([]);
    setFolders([]);
    setSelectedId(null);
    setDraftId(null);
    goPick();
  }

  // ============================ 选择保险库 ============================
  if (phase === "select") {
    return (
      <CenteredShell user={user} provider={provider}>
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
      <CenteredShell user={user} provider={provider}>
        <Card {...testId("vault-create")} className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {vaults.length > 0 ? (
                <button
                  type="button"
                  {...testId("vault-create-back")}
                  onClick={goPick}
                  disabled={busy}
                  aria-label={t("back_to_unlock")}
                  className="-ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              ) : null}
              {t("create_title")}
            </CardTitle>
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
                {/* 前两行清晰,其余模糊 + 渐变淡出:完整助记词只能在下载的 PDF 里看到。 */}
                <ol
                  className="grid grid-cols-2 gap-2 sm:grid-cols-3"
                  style={{
                    maskImage: "linear-gradient(to bottom, #000 0 44%, transparent 86%)",
                    WebkitMaskImage: "linear-gradient(to bottom, #000 0 44%, transparent 86%)",
                  }}
                >
                  {newMnemonic.split(" ").map((w, i) => {
                    const hidden = i >= 6;
                    return (
                      <li
                        key={i}
                        className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 font-mono text-sm"
                      >
                        <span className="text-[var(--color-muted-foreground)] tabular-nums">
                          {i + 1}.
                        </span>
                        <span
                          className={`font-medium ${hidden ? "select-none blur-[5px]" : ""}`}
                          aria-hidden={hidden}
                        >
                          {w}
                        </span>
                      </li>
                    );
                  })}
                </ol>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {t("reveal_hint_obscured")}
                </p>
                {/* 分体按钮:主体下载 PDF(原行为不变),右侧下拉选择其他导出方式 */}
                <div className="flex">
                  <Button
                    onClick={downloadBackup}
                    disabled={busy || exporting}
                    size="lg"
                    variant={downloaded ? "outline" : "default"}
                    className="flex-1 rounded-r-none"
                  >
                    <Download className="h-4 w-4" />
                    {exporting ? t("pdf_downloading") : t("pdf_download_btn")}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        {...testId("vault-backup-menu")}
                        size="lg"
                        variant={downloaded ? "outline" : "default"}
                        disabled={busy || exporting}
                        aria-label={t("backup_more_options")}
                        className="rounded-l-none border-l border-[var(--color-border)] px-2.5"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        {...testId("vault-backup-html-option")}
                        onSelect={() => {
                          setBkPw("");
                          setBkPw2("");
                          setShowHtmlExport(true);
                        }}
                      >
                        <Lock className="h-4 w-4" />
                        {t("backup_html_option")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {downloaded ? (
                  <>
                    <p className="text-xs text-[var(--color-success)]">
                      {t("pdf_downloaded_note")}
                    </p>
                    <Button
                      onClick={() => setConfirming(true)}
                      disabled={busy}
                      size="lg"
                      variant="secondary"
                    >
                      {t("btn_copied")}
                    </Button>
                  </>
                ) : null}
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
            {/* 加密 HTML 备份:设备份密码(强度门槛 + 二次确认)→ 生成自解密单文件 */}
            <AlertDialog
              open={showHtmlExport}
              onOpenChange={(open) => {
                if (!open) {
                  setShowHtmlExport(false);
                  setBkPw("");
                  setBkPw2("");
                }
              }}
            >
              <AlertDialogContent {...testId("vault-backup-html-dialog")}>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("backup_html_title")}</AlertDialogTitle>
                  <AlertDialogDescription>{t("backup_html_desc")}</AlertDialogDescription>
                </AlertDialogHeader>
                <div className="flex flex-col gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
                      {t("backup_pw_label")}
                    </span>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={bkPw}
                      onChange={(e) => setBkPw(e.target.value)}
                      placeholder={t("pw_rule_hint")}
                      disabled={busy}
                    />
                  </label>
                  <StrengthBar password={bkPw} />
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
                      {t("pw_confirm_label")}
                    </span>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={bkPw2}
                      onChange={(e) => setBkPw2(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  {bkPw2.length > 0 && bkPw !== bkPw2 ? (
                    <p className="text-xs text-[var(--color-danger)]">{t("pw_mismatch")}</p>
                  ) : null}
                  <p className="text-xs text-[var(--color-danger)]">{t("backup_html_warn")}</p>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>{t("btn_cancel")}</AlertDialogCancel>
                  <Button
                    {...testId("vault-backup-html-submit")}
                    onClick={downloadEncryptedBackup}
                    disabled={busy || !scorePassword(bkPw).ok || bkPw !== bkPw2 || !bkPw2}
                  >
                    <Lock className="h-4 w-4" />
                    {t("btn_download_html")}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </CenteredShell>
    );
  }

  // ============================ 解锁保险库 ============================
  if (phase === "unlock") {
    // 子态一:助记词已验证 / 新库刚创建 → 强制设置本机解锁密码(设完才进库)。
    if (setup) {
      const pwScore = scorePassword(newPw);
      const mismatch = newPw2.length > 0 && newPw !== newPw2;
      const canSubmit = !busy && pwScore.ok && newPw2.length > 0 && newPw === newPw2;
      return (
        <CenteredShell user={user} provider={provider}>
          <Card {...testId("vault-set-password")} className="w-full">
            <CardHeader>
              <CardTitle>{t("pw_set_title")}</CardTitle>
              <CardDescription>{t("pw_set_desc")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
                  {t("pw_new_label")}
                </span>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder={t("pw_rule_hint")}
                  disabled={busy}
                />
              </label>
              <StrengthBar password={newPw} />
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
                  {t("pw_confirm_label")}
                </span>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={newPw2}
                  onChange={(e) => setNewPw2(e.target.value)}
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSubmit) finishSetup();
                  }}
                />
              </label>
              {mismatch ? (
                <p className="text-xs text-[var(--color-danger)]">{t("pw_mismatch")}</p>
              ) : null}
              <Button onClick={finishSetup} disabled={!canSubmit} size="lg">
                {t("btn_set_password")}
              </Button>
              <div className="border-t border-[var(--color-border)] pt-3 text-center">
                <Button
                  variant="link"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setSetup(null);
                    setNewPw("");
                    setNewPw2("");
                    goPick();
                  }}
                >
                  {t("btn_cancel")}
                </Button>
              </div>
              <StatusLine status={status} />
            </CardContent>
          </Card>
        </CenteredShell>
      );
    }

    const passwordMode = credExists === true && !phraseFallback;
    return (
      <CenteredShell user={user} provider={provider}>
        <Card {...testId("vault-unlock")} className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {credExists === true && phraseFallback ? (
                // 从密码解锁切到助记词:返回密码解锁
                <button
                  type="button"
                  {...testId("vault-unlock-back")}
                  onClick={() => setPhraseFallback(false)}
                  disabled={busy}
                  aria-label={t("back_to_password")}
                  className="-ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              ) : vaults.length > 1 ? (
                // 多库:返回保险库选择
                <button
                  type="button"
                  {...testId("vault-unlock-back")}
                  onClick={goPick}
                  disabled={busy}
                  aria-label={t("switch_vault")}
                  className="-ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              ) : null}
              {t("unlock_title")}
            </CardTitle>
            <CardDescription>
              {passwordMode
                ? selectedVault
                  ? t("pw_unlock_desc", vaultName(selectedVault))
                  : t("unlock_desc")
                : selectedVault
                  ? t("unlock_desc_named", vaultName(selectedVault))
                  : t("unlock_desc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {credExists === null ? (
              // IndexedDB 探测中(瞬时):避免助记词框闪一下又切成密码框。
              <div className="h-20" aria-hidden="true" />
            ) : passwordMode ? (
              // 子态二:本机已有加密凭据 → 输密码解锁
              <>
                <Input
                  {...testId("vault-unlock-password")}
                  type="password"
                  autoComplete="current-password"
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    setPwError(null);
                  }}
                  placeholder={t("pw_input_ph")}
                  autoFocus
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && passwordInput) unlockWithPassword();
                  }}
                />
                {pwError ? (
                  <p {...testId("vault-unlock-error")} className="text-xs text-[var(--color-danger)]">
                    {pwError}
                  </p>
                ) : null}
                <Button onClick={unlockWithPassword} disabled={busy || !passwordInput} size="lg">
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("st_unlocking")}
                    </>
                  ) : (
                    t("btn_unlock")
                  )}
                </Button>
              </>
            ) : (
              // 子态三:无本机凭据(新设备/清缓存/忘记密码)→ 输助记词,验证后强制设密码
              <>
                <Textarea
                  value={mnemonicInput}
                  onChange={(e) => setMnemonicInput(e.target.value)}
                  placeholder="word1 word2 … word12"
                  rows={3}
                  className="font-mono"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) verifyPhrase();
                  }}
                />
                <Button onClick={verifyPhrase} disabled={busy} size="lg">
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("st_unlocking")}
                    </>
                  ) : (
                    t("btn_phrase_continue")
                  )}
                </Button>
              </>
            )}
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-[var(--color-border)] pt-3">
              {passwordMode ? (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setPhraseFallback(true)}
                  disabled={busy}
                >
                  {t("forgot_password")}
                </Button>
              ) : credExists === true && phraseFallback ? (
                // 从密码解锁切到助记词后,提供回退入口
                <Button
                  {...testId("vault-unlock-back-to-password")}
                  variant="link"
                  size="sm"
                  onClick={() => setPhraseFallback(false)}
                  disabled={busy}
                >
                  {t("back_to_password")}
                </Button>
              ) : null}
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
  /** 条目在 CLI 里的文件路径:文件夹链(/ 分隔)+ 标题,供 `ark get <path>` 使用。 */
  function cliPathOf(e: EntryMeta): string {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const parts: string[] = [];
    let cur: string | null = e.folderId;
    while (cur) {
      const f = byId.get(cur);
      if (!f) break;
      parts.unshift(f.name);
      cur = f.parentId;
    }
    parts.push(e.title || "");
    return parts.join("/");
  }

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
    // 铺平模式看不到层级,行尾补条目的最近(直属)目录名;目录模式层级自明,不显示。
    const folderName =
      viewMode === "flat" && e.folderId
        ? folders.find((f) => f.id === e.folderId)?.name
        : undefined;
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
          {folderName ? (
            <span
              className={`ml-auto flex max-w-[9rem] shrink-0 items-center gap-1 pl-1 text-[11px] ${
                active
                  ? "text-[var(--color-primary-foreground)]/75"
                  : "text-[var(--color-muted-foreground)]"
              }`}
            >
              <Folder className="h-3 w-3 shrink-0" />
              <span className="truncate">{folderName}</span>
            </span>
          ) : null}
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

  // 文件条目的方形图标(替代文本条目的首字母头像)。
  function fileIconBox() {
    return (
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--color-primary)] to-[oklch(0.55_0.21_292)] text-[var(--color-primary-foreground)] shadow-sm">
        <FileIcon className="h-7 w-7" />
      </span>
    );
  }

  const previewName = selected?.title || t("untitled");

  return (
    <div
      {...testId("vault-workbench")}
      className="grid h-screen overflow-hidden"
      style={{ gridTemplateColumns: `${navWidth}px 1fr` }}
    >
      {/* 隐藏文件选择框:上传文件条目时由 pickFile() 触发 */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={onPickedFile}
        aria-hidden="true"
      />
      {/* 修改密码弹窗:需当前密码(防走近已解锁屏幕者直接改密);无「移除密码」 */}
      <AlertDialog
        open={showChangePw}
        onOpenChange={(open) => {
          if (!open) closeChangePw();
        }}
      >
        <AlertDialogContent {...testId("vault-change-password-dialog")}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pw_change_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("pw_change_desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
                {t("pw_current_label")}
              </span>
              <Input
                type="password"
                autoComplete="current-password"
                value={curPw}
                onChange={(e) => setCurPw(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
                {t("pw_new_label")}
              </span>
              <Input
                type="password"
                autoComplete="new-password"
                value={chPw}
                onChange={(e) => setChPw(e.target.value)}
                placeholder={t("pw_rule_hint")}
                disabled={busy}
              />
            </label>
            <StrengthBar password={chPw} />
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
                {t("pw_confirm_label")}
              </span>
              <Input
                type="password"
                autoComplete="new-password"
                value={chPw2}
                onChange={(e) => setChPw2(e.target.value)}
                disabled={busy}
              />
            </label>
            {chPw2.length > 0 && chPw !== chPw2 ? (
              <p className="text-xs text-[var(--color-danger)]">{t("pw_mismatch")}</p>
            ) : null}
            {chError ? <p className="text-xs text-[var(--color-danger)]">{chError}</p> : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("btn_cancel")}</AlertDialogCancel>
            <Button
              {...testId("vault-change-password-submit")}
              onClick={submitChangePassword}
              disabled={busy || !curPw || !scorePassword(chPw).ok || chPw !== chPw2 || !chPw2}
            >
              {t("btn_change_password")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* 自动锁定时长弹窗:预设档位即点即生效;自定义分钟数按「确定」生效 */}
      <AlertDialog open={showAutoLock} onOpenChange={setShowAutoLock}>
        <AlertDialogContent {...testId("vault-autolock-dialog")}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("autolock_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("autolock_desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {IDLE_OPTIONS.map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={idleMinutes === n ? "default" : "outline"}
                  onClick={() => {
                    applyIdleMinutes(n);
                    setShowAutoLock(false);
                  }}
                >
                  {t("autolock_minutes", n)}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input
                {...testId("vault-autolock-custom")}
                type="number"
                min={1}
                value={idleCustom}
                onChange={(e) => setIdleCustom(e.target.value)}
                placeholder={t("autolock_custom_ph")}
                className="h-9"
              />
              <Button
                size="sm"
                disabled={normalizeIdleMinutes(idleCustom) === null}
                onClick={() => {
                  const n = normalizeIdleMinutes(idleCustom);
                  if (n === null) return;
                  applyIdleMinutes(n);
                  setShowAutoLock(false);
                }}
              >
                {t("btn_apply")}
              </Button>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("btn_cancel")}</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* 导航:文件夹 + 条目 合并的目录树 */}
      <aside {...testId("vault-nav")} className="relative flex flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-2)]">
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
                <DropdownMenuItem onSelect={() => pickFile()}>
                  <Upload className="h-4 w-4" />
                  {t("upload_file")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
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
        {/* 右缘拖动条:拖动改宽,双击恢复默认宽度 */}
        <div
          {...testId("vault-nav-resizer")}
          onPointerDown={startNavResize}
          onDoubleClick={() => {
            setNavWidth(NAV_WIDTH_DEFAULT);
            persistNavWidth(NAV_WIDTH_DEFAULT);
          }}
          className="absolute inset-y-0 right-[-2px] z-10 w-[5px] cursor-col-resize touch-none bg-transparent transition-colors hover:bg-[var(--color-primary)]/35 active:bg-[var(--color-primary)]/55"
        />
      </aside>

      {/* 详情 / 编辑(布局对齐 1Password) */}
      <section {...testId("vault-detail")} className="flex flex-col bg-[var(--color-surface-2)]">
        <div {...testId("vault-detail-scroll")} className="flex-1 overflow-y-auto">
          {/* 顶栏:同步状态 + 控件 + 用户菜单(编辑/预览共用) */}
          <div {...testId("vault-detail-header")} className="flex h-14 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-background)] px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Tooltip label={t("sync_now")}>
                <Button
                  {...testId("vault-sync-now")}
                  variant="ghost"
                  size="sm"
                  onClick={syncNow}
                  disabled={busy}
                  aria-label={t("sync_now")}
                >
                  <RefreshCw className={`h-3.5 w-3.5${syncing ? " animate-spin" : ""}`} />
                </Button>
              </Tooltip>
              {pending > 0 ? (
                <Button variant="secondary" size="sm" onClick={syncNow} disabled={busy}>
                  {t("btn_sync", storeName)} · {t("pending_count", pending)}
                </Button>
              ) : (
                <span
                  {...testId("vault-sync-status")}
                  className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
                  {t("synced")}
                  {lastSyncAt !== null ? <span>· {formatAgo(lastSyncAt)}</span> : null}
                </span>
              )}
              <StatusLine status={status} inline />
            </div>
            <div className="flex items-center gap-2.5">
              <HeaderControls />
              <UserMenu
                name={user.name}
                avatar={user.avatar}
                provider={provider}
                onLock={lock}
                onChangePassword={() => setShowChangePw(true)}
                onAutoLock={() => {
                  setIdleCustom("");
                  setShowAutoLock(true);
                }}
              />
            </div>
          </div>

          {mode === "edit" ? (
            // ---- 编辑模式:满宽条目头(文件夹路径 + 取消/保存)+ 居中正文 ----
            <div {...testId("vault-item-edit")} className="w-full">
              <div
                {...testId("vault-item-edit-header")}
                className={`flex items-center justify-between gap-3 px-6 py-3${busy ? " vault-stripes-saving" : ""}`}
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
              <div {...testId("vault-item-edit-body")} className="mx-auto w-full max-w-[1080px] px-6 py-8">
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
                {/* 历史版本入口(文本+文件都有);文件条目正文不可文本编辑,隐藏「编辑」按钮 */}
                <div className="flex shrink-0 items-center gap-2">
                  {selected && selected.id !== draftId ? (
                    <Button
                      {...testId("vault-item-history-toggle")}
                      size="sm"
                      variant={showHistory ? "default" : "secondary"}
                      onClick={() => setShowHistory((s) => !s)}
                      disabled={busy}
                    >
                      <History className="h-3.5 w-3.5" />
                      {t("history_open")}
                      {selected && (selected.versions ?? 1) > 1 ? (
                        <span
                          {...testId("vault-item-history-count")}
                          className="ml-0.5 rounded-full bg-black/10 px-1.5 text-[10px] font-medium tabular-nums dark:bg-white/15"
                        >
                          {(selected.versions ?? 1) - 1}
                        </span>
                      ) : null}
                    </Button>
                  ) : null}
                  {selected?.kind === "file" ? null : (
                    <Button size="sm" variant="secondary" onClick={editEntry} disabled={busy}>
                      <Pencil className="h-3.5 w-3.5" />
                      {t("btn_edit")}
                    </Button>
                  )}
                  {selected && selected.id !== draftId ? (
                    <DropdownMenu>
                      <Tooltip label={t("more_actions")}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            {...testId("vault-item-more")}
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                      </Tooltip>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem destructive onSelect={() => setDeleteTarget(selected)}>
                          <Trash2 className="h-4 w-4" />
                          {t("delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </div>
              {/* 删除确认弹窗:不可撤销,确认才真正删除(含全部历史版本) */}
              <AlertDialog
                open={deleteTarget != null}
                onOpenChange={(open) => {
                  if (!open) setDeleteTarget(null);
                }}
              >
                <AlertDialogContent {...testId("vault-item-delete-dialog")}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("delete_item_title")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("confirm_delete_item", deleteTarget?.title || t("untitled"))}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>{t("btn_cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      {...testId("vault-item-delete-confirm")}
                      variant="danger"
                      disabled={busy}
                      onClick={() => {
                        if (deleteTarget) removeEntry(deleteTarget);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("delete")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <div {...testId("vault-item-preview-body")} className="mx-auto w-full max-w-[1080px] px-6 py-8">
                <div {...testId("vault-item-header")} className="mb-6 flex items-center gap-4">
                  {selected?.kind === "file" ? fileIconBox() : itemIcon(previewName)}
                  <h2 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">
                    {previewName}
                  </h2>
                  {selected?.provider ? <ServiceProviderBadge provider={selected.provider} /> : null}
                </div>
                {showHistory && selected ? (
                  // ---- 历史版本面板(覆盖正文区,冷路径)----
                  <VersionHistory
                    vault={vaultRef.current!}
                    entry={selected}
                    busy={busy}
                    onRestore={(ts) => restoreEntryVersion(selected, ts)}
                    onClose={() => setShowHistory(false)}
                  />
                ) : selected?.kind === "file" ? (
                  // ---- 文件条目:文件名 + 大小 + 下载 + 在线预览 ----
                  <div className="space-y-4">
                  <div
                    {...testId("vault-item-file-card")}
                    className="flex items-center gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-accent)] px-4 py-4"
                  >
                    <FileIcon className="h-8 w-8 shrink-0 text-[var(--color-primary)]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{selected.filename || previewName}</div>
                      <div className="text-xs text-[var(--color-muted-foreground)]">
                        {t("file_size_label", humanSize(selected.fileSize ?? 0))}
                      </div>
                    </div>
                    <Button
                      {...testId("vault-item-file-download")}
                      size="sm"
                      onClick={() => downloadFile(selected)}
                      disabled={busy}
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t("file_download")}
                    </Button>
                  </div>
                  <FilePreview
                    entryId={selected.id}
                    filename={selected.filename || previewName}
                    loadBytes={(id) => vaultRef.current!.openFile(id)}
                  />
                  </div>
                ) : (
                  <div {...testId("vault-item-content-card")} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-accent)] px-4 py-3">
                    {!content ? (
                      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                        <span className="text-[var(--color-muted-foreground)]">{t("content_empty")}</span>
                      </div>
                    ) : revealed ? (
                      <div className="relative">
                        {(() => {
                          // 按标题(末段文件名)判定语言:.env 家族 / json / yaml 等文本条目带语法高亮
                          const spec = previewSpecOf(selected?.title ?? "");
                          return spec.kind === "code" && spec.lang ? (
                            <InlineHighlight text={content} lang={spec.lang} />
                          ) : (
                            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{content}</div>
                          );
                        })()}
                        {/* 揭开后仍可随手再盖上(右上角) */}
                        <Tooltip label={t("content_hide")}>
                          <button
                            type="button"
                            {...testId("vault-item-content-hide")}
                            onClick={() => setRevealed(false)}
                            aria-label={t("content_hide")}
                            className="absolute -right-1.5 -top-1 flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-foreground)]"
                          >
                            <EyeOff className="h-3.5 w-3.5" />
                          </button>
                        </Tooltip>
                      </div>
                    ) : (
                      // 毛玻璃遮罩:内容默认盖住(backdrop 模糊 + 轻微着色),整块可点,点击揭开全文
                      <button
                        type="button"
                        {...testId("vault-item-content-veil")}
                        onClick={() => setRevealed(true)}
                        aria-label={t("content_reveal")}
                        className="relative block w-full cursor-pointer overflow-hidden rounded-xl text-left"
                      >
                        <div
                          aria-hidden
                          className="max-h-40 select-none overflow-hidden whitespace-pre-wrap break-words text-sm leading-relaxed"
                        >
                          {content}
                        </div>
                        <div
                          className="absolute inset-0 flex items-center justify-center backdrop-blur-md"
                          style={{
                            background: "color-mix(in oklch, var(--color-accent) 35%, transparent)",
                          }}
                        >
                          <span className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted-foreground)] shadow-sm">
                            <Eye className="h-3.5 w-3.5" />
                            {t("content_reveal")}
                          </span>
                        </div>
                      </button>
                    )}
                  </div>
                )}
                {selected ? (
                  <div className="mt-6 flex items-center justify-between gap-3 px-1 text-xs text-[var(--color-muted-foreground)]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {t("last_edited", new Date(selected.updatedAt).toLocaleString())}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      {selected.kind !== "file" ? (
                        <button
                          type="button"
                          {...testId("vault-item-cli-access")}
                          onClick={() => setShowCliHowto(true)}
                          className="inline-flex shrink-0 items-center gap-1 text-[var(--color-primary)] hover:underline"
                        >
                          <Terminal className="h-3 w-3" />
                          {t("cli_access")}
                        </button>
                      ) : null}
                      {selectedVault && netdiskUrl(itemRelPath(selectedVault.dir, selected.id, selected.updatedAt)) ? (
                        <a
                          href={netdiskUrl(itemRelPath(selectedVault.dir, selected.id, selected.updatedAt))!}
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
                    </span>
                  </div>
                ) : null}
                {selected ? (
                  <CliAccessDialog
                    open={showCliHowto}
                    onOpenChange={setShowCliHowto}
                    itemPath={cliPathOf(selected)}
                    title={selected.title || "item.txt"}
                  />
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
function CenteredShell({
  children,
  user,
  provider,
}: {
  children: React.ReactNode;
  user: VaultUser;
  provider: StorageProvider;
}) {
  return (
    <main {...testId("vault-shell")} className="relative flex min-h-screen flex-col bg-[var(--color-background)]">
      <div className="hero-aurora" aria-hidden="true" />
      <header {...testId("vault-shell-header")} className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-6 py-5">
        <Wordmark className="text-lg" />
        <div className="flex items-center gap-3">
          <HeaderControls />
          <UserMenu name={user.name} avatar={user.avatar} provider={provider} />
        </div>
      </header>
      <div {...testId("vault-shell-body")} className="relative z-10 flex flex-1 flex-col items-center justify-center gap-8 px-4 pb-16">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </main>
  );
}

// 密码强度条:4 段着色 + 等级文案 + 不达标原因。设密码(002)与改密码(003)共用。
function StrengthBar({ password }: { password: string }) {
  const t = useT();
  const { score, ok, reasons } = scorePassword(password);
  const levelKey = (["pw_strength_0", "pw_strength_1", "pw_strength_2", "pw_strength_3", "pw_strength_4"] as const)[score];
  const reasonKey: Record<StrengthReason, MsgKey> = {
    too_short: "pw_reason_short",
    need_classes: "pw_reason_classes",
    weak_pattern: "pw_reason_pattern",
  };
  const color =
    score <= 1
      ? "var(--color-danger)"
      : score === 2
        ? "var(--color-primary)"
        : "var(--color-success)";
  if (!password) return null;
  return (
    <div {...testId("password-strength")} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {[1, 2, 3, 4].map((seg) => (
            <span
              key={seg}
              className="h-1.5 flex-1 rounded-full"
              style={{ background: seg <= score ? color : "var(--color-border)" }}
            />
          ))}
        </div>
        <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">{t(levelKey)}</span>
      </div>
      {!ok && reasons.length > 0 ? (
        <p className="text-xs text-[var(--color-danger)]">
          {reasons.map((r) => t(reasonKey[r])).join(" · ")}
        </p>
      ) : null}
    </div>
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
