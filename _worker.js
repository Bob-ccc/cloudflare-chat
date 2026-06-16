const DEFAULT_UPSTREAM_BASE = "https://api.openai.com";
const DEFAULT_AGNES_BASE = "https://apihub.agnes-ai.com";
const IMAGE_TABLE = "images";
const THUMBNAIL_TABLE = "image_thumbnails";
const MAX_THUMBNAIL_BYTES = 1024 * 1024;
const ALLOWED_THUMBNAIL_TYPES = new Set(["image/webp", "image/jpeg", "image/png"]);
const DEFAULT_QINIU_BUCKET = "ai-videoxjp";
const DEFAULT_QINIU_REGION = "as0";
const DEFAULT_QINIU_PUBLIC_DOMAIN = "http://xjp.zaoj.top";
const DEFAULT_QINIU_PREFIX = "uploads";
const QINIU_UPLOAD_HOSTS = {
  z0: "https://upload.qiniup.com",
  z1: "https://upload-z1.qiniup.com",
  z2: "https://upload-z2.qiniup.com",
  na0: "https://upload-na0.qiniup.com",
  as0: "https://upload-as0.qiniup.com",
};
const QINIU_RSF_HOSTS = {
  z0: "https://rsf.qbox.me",
  z1: "https://rsf-z1.qbox.me",
  z2: "https://rsf-z2.qbox.me",
  na0: "https://rsf-na0.qbox.me",
  as0: "https://rsf-as0.qbox.me",
};
const QINIU_RS_HOSTS = {
  z0: "https://rs.qbox.me",
  z1: "https://rs-z1.qbox.me",
  z2: "https://rs-z2.qbox.me",
  na0: "https://rs-na0.qbox.me",
  as0: "https://rs-as0.qbox.me",
};
const QINIU_IOVIP_HOSTS = {
  z0: "https://iovip-z0.qiniuio.com",
  z1: "https://iovip-z1.qiniuio.com",
  z2: "https://iovip-z2.qiniuio.com",
  na0: "https://iovip-na0.qiniuio.com",
  as0: "https://iovip-as0.qiniuio.com",
};
const QINIU_ALLOWED_PREFIXES = ["uploads/", "uploads/local/", "uploads/remote/", "agnes/", "agnes/images/", "agnes/videos/", "images/"];

function corsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Upstream-Base",
    "Access-Control-Max-Age": "86400",
  };
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request))) {
    headers.set(key, value);
  }
  headers.set("Cache-Control", "no-cache");
  headers.set("X-Accel-Buffering", "no");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(payload, status, request) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request),
    },
  });
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlEncodeText(text) {
  return base64UrlEncodeBytes(new TextEncoder().encode(text));
}

