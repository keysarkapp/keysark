import { POSTS } from "@/lib/content/blog";
import { ALT, CONTENT_TYPE, renderCard, SIZE } from "./_card/render";

// Twitter 卡片复用同一张分享卡片(summary_large_image)。
export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export const alt = ALT;
export const size = SIZE;
export const contentType = CONTENT_TYPE;

export default async function TwitterImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return renderCard(slug);
}
