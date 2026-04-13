import { app } from "../../scripts/app.js";

export function splitValues(str) {
  if (!str || typeof str !== "string") return [];

  const results = [];

  // Split by newline and treat each line as a single value. 줄바꿈으로 먼저 나눈 뒤, 각 줄을 하나의 값으로 취급
  const lines = str.split(/\r?\n/);

  for (let line of lines) {
    line = line.trim();
    if (line === "") continue;        // Skip blank lines 빈 줄은 무시

    results.push(line);               // ← Add the entire line as a single value 한 줄 전체를 하나의 값으로 추가
  }

  return results;
}

// Expand range tokens like "1-5", "1-10 (+2)", "0-1 [6]" into flat number arrays.
// Non-range tokens are converted to numbers if possible, left as strings otherwise.
// Only called when the axis is in "range" mode.
export function expandRanges(tokens) {
  const rangeRe = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)(?:\s+\(([+-]\d+(?:\.\d+)?)\))?$/;
  const rngRe = /^rng_([if])\((\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)(?:\*(\d+))?\)$/;
  const fp = (n) => parseFloat(n.toPrecision(10));
  const result = [];
  for (const token of tokens) {
    const rng = token.match(rngRe);
    if (rng) {
      const lo = parseFloat(rng[2]), hi = parseFloat(rng[3]);
      const count = rng[4] ? parseInt(rng[4], 10) : 1;
      for (let k = 0; k < count; k++) {
        result.push(rng[1] === "i"
          ? Math.floor(Math.random() * (hi - lo + 1)) + lo
          : fp(Math.random() * (hi - lo) + lo));
      }
      continue;
    }
    const m = token.match(rangeRe);
    if (!m) {
      const n = Number(token);
      result.push(isNaN(n) ? token : n);
      continue;
    }
    const start = parseFloat(m[1]);
    const end = parseFloat(m[2]);
    const step = m[3] !== undefined ? parseFloat(m[3]) : (end >= start ? 1 : -1);
    if (step === 0) { result.push(start); continue; }
    if ((end > start && step < 0) || (end < start && step > 0)) { result.push(start); continue; }
    const MAX = 1000;
    let count = 0;
    for (let val = start; step > 0 ? val <= end + 1e-9 : val >= end - 1e-9; val = fp(val + step)) {
      result.push(fp(val));
      if (++count >= MAX) break;
    }
  }
  return result;
}

export function getNodes() {
  return (app.graph?.nodes ?? [])
    .map((n) => ({
      id: String(n.id),
      label: `${n.comfyClass ?? n.type ?? "Node"} #${n.id}`,
    }))
    .sort((a, b) => {
      const cmp = a.label.localeCompare(b.label, undefined, { numeric: true });
      return cmp !== 0 ? cmp : Number(a.id) - Number(b.id);
    });
}

export function getInputsFromGraphNode(nodeId) {
  const node = (app.graph?.nodes ?? []).find((n) => String(n.id) === nodeId);
  if (!node) return [];
  // Only expose widget inputs — link slots are [nodeId, slot] arrays in the
  // serialized prompt and can't be meaningfully varied with plain values.
  return (node.widgets ?? []).map((w) => w.name).filter(Boolean);
}