async function hmacSha1Base64Url(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function normalizeQiniuRegion(region) {
  const value = String(region || "").trim().toLowerCase();
  if (["z0", "huadong", "east", "cn-east"].includes(value)) return "z0";
  if (["z1", "huabei", "north", "cn-north"].includes(value)) return "z1";
  if (["z2", "huanan", "south", "cn-south"].includes(value)) return "z2";
  if (["na0", "beimei", "north-america", "us"].includes(value)) return "na0";
  if (["as0", "xinjiapo", "singapore", "ap-southeast", "asia-southeast"].includes(value)) return "as0";
  return DEFAULT_QINIU_REGION;
}

function qiniuConfig(env) {
  const accessKey = String(env.QINIU_ACCESS_KEY || "").trim();
  const secretKey = String(env.QINIU_SECRET_KEY || "").trim();
  const bucket = String(env.QINIU_BUCKET || DEFAULT_QINIU_BUCKET).trim();
  const region = normalizeQiniuRegion(env.QINIU_REGION || DEFAULT_QINIU_REGION);
  const publicDomain = String(env.QINIU_PUBLIC_DOMAIN || DEFAULT_QINIU_PUBLIC_DOMAIN).trim().replace(/\/+$/, "");
  const defaultPrefix = normalizeStoragePrefix(env.QINIU_PREFIX || DEFAULT_QINIU_PREFIX);
  return {
    accessKey,
    secretKey,
    bucket,
    region,
    publicDomain,
    defaultPrefix,
    uploadUrl: QINIU_UPLOAD_HOSTS[region] || QINIU_UPLOAD_HOSTS[DEFAULT_QINIU_REGION],
    rsfUrl: QINIU_RSF_HOSTS[region] || QINIU_RSF_HOSTS[DEFAULT_QINIU_REGION],
    rsUrl: QINIU_RS_HOSTS[region] || QINIU_RS_HOSTS[DEFAULT_QINIU_REGION],
    iovipUrl: QINIU_IOVIP_HOSTS[region] || QINIU_IOVIP_HOSTS[DEFAULT_QINIU_REGION],
  };
}

function requireQiniuConfig(request, env) {
  const cfg = qiniuConfig(env);
  if (!cfg.accessKey || !cfg.secretKey) {
    return { error: jsonResponse({ error: { message: "Qiniu credentials are not configured" } }, 500, request) };
  }
  if (!cfg.bucket) {
    return { error: jsonResponse({ error: { message: "Qiniu bucket is not configured" } }, 500, request) };
  }
  return { cfg };
}

function normalizeStoragePrefix(prefix) {
  let value = String(prefix || DEFAULT_QINIU_PREFIX).trim().replace(/\\/g, "/").replace(/^\/+/, "");
  value = value.replace(/\/{2,}/g, "/");
  if (value && !value.endsWith("/")) value += "/";
  return value || DEFAULT_QINIU_PREFIX + "/";
}

function sanitizeFilename(filename) {
  const raw = String(filename || "file").split(/[\\/]/).pop() || "file";
  return raw.replace(/[\x00-\x1f\x7f<>:"|?*]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "file";
}

function fileExtension(filename, mimeType) {
  const match = /\.([a-z0-9]{1,12})$/i.exec(String(filename || ""));
  if (match) return "." + match[1].toLowerCase();
  const mime = String(mimeType || "").toLowerCase();
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "video/mp4") return ".mp4";
  if (mime === "video/webm") return ".webm";
  if (mime === "application/pdf") return ".pdf";
  return ".bin";
}

function isAllowedStoragePrefix(prefix) {
  const normalized = normalizeStoragePrefix(prefix);
  return QINIU_ALLOWED_PREFIXES.some((allowed) => normalized === allowed || normalized.startsWith(allowed));
}

function normalizeStorageKey(key) {
  const value = String(key || "").trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  if (!value || value.includes("../") || value.startsWith("..") || /[\x00-\x1f\x7f]/.test(value)) return "";
  return value.slice(0, 512);
}

function randomStorageSuffix(length = 6) {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function makeStorageKey({ key, prefix, filename, mimeType }) {
  const explicit = normalizeStorageKey(key);
  if (explicit) return explicit;
  const cleanPrefix = normalizeStoragePrefix(prefix);
  const cleanName = sanitizeFilename(filename);
  const ext = fileExtension(cleanName, mimeType);
  const d = new Date();
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const id = `${Date.now().toString(36)}-${randomStorageSuffix()}`;
  return `${cleanPrefix}${yyyy}${mm}${dd}/${id}${ext}`.replace(/\/{2,}/g, "/");
}

function assertStorageKeyAllowed(key) {
  const prefix = key.includes("/") ? key.slice(0, key.lastIndexOf("/") + 1) : "";
  return isAllowedStoragePrefix(prefix || DEFAULT_QINIU_PREFIX + "/");
}

function qiniuPublicUrl(cfg, key) {
  return `${cfg.publicDomain}/${String(key || "").split("/").map(encodeURIComponent).join("/")}`;
}

function qiniuImageInfoUrl(url) {
  const value = String(url || "");
  return value + (value.includes("?") ? "&" : "?") + "imageInfo";
}

async function fetchQiniuImageInfo(publicUrl) {
  try {
    const res = await fetch(qiniuImageInfoUrl(publicUrl));
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) return null;
    return {
      width: intValue(json.width),
      height: intValue(json.height),
      size: intValue(json.size),
      format: textValue(json.format, 32),
      colorModel: textValue(json.colorModel, 64),
      frameNumber: intValue(json.frameNumber),
      raw: json,
    };
  } catch {
    return null;
  }
}

function storageImageUrl(id, kind) {
  return `/api/images/${encodeURIComponent(String(id || ""))}/${kind}`;
}

function imageRecordUrls(row) {
  const id = row?.id || "";
  const hasImage = row?.status !== "error" && (
    row?.thumbnail_url ||
    row?.preview_url ||
    row?.thumbnail_mime_type ||
    row?.storage_key ||
    row?.thumbnail_key ||
    row?.r2_key ||
    row?.public_url
  );
  if (!hasImage) {
    return {
      thumbnail_url: "",
      preview_url: "",
      public_url: "",
      storage_thumbnail_url: row?.thumbnail_url || "",
      storage_preview_url: row?.preview_url || "",
    };
  }
  return {
    thumbnail_url: storageImageUrl(id, "thumbnail"),
    preview_url: storageImageUrl(id, "preview"),
    public_url: storageImageUrl(id, "thumbnail"),
    storage_thumbnail_url: row?.thumbnail_url || "",
    storage_preview_url: row?.preview_url || "",
  };
}

function qiniuImageKey(id, kind, mimeType) {
  const ext = fileExtension(`image.${formatFromMime(mimeType || "image/png")}`, mimeType || "image/png");
  return `images/${id}${ext}`;
}

function bytesFromBase64(base64) {
  return Uint8Array.from(atob(cleanBase64(base64)), (c) => c.charCodeAt(0));
}

async function uploadBase64ToQiniu(cfg, key, base64, mimeType) {
  const bytes = bytesFromBase64(base64);
  const token = await qiniuUploadToken(cfg, key);
  const form = new FormData();
  form.append("token", token);
  form.append("key", key);
  form.append("file", new Blob([bytes], { type: mimeType || "application/octet-stream" }), key.split("/").pop() || "image");
  const res = await fetch(cfg.uploadUrl, { method: "POST", body: form });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = json?.error || json?.message || "Qiniu upload failed";
    const err = new Error(message);
    err.status = res.status || 502;
    err.raw = json;
    throw err;
  }
  return { key, url: qiniuPublicUrl(cfg, key), bytes: bytes.length, raw: json };
}

async function qiniuUploadToken(cfg, key, options = {}) {
  const deadline = Math.floor(Date.now() / 1000) + Math.max(60, Number(options.expires || 1800));
  const policy = {
    scope: `${cfg.bucket}:${key}`,
    deadline,
    returnBody: JSON.stringify({
      key: "$(key)",
      hash: "$(etag)",
      fsize: "$(fsize)",
      mimeType: "$(mimeType)",
      bucket: "$(bucket)",
    }),
  };
  const encoded = base64UrlEncodeText(JSON.stringify(policy));
  const sign = await hmacSha1Base64Url(cfg.secretKey, encoded);
  return `${cfg.accessKey}:${sign}:${encoded}`;
}

async function qiniuManageAuthorization(cfg, pathWithQuery, body = "") {
  const signingText = `${pathWithQuery}\n${body || ""}`;
  const sign = await hmacSha1Base64Url(cfg.secretKey, signingText);
  return `QBox ${cfg.accessKey}:${sign}`;
}

async function qiniuRequestAuthorization(cfg, method, requestUrl, headers = {}, body = "") {
  const url = new URL(requestUrl);
  const contentType = headers["Content-Type"] || headers["content-type"] || "";
  let signingText = `${String(method || "GET").toUpperCase()} ${url.pathname}${url.search}\nHost: ${url.host}`;
  if (contentType) signingText += `\nContent-Type: ${contentType}`;
  signingText += "\n\n";
  if (body && contentType !== "application/octet-stream") signingText += body;
  const sign = await hmacSha1Base64Url(cfg.secretKey, signingText);
  return `Qiniu ${cfg.accessKey}:${sign}`;
}

function encodedEntry(bucket, key) {
  return base64UrlEncodeText(`${bucket}:${key}`);
}

function isQiniuVideoFile(item) {
  const mimeType = String(item?.mimeType || item?.mime_type || "").toLowerCase();
  const key = String(item?.key || "").toLowerCase();
  return mimeType.startsWith("video/") || /\.(mp4|webm|mov|m4v|avi|mkv)$/.test(key);
}

function isQiniuImageFile(item) {
  const mimeType = String(item?.mimeType || item?.mime_type || "").toLowerCase();
  const key = String(item?.key || "").toLowerCase();
  return mimeType.startsWith("image/") || /\.(jpg|jpeg|png|webp|gif|avif)$/.test(key);
}

function publicFileFromQiniuItem(cfg, item) {
  const file = {
    key: item.key,
    hash: item.hash || "",
    fsize: Number(item.fsize || 0),
    mimeType: item.mimeType || item.mime_type || "",
    putTime: item.putTime || item.put_time || 0,
    type: item.type || 0,
    status: item.status || 0,
    url: qiniuPublicUrl(cfg, item.key),
  };
  if (isQiniuVideoFile(file)) {
    file.cover_key = `${file.key}-cover`;
    file.cover_url = qiniuPublicUrl(cfg, file.cover_key);
  } else if (isQiniuImageFile(file) && !String(file.key || "").endsWith("-pre") && !String(file.key || "").endsWith("-cover")) {
    file.preview_key = `${file.key}-pre`;
    file.preview_url = qiniuPublicUrl(cfg, file.preview_key);
  }
  return file;
}

function isPrivateHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

function upstreamUrlFor(request, env) {
  const requestUrl = new URL(request.url);
  const requestedUpstream =
    request.headers.get("X-Upstream-Base") ||
    env.UPSTREAM_BASE ||
    DEFAULT_UPSTREAM_BASE;
  const upstreamBase = new URL(requestedUpstream);
  if (!["https:", "http:"].includes(upstreamBase.protocol)) {
    throw new Error("X-Upstream-Base must use HTTP(S)");
  }

  const upstreamPath =
    upstreamBase.pathname.replace(/\/$/, "").endsWith("/v1") &&
    requestUrl.pathname.startsWith("/v1/")
      ? requestUrl.pathname.slice(3)
      : requestUrl.pathname;

  return upstreamBase.href.replace(/\/$/, "") + upstreamPath + requestUrl.search;
}

function base64ByteLength(base64) {
  const clean = String(base64 || "").replace(/^data:[^,]+,/, "").replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

function cleanBase64(base64) {
  return String(base64 || "").replace(/^data:[^,]+,/, "").replace(/\s/g, "");
}

function mimeFromBase64(base64) {
  const clean = cleanBase64(base64);
  try {
    const binary = atob(clean.slice(0, 24));
    const bytes = Array.from(binary.slice(0, 12)).map((char) => char.charCodeAt(0));
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
      return "image/webp";
    }
  } catch {}
  return "";
}

function formatFromMime(mimeType) {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpeg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function parseSize(size, fallbackWidth = 1152, fallbackHeight = 768) {
  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(String(size || "").trim());
  if (!match) return { width: fallbackWidth, height: fallbackHeight, size: `${fallbackWidth}x${fallbackHeight}` };
  const width = Math.max(1, Math.trunc(Number(match[1])));
  const height = Math.max(1, Math.trunc(Number(match[2])));
  return { width, height, size: `${width}x${height}` };
}

function agnesVideoUrlFromResult(json) {
  if (!json || typeof json !== "object") return "";
  return (
    json.video_url ||
    json.url ||
    json.remixed_from_video_id ||
    json.output_url ||
    json.output?.video_url ||
    json.output?.url ||
    json.data?.video_url ||
    json.data?.url ||
    ""
  );
}

function normalizeAgnesVideoTask(json, fallback = {}) {
  const item = json?.data && typeof json.data === "object" && !Array.isArray(json.data) ? json.data : json;
  const videoUrl = agnesVideoUrlFromResult(item) || agnesVideoUrlFromResult(json);
  return {
    id: textValue(item?.id || item?.task_id || item?.taskId || fallback.task_id || "", 128),
    task_id: textValue(item?.task_id || item?.taskId || item?.id || fallback.task_id || "", 128),
    video_id: textValue(item?.video_id || item?.videoId || item?.video?.id || fallback.video_id || "", 128),
    model: textValue(item?.model || fallback.model || "agnes-video-v2.0", 128),
    status: textValue(item?.status || fallback.status || "queued", 64),
    progress: Number(item?.progress ?? fallback.progress ?? 0) || 0,
    seconds: textValue(item?.seconds || fallback.seconds || "", 32),
    size: textValue(item?.size || fallback.size || "", 32),
    video_url: textValue(videoUrl, 2048),
    error: item?.error || json?.error || null,
    raw: json,
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function textValue(value, max = 4000) {
  if (value == null) return "";
  return String(value).slice(0, max);
}

function intValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function authHeadersFor(request, env, contentType = "application/json") {
  const headers = new Headers();
  if (contentType) headers.set("Content-Type", contentType);
  const browserAuth = request.headers.get("Authorization");
  if (env.OPENAI_API_KEY) {
    headers.set("Authorization", "Bearer " + env.OPENAI_API_KEY);
  } else if (browserAuth) {
    headers.set("Authorization", browserAuth);
  } else {
    return null;
  }
  return headers;
}

function upstreamBaseFor(request, env) {
  const requestedUpstream =
    request.headers.get("X-Upstream-Base") ||
    env.UPSTREAM_BASE ||
    DEFAULT_UPSTREAM_BASE;
  const upstreamBase = new URL(requestedUpstream);
  if (!["https:", "http:"].includes(upstreamBase.protocol)) {
    throw new Error("X-Upstream-Base must use HTTP(S)");
  }
  return upstreamBase.href.replace(/\/$/, "");
}

async function proxyApi(request, env) {
  let upstreamUrl;
  try {
    upstreamUrl = upstreamUrlFor(request, env);
  } catch (err) {
    return jsonResponse({ error: { message: err.message } }, 400, request);
  }

  const contentType = request.headers.get("Content-Type");
  const headers = authHeadersFor(request, env, contentType);
  if (!headers) {
    return jsonResponse(
      { error: { message: "请在页面填写 API Key，或为 Worker 配置 OPENAI_API_KEY secret" } },
      401,
      request
    );
  }

  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });
  return withCors(upstream, request);
}

async function handleAgnesGenerate(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: { message: "Invalid JSON body" } }, 400, request);
  }

  const apiKey = textValue(body.apiKey || env.AGNES_API_KEY, 4096);
  if (!apiKey) {
    return jsonResponse({ error: { message: "请填写 Agnes API Key，或为 Worker 配置 AGNES_API_KEY secret" } }, 401, request);
  }

  let baseUrl;
  try {
    baseUrl = new URL(body.baseUrl || env.AGNES_BASE_URL || DEFAULT_AGNES_BASE);
  } catch {
    return jsonResponse({ error: { message: "Agnes Base URL is invalid" } }, 400, request);
  }
  if (!["https:", "http:"].includes(baseUrl.protocol)) {
    return jsonResponse({ error: { message: "Agnes Base URL must use HTTP(S)" } }, 400, request);
  }

  const model = textValue(body.model || "agnes-image-2.1-flash", 128) || "agnes-image-2.1-flash";
  const prompt = textValue(body.prompt);
  const size = textValue(body.size || "1024x768", 32) || "1024x768";
  const responseFormatInput = textValue(body.response_format || body.responseFormat || body.output_format || body.outputFormat, 32).toLowerCase();
  const responseFormat = responseFormatInput === "url" ? "url" : "b64_json";
  const images = Array.isArray(body.images)
    ? body.images.filter((item) => typeof item === "string" && item.trim()).slice(0, 10)
    : [];

  if (!prompt.trim()) return jsonResponse({ error: { message: "prompt is required" } }, 400, request);

  const payload = {
    model,
    prompt,
    size,
  };
  if (images.length) {
    payload.extra_body = {
      image: images,
      response_format: responseFormat,
    };
  } else if (responseFormat === "url") {
    payload.extra_body = {
      response_format: "url",
    };
  } else {
    payload.response_format = "b64_json";
    payload.return_base64 = true;
  }

  const endpoint = baseUrl.href.replace(/\/$/, "") + "/v1/images/generations";
  const upstream = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await upstream.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return jsonResponse({ error: { message: "Agnes returned invalid JSON: " + text.slice(0, 300) } }, upstream.status || 502, request);
  }
  if (!upstream.ok) {
    return jsonResponse(
      { error: { message: json.error?.message || json.message || upstream.statusText || "Agnes request failed", raw: json } },
      upstream.status,
      request
    );
  }

  const item = Array.isArray(json.data) ? json.data[0] : null;
  if (!item) return jsonResponse({ error: { message: "Agnes response has no image data", raw: json } }, 502, request);

  let imageData = item.b64_json || item.base64 || item.image || "";
  let mimeType = item.mime_type || item.mimeType || item.content_type || item.contentType || "image/png";
  let url = item.url || "";

  if (!imageData && url && responseFormat !== "url") {
    const imageRes = await fetch(url);
    if (!imageRes.ok) {
      return jsonResponse({ error: { message: "Agnes image URL download failed" } }, 502, request);
    }
    const contentType = imageRes.headers.get("Content-Type") || "";
    if (contentType.startsWith("image/")) mimeType = contentType.split(";")[0].toLowerCase();
    imageData = arrayBufferToBase64(await imageRes.arrayBuffer());
    url = "";
  }

  if (!imageData && !url) return jsonResponse({ error: { message: "Agnes response has neither b64_json nor url", raw: json } }, 502, request);
  if (imageData) mimeType = mimeFromBase64(imageData) || mimeType;

  return jsonResponse(
    {
      data: {
        imageData,
        url,
        mimeType,
        format: formatFromMime(mimeType),
        model,
        size,
        response_format: responseFormat,
        revised_prompt: item.revised_prompt || null,
        raw: json,
      },
    },
    200,
    request
  );
}

