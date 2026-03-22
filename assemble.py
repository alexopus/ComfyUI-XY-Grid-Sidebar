import os
import time
from PIL import Image, ImageDraw, ImageFont
import folder_paths

LABEL_H = 96
LABEL_W = 240
FONT_SIZE = 32
CELL_PAD = 4
DESC_PAD = 20
BG_COLOR = (0, 0, 0)
LABEL_BG = (0, 0, 0)
LABEL_FG = (255, 255, 255)
FAILED_COLOR = (40, 40, 40)


def _font(size):
    try:
        return ImageFont.load_default(size=size)  # Pillow >= 10.0
    except TypeError:
        return ImageFont.load_default()  # Pillow < 10.0 — fixed bitmap, size ignored


def _wrap_text(text, max_w, font):
    """Word-wrap text to fit max_w pixels wide. Returns list of line strings."""
    dummy = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    words = text.split()
    if not words:
        return []
    lines, current = [], words[0]
    for word in words[1:]:
        candidate = current + " " + word
        bb = dummy.textbbox((0, 0), candidate, font=font)
        if bb[2] - bb[0] <= max_w:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def _desc_height(text, total_w, font):
    """Return the pixel height needed for the description bar (0 if empty)."""
    text = text.strip()
    if not text:
        return 0
    lines = _wrap_text(text, total_w - 2 * DESC_PAD, font)
    if not lines:
        return 0
    dummy = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    bb = dummy.textbbox((0, 0), "Ag", font=font)
    line_h = bb[3] - bb[1]
    return len(lines) * line_h + (len(lines) - 1) * 6 + 2 * DESC_PAD


def _draw_description(draw, text, total_w, font):
    """Draw a full-width description bar starting at y=0."""
    text = text.strip()
    if not text:
        return
    lines = _wrap_text(text, total_w - 2 * DESC_PAD, font)
    if not lines:
        return
    bb = draw.textbbox((0, 0), "Ag", font=font)
    line_h = bb[3] - bb[1]
    height = _desc_height(text, total_w, font)
    draw.rectangle([0, 0, total_w - 1, height - 1], fill=LABEL_BG)
    ty = DESC_PAD
    for line in lines:
        draw.text((DESC_PAD, ty), line, fill=LABEL_FG, font=font)
        ty += line_h + 6


