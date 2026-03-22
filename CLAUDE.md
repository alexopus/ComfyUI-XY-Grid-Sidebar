# CLAUDE.md — comfyui-xy-grid-sidebar

ComfyUI sidebar extension that queues N×M workflow variants and assembles their image outputs into an XY grid image saved to the output directory.

## File structure

```
__init__.py        # aiohttp route: POST /xy_grid/assemble
assemble.py        # PIL grid assembly (assemble_grid())
web/
  xy_grid.js       # orchestrator: render(), persistence, queuing loop, context menu
  axis_section.js  # buildAxisSection(), splitValues(), expandRanges(), value modes
  session.js       # session state, WS listeners, poll-based dropped-prompt detection
  xy_grid.css      # injected via <link>; uses ComfyUI CSS variables
```

## Module boundaries

- **`axis_section.js`** — self-contained; imports only `app`. Owns: splitValues, expandRanges, buildAxisSection, watchWidget, value previews, getValues/getValueCount.
- **`session.js`** — owns the `session` variable; `xy_grid.js` never touches it directly. Exports: `initUI({ status, runBtn })`, `isActive()`, `startSession(config)`, `endSession()`, `updateStatus(msg)`, `checkAllSettled()`.
- **`xy_grid.js`** — orchestrator; calls session exports and axis section refs. Owns: render, persistence, queuing loop, context menu, cartesian product.

## Key conventions

### Frontend

- **Node/input enumeration**: sourced from `app.graph.nodes` and `node.widgets` (NOT `/object_info`). Widget inputs only — link slots are arrays and can't be varied with plain values.
- **Queue a prompt**: `POST /prompt` with `{ prompt, client_id, extra_data }` — bypasses `app.queuePrompt`, causes harmless `'execution_start' fired before prompt was made` warnings in console.
- **WS events**: listen via `api.addEventListener(eventName, handler)`. Relevant: `executed` (→ `data.output.images`), `execution_success`, `execution_error`, `execution_interrupted`.
- **Dropped-prompt detection**: poll `GET /queue` every 2s. If a pending cell's `promptId` is absent from both `queue_running` and `queue_pending`, check `GET /history/{prompt_id}` before marking failed (race condition: prompt may have completed and left the queue before its WS event arrives).
- **Image capture**: nodes like SaveImage/PreviewImage have no IMAGE output slot. Images arrive via `executed` WS event: `data.output.images[0]` (`{filename, subfolder, type}`).
- **S/R mode values**: `getValues()` returns `{ patchValue, label }` objects; `xy_grid.js` unwraps with `patchValue(v)` / `displayValue(v)`.
- **Session timing**: session is created *before* the queuing loop to avoid a race with fast-completing prompts. `total` is set to `combos.length` (not `cells.length`) so `checkAllSettled` can't fire prematurely mid-loop.
- **State persistence**: `localStorage` key `comfyui_xy_grid_sidebar_state`. Includes node/input/values/label/mode/format/quality/scale/description per axis.

### Value modes (per axis)

| Mode | Button color | Value field behavior |
|------|-------------|----------------------|
| `abc` | orange `#d4956a` | Comma-separated strings (CSV quoting supported) |
| `1-n` | blue `#6ab0d4` | Range tokens: `1-5`, `1-10 (+2)`, `rng_i(0-9999*3)`, `rng_f(0-1*4)` |
| `S/R` | green `#6ab87a` | `search, replace1, replace2, ...` — replaces in widget's live value |

Random values (`rng_*`) are rolled when the preview renders and cached by input string (`rangeCache = { key, values }`). `getValues()`, `getValueCount()`, and `updateValPreview()` all use `getCachedRangeValues()` so preview values match queued values exactly.

### Backend (`assemble.py`)

- `assemble_grid(cells, x_labels, y_labels, x_name, y_name, description, output_name, fmt, quality, scale)`
- `cells` is a list of rows; each cell is `{filename, subfolder, type}` or `None` (failed → grey placeholder).
- Scale applied at image-load time via `Image.LANCZOS` before computing cell dimensions.
- Description bar drawn above all other layout; `desc_off` shifts column headers, row headers, and cells downward.
- Corner cell (both axes + names): diagonal separator, x_name top-right, y_name bottom-left.
- Saved as `xy_grid_{timestamp}.{png|jpg}` to `folder_paths.get_output_directory()`.
- Font: `ImageFont.load_default(size=32)` — no hardcoded font paths.

### Styling

CSS uses ComfyUI variables: `--fg-color`, `--comfy-input-bg`, `--comfy-menu-bg`, `--border-color`, `--descrip-text`. Injected via `<link>` in `injectStyles()` (not inline `<style>`).

## Run / test

No dedicated test suite. Test by loading ComfyUI and opening the XY Grid sidebar tab.

```bash
# From ComfyUI root
python main.py
```