async function handleAgnesVideoCreate(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: { message: "Invalid JSON body" } }, 400, request);
  }

  const apiKey = textValue(body.apiKey || env.AGNES_API_KEY, 4096);
  if (!apiKey) {
    return jsonResponse({ error: { message: "请填写 Agnes API Key，或为 Worker 配置 AGNES_API_KEY secret" } }, 401, request);
  }

  let baseUrl;
  try {
    baseUrl = new URL(body.baseUrl || env.AGNES_BASE_URL || DEFAULT_AGNES_BASE);
  } catch {
    return jsonResponse({ error: { message: "Agnes Base URL is invalid" } }, 400, request);
  }
  if (!["https:", "http:"].includes(baseUrl.protocol)) {
    return jsonResponse({ error: { message: "Agnes Base URL must use HTTP(S)" } }, 400, request);
  }

  const model = textValue(body.model || "agnes-video-v2.0", 128) || "agnes-video-v2.0";
  const prompt = textValue(body.prompt);
  if (!prompt.trim()) return jsonResponse({ error: { message: "prompt is required" } }, 400, request);

  const { width, height, size } = parseSize(body.size, 1152, 768);
  let numFrames = intValue(body.num_frames || body.numFrames || 121);
  let frameRate = intValue(body.frame_rate || body.frameRate || 24);
  if (numFrames < 1) numFrames = 121;
  if (numFrames > 441) numFrames = 441;
  if ((numFrames - 1) % 8 !== 0) numFrames = Math.max(1, Math.min(441, Math.round((numFrames - 1) / 8) * 8 + 1));
  if (frameRate < 1) frameRate = 24;
  if (frameRate > 60) frameRate = 60;

  const imageUrls = Array.isArray(body.imageUrls)
    ? body.imageUrls.filter((item) => typeof item === "string" && /^https?:\/\//i.test(item.trim())).map((item) => item.trim()).slice(0, 10)
    : [];
  const mode = textValue(body.mode, 32);
  const payload = {
    model,
    prompt,
    width,
    height,
    num_frames: numFrames,
    frame_rate: frameRate,
  };
  if (imageUrls.length === 1) {
    payload.image = imageUrls[0];
  } else if (imageUrls.length > 1) {
    payload.extra_body = { image: imageUrls };
    if (mode === "keyframes") payload.extra_body.mode = "keyframes";
  }

  const endpoint = baseUrl.href.replace(/\/$/, "") + "/v1/videos";
  const upstream = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await upstream.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return jsonResponse({ error: { message: "Agnes returned invalid JSON: " + text.slice(0, 300) } }, upstream.status || 502, request);
  }
  if (!upstream.ok) {
    return jsonResponse(
      { error: { message: json.error?.message || json.message || upstream.statusText || "Agnes video request failed", raw: json } },
      upstream.status,
      request
    );
  }

  return jsonResponse(
    { data: normalizeAgnesVideoTask(json, { model, size, seconds: String(numFrames / frameRate), status: "queued" }) },
    200,
    request
  );
}

