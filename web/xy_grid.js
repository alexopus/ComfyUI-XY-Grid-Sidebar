import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { buildAxisSection, getNodes } from "./axis_section.js";
import { initUI, isActive, startSession, endSession, updateStatus, checkAllSettled } from "./session.js";

// ── styles ─────────────────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById("xy-grid-styles")) return;
  const link = document.createElement("link");
  link.id = "xy-grid-styles";
  link.rel = "stylesheet";
  link.href = "/extensions/comfyui-xy-grid-sidebar/xy_grid.css";
  document.head.appendChild(link);
}

// ── sidebar state (set when tab is rendered) ───────────────────────────────
const sidebarState = { x: null, y: null, out: null };

// ── persistence ────────────────────────────────────────────────────────────
const STORAGE_KEY = "comfyui_xy_grid_sidebar_state";

function loadPersistedState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"); } catch { return {}; }
}

function savePersistedState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}


// ── utilities ──────────────────────────────────────────────────────────────
function cartesian(xs, ys) {
  const hasX = xs && xs.length > 0;
  const hasY = ys && ys.length > 0;
  if (hasX && hasY) {
    const out = [];
    xs.forEach((x, xi) => ys.forEach((y, yj) => out.push({ xi, yj, xVal: x, yVal: y })));
    return out;
  }
  if (hasX) return xs.map((x, xi) => ({ xi, yj: 0, xVal: x, yVal: null }));
  if (hasY) return ys.map((y, yj) => ({ xi: 0, yj, xVal: null, yVal: y }));
  return [];
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// S/R mode wraps values as { patchValue, label }; unwrap for patching vs. display.
function patchValue(v) { return v?.patchValue ?? v; }
function displayValue(v) { return v?.label ?? v; }

// ── UI refs (populated in render) ─────────────────────────────────────────
let ui = {};

// ── main render ────────────────────────────────────────────────────────────
function render(el) {
  injectStyles();
  el.innerHTML = "";
  el.className = "xy-grid-sidebar";

  // ── Title row ──
  const titleRow = document.createElement("div");
  titleRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;";
  const title = document.createElement("div");
  title.className = "xy-grid-title";
  title.textContent = "XY Grid";
  titleRow.appendChild(title);
  const titleBtns = document.createElement("div");
  titleBtns.style.cssText = "display:flex;gap:4px;";
  const refreshBtn = document.createElement("button");
  refreshBtn.textContent = "↺";
  refreshBtn.title = "Refresh nodes";
  refreshBtn.className = "xy-grid-btn";
  refreshBtn.style.cssText = "padding:2px 8px;font-size:11px;";
  titleBtns.appendChild(refreshBtn);
  const swapBtn = document.createElement("button");
  swapBtn.textContent = "⇅ Swap X/Y";
  swapBtn.className = "xy-grid-btn";
  swapBtn.style.cssText = "padding:2px 8px;font-size:11px;";
  titleBtns.appendChild(swapBtn);
  titleRow.appendChild(titleBtns);
  el.appendChild(titleRow);

  const subtitle = document.createElement("div");
  subtitle.className = "xy-grid-subtitle";
  subtitle.textContent = "Queue every axis combination and assemble a labelled grid.";
  el.appendChild(subtitle);

  // ── Description ──
  const descSection = document.createElement("div");
  descSection.className = "xy-grid-section";
  const descHeading = document.createElement("div");
  descHeading.className = "xy-grid-heading";
  descHeading.textContent = "Description";
  descSection.appendChild(descHeading);
  const descInput = document.createElement("textarea");
  descInput.rows = 3;
  descInput.placeholder = "Optional description printed above the grid";
  descSection.appendChild(descInput);

  // saveAll is defined after outSel exists; captured by reference via arrow fn
  let saveAll;
  const onAxisChange = () => { updateComboPreview(); saveAll?.(); };

  // ── X axis ──
  const xRef = buildAxisSection("X axis", el, onAxisChange);
  sidebarState.x = xRef;

  // ── Y axis ──
  const yRef = buildAxisSection("Y axis", el, onAxisChange);
  sidebarState.y = yRef;

  swapBtn.addEventListener("click", () => {
    const xState = xRef.getState();
    const yState = yRef.getState();
    xRef.setState(yState);
    yRef.setState(xState);
    saveAll?.();
  });

  // ── Output node ──
  const outSection = document.createElement("div");
  outSection.className = "xy-grid-section";
  const outHeading = document.createElement("div");
  outHeading.className = "xy-grid-heading";
  outHeading.textContent = "Output source";
  outSection.appendChild(outHeading);
  const outSel = document.createElement("select");
  outSel.style.cssText = "width:100%;";
  function makeOutRow(child) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;margin-bottom:4px;";
    const lbl = document.createElement("span");
    lbl.textContent = "node:";
    lbl.style.cssText = "flex-shrink:0;width:46px;color:var(--descrip-text,#999);font-size:11px;";
    row.appendChild(lbl);
    child.style.flex = "1";
    row.appendChild(child);
    return row;
  }
  outSection.appendChild(makeOutRow(outSel));
  el.appendChild(outSection);

  function refreshOutputNodes() {
    const prevVal = outSel.value;
    const nodes = getNodes();
    outSel.innerHTML = '<option value="">— node —</option>';
    for (const n of nodes) {
      const opt = document.createElement("option");
      opt.value = n.id;
      opt.textContent = n.label;
      outSel.appendChild(opt);
    }
    if (prevVal && outSel.querySelector(`option[value="${prevVal}"]`)) {
      outSel.value = prevVal;
    }
  }
  refreshOutputNodes();
  outSel.addEventListener("change", () => saveAll?.());
  sidebarState.out = {
    setNode: (id) => {
      if (!outSel.querySelector(`option[value="${id}"]`)) {
        refreshOutputNodes();
      }
      outSel.value = id;
      saveAll?.();
    },
  };

  // ── Output format ──
  const fmtSection = document.createElement("div");
  fmtSection.className = "xy-grid-section";
  const fmtHeading = document.createElement("div");
  fmtHeading.className = "xy-grid-heading";
  fmtHeading.textContent = "Output format";
  fmtSection.appendChild(fmtHeading);

  function makeFmtRow(labelText, child) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;margin-bottom:4px;";
    const lbl = document.createElement("span");
    lbl.textContent = labelText;
    lbl.style.cssText = "flex-shrink:0;width:46px;color:var(--descrip-text,#999);font-size:11px;";
    row.appendChild(lbl);
    child.style.flex = "1";
    row.appendChild(child);
    return row;
  }

  const fmtSel = document.createElement("select");
  for (const f of ["png", "jpeg"]) {
    const opt = document.createElement("option");
    opt.value = f;
    opt.textContent = f.toUpperCase();
    fmtSel.appendChild(opt);
  }
  fmtSection.appendChild(makeFmtRow("format:", fmtSel));

  const qualityInput = document.createElement("input");
  qualityInput.type = "range";
  qualityInput.min = 1;
  qualityInput.max = 100;
  qualityInput.value = 90;
  qualityInput.style.cssText = "box-sizing:border-box;";
  const qualityVal = document.createElement("span");
  qualityVal.textContent = qualityInput.value;
  qualityVal.style.cssText = "flex-shrink:0;margin-left:6px;min-width:24px;text-align:right;font-size:11px;";
  qualityInput.addEventListener("input", () => { qualityVal.textContent = qualityInput.value; saveAll?.(); });
  const qualityRow = makeFmtRow("quality:", qualityInput);
  qualityRow.appendChild(qualityVal);
  qualityRow.style.display = "none";
  fmtSection.appendChild(qualityRow);

  fmtSel.addEventListener("change", () => {
    qualityRow.style.display = fmtSel.value === "jpeg" ? "flex" : "none";
    saveAll?.();
  });

  const SCALE_STEPS = [10, 20, 25, 50, 100];
  const scaleInput = document.createElement("input");
  scaleInput.type = "range";
  scaleInput.min = 0;
  scaleInput.max = SCALE_STEPS.length - 1;
  scaleInput.step = 1;
  scaleInput.value = SCALE_STEPS.length - 1;
  scaleInput.style.cssText = "box-sizing:border-box;";
  const scaleVal = document.createElement("span");
  scaleVal.textContent = "100%";
  scaleVal.style.cssText = "flex-shrink:0;margin-left:6px;min-width:34px;text-align:right;font-size:11px;";
  scaleInput.addEventListener("input", () => { scaleVal.textContent = SCALE_STEPS[scaleInput.value] + "%"; saveAll?.(); });
  const scaleRow = makeFmtRow("scale:", scaleInput);
  scaleRow.appendChild(scaleVal);
  fmtSection.appendChild(scaleRow);

  saveAll = () => savePersistedState({
    x: xRef.getState(),
    y: yRef.getState(),
    outNodeId: outSel.value,
    format: fmtSel.value,
    quality: qualityInput.value,
    scaleIdx: scaleInput.value,
    description: descInput.value,
  });
  descInput.addEventListener("input", () => saveAll?.());

  // ── Restore persisted state ──
  const saved = loadPersistedState();
  if (saved.x) xRef.setState(saved.x);
  if (saved.y) yRef.setState(saved.y);
  if (saved.outNodeId && outSel.querySelector(`option[value="${saved.outNodeId}"]`)) {
    outSel.value = saved.outNodeId;
  }
  if (saved.format && fmtSel.querySelector(`option[value="${saved.format}"]`)) {
    fmtSel.value = saved.format;
    qualityRow.style.display = saved.format === "jpeg" ? "flex" : "none";
  }
  if (saved.quality) qualityInput.value = saved.quality;
  if (saved.scaleIdx != null) {
    scaleInput.value = saved.scaleIdx;
    scaleVal.textContent = SCALE_STEPS[scaleInput.value] + "%";
  }
  if (saved.description) descInput.value = saved.description;

  refreshBtn.addEventListener("click", () => {
    xRef.refreshNodes();
    yRef.refreshNodes();
    refreshOutputNodes();
  });
  el.appendChild(fmtSection);
  el.appendChild(descSection);

  // ── Combo preview ──
  const comboPreview = document.createElement("div");
  comboPreview.className = "xy-grid-combo-preview";
  el.appendChild(comboPreview);

  function updateComboPreview() {
    const n = xRef.getValueCount();
    const m = yRef.getValueCount();
    if (n === 0 && m === 0) { comboPreview.textContent = ""; return; }
    if (n > 0 && m > 0) {
      comboPreview.innerHTML =
        `<span>${n}</span> × <span>${m}</span> = <span class="xy-grid-combo-total">${n * m}</span>`;
    } else {
      comboPreview.innerHTML =
        `<span class="xy-grid-combo-total">${n || m}</span> prompt${(n || m) === 1 ? "" : "s"}`;
    }
  }
  updateComboPreview();

  // ── Run button ──
  const runBtn = document.createElement("button");
  runBtn.textContent = "▶ Run XY Grid";
  runBtn.className = "xy-grid-btn xy-grid-btn-run";
  runBtn.style.cssText = "width:100%;margin-bottom:8px;";
  ui.runBtn = runBtn;
  el.appendChild(runBtn);

  // ── Status ──
  const statusEl = document.createElement("div");
  statusEl.className = "xy-grid-status";
  statusEl.textContent = "Idle";
  ui.status = statusEl;
  el.appendChild(statusEl);

  // ── Mode help ──
  const helpEl = document.createElement("div");
  helpEl.className = "xy-grid-mode-help";
  helpEl.innerHTML =
    '<span class="xy-grid-mode-help-label xy-grid-btn-mode-abc">abc</span> plain values, comma-separated<br>' +
    '<span class="xy-grid-mode-help-label xy-grid-btn-mode-range">1-n</span> numeric ranges, mix freely:<br>' +
    '<span class="xy-grid-mode-help-sub"><em>1-5</em> → 1 2 3 4 5</span>' +
    '<span class="xy-grid-mode-help-sub"><em>1-10 (+3)</em> → 1 4 7 10</span>' +
    '<span class="xy-grid-mode-help-sub"><em>10-1 (-4)</em> → 10 6 2</span>' +
    '<span class="xy-grid-mode-help-sub"><em>0-1 (+0.25)</em> → float step</span>' +
    '<span class="xy-grid-mode-help-sub"><em>rng_i(0-9999*3)</em> → 3 random ints</span>' +
    '<span class="xy-grid-mode-help-sub"><em>rng_f(0-1*4)</em> → 4 random floats</span>' +
    '<span class="xy-grid-mode-help-label xy-grid-btn-mode-sr">S/R</span> text search/replace: <em>find, repl1, repl2</em>';
  el.appendChild(helpEl);

  initUI(ui);

  runBtn.addEventListener("click", async () => {
    if (isActive()) return;

    const xNodeId = xRef.getNodeId();
    const xInput = xRef.getInput();
    const xValues = xRef.getValues();
    const yNodeId = yRef.getNodeId();
    const yInput = yRef.getInput();
    const yValues = yRef.getValues();
    const outputNodeId = outSel.value;

    const hasX = xNodeId && xInput && xValues.length > 0;
    const hasY = yNodeId && yInput && yValues.length > 0;
    if (!hasX && !hasY) {
      updateStatus("Set at least one axis (node, input, and values).");
      return;
    }
    if (!outputNodeId) {
      updateStatus("Pick an output node.");
      return;
    }

    const xWarning = hasX ? xRef.validate() : null;
    const yWarning = hasY ? yRef.validate() : null;
    if (xWarning || yWarning) {
      const parts = [xWarning && `X: ${xWarning}`, yWarning && `Y: ${yWarning}`].filter(Boolean);
      updateStatus(`⚠ ${parts.join(" — ")}`);
      return;
    }

    let promptTemplate;
    try {
      const result = await app.graphToPrompt();
      promptTemplate = result.output;
    } catch (err) {
      updateStatus(`Failed to get prompt: ${err.message}`);
      return;
    }

    const combos = cartesian(hasX ? xValues : [], hasY ? yValues : []);
    const cells = [];

    // Create session before queuing so WS events that fire during the loop
    // (e.g. fast single-step prompts) are not dropped.
    // Use combos.length as the fixed total — cells.length grows during the loop.
    const sess = startSession({ cells, outputNodeId, total: combos.length, xName: xRef.getLabel() || xInput, yName: yRef.getLabel() || yInput, description: descInput.value.trim(), format: fmtSel.value, quality: parseInt(qualityInput.value, 10), scale: SCALE_STEPS[scaleInput.value] });

    runBtn.disabled = true;
    updateStatus(`Queuing ${combos.length} jobs…`);

    for (const combo of combos) {
      const prompt = deepClone(promptTemplate);
      if (hasX) {
        if (!prompt[xNodeId]) {
          updateStatus(`X node ${xNodeId} not found in prompt.`);
          runBtn.disabled = false;
          endSession();
          return;
        }
        prompt[xNodeId].inputs[xInput] = patchValue(combo.xVal);
      }
      if (hasY) {
        if (!prompt[yNodeId]) {
          updateStatus(`Y node ${yNodeId} not found in prompt.`);
          runBtn.disabled = false;
          endSession();
          return;
        }
        prompt[yNodeId].inputs[yInput] = patchValue(combo.yVal);
      }

      try {
        const r = await api.fetchApi("/prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            client_id: api.clientId,
            extra_data: { xy_grid: { x: combo.xi, y: combo.yj } },
          }),
        });
        const data = await r.json();
        if (data.error) throw new Error(JSON.stringify(data.error));
        cells.push({ ...combo, xVal: displayValue(combo.xVal), yVal: displayValue(combo.yVal), promptId: data.prompt_id, status: "pending", image: null });
      } catch (err) {
        cells.push({ ...combo, promptId: null, status: "failed", image: null });
        sess.failed++;
      }
    }

    updateStatus();

    // If all failed immediately (e.g. no network), still try to assemble
    if (sess.done + sess.failed >= sess.cells.length) checkAllSettled();
  });
}

// ── Extension registration ─────────────────────────────────────────────────
app.registerExtension({
  name: "comfyui.xy_grid_sidebar",
  async setup() {
    app.extensionManager.registerSidebarTab({
      id: "xy_grid_sidebar",
      icon: "pi pi-table",
      title: "XY Grid",
      tooltip: "XY Grid parameter explorer",
      type: "custom",
      render,
    });
  },
  nodeCreated(node) {
    const orig = node.getExtraMenuOptions?.bind(node);
    node.getExtraMenuOptions = function (canvas, options) {
      orig?.(canvas, options);
      options.push(null, {
        content: "XY Grid",
        has_submenu: true,
        submenu: {
          options: [
            {
              content: "Set as X axis",
              callback: () => sidebarState.x?.setNode(String(node.id)),
            },
            {
              content: "Set as Y axis",
              callback: () => sidebarState.y?.setNode(String(node.id)),
            },
            {
              content: "Set as X and Y axis",
              callback: () => {
                sidebarState.x?.setNode(String(node.id));
                sidebarState.y?.setNode(String(node.id));
              },
            },
            {
              content: "Set as output",
              callback: () => sidebarState.out?.setNode(String(node.id)),
            },
          ],
        },
      });
    };
  },
});
