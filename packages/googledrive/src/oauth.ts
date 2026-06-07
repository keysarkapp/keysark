import type { GoogleConfig } from "./config";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

// openid/email/profile 取身份。
// drive.appdata:仅应用专属隐藏文件夹(appDataFolder)的读写,与百度沙盒同等隔离,用户在 Drive 里看不到。
// drive.file  :应用在 My Drive 里创建/打开的文件(可见),用于「根目录可见文件夹」模式;仍只能碰本应用创建的文件。
const IDENTITY = "openid email profile";
const APPDATA = "https://www.googleapis.com/auth/drive.appdata";
const FILE = "https://www.googleapis.com/auth/drive.file";
const SCOPE_APPDATA = `${IDENTITY} ${APPDATA}`;
const SCOPE_FILE = `${IDENTITY} ${FILE}`;

/** 默认 scope(appDataFolder 隐藏沙盒)。 */
export const DEFAULT_SCOPE = SCOPE_APPDATA;

/** 按存储位置选 scope:设置了可见文件夹名 → drive.file;否则 → drive.appdata。 */
export function driveScope(driveFolder: string): string {
  return driveFolder ? SCOPE_FILE : SCOPE_APPDATA;
}

export interface TokenResponse {
  /** 调用 Drive API 的凭据(expiresIn 秒后过期,通常 3600) */
  accessToken: string;
  /** 换新 access_token;仅在首次同意(access_type=offline + prompt=consent)时返回,刷新时可能为空 */
  refreshToken: string;
  /** access_token 剩余有效秒数 */
  expiresIn: number;
  /** 用户实际授予的 scope */
  scope: string;
}

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

export interface GoogleUserInfo {
  /** 稳定的用户唯一标识(作为 accountKey) */
  sub: string;
  name: string;
  email: string;
  picture: string;
}

/** Step 1:构造授权页 URL。access_type=offline + prompt=consent 确保拿到 refresh_token。 */
export function buildAuthorizeUrl(
  config: GoogleConfig,
  options: { state?: string; scope?: string } = {},
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: options.scope ?? DEFAULT_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  if (options.state) params.set("state", options.state);
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

function normalizeToken(raw: RawTokenResponse): TokenResponse {
  if (raw.error || !raw.access_token) {
    throw new Error(
      `google oauth error: ${raw.error ?? "missing_token"}${
        raw.error_description ? ` - ${raw.error_description}` : ""
      }`,
    );
  }
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? "",
    expiresIn: raw.expires_in ?? 0,
    scope: raw.scope ?? "",
  };
}

async function postToken(form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const raw = (await res.json()) as RawTokenResponse;
  return normalizeToken(raw);
}

/** Step 2:用回调拿到的 code 换 token。 */
export function exchangeCodeForToken(
  config: GoogleConfig,
  code: string,
): Promise<TokenResponse> {
  return postToken({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
  });
}

/** access_token 过期时用 refresh_token 换新的(Google 通常不返回新的 refresh_token)。 */
export function refreshAccessToken(
  config: GoogleConfig,
  refreshToken: string,
): Promise<TokenResponse> {
  return postToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
}

/** 取用户基本信息(sub 作为稳定账号标识)。 */
export async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`google userinfo failed: HTTP ${res.status}`);
  return (await res.json()) as GoogleUserInfo;
}
