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
    .saa-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:6px; max-height:320px; overflow:auto; padding-right:4px; }
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

  const search = document.createElement("input");
  search.type = "text";
  search.placeholder = "Search name/origin";

  const groupSearch = document.createElement("input");
  groupSearch.type = "text";
  groupSearch.placeholder = "Search group";

  const group = document.createElement("select");
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.textContent = "Reload";

  top.appendChild(search);
  top.appendChild(groupSearch);
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

  const grid = document.createElement("div");
  grid.className = "saa-grid";

  wrap.appendChild(top);
  wrap.appendChild(progressRow);
  wrap.appendChild(status);
  wrap.appendChild(grid);

  node.addDOMWidget("saa_selector", "saa_selector", wrap, {
    getMinHeight: () => 390,
    getMaxHeight: () => 600,
    getHeight: () => 430,
  });

  let searchTimer = null;

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

  async function loadGroups() {
    const data = await apiGet("/saa_selector/groups");
    const allGroups = data.groups || [];
    node.__saaGroupsRaw = allGroups;
    renderGroupOptions(allGroups, groupSearch.value);

    const sourceWidget = byName(node, "source_group");
    if (sourceWidget) {
      const current = sourceWidget.value || "All";
      sourceWidget.value = node.__saaGroupNames.includes(current) ? current : "All";
      group.value = sourceWidget.value;
    }
  }

  async function loadCharacters() {
    const q = encodeURIComponent(search.value || "");
    const g = encodeURIComponent(group.value || "All");
    const data = await apiGet(`/saa_selector/characters?search=${q}&group=${g}&limit=200`);
    renderCards(node, grid, data.items || []);
    status.textContent = `Loaded ${data.items?.length || 0} items`;
  }

  async function refreshStatus() {
    try {
      const s = await apiGet("/saa_selector/status");
      progress.value = Number(s.progress || 0);
      pLabel.textContent = `${Math.round(Number(s.progress || 0))}%`;
      const isLoading = Boolean(s.is_loading);
      progressRow.style.display = isLoading ? "flex" : "none";
      if (s.error) {
        status.textContent = `Error: ${s.error}`;
        progressRow.style.display = "flex";
      } else {
        status.textContent = s.status || "idle";
      }
      if (!s.is_loading && (s.progress || 0) >= 100) {
        await loadGroups();
        await loadCharacters();
      }
    } catch (err) {
      status.textContent = `Status failed: ${String(err)}`;
    }
  }

  refreshBtn.addEventListener("click", async () => {
    status.textContent = "Reloading...";
    progressRow.style.display = "flex";
    progress.value = 0;
    pLabel.textContent = "0%";
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

  groupSearch.addEventListener("input", () => {
    renderGroupOptions(node.__saaGroupsRaw || [], groupSearch.value);
  });

  group.addEventListener("change", () => {
    const sourceWidget = byName(node, "source_group");
    if (sourceWidget) {
      const allowed = Array.isArray(node.__saaGroupNames) ? node.__saaGroupNames : ["All"];
      sourceWidget.value = allowed.includes(group.value) ? group.value : "All";
      node.setDirtyCanvas(true, true);
    }
    loadCharacters().catch((err) => {
      status.textContent = `Filter failed: ${String(err)}`;
    });
  });

  refreshStatus();
  node.__saaTimer = setInterval(refreshStatus, 1400);

  const oldRemoved = node.onRemoved;
  node.onRemoved = function () {
    if (node.__saaTimer) clearInterval(node.__saaTimer);
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
