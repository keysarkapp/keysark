import { NextResponse } from "next/server";
import { getStorageForRequest, sanitizeRelDir, sanitizeRelPath } from "@/lib/storage";
import {
  PayloadTooLargeError,
  readBodyLimited,
  rejectIfTooLargeByHeader,
  tooLargeResponse,
} from "@/lib/request-limits";

export const runtime = "nodejs";

// 列出存储目录文件。只暴露 id/name/size —— 内容不在这里。?dir= 指定子目录(默认根)。
export async function GET(request: Request) {
  const conn = await getStorageForRequest(request);
  if (!conn) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  const dir = sanitizeRelDir(new URL(request.url).searchParams.get("dir") ?? "");
  if (dir === null) return NextResponse.json({ error: "bad_path" }, { status: 400 });
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
  const tooLarge = rejectIfTooLargeByHeader(request);
  if (tooLarge) return tooLarge;

  const conn = await getStorageForRequest(request);
  if (!conn) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  let body: { path?: string; contentB64?: string };
  try {
    const raw = await readBodyLimited(request); // 硬上限 + 流式,防超大 JSON 进内存
    body = JSON.parse(new TextDecoder().decode(raw)) as typeof body;
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return tooLargeResponse();
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const path = sanitizeRelPath(body.path ?? null);
  if (!path) return NextResponse.json({ error: "bad_path" }, { status: 400 });

  const bytes = new Uint8Array(Buffer.from(body.contentB64 ?? "", "base64"));
  try {
    await conn.client.upload(path, bytes);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("upload failed", err);
    return NextResponse.json({ error: "upload_failed", message: String(err) }, { status: 502 });
  }
}

// 删除文件(?path= 相对路径)。后端实现保证幂等(不存在不报错)。内容无关。
export async function DELETE(request: Request) {
  const conn = await getStorageForRequest(request);
  if (!conn) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  const path = sanitizeRelPath(new URL(request.url).searchParams.get("path"));
  if (!path) return NextResponse.json({ error: "bad_path" }, { status: 400 });

  try {
    await conn.client.delete(path);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("delete failed", err);
    return NextResponse.json({ error: "delete_failed", message: String(err) }, { status: 502 });
  }
}
