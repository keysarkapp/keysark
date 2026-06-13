import { downloadByPath, getStorageForRequest, sanitizeRelPath } from "@/lib/storage";
import {
  PayloadTooLargeError,
  readBodyLimited,
  rejectIfTooLargeByHeader,
  tooLargeResponse,
} from "@/lib/request-limits";

export const runtime = "nodejs";
export const maxDuration = 60;

// 二进制文件中转:body / 响应体都是不透明 octet-stream 密文,绕开 /api/files 的 base64+JSON。
// 用于大文件(≤100MB)上传下载,省 33% base64 体积 + JSON 全字符串内存峰值。内容由客户端加密,服务端不解读。

// 上传/覆盖:?path= 相对路径,body 为 application/octet-stream 原始密文字节。
export async function POST(request: Request) {
  const tooLarge = rejectIfTooLargeByHeader(request);
  if (tooLarge) return tooLarge;

  const conn = await getStorageForRequest(request);
  if (!conn) return Response.json({ error: "not_connected" }, { status: 401 });

  const path = sanitizeRelPath(new URL(request.url).searchParams.get("path"));
  if (!path) return Response.json({ error: "bad_path" }, { status: 400 });

  let bytes: Uint8Array;
  try {
    bytes = await readBodyLimited(request); // 流式读取 + 硬上限,不信任 Content-Length
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return tooLargeResponse();
    throw err;
  }
  try {
    await conn.client.upload(path, bytes);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("blob upload failed", err);
    return Response.json({ error: "upload_failed", message: String(err) }, { status: 502 });
  }
}

// 下载:?path= 沙盒相对路径(服务端在 app 根内解析为 fileId);octet-stream 返回原始密文字节。
export async function GET(request: Request) {
  const conn = await getStorageForRequest(request);
  if (!conn) return Response.json({ error: "not_connected" }, { status: 401 });

  const path = new URL(request.url).searchParams.get("path");
  try {
    const r = await downloadByPath(conn, path);
    if (r.status === "bad_path") return Response.json({ error: "path_required" }, { status: 400 });
    if (r.status === "not_found") return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(r.bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(r.bytes.byteLength),
      },
    });
  } catch (err) {
    console.error("blob download failed", err);
    return Response.json({ error: "download_failed", message: String(err) }, { status: 502 });
  }
}
