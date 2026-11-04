// Announcement: the launch post, 1080×1350. The preview is the PNG you download.
import { h } from "./dom.js";
import { F, THEMES, bound, capRow, copyText, eyebrow, fit, fitLine, lines, rr, saveBlob, scheduler, setF, themePicker, toBlob } from "./shared.js";

export function drawAnn(c, a) {
  const x = c.getContext("2d"), W = 1080, H = 1350, Pd = 84, t = THEMES[a.theme] || THEMES.burgundy;
  x.textBaseline = "alphabetic";
  x.fillStyle = t.bg; x.fillRect(0, 0, W, H);
  eyebrow(x, a.eyebrow, Pd, 118, t.accent, 24);
  x.fillStyle = t.line; x.fillRect(Pd, 146, W - 2 * Pd, 2);
  x.fillStyle = t.fg;
  const hs = fit(x, a.headline, F.disp, "", W - 2 * Pd, 340, 116, 56, 1.02);
  const hn = lines(x, a.headline, Pd, 196 + hs * 0.82, W - 2 * Pd, hs * 1.02);
  const y = 196 + hn * hs * 1.02 + 34;
  x.fillStyle = t.soft;
  const bs = fit(x, a.body, F.body, "400", W - 2 * Pd - 40, Math.max(80, 850 - y), 38, 24, 1.42);
  lines(x, a.body, Pd, y + bs, W - 2 * Pd - 40, bs * 1.42);
  capRow(x, 925, 48, Pd, W - Pd);
  const py = 1015, ph = 235;
  x.fillStyle = t.panel; rr(x, Pd, py, W - 2 * Pd, ph, 22);
  eyebrow(x, a.dateLabel, Pd + 40, py + 62, t.accent, 22);
  x.fillStyle = t.fg;
  const ds = fitLine(x, a.date, F.disp, "", 540, 108, 40);
  x.fillText(a.date, Pd + 38, py + 80 + ds * 0.78);
  x.fillStyle = t.line; x.fillRect(Pd + 620, py + 36, 2, ph - 72);
  const pl = String(a.prices || "").split("\n").filter(Boolean).slice(0, 4);
  x.fillStyle = t.fg; x.textAlign = "right";
  const pls = pl.length > 3 ? 30 : 34;
  setF(x, pls, F.body, "600");
  const top = py + ph / 2 - (pl.length - 1) * pls * 0.8 + pls * 0.35;
  pl.forEach((l, i) => x.fillText(l, W - Pd - 40, top + i * pls * 1.6));
  x.textAlign = "left";
  eyebrow(x, a.handle, Pd, 1306, t.soft, 22);
  eyebrow(x, "Anatolia American University", W - Pd, 1306, t.soft, 22, "right");
}

export function render(root, mk) {
  const { ws, toast } = mk;
  const canvas = h("canvas.preview", { width: 1080, height: 1350, "aria-label": "Announcement post preview" });
  const draw = scheduler(() => drawAnn(canvas, ws.doc("announce")));
  const f = (key, opts) => bound(mk, "announce", key, { ...opts, onInput: draw });
  const caption = f("caption", { label: "Caption", hint: "paste this under the post", rows: 6 });

  root.append(
    h("header.head", {}, h("div.eyebrow", {}, "Instagram · 4:5 portrait"), h("h1", {}, "Launch announcement"),
      h("p", {}, "The first official post. Edit the copy on the right; the preview is the exact PNG you download.")),
    h("div.editor", {},
      h("div.stage", {}, canvas,
        h("div.row", {}, h("button.btn", { type: "button", onclick: async () => saveBlob("coffee-space-announcement.png", await toBlob(canvas)) }, "Download PNG"))),
      h("div.panel", {},
        h("h3", {}, "Look"),
        themePicker(ws.doc("announce").theme, (id) => { ws.doc("announce").theme = id; ws.touch("announce"); draw(); }),
        h("h3", {}, "Copy"),
        f("eyebrow", { label: "Top line" }),
        f("headline", { label: "Headline", rows: 2 }),
        f("body", { label: "Body", rows: 5 }),
        h("div.two", {}, f("dateLabel", { label: "Date label" }), f("date", { label: "Date" })),
        f("prices", { label: "Prices", hint: "one per line", rows: 3 }),
        f("handle", { label: "Footer handle" }),
        caption,
        h("button.btn.small.ghost", { type: "button", onclick: () => copyText(ws.doc("announce").caption || "", toast) }, "Copy caption"))));
  draw();
  return () => {};
}