def _draw_label(draw, text, x, y, w, h, font):
    avail_w = w - 8

    def measure(s):
        bb = draw.textbbox((0, 0), s, font=font)
        return bb[2] - bb[0], bb[3] - bb[1]

    def truncate(s):
        while len(s) > 1 and measure(s)[0] > avail_w:
            s = s[:-2] + "…"
        return s

    if measure(text)[0] <= avail_w:
        lines = [text]
    else:
        words = text.split()
        if len(words) > 1:
            # Greedy: find the largest word-boundary prefix that fits on line 1
            split_i = 1
            for i in range(1, len(words)):
                if measure(" ".join(words[:i]))[0] <= avail_w:
                    split_i = i
                else:
                    break
            lines = [" ".join(words[:split_i]), truncate(" ".join(words[split_i:]))]
        else:
            lines = [truncate(text)]

    line_gap = 4
    _, th = measure(lines[0])
    total_h = len(lines) * th + (len(lines) - 1) * line_gap
    ty = y + (h - total_h) // 2

    draw.rectangle([x, y, x + w - 1, y + h - 1], fill=LABEL_BG)
    for i, line in enumerate(lines):
        lw, _ = measure(line)
        draw.text((x + max(4, (w - lw) // 2), ty + i * (th + line_gap)), line, fill=LABEL_FG, font=font)


def _draw_corner(draw, x_name, y_name, x, y, w, h, font):
    """Draw the top-left corner cell with a diagonal separator and axis names.
    x_name (column axis) → top-right; y_name (row axis) → bottom-left."""
    draw.rectangle([x, y, x + w - 1, y + h - 1], fill=LABEL_BG)
    draw.line([(x, y), (x + w - 1, y + h - 1)], fill=LABEL_FG, width=1)
    # x_name (col axis) — top-right, pointing toward the columns
    bb = draw.textbbox((0, 0), x_name, font=font)
    tw = bb[2] - bb[0]
    draw.text((x + w - tw - 4, y + 4), x_name, fill=LABEL_FG, font=font)
    # y_name (row axis) — bottom-left, pointing toward the rows
    bb = draw.textbbox((0, 0), y_name, font=font)
    draw.text((x + 4, y + h - bb[3] - 4), y_name, fill=LABEL_FG, font=font)


def assemble_grid(cells, x_labels, y_labels, x_name=None, y_name=None, description="", output_name="xy_grid", fmt="png", quality=90, scale=100):
    """
    cells: list of rows, each row is a list of {filename, subfolder, type} or None
    x_labels: column header strings
    y_labels: row header strings
    """
    output_dir = folder_paths.get_output_directory()
    temp_dir = folder_paths.get_temp_directory()
    rows = len(cells)
    cols = len(cells[0]) if rows > 0 else 0

    # Load all images, track cell size
    loaded = [[None] * cols for _ in range(rows)]
    cell_w, cell_h = 64, 64  # fallback minimum

    for r in range(rows):
        for c in range(cols):
            info = cells[r][c]
            if info is None:
                continue
            base_dir = temp_dir if info.get("type") == "temp" else output_dir
            subfolder = info.get("subfolder", "")
            img_path = os.path.join(base_dir, subfolder, info["filename"]) if subfolder else os.path.join(base_dir, info["filename"])
            if os.path.exists(img_path):
                img = Image.open(img_path).convert("RGB")
                if scale != 100:
                    img = img.resize((max(1, img.width * scale // 100), max(1, img.height * scale // 100)), Image.LANCZOS)
                loaded[r][c] = img
                cell_w = max(cell_w, img.width)
                cell_h = max(cell_h, img.height)

    has_y = bool(y_labels)
    has_x = bool(x_labels)

    font = _font(FONT_SIZE)

    left_off = LABEL_W if has_y else 0
    total_w = left_off + cols * (cell_w + CELL_PAD) - CELL_PAD

    desc_off = _desc_height(description, total_w, font)
    top_off = desc_off + (LABEL_H if has_x else 0)
    total_h = top_off + rows * (cell_h + CELL_PAD) - CELL_PAD

    canvas = Image.new("RGB", (total_w, total_h), BG_COLOR)
    draw = ImageDraw.Draw(canvas)

    # Description bar (above everything)
    if desc_off:
        _draw_description(draw, description, total_w, font)

    # Corner cell (when both axes are present and named)
    if has_x and has_y and x_name and y_name:
        _draw_corner(draw, x_name, y_name, 0, desc_off, left_off, LABEL_H, font)

    # Column headers (X labels)
    for c, label in enumerate(x_labels[:cols]):
        x = left_off + c * (cell_w + CELL_PAD)
        _draw_label(draw, str(label), x, desc_off, cell_w, LABEL_H, font)

    # Row headers (Y labels)
    for r, label in enumerate(y_labels[:rows]):
        y = top_off + r * (cell_h + CELL_PAD)
        _draw_label(draw, str(label), 0, y, LABEL_W, cell_h, font)

    # Paste cells
    for r in range(rows):
        for c in range(cols):
            x = left_off + c * (cell_w + CELL_PAD)
            y = top_off + r * (cell_h + CELL_PAD)
            img = loaded[r][c]
            if img is not None:
                # center image in cell
                ox = (cell_w - img.width) // 2
                oy = (cell_h - img.height) // 2
                canvas.paste(img, (x + ox, y + oy))
            else:
                draw.rectangle([x, y, x + cell_w - 1, y + cell_h - 1], fill=FAILED_COLOR)
                draw.text((x + 4, y + 4), "failed", fill=(120, 120, 120), font=font)

    timestamp = int(time.time())
    ext = "jpg" if fmt == "jpeg" else "png"
    filename = f"{output_name}_{timestamp}.{ext}"
    save_path = os.path.join(output_dir, filename)
    save_kwargs = {"quality": int(quality), "optimize": True} if fmt == "jpeg" else {}
    canvas.save(save_path, format=fmt.upper(), **save_kwargs)
    return filename
