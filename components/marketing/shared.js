// Everything the Marketing HQ tools share: the themes and fonts the canvases
// draw with, the canvas helpers, and copy / download.
import { h } from "./dom.js";

export const F = {
  disp: "Gloock, Georgia, serif",
  body: '"Hanken Grotesk", Helvetica, Arial, sans-serif',
  mono: '"JetBrains Mono", Menlo, monospace',
};

export const THEMES = {
  burgundy: { label: "Burgundy", bg: "#5C1A27", fg: "#F6EDE2", soft: "rgba(246,237,226,.80)", accent: "#E4B874", line: "rgba(246,237,226,.22)", panel: "rgba(0,0,0,.22)" },
  green: { label: "Forest", bg: "#1D3B30", fg: "#F3EEE3", soft: "rgba(243,238,227,.80)", accent: "#E4B874", line: "rgba(243,238,227,.22)", panel: "rgba(0,0,0,.2)" },
  cream: { label: "Oat", bg: "#F1E9DC", fg: "#3B1119", soft: "rgba(59,17,25,.78)", accent: "#7A2234", line: "rgba(59,17,25,.18)", panel: "#E4D8C5" },
};
export const CAPS = ["#B8862B", "#2E5A47", "#7A1F33", "#2C3E6B", "#C9C2B3", "#8C4A2F"];
export const SWATCH = ["#C8914A", "#7A1F33", "#1D3B30", "#2C3E6B", "#D9C7A8", "#3A2A24", "#B5475A", "#6E8B5A"];
export const DEFAULT_HANDLE = "@act_studentgov";

// Canvas text needs the faces loaded first, or it silently draws in a fallback.
export function fontsReady() {
  return Promise.all([
    document.fonts.load("80px Gloock"),
    document.fonts.load('400 30px "Hanken Grotesk"'),
    document.fonts.load('500 30px "Hanken Grotesk"'),
    document.fonts.load('600 30px "Hanken Grotesk"'),
    document.fonts.load('700 30px "Hanken Grotesk"'),
    document.fonts.load('500 20px "JetBrains Mono"'),
  ]).catch(() => {});
}

// --- canvas helpers ------------------------------------------------------------

export function setF(x, size, family, weight) { x.font = `${weight ? weight + " " : ""}${size}px ${family}`; }
function ls(x, px) { if ("letterSpacing" in x) x.letterSpacing = `${px}px`; }

