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
  const cors = corsHeaders(request);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
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

async function proxyOpenAI(request, env) {
  const url = new URL(request.url);
  const requestedUpstream =
    request.headers.get("X-Upstream-Base") ||
    env.UPSTREAM_BASE ||
    DEFAULT_UPSTREAM_BASE;
  let upstreamBase;
  try {
    upstreamBase = new URL(requestedUpstream);
  } catch {
    return jsonResponse(
      { error: { message: "X-Upstream-Base is not a valid URL" } },
      400,
      request
    );
  }
  if (!["https:", "http:"].includes(upstreamBase.protocol)) {
    return jsonResponse(
      { error: { message: "X-Upstream-Base must use HTTP(S)" } },
      400,
      request
    );
  }
  const upstreamPath =
    upstreamBase.pathname.replace(/\/$/, "").endsWith("/v1") &&
    url.pathname.startsWith("/v1/")
      ? url.pathname.slice(3)
      : url.pathname;
  const upstreamUrl =
    upstreamBase.href.replace(/\/$/, "") + upstreamPath + url.search;
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
      { error: { message: "OPENAI_API_KEY secret is not configured" } },
      500,
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
      return proxyOpenAI(request, env);
    }
    return jsonResponse(
      { error: { message: "Use Cloudflare Pages for index.html, and this Worker for /v1/*." } },
      404,
      request
    );
  },
};