async function handleAgnesVideoQuery(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: { message: "Invalid JSON body" } }, 400, request);
  }

  const apiKey = textValue(body.apiKey || env.AGNES_API_KEY, 4096);
  if (!apiKey) {
    return jsonResponse({ error: { message: "请填写 Agnes API Key，或为 Worker 配置 AGNES_API_KEY secret" } }, 401, request);
  }

  let baseUrl;
  try {
    baseUrl = new URL(body.baseUrl || env.AGNES_BASE_URL || DEFAULT_AGNES_BASE);
  } catch {
    return jsonResponse({ error: { message: "Agnes Base URL is invalid" } }, 400, request);
  }
  if (!["https:", "http:"].includes(baseUrl.protocol)) {
    return jsonResponse({ error: { message: "Agnes Base URL must use HTTP(S)" } }, 400, request);
  }

  const model = textValue(body.model || "agnes-video-v2.0", 128) || "agnes-video-v2.0";
  const videoId = textValue(body.video_id || body.videoId, 128);
  const taskId = textValue(body.task_id || body.taskId || body.id, 128);
  if (!videoId && !taskId) {
    return jsonResponse({ error: { message: "video_id or task_id is required" } }, 400, request);
  }

  const base = baseUrl.href.replace(/\/$/, "");
  const endpoints = [];
  if (videoId) {
    endpoints.push(`${base}/agnesapi?video_id=${encodeURIComponent(videoId)}`);
    endpoints.push(`${base}/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(model)}`);
  }
  if (taskId) {
    endpoints.push(`${base}/v1/videos/${encodeURIComponent(taskId)}`);
  }

  let upstream = null;
  let json = null;
  let lastError = null;
  const attempted = [];
  for (const endpoint of endpoints) {
    upstream = await fetch(endpoint, {
      method: "GET",
      headers: { "Authorization": "Bearer " + apiKey },
    });
    attempted.push(endpoint.replace(base, ""));
    const text = await upstream.text();
    try {
      json = JSON.parse(text);
    } catch {
      lastError = { status: upstream.status || 502, message: "Agnes returned invalid JSON: " + text.slice(0, 300), raw: text.slice(0, 300) };
      if (upstream.status !== 404) break;
      continue;
    }
    if (upstream.ok) {
      lastError = null;
      break;
    }
    lastError = {
      status: upstream.status,
      message: json.error?.message || json.message || upstream.statusText || "Agnes video query failed",
      raw: json,
      retryAfter: upstream.headers.get("Retry-After") || "",
    };
    if (upstream.status !== 404) break;
  }
  if (lastError) {
    return jsonResponse(
      { error: { message: lastError.message, raw: lastError.raw, attempted, retry_after: lastError.retryAfter || "" } },
      lastError.status,
      request
    );
  }

  return jsonResponse(
    { data: { ...normalizeAgnesVideoTask(json, { model, task_id: taskId, video_id: videoId }), attempted } },
    200,
    request
  );
}