export function wrap(x, text, maxW) {
  const out = [];
  String(text || "").split("\n").forEach((para) => {
    if (!para.trim()) { out.push(""); return; }
    let line = "";
    para.split(/\s+/).forEach((word) => {
      const t = line ? `${line} ${word}` : word;
      if (x.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
    });
    out.push(line);
  });
  return out;
}
export function lines(x, text, X, y, maxW, lh) {
  const rows = wrap(x, text, maxW);
  rows.forEach((l, i) => x.fillText(l, X, y + i * lh));
  return rows.length;
}
export function fit(x, text, family, weight, maxW, maxH, max, min, lhR) {
  for (let s = max; s >= min; s -= 2) {
    setF(x, s, family, weight);
    const rows = wrap(x, text, maxW);
    if (rows.length * s * lhR <= maxH && rows.every((l) => x.measureText(l).width <= maxW)) return s;
  }
  setF(x, min, family, weight);
  return min;
}
export function fitLine(x, text, family, weight, maxW, max, min) {
  for (let s = max; s >= min; s -= 2) {
    setF(x, s, family, weight);
    if (x.measureText(text).width <= maxW) return s;
  }
  return min;
}
export function rr(x, X, Y, w, hh, r) {
  x.beginPath();
  if (x.roundRect) x.roundRect(X, Y, w, hh, r); else x.rect(X, Y, w, hh);
  x.fill();
}
function hex2rgb(hex) {
  // shade() returns "rgb(r,g,b)", and capsule() shades that again.
  const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(hex);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
  let c = hex.replace("#", "");
  if (c.length === 3) c = c.split("").map((ch) => ch + ch).join("");
  const n = parseInt(c, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function shade(hex, a) {
  const c = hex2rgb(hex).map((v) => Math.round(a >= 0 ? v + (255 - v) * a : v * (1 + a)));
  return `rgb(${c.join(",")})`;
}
export function lum(hex) {
  const [r, g, b] = hex2rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function capsule(x, cx, cy, r, col) {
  x.save();
  x.fillStyle = "rgba(0,0,0,.28)"; x.beginPath(); x.arc(cx + r * 0.05, cy + r * 0.14, r, 0, 7); x.fill();
  x.fillStyle = shade(col, -0.3); x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  const g = x.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.05, cx, cy, r * 0.82);
  g.addColorStop(0, shade(col, 0.4)); g.addColorStop(1, col);
  x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r * 0.8, 0, 7); x.fill();
  x.strokeStyle = "rgba(255,255,255,.2)"; x.lineWidth = Math.max(1, r * 0.035);
  x.beginPath(); x.arc(cx, cy, r * 0.56, 0, 7); x.stroke();
  x.restore();
}
export function capRow(x, y, r, X0, X1) {
  const n = 6, gap = (X1 - X0 - 2 * r) / (n - 1);
  for (let i = 0; i < n; i++) capsule(x, X0 + r + i * gap, y, r, CAPS[i]);
}
export function eyebrow(x, text, X, y, col, size, align) {
  x.fillStyle = col; setF(x, size || 24, F.mono, "500"); ls(x, 3);
  x.textAlign = align || "left"; x.fillText(String(text).toUpperCase(), X, y);
  ls(x, 0); x.textAlign = "left";
}

// --- copy, download -------------------------------------------------------------

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "post";
export const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

export function saveBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function copyText(text, toast) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied.");
    return true;
  } catch {
    toast("Couldn’t copy. Select the text and press Ctrl/Cmd+C.");
    return false;
  }
}

// --- small builders the tools all use ---------------------------------------------

/** A theme picker: three swatches with names. */
export function themePicker(value, onChange) {
  const wrap = h("div.seg", { role: "group", "aria-label": "Theme" });
  Object.entries(THEMES).forEach(([id, t]) => wrap.append(h("button", {
    type: "button", "aria-pressed": String(value === id), dataset: { key: id },
    onclick: () => {
      for (const b of wrap.children) b.setAttribute("aria-pressed", String(b.dataset.key === id));
      onChange(id);
    },
  }, h("i.sw-dot", { style: `background:${t.bg}` }), t.label)));
  return wrap;
}

/** A canvas redrawn at most once per frame, however fast the edits come. */
export function scheduler(fn) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(); });
  };
}

/** A textarea whose text is generated; readonly, with a Copy button. */
export function outputBox(title, rows, toast) {
  const area = h("textarea", { readonly: true, rows: String(rows), "aria-label": title });
  const count = h("span.chars");
  const box = h("div.out", {},
    h("header", {}, h("h3", {}, title), count,
      h("button.btn.small", { type: "button", onclick: () => copyText(area.value, toast) }, "Copy")),
    area);
  return { el: box, set(text, limit) {
    area.value = text;
    count.textContent = limit ? `${text.length} / ${limit} characters` : "";
    count.classList.toggle("over", !!limit && text.length > limit);
  } };
}

/** A labelled input or textarea bound to `ws.doc(tool)[key]`; every edit is
    saved (debounced) and `onInput` redraws whatever shows it. */
export function bound(mk, tool, key, { label, hint, rows, type = "text", min, max, onInput = () => {} }) {
  const doc = () => mk.ws.doc(tool);
  const attrs = { "aria-label": label };
  const control = rows
    ? h("textarea", { ...attrs, rows: String(rows) })
    : h("input", { ...attrs, type, min, max });
  control.value = doc()[key] ?? "";
  control.addEventListener("input", () => {
    doc()[key] = type === "range" || type === "number" ? Number(control.value) : control.value;
    mk.ws.touch(tool);
    onInput(control);
  });
  return h("label.f", {}, h("span", {}, label), control, hint ? h("em", {}, hint) : null);
}
