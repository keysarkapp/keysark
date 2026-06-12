// 交互层(@inquirer/prompts 经典 `?` 风格)+ 自绘 note 面板 / spinner / log。
// 仅在 TTY 场景调用(调用方已用 isTTY 把关);非交互路径仍走 console.log 纯文本。
// 用户取消(Ctrl+C)一律干净退出。
import { confirm, input, password, select } from "@inquirer/prompts";
import { cyan, dim, green, red, yellow } from "./colors";

function bail(): never {
  console.log();
  console.log(yellow("Cancelled."));
  process.exit(1);
}

/** 包一层:Ctrl+C(ExitPromptError)→ 干净退出。 */
async function run<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof Error && err.name === "ExitPromptError") bail();
    throw err;
  }
}

/** validate 约定适配:string=错误信息,undefined=通过 → inquirer 的 true/string。 */
const toValidate =
  (v?: (s: string) => string | undefined) =>
  v
    ? (s: string) => v(s) ?? true
    : undefined;

/** 单行文本输入;placeholder 以淡色附注呈现。 */
export async function askText(
  message: string,
  opts: { placeholder?: string; validate?: (v: string) => string | undefined } = {},
): Promise<string> {
  const msg = opts.placeholder ? `${message} ${dim(`(${opts.placeholder})`)}` : message;
  return run(input({ message: msg, validate: toValidate(opts.validate) }));
}

/** 密码输入(掩码)。 */
export async function askPassword(
  message: string,
  validate?: (v: string) => string | undefined,
): Promise<string> {
  return run(password({ message, mask: "*", validate: toValidate(validate) }));
}

/** 是/否确认。 */
export async function askConfirm(message: string, def = false): Promise<boolean> {
  return run(confirm({ message, default: def }));
}

/** 单选(↑↓ 移动,回车确认);hint 显示在选中项下方。 */
export async function askSelect<T extends string>(
  message: string,
  options: { value: T; label: string; hint?: string }[],
): Promise<T> {
  return run(
    select<T>({
      message,
      choices: options.map((o) => ({ value: o.value, name: o.label, description: o.hint })),
    }),
  );
}

const ANSI_RE = new RegExp(`\\x1b\\[[0-9;]*m`, "g");
const visibleWidth = (s: string) => s.replace(ANSI_RE, "").length;

/** 圆角框面板(标题嵌在上边框)。 */
export function note(content: string, title?: string): void {
  const lines = content.split("\n");
  const inner = Math.max(...lines.map(visibleWidth), title ? visibleWidth(title) + 2 : 0);
  const top = title
    ? `${dim("╭─")} ${title} ${dim("─".repeat(Math.max(0, inner - visibleWidth(title) - 2)) + "─╮")}`
    : dim(`╭${"─".repeat(inner + 2)}╮`);
  console.log(top);
  for (const l of lines) {
    const pad = " ".repeat(inner - visibleWidth(l));
    console.log(`${dim("│")} ${l}${pad} ${dim("│")}`);
  }
  console.log(dim(`╰${"─".repeat(inner + 2)}╯`));
}

/** 转圈等待器(\r 原地刷新;stop 清行后打印收尾消息)。 */
export function spinner(): { start(msg: string): void; stop(msg?: string): void; message(msg: string): void } {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let timer: ReturnType<typeof setInterval> | null = null;
  let text = "";
  let i = 0;
  return {
    start(msg: string) {
      text = msg;
      timer = setInterval(() => {
        process.stdout.write(`\r${cyan(frames[i++ % frames.length]!)} ${text} `);
      }, 80);
    },
    stop(msg?: string) {
      if (timer) clearInterval(timer);
      timer = null;
      process.stdout.write("\r\x1b[2K");
      if (msg) console.log(msg);
    },
    message(msg: string) {
      text = msg;
    },
  };
}

/** 统一的消息样式。 */
export const log = {
  error: (m: string) => console.error(red(`✗ ${m}`)),
  warn: (m: string) => console.error(yellow(`! ${m}`)),
  success: (m: string) => console.log(green(`✓ ${m}`)),
  info: (m: string) => console.log(dim(m)),
};
