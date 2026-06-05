# Cloudflare 部署

## 1. 部署 Cloudflare Pages

```sh
cd image-gen-web
npx wrangler login
npx wrangler pages deploy . --project-name gpt-image-playground --commit-dirty=true
```

页面会部署到 Pages 地址，例如：

```text
https://gpt-image-playground-axd.pages.dev
```

页面里的上游 Base URL 填实际服务商地址：

```text
https://api.openai.com/v1
```

用户需要在页面里填写自己的 API Key。Pages 同域 `/v1/*` 代理会转发浏览器传来的 Authorization，并通过 `X-Upstream-Base` 转发到用户填写的上游 Base URL。

## 2. 注意限制

- 本地图片会以 base64 data URL 放进请求体，受 Cloudflare 请求体大小限制。
- 在线图片链接请求体更小，更适合部署环境。
- 参考图片合计最多 16 张；本地图片支持 PNG、JPEG、WebP，单张小于 50MB。
