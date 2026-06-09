// KeysArk 官方品牌标识(取自 logos 资源包 keysark-icon):盾形「方舟」外壳 + 钥匙孔,
// 寓意把密钥稳妥载于方舟之内。外壳跟随主色(随主题深浅自适应),钥匙孔为品牌琥珀色。
const BRAND_AMBER = "#F59E0B";

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M14 7 H86 Q95 7 95 18 V58 Q95 77 77 89 Q62 96 50 96 Q38 96 23 89 Q5 77 5 58 V18 Q5 7 14 7 Z"
        className="fill-[var(--color-primary)]"
      />
      <circle cx="50" cy="44" r="11" fill={BRAND_AMBER} />
      <path d="M45.5 50 L42 72 H58 L54.5 50 Z" fill={BRAND_AMBER} />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className ?? ""}`}>
      <Logo className="h-6 w-6" />
      <span>
        Keys<span className="text-[var(--color-primary)]">Ark</span>
      </span>
    </span>
  );
}