async function createImageRecord(request, env) {
  if (!env.DB) return jsonResponse({ error: { message: "D1 is not configured" } }, 500, request);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: { message: "Invalid JSON body" } }, 400, request);
  }

  {
    const rawStatus = textValue(body.status, 32).toLowerCase();
    const isFailedRecord = ["error", "failed", "failure"].includes(rawStatus);
    if (isFailedRecord) {
      const requestedId = textValue(body.id, 128);
      const id = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(requestedId) ? requestedId : crypto.randomUUID();
      const now = new Date().toISOString();
      let errorText = "";
      if (typeof body.error === "string") {
        errorText = textValue(body.error);
      } else if (body.error && typeof body.error === "object") {
        errorText = textValue(body.error.message || body.error.error?.message || JSON.stringify(body.error));
      } else {
        errorText = textValue(body.message || body.error_message || body.errorMessage);
      }
      if (!errorText) errorText = "Generation failed";
      const completedAt = textValue(body.completed_at || body.completedAt, 64) || now;
      const generationMs = intValue(body.generation_ms || body.generationMs || body.duration_ms || body.elapsed_ms);

      await env.DB.prepare(
        `INSERT INTO ${IMAGE_TABLE}
          (id, r2_key, public_url, prompt, model, api_mode, size, quality, format, streamed, reference_count, created_at,
           storage_provider, storage_key, thumbnail_key, thumbnail_url, preview_key, preview_url,
           status, error, completed_at, generation_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        null,
        null,
        textValue(body.prompt) || "Untitled prompt",
        textValue(body.model, 128),
        textValue(body.api_mode, 32),
        textValue(body.size, 32),
        textValue(body.quality, 32),
        textValue(body.format, 32),
        body.streamed ? 1 : 0,
        intValue(body.reference_count),
        now,
        null,
        null,
        null,
        null,
        null,
        null,
        "error",
        errorText,
        completedAt,
        generationMs
      ).run();

      return jsonResponse(
        {
          data: {
            id,
            thumbnail_url: "",
            preview_url: "",
            public_url: "",
            storage_provider: "",
            storage_key: "",
            storage_thumbnail_url: "",
            storage_preview_url: "",
            status: "error",
            error: errorText,
            completed_at: completedAt,
            generation_ms: generationMs,
            created_at: now,
          },
        },
        201,
        request
      );
    }
  }

  const thumbnail = body.thumbnail || {};
  const preview = body.preview || {};
  const useQiniu = textValue(body.storage_provider || body.storageProvider || body.storage, 32) === "qiniu";
  const mimeType = textValue(thumbnail.mime_type, 64);
  if (!ALLOWED_THUMBNAIL_TYPES.has(mimeType)) {
    return jsonResponse({ error: { message: "Unsupported thumbnail mime_type" } }, 400, request);
  }

  const dataBase64 = cleanBase64(thumbnail.data_base64);
  const storageKeyInput = normalizeStorageKey(body.storage_key || body.storageKey || thumbnail.key || "");
  const thumbnailUrlInput = textValue(body.thumbnail_url || body.thumbnailUrl || thumbnail.url, 2048);
  const hasDirectQiniuFile = useQiniu && storageKeyInput && thumbnailUrlInput && !dataBase64;
  if (hasDirectQiniuFile && !assertStorageKeyAllowed(storageKeyInput)) {
    return jsonResponse({ error: { message: "Storage prefix is not allowed" } }, 400, request);
  }
  const bytes = dataBase64 ? base64ByteLength(dataBase64) : intValue(thumbnail.bytes);
  const declaredBytes = intValue(thumbnail.bytes);
  if (!hasDirectQiniuFile && (!dataBase64 || bytes <= 0)) {
    return jsonResponse({ error: { message: "thumbnail.data_base64 is required" } }, 400, request);
  }
  if (!useQiniu && (bytes > MAX_THUMBNAIL_BYTES || declaredBytes > MAX_THUMBNAIL_BYTES)) {
    return jsonResponse({ error: { message: "Thumbnail exceeds 1MB limit" } }, 413, request);
  }
  const previewMimeType = textValue(preview.mime_type || mimeType, 64);
  const previewDataBase64 = cleanBase64(preview.data_base64 || (useQiniu ? "" : dataBase64));
  const previewBytes = previewDataBase64 ? base64ByteLength(previewDataBase64) : 0;
  if (!ALLOWED_THUMBNAIL_TYPES.has(previewMimeType)) {
    return jsonResponse({ error: { message: "Unsupported preview mime_type" } }, 400, request);
  }
  if (!useQiniu && (!previewDataBase64 || previewBytes <= 0)) {
    return jsonResponse({ error: { message: "preview.data_base64 is required" } }, 400, request);
  }

  const requestedId = textValue(body.id, 128);
  const id = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(requestedId) ? requestedId : crypto.randomUUID();
  const now = new Date().toISOString();
  const prompt = textValue(body.prompt);
  let storageProvider = "";
  let storageKey = "";
  let thumbnailKey = "";
  let thumbnailUrl = "";
  let previewKey = "";
  let previewUrl = "";
  let thumbnailDataBase64 = dataBase64;
  let previewStoredBase64 = previewDataBase64;

  if (useQiniu) {
    const { cfg, error } = requireQiniuConfig(request, env);
    if (error) return error;
    try {
      if (hasDirectQiniuFile) {
        thumbnailKey = storageKeyInput;
        thumbnailUrl = thumbnailUrlInput;
      } else {
        thumbnailKey = qiniuImageKey(id, "thumbnail", mimeType);
        const uploadedThumbnail = await uploadBase64ToQiniu(cfg, thumbnailKey, dataBase64, mimeType);
        thumbnailUrl = uploadedThumbnail.url;
      }
      previewKey = `${thumbnailKey}-pre`;
      previewUrl = `${thumbnailUrl}-pre`;
      storageProvider = "qiniu";
      storageKey = thumbnailKey;
      thumbnailDataBase64 = "";
      previewStoredBase64 = "";
    } catch (err) {
      return jsonResponse(
        { error: { message: err.message || "Qiniu image upload failed", raw: err.raw || null } },
        err.status || 502,
        request
      );
    }
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ${IMAGE_TABLE}
        (id, r2_key, public_url, prompt, model, api_mode, size, quality, format, streamed, reference_count, created_at,
         storage_provider, storage_key, thumbnail_key, thumbnail_url, preview_key, preview_url,
         status, error, completed_at, generation_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      storageKey || null,
      storageImageUrl(id, "thumbnail"),
      prompt || "未填写提示词",
      textValue(body.model, 128),
      textValue(body.api_mode, 32),
      textValue(body.size, 32),
      textValue(body.quality, 32),
      textValue(body.format, 32),
      body.streamed ? 1 : 0,
      intValue(body.reference_count),
      now,
      storageProvider || null,
      storageKey || null,
      thumbnailKey || null,
      thumbnailUrl || null,
      previewKey || null,
      previewUrl || null,
      "completed",
      null,
      textValue(body.completed_at || body.completedAt, 64) || now,
      intValue(body.generation_ms || body.generationMs || body.duration_ms || body.elapsed_ms)
    ),
    env.DB.prepare(
      `INSERT INTO ${THUMBNAIL_TABLE}
        (image_id, mime_type, data_base64, bytes, width, height,
         original_bytes, original_width, original_height, compression_ratio, encoder_quality,
         preview_mime_type, preview_data_base64, preview_bytes, preview_width, preview_height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      mimeType,
      thumbnailDataBase64,
      bytes,
      intValue(thumbnail.width),
      intValue(thumbnail.height),
      intValue(thumbnail.original_bytes),
      intValue(thumbnail.original_width),
      intValue(thumbnail.original_height),
      Number(thumbnail.compression_ratio) || 0,
      Number(thumbnail.quality) || 0,
      previewMimeType,
      previewStoredBase64,
      previewBytes,
      intValue(preview.width),
      intValue(preview.height),
      now
    ),
  ]);

  return jsonResponse(
    {
      data: {
        id,
        thumbnail_url: storageImageUrl(id, "thumbnail"),
        preview_url: storageImageUrl(id, "preview"),
        public_url: storageImageUrl(id, "thumbnail"),
        storage_provider: storageProvider,
        storage_key: storageKey,
        storage_thumbnail_url: thumbnailUrl,
        storage_preview_url: previewUrl,
        status: "completed",
        error: null,
        completed_at: textValue(body.completed_at || body.completedAt, 64) || now,
        generation_ms: intValue(body.generation_ms || body.generationMs || body.duration_ms || body.elapsed_ms),
        created_at: now,
      },
    },
    201,
    request
  );
}

