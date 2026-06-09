// 保险库备份 PDF —— 纯客户端生成,助记词绝不离开浏览器。
//
// 做法:把版面画到 <canvas>(浏览器原生渲染中文,无需内嵌 CJK 字体),再作为整页
// 图片塞进 jsPDF 直接下载。jsPDF 动态 import,不进首屏包。
//
// 安全:本模块只在浏览器事件回调中调用;mnemonic / url / 库名仅在内存与本地下载的
// 文件中出现,不发起任何网络请求(符合 E2E 约束 #3)。

import { translate, type Locale } from "@/lib/i18n";

export type VaultBackupInput = {
  mnemonic: string;
  vaultName: string;
  url: string;
  locale: Locale;
};

// A4 纵向,约 150 DPI 的画布尺寸(宽高比对齐 A4 595.28:841.89)。
const CANVAS_W = 1240;
const CANVAS_H = 1754;
const MARGIN = 92;
const CONTENT_W = CANVAS_W - MARGIN * 2;

const SANS =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif";
const MONO = "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace";

const COLOR = {
  indigo: "#4338CA",
  indigoDeep: "#312E81",
  ink: "#1F2937",
  muted: "#6B7280",
  line: "#E5E7EB",
  chipFill: "#EEF2FF",
  chipBorder: "#C7D2FE",
  amber: "#B45309",
  danger: "#B91C1C",
  dangerFill: "#FEF2F2",
  dangerBorder: "#FECACA",
};

/** 按宽度折行:含空格(英文)按词折,必要时长词按字断;无空格(中文)按字断。 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const tentative = line ? `${line} ${word}` : word;
    if (ctx.measureText(tentative).width <= maxWidth) {
      line = tentative;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    if (ctx.measureText(word).width <= maxWidth) {
      line = word;
    } else {
      let chunk = "";
      for (const ch of word) {
        if (chunk && ctx.measureText(chunk + ch).width > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      line = chunk;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export async function exportVaultBackupPdf(input: VaultBackupInput): Promise<void> {
  const { mnemonic, vaultName, url, locale } = input;
  const tr = (key: Parameters<typeof translate>[1], ...args: unknown[]) =>
    translate(locale, key, ...args);

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.textBaseline = "alphabetic";

  let y = 132;

  // 标题
  ctx.fillStyle = COLOR.indigo;
  ctx.font = `700 50px ${SANS}`;
  ctx.fillText("KeysArk", MARGIN, y);
  const brandW = ctx.measureText("KeysArk").width;
  ctx.fillStyle = COLOR.ink;
  ctx.font = `400 34px ${SANS}`;
  ctx.fillText(` · ${tr("pdf_doc_title")}`, MARGIN + brandW, y);

  y += 28;
  ctx.strokeStyle = COLOR.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y);
  ctx.lineTo(CANVAS_W - MARGIN, y);
  ctx.stroke();

  // 信息行:网址、库名
  const drawField = (label: string, value: string) => {
    y += 64;
    ctx.fillStyle = COLOR.muted;
    ctx.font = `600 22px ${SANS}`;
    ctx.fillText(label, MARGIN, y);
    y += 38;
    ctx.fillStyle = COLOR.ink;
    ctx.font = `500 30px ${SANS}`;
    for (const ln of wrapText(ctx, value, CONTENT_W)) {
      ctx.fillText(ln, MARGIN, y);
      y += 40;
    }
    y -= 40;
  };
  drawField(tr("pdf_url_label"), url);
  drawField(tr("pdf_name_label"), vaultName);

  // 助记词网格(3 列 × 4 行)
  y += 70;
  ctx.fillStyle = COLOR.muted;
  ctx.font = `600 22px ${SANS}`;
  ctx.fillText(tr("pdf_phrase_label"), MARGIN, y);

  y += 28;
  const words = mnemonic.split(" ");
  const cols = 3;
  const gap = 18;
  const boxW = (CONTENT_W - gap * (cols - 1)) / cols;
  const boxH = 74;
  words.forEach((w, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const bx = MARGIN + col * (boxW + gap);
    const by = y + row * (boxH + gap);
    ctx.fillStyle = COLOR.chipFill;
    ctx.strokeStyle = COLOR.chipBorder;
    ctx.lineWidth = 2;
    roundRect(ctx, bx, by, boxW, boxH, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLOR.muted;
    ctx.font = `500 24px ${MONO}`;
    ctx.fillText(`${i + 1}.`, bx + 22, by + boxH / 2 + 9);
    ctx.fillStyle = COLOR.indigoDeep;
    ctx.font = `600 30px ${MONO}`;
    ctx.fillText(w, bx + 78, by + boxH / 2 + 11);
  });
  y += 4 * boxH + 3 * gap + 64;

  // 风险提示框
  const risks = [tr("pdf_risk_1"), tr("pdf_risk_2"), tr("pdf_risk_3"), tr("pdf_risk_4")];
  const padX = 32;
  const innerW = CONTENT_W - padX * 2 - 30; // 减去项目符号缩进
  const boxTop = y;

  // 预算高度
  ctx.font = `400 26px ${SANS}`;
  let bodyH = 0;
  const wrapped = risks.map((r) => {
    const lines = wrapText(ctx, r, innerW);
    bodyH += lines.length * 38 + 16;
    return lines;
  });
  const riskBoxH = 24 + 44 + 14 + bodyH + 12;

  ctx.fillStyle = COLOR.dangerFill;
  ctx.strokeStyle = COLOR.dangerBorder;
  ctx.lineWidth = 2;
  roundRect(ctx, MARGIN, boxTop, CONTENT_W, riskBoxH, 18);
  ctx.fill();
  ctx.stroke();

  let ry = boxTop + 52;
  ctx.fillStyle = COLOR.danger;
  ctx.font = `700 28px ${SANS}`;
  ctx.fillText(`⚠  ${tr("pdf_risk_title")}`, MARGIN + padX, ry);
  ry += 38;

  ctx.fillStyle = COLOR.ink;
  for (const lines of wrapped) {
    ctx.fillStyle = COLOR.danger;
    ctx.font = `700 26px ${SANS}`;
    ctx.fillText("•", MARGIN + padX, ry + 4);
    ctx.fillStyle = COLOR.ink;
    ctx.font = `400 26px ${SANS}`;
    for (const ln of lines) {
      ctx.fillText(ln, MARGIN + padX + 30, ry);
      ry += 38;
    }
    ry += 16;
  }

  // 页脚:生成时间
  const dateStr = new Date().toLocaleString(locale === "zh" ? "zh-CN" : "en-US");
  ctx.fillStyle = COLOR.muted;
  ctx.font = `400 22px ${SANS}`;
  ctx.fillText(tr("pdf_generated", dateStr), MARGIN, CANVAS_H - 64);

  // 转成 PDF 并下载
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pageW, pageH);
  // 非默认库名时,把库名并进文件名(剔除文件系统非法字符、空白折成连字符;CJK 保留)。
  const trimmed = vaultName.trim();
  const safeName =
    trimmed === "default"
      ? ""
      : trimmed
          .replace(/[/\\:*?"<>|]+/g, "")
          .replace(/\s+/g, "-")
          .slice(0, 60);
  pdf.save(safeName ? `keysark-vault-backup-${safeName}.pdf` : "keysark-vault-backup.pdf");
}