export function buildAxisSection(label, container, onChange) {
  const section = document.createElement("div");
  section.className = "xy-grid-section";

  const heading = document.createElement("div");
  heading.className = "xy-grid-heading";
  heading.textContent = label;
  section.appendChild(heading);

  function makeRow(labelText, child) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;margin-bottom:4px;";
    const lbl = document.createElement("span");
    lbl.textContent = labelText;
    lbl.style.cssText = "flex-shrink:0;width:46px;color:var(--descrip-text,#999);font-size:11px;";
    row.appendChild(lbl);
    child.style.flex = "1";
    // remove bottom margin from child since row provides spacing
    child.style.marginBottom = "0";
    row.appendChild(child);
    return row;
  }

  const nodeSel = document.createElement("select");
  nodeSel.style.cssText = "width:100%;";
  const nodeRow = makeRow("node", nodeSel);
  nodeRow.style.marginBottom = "4px";
  section.appendChild(nodeRow);

  const inputSel = document.createElement("select");
  inputSel.style.cssText = "width:100%;";
  const inputRow = makeRow("widget", inputSel);
  inputRow.style.display = "none";
  section.appendChild(inputRow);

  const valInput = document.createElement("textarea");
  valInput.rows = 2;
  valInput.placeholder = "val1, val2, val3";
  valInput.style.cssText = "box-sizing:border-box;resize:vertical;flex:1;";
  const valRow = document.createElement("div");
  valRow.style.cssText = "display:flex;align-items:flex-start;margin-bottom:4px;";
  const valLabelCol = document.createElement("div");
  valLabelCol.style.cssText = "flex-shrink:0;width:46px;display:flex;flex-direction:column;align-items:flex-start;gap:2px;";
  const valLabel = document.createElement("span");
  valLabel.textContent = "value";
  valLabel.style.cssText = "color:var(--descrip-text,#999);font-size:11px;padding-top:4px;";
  valLabelCol.appendChild(valLabel);
  valRow.appendChild(valLabelCol);
  valRow.appendChild(valInput);

  let mode = "plain";
  let rangeCache = null; // { key: string, values: array }
  function getCachedRangeValues() {
    const key = valInput.value;
    if (rangeCache?.key === key) return rangeCache.values;
    const values = expandRanges(splitValues(key));
    rangeCache = { key, values };
    return values;
  }
  const modeBtn = document.createElement("button");
  modeBtn.className = "xy-grid-btn";
  modeBtn.title = "Cycle value mode: plain text (abc) → numeric range (1-n) → text search/replace (S/R)";
  modeBtn.style.cssText = "flex-shrink:0;padding:2px 4px;";
  function updateModeBtn() {
    modeBtn.classList.remove("xy-grid-btn-mode-abc", "xy-grid-btn-mode-range", "xy-grid-btn-mode-sr");
    if (mode === "range") {
      modeBtn.textContent = "1-n";
      modeBtn.classList.add("xy-grid-btn-mode-range");
      valInput.placeholder = "1-5, 0-1 (+0.2), rng_i(0-9999*3)";
      valInput.style.borderColor = "color-mix(in srgb, #6ab0d4 50%, transparent)";
    } else if (mode === "sr") {
      modeBtn.textContent = "S/R";
      modeBtn.classList.add("xy-grid-btn-mode-sr");
      valInput.placeholder = "search, replace1, replace2, ...";
      valInput.style.borderColor = "color-mix(in srgb, #6ab87a 50%, transparent)";
    } else {
      modeBtn.textContent = "abc";
      modeBtn.classList.add("xy-grid-btn-mode-abc");
      valInput.placeholder = "val1, val2, val3";
      valInput.style.borderColor = "color-mix(in srgb, #d4956a 50%, transparent)";
    }
  }
  updateModeBtn();
  modeBtn.addEventListener("click", () => {
    mode = mode === "plain" ? "range" : mode === "range" ? "sr" : "plain";
    updateModeBtn();
    updateSRPreview();
    updateValPreview();
    onChange?.();
  });
  valLabelCol.appendChild(modeBtn);

  const fillBtn = document.createElement("button");
  fillBtn.textContent = "↓";
  fillBtn.title = "Fill all values from widget options";
  fillBtn.className = "xy-grid-btn";
  fillBtn.style.cssText = "flex-shrink:0;padding:2px 6px;display:none;margin-left:4px;";
  valRow.appendChild(fillBtn);

  fillBtn.addEventListener("click", () => {
    const node = (app.graph?.nodes ?? []).find((n) => String(n.id) === nodeSel.value);
    const widget = (node?.widgets ?? []).find((w) => w.name === inputSel.value);
    const vals = widget?.options?.values;
    if (vals?.length) {
      valInput.value = vals.join(", ");
      valInput.dispatchEvent(new Event("input"));
    }
  });

  const srPreview = document.createElement("div");
  srPreview.className = "xy-grid-sr-preview";
  const srPreviewRow = makeRow("current", srPreview);
  srPreviewRow.style.display = "none";
  section.appendChild(srPreviewRow);

  valRow.style.display = "none";
  section.appendChild(valRow);

  const valPreview = document.createElement("div");
  valPreview.className = "xy-grid-val-preview";
  const valPreviewRow = makeRow("preview", valPreview);
  valPreviewRow.style.display = "none";
  section.appendChild(valPreviewRow);

  function updateValPreview() {
    valPreview.innerHTML = "";
    valPreviewRow.style.display = "none";
    if (valRow.style.display === "none") return;
    const tokens = splitValues(valInput.value);
    let displayValues;
    if (mode === "range") {
      displayValues = getCachedRangeValues().map(String);
    } else if (mode === "sr") {
      if (tokens.length < 2) return;
      const [search, ...replacements] = tokens;
      const node = (app.graph?.nodes ?? []).find((n) => String(n.id) === nodeSel.value);
      const widget = (node?.widgets ?? []).find((w) => w.name === inputSel.value);
      const currentVal = String(widget?.value ?? "");
      if (!search || !currentVal.includes(search)) return;
      // Rich inline preview: full text with replacement spans at each match site
      const parts = currentVal.split(search);
      parts.forEach((part, i) => {
        if (part) valPreview.appendChild(document.createTextNode(part));
        if (i < parts.length - 1) {
          for (const r of replacements) {
            const span = document.createElement("span");
            span.className = "xy-grid-val-tag";
            span.style.color = "#6ab87a";
            span.textContent = `[${r}]`;
            valPreview.appendChild(span);
            valPreview.appendChild(document.createTextNode(" "));
          }
        }
      });
      valPreviewRow.style.display = "flex";
      return;
    } else {
      displayValues = tokens;
    }
    if (!displayValues.length) return;
    const MAX = 20;
    const shown = displayValues.slice(0, MAX);
    const rest = displayValues.length - MAX;
    const color = mode === "range" ? "#6ab0d4" : mode === "sr" ? "#6ab87a" : "#d4956a";
    for (const v of shown) {
      const span = document.createElement("span");
      span.className = "xy-grid-val-tag";
      span.style.color = color;
      span.textContent = `[${v}]`;
      valPreview.appendChild(span);
    }
    if (rest > 0) {
      const more = document.createElement("span");
      more.className = "xy-grid-val-more";
      more.style.color = color;
      more.textContent = `+${rest} more`;
      valPreview.appendChild(more);
    }
    valPreviewRow.style.display = "flex";
  }

  function updateSRPreview() {
    const node = (app.graph?.nodes ?? []).find((n) => String(n.id) === nodeSel.value);
    const widget = (node?.widgets ?? []).find((w) => w.name === inputSel.value);
    if (!widget) { srPreviewRow.style.display = "none"; return; }
    srPreview.textContent = String(widget.value ?? "");
    srPreviewRow.style.display = "flex";
  }

  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.placeholder = "axis label (optional, defaults to widget name)";
  labelInput.style.cssText = "width:100%;box-sizing:border-box;";
  const labelRow = makeRow("label", labelInput);
  labelRow.style.display = "none";
  section.appendChild(labelRow);

  container.appendChild(section);

  function populateInputs(inputs, selectName) {
    inputSel.innerHTML = "";
    for (const name of inputs) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      inputSel.appendChild(opt);
    }
    if (selectName && inputSel.querySelector(`option[value="${selectName}"]`)) {
      inputSel.value = selectName;
    }
    // always default to first widget
    if (!inputSel.value && inputSel.options.length) inputSel.selectedIndex = 0;
  }

  function refreshNodes() {
    const prevNodeId = nodeSel.value;
    const prevInput = inputSel.value;
    const nodes = getNodes();
    nodeSel.innerHTML = '<option value="">— node —</option>';
    for (const n of nodes) {
      const opt = document.createElement("option");
      opt.value = n.id;
      opt.textContent = n.label;
      nodeSel.appendChild(opt);
    }
    if (prevNodeId && nodeSel.querySelector(`option[value="${prevNodeId}"]`)) {
      nodeSel.value = prevNodeId;
      populateInputs(getInputsFromGraphNode(prevNodeId), prevInput);
      inputRow.style.display = "flex";
      valRow.style.display = "flex";
      labelRow.style.display = "flex";
      updateFillBtn();
    } else {
      inputRow.style.display = "none";
      valRow.style.display = "none";
      labelRow.style.display = "none";
    }
    updateSRPreview();
    updateValPreview();
  }

  nodeSel.addEventListener("change", () => {
    if (!nodeSel.value) {
      inputSel.innerHTML = "";
      inputRow.style.display = "none";
      valRow.style.display = "none";
      labelRow.style.display = "none";
      updateSRPreview();
      updateValPreview();
      onChange?.();
      return;
    }
    populateInputs(getInputsFromGraphNode(nodeSel.value));
    inputRow.style.display = "flex";
    valRow.style.display = "flex";
    labelRow.style.display = "flex";
    updateFillBtn();
    watchWidget();
    updateSRPreview();
    updateValPreview();
    onChange?.();
  });

  function updateFillBtn() {
    const node = (app.graph?.nodes ?? []).find((n) => String(n.id) === nodeSel.value);
    const widget = (node?.widgets ?? []).find((w) => w.name === inputSel.value);
    fillBtn.style.display = widget?.options?.values?.length ? "block" : "none";
  }

  let _unwatchWidget = null;
  function watchWidget() {
    _unwatchWidget?.();
    _unwatchWidget = null;
    const node = (app.graph?.nodes ?? []).find((n) => String(n.id) === nodeSel.value);
    const widget = (node?.widgets ?? []).find((w) => w.name === inputSel.value);
    if (!widget) return;
    const orig = widget.callback;
    widget.callback = (...args) => {
      orig?.(...args);
      updateSRPreview();
      updateValPreview();
    };
    _unwatchWidget = () => { widget.callback = orig; };
  }

  inputSel.addEventListener("change", () => { updateFillBtn(); watchWidget(); updateSRPreview(); updateValPreview(); onChange?.(); });
  valInput.addEventListener("input", () => { updateSRPreview(); updateValPreview(); onChange?.(); });
  labelInput.addEventListener("input", () => onChange?.());

  refreshNodes();

  function setNode(nodeId) {
    if (!nodeSel.querySelector(`option[value="${nodeId}"]`)) {
      refreshNodes();
    }
    nodeSel.value = nodeId;
    nodeSel.dispatchEvent(new Event("change"));
  }

  return {
    section,
    refreshNodes,
    setNode,
    getNodeId: () => nodeSel.value,
    getInput: () => inputSel.value,
    getValues: () => {
      const tokens = splitValues(valInput.value);
      if (mode === "range") return getCachedRangeValues();
      if (mode === "sr") {
        if (tokens.length < 2) return tokens;
        const [search, ...replacements] = tokens;
        const node = (app.graph?.nodes ?? []).find((n) => String(n.id) === nodeSel.value);
        const widget = (node?.widgets ?? []).find((w) => w.name === inputSel.value);
        const currentVal = String(widget?.value ?? "");
        return replacements.map((r) => ({ patchValue: currentVal.replaceAll(search, r), label: r }));
      }
      return tokens;
    },
    getValueCount: () => {
      if (!nodeSel.value || !inputSel.value) return 0;
      const tokens = splitValues(valInput.value);
      if (mode === "range") return getCachedRangeValues().length;
      if (mode === "sr") return tokens.length > 1 ? tokens.length - 1 : 0;
      return tokens.length;
    },
    getLabel: () => labelInput.value.trim(),
    getState: () => ({ nodeId: nodeSel.value, input: inputSel.value, values: valInput.value, label: labelInput.value, mode }),
    setState: (savedState = {}) => {
      const { nodeId, input, values, label } = savedState;
      if (nodeId && nodeSel.querySelector(`option[value="${nodeId}"]`)) {
        nodeSel.value = nodeId;
        populateInputs(getInputsFromGraphNode(nodeId), input);
        inputRow.style.display = "flex";
        valRow.style.display = "flex";
        labelRow.style.display = "flex";
        updateFillBtn();
      } else {
        nodeSel.value = "";
        inputSel.innerHTML = "";
        inputRow.style.display = "none";
        valRow.style.display = "none";
        labelRow.style.display = "none";
        updateFillBtn();
      }
      valInput.value = values ?? "";
      labelInput.value = label ?? "";
      mode = savedState.mode === "range" ? "range" : savedState.mode === "sr" ? "sr" : "plain";
      updateModeBtn();
      watchWidget();
      updateSRPreview();
      updateValPreview();
    },
    validate: () => {
      if (mode !== "sr") return null;
      const tokens = splitValues(valInput.value);
      if (tokens.length < 1) return null;
      const search = tokens[0];
      const node = (app.graph?.nodes ?? []).find((n) => String(n.id) === nodeSel.value);
      const widget = (node?.widgets ?? []).find((w) => w.name === inputSel.value);
      const currentVal = String(widget?.value ?? "");
      if (search && !currentVal.includes(search)) {
        return `"${search}" not found in current value of "${inputSel.value}"`;
      }
      return null;
    },
  };
}