async function listImages(request, env) {
  if (!env.DB) return jsonResponse({ data: [] }, 200, request);
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 100);
  const cursorCreatedAt = url.searchParams.get("cursor_created_at") || "";
  const cursorId = url.searchParams.get("cursor_id") || "";
  const apiMode = textValue(url.searchParams.get("api_mode"), 32);
  const pageLimit = limit + 1;
  const baseQuery = `SELECT i.id, i.r2_key, i.public_url, i.prompt, i.model, i.api_mode, i.size,
            i.quality, i.format, i.streamed, i.reference_count, i.created_at,
            i.storage_provider, i.storage_key, i.thumbnail_key, i.thumbnail_url, i.preview_key, i.preview_url,
            i.status, i.error, i.completed_at, i.generation_ms,
            t.mime_type AS thumbnail_mime_type, t.bytes AS thumbnail_bytes,
            t.width AS thumbnail_width, t.height AS thumbnail_height,
            t.original_bytes, t.original_width, t.original_height,
            t.compression_ratio, t.encoder_quality,
            t.preview_mime_type, t.preview_bytes, t.preview_width, t.preview_height
     FROM ${IMAGE_TABLE} i
     LEFT JOIN ${THUMBNAIL_TABLE} t ON t.image_id = i.id`;
  const filters = [];
  const binds = [];
  if (apiMode) {
    filters.push("i.api_mode = ?");
    binds.push(apiMode);
  }
  if (cursorCreatedAt && cursorId) {
    filters.push("(i.created_at < ? OR (i.created_at = ? AND i.id < ?))");
    binds.push(cursorCreatedAt, cursorCreatedAt, cursorId);
  }
  const query = `${baseQuery}
     ${filters.length ? "WHERE " + filters.join(" AND ") : ""}
     ORDER BY i.created_at DESC, i.id DESC
     LIMIT ?`;
  const stmt = env.DB.prepare(query);
  const { results } = await stmt.bind(...binds, pageLimit).all();
  const rows = results || [];
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const data = pageRows.map((row) => ({
    ...row,
    ...imageRecordUrls(row),
  }));
  const last = data[data.length - 1] || null;
  return jsonResponse(
    {
      data,
      has_more: hasMore,
      next_cursor: hasMore && last ? { created_at: last.created_at, id: last.id } : null,
    },
    200,
    request
  );
}

