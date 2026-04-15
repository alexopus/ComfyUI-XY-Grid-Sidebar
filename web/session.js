import { api } from "../../scripts/api.js";

// ── session state ──────────────────────────────────────────────────────────
let session = null; // null when idle
let assembling = false; // guard against concurrent checkAllSettled calls

// ── UI refs (set via initUI) ───────────────────────────────────────────────
let _ui = {};

export function initUI(refs) {
  _ui = refs;
}

export function isActive() {
  return session !== null;
}

export function startSession(config) {
  assembling = false;
  session = { ...config, done: 0, failed: 0 };
  session.poller = setInterval(pollDroppedPrompts, 2000);
  return session;
}

export function endSession() {
  clearInterval(session?.poller);
  session = null;
  assembling = false;
}

export function updateStatus(msg) {
  if (!_ui.status) return;
  if (msg) {
    _ui.status.textContent = msg;
    return;
  }
  if (!session) {
    _ui.status.textContent = "Idle";
    return;
  }
  const total = session.total;
  _ui.status.textContent = `Queued ${total} — Done ${session.done}/${total} — Failed ${session.failed}`;
}

export async function checkAllSettled() {
  if (!session) return;
  const total = session.total;
  if (session.done + session.failed < total) return;
  if (assembling) return;
  assembling = true;

  updateStatus("Assembling grid…");

  // For any 'done' cell whose 'executed' WS event was missed, recover image from history
  await Promise.all(
    session.cells
      .filter((c) => c.status === "done" && !c.image && c.promptId)
      .map(async (cell) => {
        try {
          const hr = await api.fetchApi(`/history/${cell.promptId}`);
          const hdata = await hr.json();
          const imgs = hdata[cell.promptId]?.outputs?.[session.outputNodeId]?.images;
          if (imgs?.length) cell.image = imgs[0];
        } catch {}
      })
  );

  // Build 2D cells array
  const xCount = new Set(session.cells.map((c) => c.xi)).size;
  const yCount = new Set(session.cells.map((c) => c.yj)).size;
  const grid = Array.from({ length: yCount }, () => Array(xCount).fill(null));
  for (const cell of session.cells) {
    grid[cell.yj][cell.xi] = cell.image ?? null;
  }

  const xLabels = session.cells[0]?.xVal !== null
    ? [...new Set(session.cells.map((c) => c.xVal))]
    : [];
  const yLabels = session.cells[0]?.yVal !== null
    ? [...new Set(session.cells.map((c) => c.yVal))]
    : [];

  try {
    const r = await api.fetchApi("/xy_grid/assemble", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cells: grid, x_labels: xLabels, y_labels: yLabels, x_name: session.xName, y_name: session.yName, description: session.description, format: session.format, quality: session.quality, scale: session.scale }),
    });
    const data = await r.json();
    if (data.error) {
      updateStatus(`Assembly failed: ${data.error}`);
    } else {
      updateStatus(`Done — saved as ${data.filename}`);
    }
  } catch (err) {
    updateStatus(`Assembly error: ${err.message}`);
  }

  clearInterval(session.poller);
  if (_ui.runBtn) _ui.runBtn.disabled = false;
  session = null;
  assembling = false;
}

// ── WebSocket listeners ────────────────────────────────────────────────────
async function pollDroppedPrompts() {
  if (!session) return;
  const pending = session.cells.filter((c) => c.status === "pending" && c.promptId);
  if (pending.length === 0) return;
  try {
    const r = await api.fetchApi("/queue");
    const data = await r.json();
    const active = new Set([
      ...(data.queue_running ?? []).map((item) => item[1]),
      ...(data.queue_pending ?? []).map((item) => item[1]),
    ]);

    const missing = pending.filter((c) => !active.has(c.promptId));
    if (missing.length === 0) return;

    let changed = false;
    for (const cell of missing) {
      if (cell.status !== "pending") continue; // WS event already handled it
      try {
        const hr = await api.fetchApi(`/history/${cell.promptId}`);
        const hdata = await hr.json();
        if (cell.status !== "pending") continue; // WS event arrived while awaiting history
        const entry = hdata[cell.promptId];
        if (entry?.status?.status_str === "success") {
          // Completed normally but WS event lost or delayed — resolve from history
          const imgs = entry.outputs?.[session.outputNodeId]?.images;
          if (imgs?.length && !cell.image) cell.image = imgs[0];
          cell.status = "done";
          session.done++;
        } else {
          // Not in history or errored — was cancelled
          cell.status = "failed";
          session.failed++;
        }
      } catch {
        if (cell.status !== "pending") continue;
        cell.status = "failed";
        session.failed++;
      }
      changed = true;
    }
    if (changed) {
      updateStatus();
      checkAllSettled();
    }
  } catch {}
}

api.addEventListener("executed", (e) => {
  if (!session) return;
  const { prompt_id, node, output } = e.detail ?? {};
  if (!prompt_id || node !== session.outputNodeId) return;
  const cell = session.cells.find((c) => c.promptId === prompt_id);
  if (!cell) return;
  const images = output?.images;
  if (images?.length) cell.image = images[0];
});

api.addEventListener("execution_success", (e) => {
  if (!session) return;
  const { prompt_id } = e.detail ?? {};
  const cell = session.cells.find((c) => c.promptId === prompt_id);
  if (!cell || cell.status !== "pending") return;
  cell.status = "done";
  session.done++;
  updateStatus();
  checkAllSettled();
});

api.addEventListener("execution_error", (e) => {
  if (!session) return;
  const { prompt_id } = e.detail ?? {};
  const cell = session.cells.find((c) => c.promptId === prompt_id);
  if (!cell || cell.status !== "pending") return;
  cell.status = "failed";
  session.failed++;
  updateStatus();
  checkAllSettled();
});

api.addEventListener("execution_interrupted", (e) => {
  if (!session) return;
  const { prompt_id } = e.detail ?? {};
  const cell = session.cells.find((c) => c.promptId === prompt_id);
  if (!cell || cell.status !== "pending") return;
  cell.status = "failed";
  session.failed++;
  updateStatus();
  checkAllSettled();
});
