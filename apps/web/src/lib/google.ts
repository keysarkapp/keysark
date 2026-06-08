import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  GoogleDriveClient,
  buildAuthorizeUrl,
  driveScope,
  exchangeCodeForToken,
  fetchUserInfo,
  loadGoogleConfig,
  refreshAccessToken,
  type DriveOptions,
  type GoogleConfig,
} from "@keysark/googledrive";
import {
  getStorageAccount,
  newId,
  updateStorageTokens,
  upsertStorageAccount,
} from "@keysark/db";

// Google 存储后端;provider 列固定 "google",accountKey = Google 用户 sub。
const PROVIDER = "google";
const STATE_COOKIE = "google_oauth_state";
export const GOOGLE_UID_COOKIE = "google_uid";
const REFRESH_SKEW_MS = 60_000;

/** 由配置推导客户端存储位置:设置了 GOOGLE_DRIVE_FOLDER → 根下可见文件夹;否则 → 隐藏 appDataFolder。 */
function driveOptions(config: GoogleConfig): DriveOptions {
  return config.driveFolder
    ? { mode: "folder", folderName: config.driveFolder }
    : { mode: "appdata" };
}

export interface ConnectedGoogle {
  client: GoogleDriveClient;
  sub: string;
}

/** 取已连接的 Google Drive 客户端(读会话 cookie 决定账号)。未连接返回 null。 */
export async function getConnectedGoogle(): Promise<ConnectedGoogle | null> {
  const sub = (await cookies()).get(GOOGLE_UID_COOKIE)?.value;
  if (!sub) return null;
  return getConnectedGoogleBySub(sub);
}

/** 按 Google sub 取已连接客户端(无 cookie 路径:本地接口按唯一账号解析时用)。必要时刷新 token 写回。 */
export async function getConnectedGoogleBySub(sub: string): Promise<ConnectedGoogle | null> {
  const account = await getStorageAccount(PROVIDER, sub);
  if (!account) return null;

  const config = loadGoogleConfig();
  let accessToken = account.accessToken;
  if (account.expiresAt.getTime() - Date.now() < REFRESH_SKEW_MS) {
    if (!account.refreshToken) return null; // 无 refresh_token → 需重新登录授权
    const token = await refreshAccessToken(config, account.refreshToken);
    accessToken = token.accessToken;
    await updateStorageTokens(PROVIDER, sub, {
      accessToken: token.accessToken,
      // Google 刷新通常不返回新的 refresh_token,沿用旧的。
      refreshToken: token.refreshToken || account.refreshToken,
      expiresAt: new Date(Date.now() + token.expiresIn * 1000),
      scope: token.scope || account.scope,
    });
  }

  return { client: new GoogleDriveClient(accessToken, driveOptions(config)), sub };
}

/** 发起 Google 授权:state 防 CSRF → 重定向授权页。 */
export async function handleGoogleLogin(): Promise<NextResponse> {
  const config = loadGoogleConfig();
  const state = newId();
  const res = NextResponse.redirect(
    buildAuthorizeUrl(config, { state, scope: driveScope(config.driveFolder) }),
  );
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}

/** Google 回调:校验 state → 换 token → userinfo 取 sub → 落库 → 设会话 cookie。 */
export async function handleGoogleCallback(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  const home = new URL("/", request.url);

  if (!code || !state || !expectedState || state !== expectedState) {
    home.searchParams.set("error", "oauth_state");
    return NextResponse.redirect(home);
  }

  const config = loadGoogleConfig();
  try {
    const token = await exchangeCodeForToken(config, code);
    const info = await fetchUserInfo(token.accessToken);
    const sub = info.sub;

    // 本次若未返回 refresh_token,沿用已存的,避免清空导致后续无法刷新。
    let refreshToken = token.refreshToken;
    if (!refreshToken) {
      const existing = await getStorageAccount(PROVIDER, sub);
      refreshToken = existing?.refreshToken ?? "";
    }

    await upsertStorageAccount(PROVIDER, sub, {
      accessToken: token.accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + token.expiresIn * 1000),
      scope: token.scope,
    });
    const res = NextResponse.redirect(home);
    res.cookies.set(GOOGLE_UID_COOKIE, sub, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (err) {
    console.error("google callback failed", err);
    home.searchParams.set("error", "oauth_exchange");
    return NextResponse.redirect(home);
  }
}