async function getImageRecord(request, env, id) {
  if (!env.DB) return jsonResponse({ error: { message: "D1 is not configured" } }, 500, request);
  const row = await env.DB.prepare(
    `SELECT i.id, i.r2_key, i.public_url, i.prompt, i.model, i.api_mode, i.size,
            i.quality, i.format, i.streamed, i.reference_count, i.created_at,
            i.storage_provider, i.storage_key, i.thumbnail_key, i.thumbnail_url, i.preview_key, i.preview_url,
            i.status, i.error, i.completed_at, i.generation_ms,
            t.mime_type AS thumbnail_mime_type, t.bytes AS thumbnail_bytes,
            t.width AS thumbnail_width, t.height AS thumbnail_height,
            t.original_bytes, t.original_width, t.original_height,
            t.compression_ratio, t.encoder_quality,
            t.preview_mime_type, t.preview_bytes, t.preview_width, t.preview_height
     FROM ${IMAGE_TABLE} i
     LEFT JOIN ${THUMBNAIL_TABLE} t ON t.image_id = i.id
     WHERE i.id = ?`
  )
    .bind(id)
    .first();
  if (!row) return jsonResponse({ error: { message: "Image not found" } }, 404, request);
  return jsonResponse(
    { data: { ...row, ...imageRecordUrls(row) } },
    200,
    request
  );
}

async function getImageBlob(request, env, id, kind) {
  if (!env.DB) return jsonResponse({ error: { message: "D1 is not configured" } }, 500, request);
  const row = await env.DB.prepare(
    `SELECT i.thumbnail_url, i.preview_url,
            t.mime_type, t.data_base64, t.preview_mime_type, t.preview_data_base64
     FROM ${IMAGE_TABLE} i
     LEFT JOIN ${THUMBNAIL_TABLE} t ON t.image_id = i.id
     WHERE i.id = ?`
  )
    .bind(id)
    .first();
  if (!row) return jsonResponse({ error: { message: "Image not found" } }, 404, request);
  const usePreview = kind === "preview" && row.preview_data_base64;
  const mimeType = usePreview ? row.preview_mime_type : row.mime_type;
  const dataBase64 = usePreview ? row.preview_data_base64 : row.data_base64;
  if (!dataBase64) {
    const sourceUrl = kind === "preview" ? row.preview_url || row.thumbnail_url : row.thumbnail_url;
    if (!sourceUrl) return jsonResponse({ error: { message: "Image data not found" } }, 404, request);
    const upstream = await fetch(sourceUrl);
    if (!upstream.ok && kind === "preview") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (!upstream.ok) {
      return jsonResponse({ error: { message: "Qiniu image fetch failed" } }, upstream.status || 502, request);
    }
    const headers = new Headers(upstream.headers);
    headers.set("Cache-Control", "private, max-age=3600");
    for (const [key, value] of Object.entries(corsHeaders(request))) headers.set(key, value);
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  }
  const bytes = Uint8Array.from(atob(dataBase64), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "Content-Type": mimeType,
      "Cache-Control": "private, max-age=3600",
      ...corsHeaders(request),
    },
  });
}

