import { POSTS } from "@/lib/content/blog";
import { ALT, CONTENT_TYPE, renderCard, SIZE } from "./_card/render";

// 预渲染每篇文章的卡片(与文章页相同的 slug 集合)。
export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export const alt = ALT;
export const size = SIZE;
export const contentType = CONTENT_TYPE;

export default async function OpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return renderCard(slug);
}
