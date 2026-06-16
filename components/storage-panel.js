(function () {
  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (!n) return "0 B";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 100 * 1024 ? 1 : 0) + " KB";
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + " MB";
    return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
  }

  function formatTime(putTime) {
    const n = Number(putTime || 0);
    if (!n) return "";
    const ms = n > 10 ** 15 ? Math.floor(n / 10000) : n;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  }

  function joinPrefix(prefix) {
    let value = String(prefix || "uploads/").trim().replace(/\\/g, "/").replace(/^\/+/, "");
    value = value.replace(/\/{2,}/g, "/");
    if (value && !value.endsWith("/")) value += "/";
    return value || "uploads/";
  }

  function fileNameFromKey(key) {
    const value = String(key || "");
    return value.split("/").filter(Boolean).pop() || value || "file";
  }

  function icon(name, size = 18) {
    const common = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
    const paths = {
      upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M20 16.5A4.5 4.5 0 0 1 15.5 21h-7A4.5 4.5 0 0 1 4 16.5"/>',
      link: '<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"/>',
      files: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
      image: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 14 2.5-2.5a2 2 0 0 1 2.8 0L18 16"/><path d="M8 8h.01"/>',
      video: '<path d="m16 13 5.2 3.5V7.5L16 11"/><rect x="3" y="5" width="13" height="14" rx="2"/>',
      file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
      open: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
      copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
      check: '<path d="m20 6-11 11-5-5"/>',
      trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-.8 14H5.8L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>',
      refresh: '<path d="M21 12a9 9 0 0 1-15.6 6.1"/><path d="M3 12A9 9 0 0 1 18.6 5.9"/><path d="M3 18h5v-5"/><path d="M21 6h-5v5"/>',
      close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
      alert: '<path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
      spark: '<path d="M13 2 3 14h8l-1 8 10-12h-8l1-8Z"/>',
      clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    };
    return `<svg ${common}>${paths[name] || paths.file}</svg>`;
  }

  const StorageApi = {
    async uploadToken({ file, prefix, key }) {
      const res = await fetch("/api/storage/qiniu/upload-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file?.name || "file",
          mimeType: file?.type || "application/octet-stream",
          size: file?.size || 0,
          prefix,
          key,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message || "上传凭证获取失败");
      return json.data;
    },
    uploadFileToQiniu({ file, token, key, uploadUrl, onProgress }) {
      return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append("token", token);
        form.append("key", key);
        form.append("file", file);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", uploadUrl);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
        };
        xhr.onload = () => {
          let json = null;
          try { json = JSON.parse(xhr.responseText || "{}"); } catch (_) {}
          if (xhr.status >= 200 && xhr.status < 300) resolve(json || {});
          else reject(new Error(json?.error || "七牛上传失败"));
        };
        xhr.onerror = () => reject(new Error("七牛上传网络错误"));
        xhr.send(form);
      });
    },
    async listFiles({ prefix, marker, limit = 50 } = {}) {
      const params = new URLSearchParams({ prefix: joinPrefix(prefix), limit: String(limit) });
      if (marker) params.set("marker", marker);
      const res = await fetch("/api/storage/qiniu/files?" + params.toString(), { headers: { Accept: "application/json" } });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message || "文件列表读取失败");
      return json;
    },
    async fetchUrl({ url, prefix, filename, key }) {
      const res = await fetch("/api/storage/qiniu/fetch-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, prefix, filename, key }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message || "URL 抓取失败");
      return json.data;
    },
    async deleteFile(key) {
      const res = await fetch("/api/storage/qiniu/files/" + encodeURIComponent(key), { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message || "删除失败");
      return json;
    },
  };

  function createStoragePanel(root, options = {}) {
    const state = {
      prefix: joinPrefix(options.prefix || "uploads/"),
      marker: "",
      files: [],
      activeTab: "upload",
      uploading: false,
      uploadProgress: 0,
      selectedFile: null,
      selectedKey: "",
      listLoading: false,
      remoteBusy: false,
      remoteState: "idle",
    };

    root.innerHTML = `
      <div class="storage-backdrop" data-storage-backdrop>
        <aside class="storage-panel" role="dialog" aria-modal="true" aria-label="云存储">
          <header class="storage-head">
            <div class="storage-title-wrap">
              <div class="storage-kicker">${icon("spark", 14)} 公共组件</div>
              <h2 class="storage-title">云存储</h2>
              <p class="storage-subtitle">上传、URL 抓取和七牛文件管理</p>
            </div>
            <button class="storage-close" type="button" data-close title="关闭" aria-label="关闭">${icon("close", 18)}</button>
          </header>
          <nav class="storage-tabs" aria-label="云存储视图">
            <button class="storage-tab active" type="button" data-tab="upload">${icon("upload", 15)} 上传</button>
            <button class="storage-tab" type="button" data-tab="remote">${icon("link", 15)} URL 抓取</button>
            <button class="storage-tab" type="button" data-tab="files">${icon("files", 15)} 文件列表</button>
          </nav>
          <div class="storage-body">
            <section class="storage-view active" data-view="upload">
              <div class="storage-section-title">
                <h3>本地文件上传</h3>
                <p>图片会优先展示 -pre 缩略图，视频会优先展示 -cover 封面。</p>
              </div>
              <div class="storage-dropzone" data-dropzone>
                <div class="storage-drop-icon">${icon("upload", 25)}</div>
                <div>
                  <p class="storage-drop-title">拖放文件到这里，或点击选择</p>
                  <p class="storage-drop-sub">支持图片、视频、文档和其他文件</p>
                </div>
                <input class="storage-file" data-file type="file" accept="${escapeHtml(options.accept || "*/*")}">
              </div>
              <div class="storage-row">
                <div class="storage-field">
                  <label>保存目录</label>
                  <input class="storage-input" data-prefix value="${escapeHtml(state.prefix)}" spellcheck="false">
                </div>
                <button class="storage-btn primary" type="button" data-upload>${icon("upload", 16)} 上传文件</button>
              </div>
              <div class="storage-task" data-task>
                <div class="storage-task-top">
                  <div class="storage-file-icon" data-task-icon>${icon("file", 19)}</div>
                  <div class="storage-task-copy">
                    <div class="storage-task-name" data-task-name>未选择文件</div>
                    <div class="storage-task-meta" data-task-meta></div>
                  </div>
                  <button class="storage-btn icon" type="button" data-clear-file title="清除文件" aria-label="清除文件">${icon("close", 17)}</button>
                </div>
                <div class="storage-progress"><span data-progress></span></div>
                <div class="storage-task-foot">
                  <span data-upload-label>等待上传</span>
                  <strong data-upload-percent>0%</strong>
                </div>
              </div>
              <div class="storage-status" data-status></div>
            </section>

            <section class="storage-view" data-view="remote">
              <div class="storage-section-title">
                <h3>URL 抓取上传</h3>
                <p>服务端提交给七牛抓取，适合远程图片、视频和下载链接。</p>
              </div>
              <div class="storage-field">
                <label>远程 URL</label>
                <input class="storage-input" data-remote-url placeholder="https://example.com/file.mp4" spellcheck="false">
              </div>
              <div class="storage-grid-2">
                <div class="storage-field">
                  <label>保存目录</label>
                  <input class="storage-input" data-remote-prefix value="uploads/remote/" spellcheck="false">
                </div>
                <div class="storage-field">
                  <label>文件名，可选</label>
                  <input class="storage-input" data-remote-filename placeholder="file.mp4" spellcheck="false">
                </div>
              </div>
              <button class="storage-btn primary wide" type="button" data-fetch-url>${icon("link", 16)} 抓取到七牛</button>
              <div class="storage-flow" data-remote-flow></div>
              <div class="storage-status" data-remote-status></div>
            </section>

            <section class="storage-view" data-view="files">
              <div class="storage-section-title">
                <h3>文件列表</h3>
                <p>派生资源 -pre 和 -cover 会隐藏，只作为缩略图使用。</p>
              </div>
              <div class="storage-row">
                <div class="storage-field">
                  <label>列表目录</label>
                  <input class="storage-input" data-list-prefix value="${escapeHtml(state.prefix)}" spellcheck="false">
                </div>
                <button class="storage-btn" type="button" data-refresh-list>${icon("refresh", 16)} 刷新</button>
              </div>
              <div class="storage-list-head">
                <span class="storage-list-title">文件</span>
                <span class="storage-item-meta" data-list-count>0 项</span>
              </div>
              <div class="storage-list" data-list><div class="storage-empty">暂无文件</div></div>
              <button class="storage-btn wide" type="button" data-load-more hidden>加载更多</button>
            </section>
          </div>
        </aside>
      </div>
    `;

    const $ = (selector) => root.querySelector(selector);
    const backdrop = $("[data-storage-backdrop]");
    const status = $("[data-status]");
    const remoteStatus = $("[data-remote-status]");
    const remoteFlow = $("[data-remote-flow]");
    const progress = $("[data-progress]");
    const uploadLabel = $("[data-upload-label]");
    const uploadPercent = $("[data-upload-percent]");
    const list = $("[data-list]");
    const loadMore = $("[data-load-more]");
    const dropzone = $("[data-dropzone]");
    const fileInput = $("[data-file]");
    const task = $("[data-task]");
    const taskIcon = $("[data-task-icon]");
    const taskName = $("[data-task-name]");
    const taskMeta = $("[data-task-meta]");
    const listCount = $("[data-list-count]");

    function setStatus(node, message, type) {
      node.textContent = message || "";
      node.className = "storage-status " + (type || "");
      node.hidden = !message;
    }

    function setButtonBusy(button, busy, busyText) {
      if (!button) return;
      button.disabled = Boolean(busy);
      if (busy && busyText) {
        button.dataset.idleHtml = button.dataset.idleHtml || button.innerHTML;
        button.innerHTML = `<span class="storage-spin"></span>${escapeHtml(busyText)}`;
      } else if (!busy && button.dataset.idleHtml) {
        button.innerHTML = button.dataset.idleHtml;
      }
    }

    function setTab(tab) {
      state.activeTab = tab;
      for (const node of root.querySelectorAll("[data-tab]")) node.classList.toggle("active", node.dataset.tab === tab);
      for (const node of root.querySelectorAll("[data-view]")) node.classList.toggle("active", node.dataset.view === tab);
      if (tab === "files" && !state.files.length && !state.listLoading) {
        loadFiles({ reset: true }).catch((err) => setStatus(status, err.message, "error"));
      }
    }

    function fileIconSvg(file) {
      if (isImageFile(file)) return icon("image");
      if (isVideoFile(file)) return icon("video");
      return icon("file");
    }

    function isCoverFile(file) {
      return String(file?.key || "").endsWith("-cover");
    }

    function isPreviewFile(file) {
      return String(file?.key || "").endsWith("-pre");
    }

    function isDerivedFile(file) {
      return isCoverFile(file) || isPreviewFile(file);
    }

    function isVideoFile(file) {
      const type = String(file?.mimeType || file?.type || "").toLowerCase();
      const key = String(file?.key || file?.name || "").toLowerCase();
      return type.startsWith("video/") || /\.(mp4|webm|mov|m4v|avi|mkv)$/.test(key);
    }

    function isImageFile(file) {
      const type = String(file?.mimeType || file?.type || "").toLowerCase();
      const key = String(file?.key || file?.name || "").toLowerCase();
      return type.startsWith("image/") || /\.(jpg|jpeg|png|webp|gif|avif)$/.test(key);
    }

    function videoCoverKey(file) {
      return file?.cover_key || file?.coverKey || (isVideoFile(file) ? String(file.key || "") + "-cover" : "");
    }

    function videoCoverUrl(file) {
      return file?.cover_url || file?.coverUrl || (isVideoFile(file) && file.url ? String(file.url) + "-cover" : "");
    }

    function imagePreviewKey(file) {
      return file?.preview_key || file?.previewKey || (isImageFile(file) ? String(file.key || "") + "-pre" : "");
    }

    function imagePreviewUrl(file) {
      return file?.preview_url || file?.previewUrl || (isImageFile(file) && file.url ? String(file.url) + "-pre" : "");
    }

    function enrichDerivedFields(file) {
      if (!file) return file;
      if (isVideoFile(file)) {
        file.cover_key = videoCoverKey(file);
        file.cover_url = videoCoverUrl(file);
      } else if (isImageFile(file) && !isPreviewFile(file) && !isCoverFile(file)) {
        file.preview_key = imagePreviewKey(file);
        file.preview_url = imagePreviewUrl(file);
      }
      return file;
    }

    function filePreviewHtml(file) {
      const iconHtml = fileIconSvg(file);
      const coverUrl = videoCoverUrl(file);
      if (coverUrl) {
        return `<div class="storage-item-thumb video">${iconHtml}<span class="storage-thumb-skeleton"></span><img src="${escapeHtml(coverUrl)}" alt="" loading="lazy" onload="this.parentElement.classList.add('has-image')" onerror="this.parentElement.classList.add('is-missing');this.remove()"><span class="storage-thumb-badge">封面</span></div>`;
      }
      const previewUrl = imagePreviewUrl(file);
      if (previewUrl) {
        return `<div class="storage-item-thumb image">${iconHtml}<span class="storage-thumb-skeleton"></span><img src="${escapeHtml(previewUrl)}" alt="" loading="lazy" onload="this.parentElement.classList.add('has-image')" onerror="this.parentElement.classList.add('is-missing');this.remove()"><span class="storage-thumb-badge">预览</span></div>`;
      }
      return `<div class="storage-item-icon">${iconHtml}</div>`;
    }

    function visibleFiles() {
      return state.files.filter((file) => !isDerivedFile(file));
    }

    function renderListSkeleton() {
      list.innerHTML = Array.from({ length: 5 }, () => `
        <article class="storage-item skeleton">
          <div class="storage-skeleton thumb"></div>
          <div class="storage-skeleton-lines">
            <span></span>
            <small></small>
            <em></em>
          </div>
          <div class="storage-skeleton-actions"><i></i><i></i><i></i><i></i></div>
        </article>
      `).join("");
    }

    function renderEmpty() {
      list.innerHTML = `
        <div class="storage-empty">
          <div class="storage-empty-icon">${icon("files", 24)}</div>
          <strong>暂无文件</strong>
          <span>切换到上传或 URL 抓取，保存第一个文件。</span>
        </div>
      `;
    }

    function renderFiles() {
      const files = visibleFiles();
      if (state.listLoading && !files.length) {
        renderListSkeleton();
      } else if (!files.length) {
        renderEmpty();
      } else {
        list.innerHTML = files.map((file) => {
          const selected = state.selectedKey === file.key;
          const meta = [file.mimeType || "unknown", formatBytes(file.fsize), formatTime(file.putTime)].filter(Boolean).join(" · ");
          return `
            <article class="storage-item ${selected ? "selected" : ""}" data-key="${escapeHtml(file.key)}">
              ${filePreviewHtml(file)}
              <div class="storage-item-main">
                <div class="storage-item-name" title="${escapeHtml(file.key)}">${escapeHtml(fileNameFromKey(file.key))}</div>
                <div class="storage-item-path" title="${escapeHtml(file.key)}">${escapeHtml(file.key)}</div>
                <div class="storage-item-meta">${escapeHtml(meta)}</div>
              </div>
              <div class="storage-item-actions">
                <a class="storage-btn icon" href="${escapeHtml(file.url)}" target="_blank" rel="noopener noreferrer" title="打开" aria-label="打开">${icon("open", 17)}</a>
                <button class="storage-btn icon" type="button" data-copy="${escapeHtml(file.url)}" title="复制链接" aria-label="复制链接">${icon("copy", 17)}</button>
                <button class="storage-btn icon ${selected ? "selected" : ""}" type="button" data-select="${escapeHtml(file.key)}" title="选择" aria-label="选择">${icon("check", 17)}</button>
                <button class="storage-btn icon danger" type="button" data-delete="${escapeHtml(file.key)}" title="删除" aria-label="删除">${icon("trash", 17)}</button>
              </div>
            </article>
          `;
        }).join("");
      }
      if (listCount) listCount.textContent = `${files.length} 项${state.marker ? " · 还有更多" : ""}`;
      loadMore.hidden = !state.marker;
    }

    function renderRemoteFlow() {
      const steps = [
        ["queued", "提交"],
        ["fetching", "抓取"],
        ["done", "完成"],
      ];
      const indexMap = { idle: -1, queued: 0, fetching: 1, done: 2, error: 1 };
      const active = indexMap[state.remoteState] ?? -1;
      remoteFlow.innerHTML = `
        <div class="storage-flow-line">
          ${steps.map(([key, label], index) => `<span class="${index <= active ? "active" : ""} ${state.remoteState === "error" && index === active ? "error" : ""}">${index < active ? icon("check", 13) : index === active && state.remoteBusy ? '<i class="storage-spin"></i>' : icon(index === 2 ? "check" : "clock", 13)} ${label}</span>`).join("")}
        </div>
      `;
    }

    function updateUploadProgress(ratio, label) {
      state.uploadProgress = Math.max(0, Math.min(100, Math.round(ratio * 100)));
      progress.style.width = state.uploadProgress + "%";
      uploadPercent.textContent = state.uploadProgress + "%";
      uploadLabel.textContent = label || (state.uploading ? "正在上传..." : "等待上传");
    }

    function setSelectedFile(file) {
      state.selectedFile = file || null;
      if (!state.selectedFile) {
        task.classList.remove("visible");
        taskName.textContent = "未选择文件";
        taskMeta.textContent = "";
        taskIcon.innerHTML = icon("file", 19);
        updateUploadProgress(0, "等待上传");
        fileInput.value = "";
        return;
      }
      task.classList.add("visible");
      taskName.textContent = state.selectedFile.name || "未命名文件";
      taskMeta.textContent = [formatBytes(state.selectedFile.size), state.selectedFile.type || "unknown"].filter(Boolean).join(" · ");
      taskIcon.innerHTML = fileIconSvg(state.selectedFile);
      updateUploadProgress(0, "等待上传");
      setStatus(status, "", "");
    }

    async function loadFiles({ reset = false } = {}) {
      if (reset) {
        state.marker = "";
        state.files = [];
      }
      state.listLoading = true;
      renderFiles();
      try {
        const prefix = joinPrefix($("[data-list-prefix]").value || state.prefix);
        const json = await StorageApi.listFiles({ prefix, marker: state.marker });
        const incoming = Array.isArray(json.data) ? json.data.map(enrichDerivedFields) : [];
        const seen = new Set(state.files.map((file) => file.key));
        state.files.push(...incoming.filter((file) => !seen.has(file.key)));
        state.marker = json.marker || "";
      } finally {
        state.listLoading = false;
        renderFiles();
      }
    }

    async function uploadSelectedFile() {
      const file = state.selectedFile || (fileInput.files && fileInput.files[0]);
      if (!file) return setStatus(status, "请选择文件", "error");
      const button = $("[data-upload]");
      state.uploading = true;
      task.classList.add("visible");
      updateUploadProgress(0, "获取上传凭证...");
      setButtonBusy(button, true, "上传中");
      setStatus(status, "", "");
      try {
        const prefix = joinPrefix($("[data-prefix]").value || state.prefix);
        const tokenData = await StorageApi.uploadToken({ file, prefix });
        updateUploadProgress(0.08, "正在上传...");
        const result = await StorageApi.uploadFileToQiniu({
          file,
          token: tokenData.token,
          key: tokenData.key,
          uploadUrl: tokenData.uploadUrl,
          onProgress: (ratio) => updateUploadProgress(ratio, "正在上传..."),
        });
        const uploaded = enrichDerivedFields({
          key: result.key || tokenData.key,
          hash: result.hash || "",
          fsize: Number(result.fsize || file.size || 0),
          mimeType: result.mimeType || file.type || "",
          url: tokenData.publicUrl,
          putTime: Date.now() * 10000,
        });
        updateUploadProgress(1, "上传完成");
        setStatus(status, "上传完成: " + uploaded.url, "ok");
        if (options.onUploaded) options.onUploaded(uploaded);
        state.files = [uploaded, ...state.files.filter((item) => item.key !== uploaded.key)];
        state.selectedKey = uploaded.key;
        renderFiles();
        setSelectedFile(null);
      } catch (err) {
        setStatus(status, err.message || String(err), "error");
        updateUploadProgress(0, "上传失败");
      } finally {
        state.uploading = false;
        setButtonBusy(button, false);
      }
    }

    async function fetchRemoteUrl() {
      const remoteUrl = $("[data-remote-url]").value.trim();
      if (!remoteUrl) return setStatus(remoteStatus, "请填写远程 URL", "error");
      const button = $("[data-fetch-url]");
      state.remoteBusy = true;
      state.remoteState = "queued";
      renderRemoteFlow();
      setButtonBusy(button, true, "抓取中");
      setStatus(remoteStatus, "正在提交抓取任务...", "");
      try {
        state.remoteState = "fetching";
        renderRemoteFlow();
        const data = enrichDerivedFields(await StorageApi.fetchUrl({
          url: remoteUrl,
          prefix: joinPrefix($("[data-remote-prefix]").value || "uploads/remote/"),
          filename: $("[data-remote-filename]").value.trim(),
        }));
        state.remoteState = "done";
        state.selectedKey = data.key;
        renderRemoteFlow();
        setStatus(remoteStatus, "抓取完成: " + data.url, "ok");
        if (options.onUploaded) options.onUploaded(data);
        state.files = [data, ...state.files.filter((item) => item.key !== data.key)];
        renderFiles();
      } catch (err) {
        state.remoteState = "error";
        renderRemoteFlow();
        setStatus(remoteStatus, err.message || String(err), "error");
      } finally {
        state.remoteBusy = false;
        setButtonBusy(button, false);
      }
    }

    root.addEventListener("click", async (event) => {
      const target = event.target.closest("button, a");
      if (!target) return;
      if (target.matches("[data-close]")) close();
      if (target.matches("[data-tab]")) setTab(target.dataset.tab);
      if (target.matches("[data-upload]")) uploadSelectedFile();
      if (target.matches("[data-clear-file]")) setSelectedFile(null);
      if (target.matches("[data-fetch-url]")) fetchRemoteUrl();
      if (target.matches("[data-refresh-list]")) loadFiles({ reset: true }).catch((err) => setStatus(status, err.message, "error"));
      if (target.matches("[data-load-more]")) loadFiles().catch((err) => setStatus(status, err.message, "error"));
      if (target.matches("[data-copy]")) {
        await navigator.clipboard.writeText(target.dataset.copy || "");
        setStatus(status, "链接已复制", "ok");
      }
      if (target.matches("[data-select]")) {
        const file = state.files.find((item) => item.key === target.dataset.select);
        if (file && options.onSelected) options.onSelected(file);
        if (file) {
          state.selectedKey = file.key;
          renderFiles();
          setStatus(status, "已选择: " + file.url, "ok");
        }
      }
      if (target.matches("[data-delete]")) {
        const key = target.dataset.delete;
        if (!window.confirm("确定删除这个文件吗？")) return;
        try {
          const file = state.files.find((item) => item.key === key);
          const coverKey = file ? videoCoverKey(file) : "";
          const previewKey = file ? imagePreviewKey(file) : "";
          await StorageApi.deleteFile(key);
          if (coverKey) {
            try { await StorageApi.deleteFile(coverKey); } catch (_) {}
          }
          if (previewKey) {
            try { await StorageApi.deleteFile(previewKey); } catch (_) {}
          }
          state.files = state.files.filter((item) => item.key !== key && item.key !== coverKey && item.key !== previewKey);
          if (state.selectedKey === key) state.selectedKey = "";
          renderFiles();
          setStatus(status, "已删除", "ok");
          if (options.onDeleted) options.onDeleted({ key });
        } catch (err) {
          setStatus(status, err.message || String(err), "error");
        }
      }
    });

    dropzone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => setSelectedFile(fileInput.files && fileInput.files[0]));
    for (const eventName of ["dragenter", "dragover"]) {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.add("dragging");
      });
    }
    for (const eventName of ["dragleave", "drop"]) {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.remove("dragging");
      });
    }
    dropzone.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (file) setSelectedFile(file);
    });
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close();
    });

    function open() {
      backdrop.classList.add("open");
      renderRemoteFlow();
    }

    function close() {
      backdrop.classList.remove("open");
    }

    renderRemoteFlow();
    setStatus(status, "", "");
    setStatus(remoteStatus, "", "");

    return { open, close, loadFiles, api: StorageApi };
  }

  window.StorageApi = StorageApi;
  window.mountStoragePanel = createStoragePanel;
})();
