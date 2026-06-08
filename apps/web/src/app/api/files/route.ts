import { NextResponse } from "next/server";
import { getStorageForRequest } from "@/lib/storage";

export const runtime = "nodejs";

// 列出存储目录文件。只暴露 id/name/size —— 内容不在这里。?dir= 指定子目录(默认根)。
export async function GET(request: Request) {
  const conn = await getStorageForRequest(request);
  if (!conn) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  const dir = new URL(request.url).searchParams.get("dir") ?? "";
  try {
    const files = await conn.client.list(dir);
    return NextResponse.json({ files });
  } catch (err) {
    console.error("list failed", err);
    return NextResponse.json({ error: "list_failed", message: String(err) }, { status: 502 });
  }
}

// 保存/更新文件。Body 为不透明 base64 字节(内容由客户端加密,服务端不解读)。
export async function POST(request: Request) {
  const conn = await getStorageForRequest(request);
  if (!conn) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  const body = (await request.json()) as { path?: string; contentB64?: string };
  const path = (body.path ?? "").trim();
  if (!path) return NextResponse.json({ error: "path_required" }, { status: 400 });

  const bytes = new Uint8Array(Buffer.from(body.contentB64 ?? "", "base64"));
  try {
    await conn.client.upload(path, bytes);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("upload failed", err);
    return NextResponse.json({ error: "upload_failed", message: String(err) }, { status: 502 });
  }
}
