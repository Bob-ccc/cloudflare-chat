const DEFAULT_UPSTREAM_BASE = "https://api.openai.com";

function corsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

async function proxyApi(request, env) {
  let upstreamUrl;
  try {
    upstreamUrl = upstreamUrlFor(request, env);
  } catch (err) {
    return jsonResponse({ error: { message: err.message } }, 400, request);
  }

  const headers = new Headers();
  const contentType = request.headers.get("Content-Type");
  const browserAuth = request.headers.get("Authorization");
  if (contentType) headers.set("Content-Type", contentType);
  if (env.OPENAI_API_KEY) {
    headers.set("Authorization", "Bearer " + env.OPENAI_API_KEY);
  } else if (browserAuth) {
    headers.set("Authorization", browserAuth);
  } else {
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS" && url.pathname.startsWith("/v1/")) {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (url.pathname.startsWith("/v1/")) {
      return proxyApi(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