async function deleteImageRecord(request, env, id) {
  if (!env.DB) return jsonResponse({ error: { message: "D1 is not configured" } }, 500, request);
  const existing = await env.DB.prepare(`SELECT id, thumbnail_key, preview_key FROM ${IMAGE_TABLE} WHERE id = ?`).bind(id).first();
  if (!existing) return jsonResponse({ error: { message: "Image not found" } }, 404, request);
  const keys = [existing.thumbnail_key, existing.preview_key].filter(Boolean);
  if (keys.length) {
    const { cfg } = requireQiniuConfig(request, env);
    if (cfg?.accessKey && cfg?.secretKey) {
      for (const key of keys) {
        try {
          const entry = encodedEntry(cfg.bucket, key);
          const path = `/delete/${entry}`;
          const auth = await qiniuManageAuthorization(cfg, path);
          await fetch(cfg.rsUrl + path, { method: "POST", headers: { Authorization: auth } });
        } catch (_) {}
      }
    }
  }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ${THUMBNAIL_TABLE} WHERE image_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM ${IMAGE_TABLE} WHERE id = ?`).bind(id),
  ]);
  return jsonResponse({ ok: true }, 200, request);
}

async function handleImagesApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/images" && request.method === "GET") {
    return listImages(request, env);
  }
  if (url.pathname === "/api/images" && request.method === "POST") {
    return createImageRecord(request, env);
  }
  const thumbMatch = /^\/api\/images\/([^/]+)\/thumbnail$/.exec(url.pathname);
  if (thumbMatch && request.method === "GET") return getImageBlob(request, env, thumbMatch[1], "thumbnail");
  const previewMatch = /^\/api\/images\/([^/]+)\/preview$/.exec(url.pathname);
  if (previewMatch && request.method === "GET") return getImageBlob(request, env, previewMatch[1], "preview");
  const match = /^\/api\/images\/([^/]+)$/.exec(url.pathname);
  if (match && request.method === "GET") return getImageRecord(request, env, match[1]);
  if (match && request.method === "DELETE") return deleteImageRecord(request, env, match[1]);
  return jsonResponse({ error: { message: "Not found" } }, 404, request);
}

async function handleQiniuUploadToken(request, env) {
  const { cfg, error } = requireQiniuConfig(request, env);
  if (error) return error;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: { message: "Invalid JSON body" } }, 400, request);
  }
  const filename = sanitizeFilename(body.filename || "file");
  const mimeType = textValue(body.mimeType || body.contentType || "application/octet-stream", 128);
  const size = Math.max(0, Number(body.size || 0));
  const prefix = normalizeStoragePrefix(body.prefix || cfg.defaultPrefix || DEFAULT_QINIU_PREFIX);
  const key = makeStorageKey({ key: body.key, prefix, filename, mimeType });
  if (!assertStorageKeyAllowed(key)) return jsonResponse({ error: { message: "Storage prefix is not allowed" } }, 400, request);
  const token = await qiniuUploadToken(cfg, key, { expires: Number(body.expires || 1800) });
  return jsonResponse(
    {
      data: {
        provider: "qiniu",
        bucket: cfg.bucket,
        key,
        token,
        uploadUrl: cfg.uploadUrl,
        publicUrl: qiniuPublicUrl(cfg, key),
        expires_in: Number(body.expires || 1800),
        filename,
        mimeType,
        size,
      },
    },
    200,
    request
  );
}

async function handleQiniuListFiles(request, env) {
  const { cfg, error } = requireQiniuConfig(request, env);
  if (error) return error;
  const url = new URL(request.url);
  const prefix = normalizeStoragePrefix(url.searchParams.get("prefix") || cfg.defaultPrefix || DEFAULT_QINIU_PREFIX);
  if (!isAllowedStoragePrefix(prefix)) return jsonResponse({ error: { message: "Storage prefix is not allowed" } }, 400, request);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 1000);
  const marker = url.searchParams.get("marker") || "";
  const path = `/list?bucket=${encodeURIComponent(cfg.bucket)}&prefix=${encodeURIComponent(prefix)}&limit=${limit}${marker ? `&marker=${encodeURIComponent(marker)}` : ""}`;
  const auth = await qiniuManageAuthorization(cfg, path);
  const res = await fetch(cfg.rsfUrl + path, { headers: { Authorization: auth } });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return jsonResponse({ error: { message: json?.error || "Qiniu list files failed", raw: json } }, res.status || 502, request);
  }
  const items = Array.isArray(json?.items) ? json.items.map((item) => publicFileFromQiniuItem(cfg, item)) : [];
  return jsonResponse({ data: items, marker: json?.marker || "" }, 200, request);
}

async function handleQiniuDeleteFile(request, env, encodedKey) {
  const { cfg, error } = requireQiniuConfig(request, env);
  if (error) return error;
  const key = normalizeStorageKey(decodeURIComponent(encodedKey || ""));
  if (!key) return jsonResponse({ error: { message: "key is required" } }, 400, request);
  if (!assertStorageKeyAllowed(key)) return jsonResponse({ error: { message: "Storage prefix is not allowed" } }, 400, request);
  const entry = encodedEntry(cfg.bucket, key);
  const path = `/delete/${entry}`;
  const auth = await qiniuManageAuthorization(cfg, path);
  const res = await fetch(cfg.rsUrl + path, { method: "POST", headers: { Authorization: auth } });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    return jsonResponse({ error: { message: json?.error || "Qiniu delete failed", raw: json } }, res.status || 502, request);
  }
  return jsonResponse({ ok: true, data: { key } }, 200, request);
}

async function handleQiniuFetchUrl(request, env) {
  const { cfg, error } = requireQiniuConfig(request, env);
  if (error) return error;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: { message: "Invalid JSON body" } }, 400, request);
  }
  let source;
  try {
    source = new URL(String(body.url || ""));
  } catch {
    return jsonResponse({ error: { message: "url is invalid" } }, 400, request);
  }
  if (!["http:", "https:"].includes(source.protocol) || isPrivateHostname(source.hostname)) {
    return jsonResponse({ error: { message: "url must be a public http(s) URL" } }, 400, request);
  }
  const filename = sanitizeFilename(body.filename || decodeURIComponent(source.pathname.split("/").pop() || "remote-file"));
  const mimeType = textValue(body.mimeType || "application/octet-stream", 128);
  const prefix = normalizeStoragePrefix(body.prefix || "uploads/remote/");
  const key = makeStorageKey({ key: body.key, prefix, filename, mimeType });
  if (!assertStorageKeyAllowed(key)) return jsonResponse({ error: { message: "Storage prefix is not allowed" } }, 400, request);
  const entry = encodedEntry(cfg.bucket, key);
  const encodedUrl = base64UrlEncodeText(source.href);
  const path = `/fetch/${encodedUrl}/to/${entry}`;
  const targetUrl = cfg.iovipUrl + path;
  const contentType = "application/x-www-form-urlencoded";
  const auth = await qiniuRequestAuthorization(cfg, "POST", targetUrl, { "Content-Type": contentType });
  const res = await fetch(targetUrl, { method: "POST", headers: { Authorization: auth, "Content-Type": contentType } });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return jsonResponse({ error: { message: json?.error || "Qiniu fetch url failed", raw: json } }, res.status || 502, request);
  }
  const storedFile = {
    provider: "qiniu",
    bucket: cfg.bucket,
    key,
    url: qiniuPublicUrl(cfg, key),
    source_url: source.href,
    hash: json?.hash || "",
    fsize: json?.fsize || 0,
    mimeType: json?.mimeType || mimeType,
    status: "done",
    raw: json,
  };
  const imageInfo = isQiniuImageFile(storedFile) ? await fetchQiniuImageInfo(storedFile.url) : null;
  if (imageInfo) {
    storedFile.imageInfo = imageInfo;
    storedFile.width = imageInfo.width;
    storedFile.height = imageInfo.height;
    storedFile.fsize = imageInfo.size || storedFile.fsize;
    if (imageInfo.format) storedFile.imageFormat = imageInfo.format;
  }
  if (isQiniuVideoFile(storedFile)) {
    storedFile.cover_key = `${storedFile.key}-cover`;
    storedFile.cover_url = qiniuPublicUrl(cfg, storedFile.cover_key);
  } else if (isQiniuImageFile(storedFile)) {
    storedFile.preview_key = `${storedFile.key}-pre`;
    storedFile.preview_url = qiniuPublicUrl(cfg, storedFile.preview_key);
  }
  return jsonResponse(
    {
      data: storedFile,
    },
    200,
    request
  );
}

async function handleQiniuStorageApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/storage/qiniu/upload-token" && request.method === "POST") {
    return handleQiniuUploadToken(request, env);
  }
  if (url.pathname === "/api/storage/qiniu/files" && request.method === "GET") {
    return handleQiniuListFiles(request, env);
  }
  if (url.pathname === "/api/storage/qiniu/fetch-url" && request.method === "POST") {
    return handleQiniuFetchUrl(request, env);
  }
  const match = /^\/api\/storage\/qiniu\/files\/(.+)$/.exec(url.pathname);
  if (match && request.method === "DELETE") return handleQiniuDeleteFile(request, env, match[1]);
  return jsonResponse({ error: { message: "Not found" } }, 404, request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (url.pathname.startsWith("/v1/")) {
      return proxyApi(request, env);
    }
    if (url.pathname === "/api/agnes/generate" && request.method === "POST") {
      return handleAgnesGenerate(request, env);
    }
    if (url.pathname === "/api/agnes/videos" && request.method === "POST") {
      return handleAgnesVideoCreate(request, env);
    }
    if (url.pathname === "/api/agnes/videos/query" && request.method === "POST") {
      return handleAgnesVideoQuery(request, env);
    }
    if (url.pathname === "/api/images" || url.pathname.startsWith("/api/images/")) {
      return handleImagesApi(request, env);
    }
    if (url.pathname === "/api/storage/qiniu" || url.pathname.startsWith("/api/storage/qiniu/")) {
      return handleQiniuStorageApi(request, env);
    }
    if (url.pathname === "/api/jobs" || url.pathname.startsWith("/api/jobs/")) {
      return jsonResponse({ error: { message: "Background jobs are disabled" } }, 404, request);
    }
    return env.ASSETS.fetch(request);
  },
};
