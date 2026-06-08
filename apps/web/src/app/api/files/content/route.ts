import { NextResponse } from "next/server";
import { getStorageForRequest } from "@/lib/storage";

export const runtime = "nodejs";

// 下载文件原始字节,base64 返回(不透明,客户端解密)。
export async function GET(request: Request) {
  const conn = await getStorageForRequest(request);
  if (!conn) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  const fileId = new URL(request.url).searchParams.get("fileId");
  if (!fileId) return NextResponse.json({ error: "fileId_required" }, { status: 400 });

  try {
    const bytes = await conn.client.download(fileId);
    return NextResponse.json({ contentB64: Buffer.from(bytes).toString("base64") });
  } catch (err) {
    console.error("download failed", err);
    return NextResponse.json({ error: "download_failed", message: String(err) }, { status: 502 });
  }
}
