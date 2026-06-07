// 测试用 data-testid 注入。由环境变量 NEXT_PUBLIC_TEST_IDS 开关控制:
//   未设置 / "0" / "false" → 不渲染任何 data-testid(生产默认)。
//   "1" / "true"           → 给布局容器渲染固定 data-testid(E2E / 自动化定位用)。
// NEXT_PUBLIC_ 前缀的变量在构建期静态内联,服务端与客户端组件都可用。
//
// 用法:展开到任意容器元素上 —— <div {...testId("vault-workbench")} />。
// 关闭时返回空对象(不产生属性),开启时返回 { "data-testid": id }。

const ENABLED =
  process.env.NEXT_PUBLIC_TEST_IDS === "1" || process.env.NEXT_PUBLIC_TEST_IDS === "true";

export function testId(id: string): { "data-testid"?: string } {
  return ENABLED ? { "data-testid": id } : {};
}
