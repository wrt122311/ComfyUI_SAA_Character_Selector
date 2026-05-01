import { app } from "../../scripts/app.js";

const NODE_NAME = "SAACharacterSelector";

function byName(node, name) {
  return node.widgets?.find((w) => w.name === name);
}

async function apiGet(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

async function apiPost(url) {
  const resp = await fetch(url, { method: "POST" });
  if (!resp.ok) {
    throw new Error(`${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

function setSelected(node, item) {
  const widget = byName(node, "selected_character_id");
  if (!widget) return;
  widget.value = item?.id || "";
  node.setDirtyCanvas(true, true);
}

function resolveGroupFromWidget(widget, rawValue = undefined) {
  const value = rawValue === undefined ? widget?.value : rawValue;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const values = widget?.options?.values;
    if (Array.isArray(values) && values[value] != null) return String(values[value]);
    return "All";
  }
  if (Array.isArray(value) && value.length > 0) {
    const tail = value[value.length - 1];
    if (typeof tail === "string") return tail;
    if (typeof tail === "number") {
      const values = widget?.options?.values;
      if (Array.isArray(values) && values[tail] != null) return String(values[tail]);
    }
  }
  if (value && typeof value === "object") {
    if (typeof value.content === "string") return value.content;
    if (typeof value.value === "string") return value.value;
  }
  if (value == null) return "All";
  return String(value);
}

function renderCards(node, container, items) {
  container.innerHTML = "";
  const selectedId = byName(node, "selected_character_id")?.value || "";

  for (const item of items) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "saa-card";
    if (selectedId === item.id) card.classList.add("active");

    const img = document.createElement("img");
    img.className = "saa-thumb";
    img.alt = `${item.name_en}`;
    img.loading = "lazy";
    const safeThumbUrl = `/saa_selector/thumb/${encodeURIComponent(item.id || "")}`;
    img.src = safeThumbUrl;

    const title = document.createElement("div");
    title.className = "saa-title";
    title.textContent = item.name_zh || item.name_en;

    const sub = document.createElement("div");
    sub.className = "saa-sub";
    sub.textContent = `${item.name_en} | ${item.origin}`;

    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(sub);

    card.addEventListener("click", () => {
      setSelected(node, item);
      for (const el of container.querySelectorAll(".saa-card")) {
        el.classList.remove("active");
      }
      card.classList.add("active");
    });

    container.appendChild(card);
  }
}

function ensureStyle() {
  if (document.getElementById("saa-selector-style")) return;
  const style = document.createElement("style");
  style.id = "saa-selector-style";
  style.textContent = `
    .saa-wrap { display:flex; flex-direction:column; gap:8px; }
    .saa-top { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
    .saa-top input, .saa-top select, .saa-top button { font-size:12px; padding:4px 6px; }
    .saa-progress-row { display:flex; align-items:center; gap:8px; }
    .saa-progress { width:100%; height:10px; }
    .saa-input-wrap { display:flex; gap:4px; align-items:center; min-width:0; }
    .saa-input-wrap input { flex:1; min-width:0; }
    .saa-clear-btn { font-size:12px; padding:3px 6px; line-height:1; }
    .saa-grid-row { display:flex; gap:8px; align-items:stretch; }
    .saa-grid { flex:1; display:grid; grid-template-columns:repeat(var(--saa-cols, 2), minmax(0, 1fr)); gap:6px; max-height:320px; overflow:auto; padding-right:4px; }
    .saa-scroll-progress { writing-mode: vertical-lr; -webkit-appearance: slider-vertical; width:18px; min-height:320px; transform: rotate(180deg); }
    .saa-card { display:flex; flex-direction:column; gap:4px; border:1px solid #555; background:#1f1f1f; color:#eee; padding:6px; text-align:left; cursor:pointer; border-radius:6px; }
    .saa-card.active { border-color:#58a6ff; box-shadow:0 0 0 1px #58a6ff inset; }
    .saa-thumb { width:100%; aspect-ratio:2/3; object-fit:cover; background:#111; border-radius:4px; }
    .saa-title { font-size:12px; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .saa-sub { font-size:10px; color:#b8b8b8; line-height:1.2; max-height:2.4em; overflow:hidden; }
    .saa-status { font-size:11px; color:#cfcfcf; min-height:1.2em; }
  `;
  document.head.appendChild(style);
}

function attachUI(node) {
  if (node.__saaMounted) return;
  node.__saaMounted = true;
  ensureStyle();

  const wrap = document.createElement("div");
  wrap.className = "saa-wrap";

  const top = document.createElement("div");
  top.className = "saa-top";

  const searchWrap = document.createElement("div");
  searchWrap.className = "saa-input-wrap";

  const search = document.createElement("input");
  search.type = "text";
  search.placeholder = "Search name/origin";
  const searchClearBtn = document.createElement("button");
  searchClearBtn.type = "button";
  searchClearBtn.className = "saa-clear-btn";
  searchClearBtn.textContent = "x";
  searchWrap.appendChild(search);
  searchWrap.appendChild(searchClearBtn);

  const groupSearchWrap = document.createElement("div");
  groupSearchWrap.className = "saa-input-wrap";
  const groupSearch = document.createElement("input");
  groupSearch.type = "text";
  groupSearch.placeholder = "Search group";
  const groupSearchClearBtn = document.createElement("button");
  groupSearchClearBtn.type = "button";
  groupSearchClearBtn.className = "saa-clear-btn";
  groupSearchClearBtn.textContent = "x";
  groupSearchWrap.appendChild(groupSearch);
  groupSearchWrap.appendChild(groupSearchClearBtn);

  const group = document.createElement("select");
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.textContent = "Reload";

  top.appendChild(searchWrap);
  top.appendChild(groupSearchWrap);
  top.appendChild(group);
  top.appendChild(refreshBtn);

  const progressRow = document.createElement("div");
  progressRow.className = "saa-progress-row";
  const progress = document.createElement("progress");
  progress.className = "saa-progress";
  progress.max = 100;
  progress.value = 0;
  const pLabel = document.createElement("span");
  pLabel.textContent = "0%";
  progressRow.appendChild(progress);
  progressRow.appendChild(pLabel);

  const status = document.createElement("div");
  status.className = "saa-status";
  status.textContent = "Preparing...";

  const scrollProgress = document.createElement("input");
  scrollProgress.type = "range";
  scrollProgress.className = "saa-scroll-progress";
  scrollProgress.min = "0";
  scrollProgress.max = "100";
  scrollProgress.value = "0";
  scrollProgress.orient = "vertical";

  const grid = document.createElement("div");
  grid.className = "saa-grid";
  const gridRow = document.createElement("div");
  gridRow.className = "saa-grid-row";
  gridRow.appendChild(grid);
  gridRow.appendChild(scrollProgress);

  wrap.appendChild(top);
  wrap.appendChild(progressRow);
  wrap.appendChild(status);
  wrap.appendChild(gridRow);

  node.addDOMWidget("saa_selector", "saa_selector", wrap, {
    getMinHeight: () => 390,
    getMaxHeight: () => 600,
    getHeight: () => 430,
  });

  let searchTimer = null;
  let isDraggingProgress = false;
  let lastIsLoading = null;
  let hasHydratedAfterReady = false;
  let lastSyncedGroupValue = "";
  let suppressWidgetCallback = false;

  function updateResponsiveColumns() {
    const width = Math.max(320, wrap.clientWidth || 320);
    // Card minimum width target ~170px, with gap and margins accounted for.
    const cols = Math.max(1, Math.floor((width - 16) / 176));
    grid.style.setProperty("--saa-cols", String(cols));
  }

  function updateScrollProgressFromGrid() {
    const maxScroll = Math.max(0, grid.scrollHeight - grid.clientHeight);
    if (maxScroll <= 0) {
      scrollProgress.value = "0";
      scrollProgress.disabled = true;
      return;
    }
    scrollProgress.disabled = false;
    if (isDraggingProgress) return;
    const ratio = 100 - (grid.scrollTop / maxScroll) * 100;
    scrollProgress.value = String(Math.max(0, Math.min(100, ratio)));
  }

  function renderGroupOptions(allGroups, filterText = "") {
    const current = group.value || "All";
    group.innerHTML = "";
    const q = (filterText || "").trim().toLowerCase();
    const filtered = (allGroups || []).filter((g) => {
      const name = typeof g === "string" ? g : g.name;
      if (!q) return true;
      return name.toLowerCase().includes(q);
    });
    const list = filtered.length > 0 ? filtered : allGroups;
    for (const g of list || []) {
      const groupName = typeof g === "string" ? g : g.name;
      const count = typeof g === "string" ? null : g.count;
      const opt = document.createElement("option");
      opt.value = groupName;
      opt.textContent = count === null ? groupName : `${groupName} (${count})`;
      group.appendChild(opt);
    }
    node.__saaGroupNames = (allGroups || []).map((g) => (typeof g === "string" ? g : g.name));
    if (node.__saaGroupNames.includes(current)) {
      group.value = current;
    }
  }

  function syncSourceWidgetOptions(sourceWidget) {
    if (!sourceWidget || !Array.isArray(node.__saaGroupNames) || node.__saaGroupNames.length === 0) {
      return;
    }

    const current = resolveGroupFromWidget(sourceWidget);
    if (!sourceWidget.options || typeof sourceWidget.options !== "object") {
      sourceWidget.options = {};
    }
    sourceWidget.options.values = [...node.__saaGroupNames];

    const next = node.__saaGroupNames.includes(current) ? current : "All";
    const idx = sourceWidget.options.values.indexOf(next);
    sourceWidget.value = idx >= 0 ? next : "All";
  }

  async function loadGroups() {
    const data = await apiGet("/saa_selector/groups");
    const allGroups = data.groups || [];
    node.__saaGroupsRaw = allGroups;
    renderGroupOptions(allGroups, groupSearch.value);

    const sourceWidget = byName(node, "source_group");
    if (sourceWidget) {
      syncSourceWidgetOptions(sourceWidget);
      const current = resolveGroupFromWidget(sourceWidget);
      group.value = node.__saaGroupNames.includes(current) ? current : "All";
    }
  }

  async function loadCharacters() {
    const q = encodeURIComponent(search.value || "");
    const g = encodeURIComponent(group.value || "All");
    const data = await apiGet(`/saa_selector/characters?search=${q}&group=${g}&limit=200`);
    renderCards(node, grid, data.items || []);
    updateResponsiveColumns();
    updateScrollProgressFromGrid();
    status.textContent = `Loaded ${data.items?.length || 0} items`;
  }

  async function syncFromSourceWidget(force = false) {
    const sourceWidget = byName(node, "source_group");
    if (!sourceWidget) return;
    const widgetGroup = resolveGroupFromWidget(sourceWidget);
    const allowed = node.__saaGroupNames || [];
    const nextGroup = allowed.includes(widgetGroup) ? widgetGroup : "All";
    if (group.value !== nextGroup) {
      group.value = nextGroup;
    }
    if (force || nextGroup !== lastSyncedGroupValue) {
      lastSyncedGroupValue = nextGroup;
      await loadCharacters();
    }
  }

  async function refreshStatus() {
    try {
      const s = await apiGet("/saa_selector/status");
      progress.value = Number(s.progress || 0);
      pLabel.textContent = `${Math.round(Number(s.progress || 0))}%`;
      const isLoading = Boolean(s.is_loading);
      progressRow.style.display = isLoading ? "flex" : "none";
      const becameReady = lastIsLoading === true && isLoading === false;
      lastIsLoading = isLoading;
      if (s.error) {
        status.textContent = `Error: ${s.error}`;
        progressRow.style.display = "flex";
        hasHydratedAfterReady = false;
      } else {
        if (isLoading) {
          status.textContent = s.status || "loading";
          hasHydratedAfterReady = false;
        }
      }
      if (!s.is_loading && (s.progress || 0) >= 100 && (!hasHydratedAfterReady || becameReady)) {
        await loadGroups();
        await loadCharacters();
        hasHydratedAfterReady = true;
      }
      await syncFromSourceWidget(false);
    } catch (err) {
      status.textContent = `Status failed: ${String(err)}`;
    }
  }

  refreshBtn.addEventListener("click", async () => {
    status.textContent = "Reloading...";
    progressRow.style.display = "flex";
    progress.value = 0;
    pLabel.textContent = "0%";
    hasHydratedAfterReady = false;
    lastIsLoading = true;
    await apiPost("/saa_selector/reload");
    refreshStatus();
  });

  search.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      loadCharacters().catch((err) => {
        status.textContent = `Search failed: ${String(err)}`;
      });
    }, 250);
  });
  searchClearBtn.addEventListener("click", () => {
    search.value = "";
    loadCharacters().catch((err) => {
      status.textContent = `Search failed: ${String(err)}`;
    });
  });

  groupSearch.addEventListener("input", () => {
    renderGroupOptions(node.__saaGroupsRaw || [], groupSearch.value);
  });
  groupSearchClearBtn.addEventListener("click", () => {
    groupSearch.value = "";
    renderGroupOptions(node.__saaGroupsRaw || [], "");
    group.value = "All";
    const sourceWidget = byName(node, "source_group");
    if (sourceWidget) {
      sourceWidget.value = "All";
      node.setDirtyCanvas(true, true);
    }
    loadCharacters().catch((err) => {
      status.textContent = `Filter failed: ${String(err)}`;
    });
  });

  group.addEventListener("change", () => {
    const sourceWidget = byName(node, "source_group");
    if (sourceWidget) {
      const allowed = Array.isArray(node.__saaGroupNames) ? node.__saaGroupNames : ["All"];
      const picked = allowed.includes(group.value) ? group.value : "All";
      syncSourceWidgetOptions(sourceWidget);
      const values = sourceWidget.options?.values;
      suppressWidgetCallback = true;
      if (Array.isArray(values)) {
        const idx = values.indexOf(picked);
        sourceWidget.value = idx >= 0 ? picked : "All";
      } else {
        sourceWidget.value = picked;
      }
      suppressWidgetCallback = false;
      node.setDirtyCanvas(true, true);
    }
    loadCharacters().catch((err) => {
      status.textContent = `Filter failed: ${String(err)}`;
    });
    lastSyncedGroupValue = group.value || "All";
  });

  // Immediate sync when user changes the built-in source_group widget (left/right arrows).
  const sourceWidget = byName(node, "source_group");
  if (sourceWidget && !sourceWidget.__saaHooked) {
    sourceWidget.__saaHooked = true;
    const oldCb = sourceWidget.callback;
    sourceWidget.callback = function (value) {
      if (typeof oldCb === "function") {
        oldCb.apply(this, arguments);
      }
      if (suppressWidgetCallback) return;
      const mapped = resolveGroupFromWidget(sourceWidget, value);
      const allowed = node.__saaGroupNames || [];
      const nextGroup = allowed.includes(mapped) ? mapped : "All";
      if (group.value !== nextGroup) {
        group.value = nextGroup;
      }
      syncFromSourceWidget(true).catch((err) => {
        status.textContent = `Sync failed: ${String(err)}`;
      });
    };
  }

  grid.addEventListener("scroll", updateScrollProgressFromGrid);

  scrollProgress.addEventListener("pointerdown", () => {
    isDraggingProgress = true;
  });
  scrollProgress.addEventListener("pointerup", () => {
    isDraggingProgress = false;
    updateScrollProgressFromGrid();
  });
  scrollProgress.addEventListener("input", () => {
    const maxScroll = Math.max(0, grid.scrollHeight - grid.clientHeight);
    if (maxScroll <= 0) return;
    const ratio = 1 - Number(scrollProgress.value || 0) / 100;
    grid.scrollTop = maxScroll * ratio;
  });

  const resizeObserver = new ResizeObserver(() => {
    updateResponsiveColumns();
    updateScrollProgressFromGrid();
  });
  resizeObserver.observe(wrap);

  refreshStatus();
  node.__saaTimer = setInterval(refreshStatus, 1400);

  const oldRemoved = node.onRemoved;
  node.onRemoved = function () {
    if (node.__saaTimer) clearInterval(node.__saaTimer);
    resizeObserver.disconnect();
    if (oldRemoved) oldRemoved.apply(this, arguments);
  };
}

app.registerExtension({
  name: "saa.character.selector",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
      attachUI(this);
      return r;
    };
  },
});
