// Flavour drop: a capsule picture on a coloured background, with tasting
// notes and intensity. The picture is either a catalogue pod (saved as its
// sku) or a file dropped in for this session only: no image bytes are stored.
import { api } from "./api.js";
import { h } from "./dom.js";
import { busy, sheet } from "./ui.js";
import { F, SWATCH, bound, capsule, eyebrow, fit, lines, lum, saveBlob, scheduler, setF, shade, slug, toBlob } from "./shared.js";

const podUrl = (c) => `/api/marketing/pod?path=${encodeURIComponent(c.pod_image)}&t=${encodeURIComponent(c.edited_at || "")}`;

export function drawFl(c, f, img, handle) {
  const x = c.getContext("2d"), W = 1080, H = 1350, bg = f.bg || "#C8914A", dark = lum(bg) < 0.32;
  const fg = dark ? "#FBF6EE" : "#1E1512", soft = dark ? "rgba(251,246,238,.78)" : "rgba(30,21,18,.74)";
  x.textBaseline = "alphabetic";
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const g = x.createRadialGradient(540, 560, 40, 540, 560, 470);
  g.addColorStop(0, shade(bg, dark ? 0.22 : 0.3)); g.addColorStop(1, bg);
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  eyebrow(x, `${f.eyebrow}  ·  SGA Coffee Space`, 540, 116, fg, 24, "center");
  const sc = (f.scale || 100) / 100;
  if (img) {
    const bw = 660 * sc, bh = 620 * sc, k = Math.min(bw / img.width, bh / img.height), w = img.width * k, hh = img.height * k;
    x.save(); x.shadowColor = "rgba(0,0,0,.35)"; x.shadowBlur = 70; x.shadowOffsetY = 34;
    x.drawImage(img, 540 - w / 2, 560 - hh / 2, w, hh); x.restore();
  } else capsule(x, 540, 560, 220 * sc, shade(bg, dark ? 0.3 : -0.12));
  x.fillStyle = fg; x.textAlign = "center";
  const ns = fit(x, f.name, F.disp, "", 920, 150, 128, 54, 1.0);
  const nn = lines(x, f.name, 540, 930 + ns * 0.8, 920, ns);
  const y = 930 + nn * ns + 22;
  x.fillStyle = soft; setF(x, 34, F.body, "400");
  const tn = lines(x, f.notes, 540, y + 30, 820, 46);
  const iy = Math.max(1175, y + 30 + tn * 46 + 40);
  eyebrow(x, `Intensity ${f.intensity}`, 540, iy, fg, 20, "center");
  const n = 13, r = 10, sp = 34, x0 = 540 - ((n - 1) * sp) / 2;
  for (let i = 0; i < n; i++) {
    x.beginPath(); x.arc(x0 + i * sp, iy + 36, r, 0, 7);
    if (i < f.intensity) { x.fillStyle = fg; x.fill(); } else { x.strokeStyle = soft; x.lineWidth = 2; x.stroke(); }
  }
  x.textAlign = "left";
  eyebrow(x, f.avail, 84, 1302, soft, 20);
  eyebrow(x, handle || "@act_studentgov", W - 84, 1302, soft, 20, "right");
}

export function render(root, mk) {
  const { ws, toast } = mk;
  const doc = () => ws.doc("flavour");
  let img = null;                                   // the picture drawn; never saved
  const canvas = h("canvas.preview", { width: 1080, height: 1350, "aria-label": "Flavour post preview" });
  const draw = scheduler(() => drawFl(canvas, doc(), img, ws.doc("announce").handle));

  function setImage(src) {
    if (!src) { img = null; draw(); return Promise.resolve(); }
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => { img = im; draw(); resolve(); };
      im.onerror = () => { toast("That picture didn’t load."); resolve(); };
      im.src = src;
    });
  }

  function takeFile(file) {
    if (!file || !file.type.startsWith("image/")) { toast("That file is not an image."); return; }
    const reader = new FileReader();
    reader.onload = () => { doc().sku = null; ws.touch("flavour"); setImage(reader.result).then(() => toast("Picture added for this session.")); };
    reader.readAsDataURL(file);
  }

  const bgPick = h("input", { type: "color", value: doc().bg, "aria-label": "Background colour" });
  bgPick.addEventListener("input", () => { doc().bg = bgPick.value; ws.touch("flavour"); draw(); });
  const setBg = (c) => { doc().bg = c; bgPick.value = c; ws.touch("flavour"); draw(); };
  const intensityOut = h("span", {}, String(doc().intensity));
  const file = h("input", { type: "file", accept: "image/*", hidden: true });
  const drop = h("div.drop", { tabindex: "0", role: "button" }, h("b", {}, "Drop a capsule PNG here"), h("br"), "or click to choose. A transparent background works best.");
  drop.addEventListener("click", () => file.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } });
  file.addEventListener("change", () => takeFile(file.files[0]));
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => takeFile(e.dataTransfer.files[0]));
  canvas.addEventListener("dragover", (e) => e.preventDefault());
  canvas.addEventListener("drop", (e) => { e.preventDefault(); takeFile(e.dataTransfer.files[0]); });

  // --- pick a capsule from the catalogue: its pod, colour, intensity and notes -------
  async function pick(button) {
    const { capsules } = await busy(button, api("marketing/capsules"));
    const grid = h("div.cap-grid");
    const panel = sheet("Pick from catalogue", grid);
    for (const c of capsules) {
      grid.append(h("button.cap-tile", { type: "button", style: `background:${c.bg_color};color:${c.ink_color}`, onclick: async () => {
        const f = doc();
        f.sku = c.sku; f.bg = c.bg_color; f.name = c.name;
        if (c.intensity) f.intensity = c.intensity;
        const tags = (c.flavour_tags || []).map((t) => t.label).filter(Boolean);
        if (tags.length) f.notes = tags.join(", ");
        ws.touch("flavour");
        panel.close();
        mk.refresh();                       // the fields re-read the document; the pod loads by sku
      } }, h("img", { src: podUrl(c), alt: "", loading: "lazy", style: "max-height:70px" }), h("b", {}, c.name)));
    }
  }
  const catalogueBtn = h("button.btn.small.ghost", { type: "button", onclick: () => pick(catalogueBtn).catch((e) => toast(e.message)) }, "Pick from catalogue");

  const f = (key, opts) => bound(mk, "flavour", key, { ...opts, onInput: draw });
  const intensityField = bound(mk, "flavour", "intensity", { label: "Intensity", type: "range", min: "1", max: "13", hint: "Nespresso 1–13 scale · ",
    onInput: (el) => { intensityOut.textContent = el.value; draw(); } });
  intensityField.querySelector("em").append(intensityOut);
  const swatches = h("div.swatches", {}, ...SWATCH.map((c) => h("button", { type: "button", style: `background:${c}`, title: c, "aria-label": `Background ${c}`, onclick: () => setBg(c) })));

  root.append(
    h("header.head", {}, h("div.eyebrow", {}, "Instagram · 4:5 portrait"), h("h1", {}, "New flavour drop"),
      h("p", {}, "Pick a capsule from the catalogue, or drop in a transparent PNG. Choose a background that matches it and write the flavour copy.")),
    h("div.editor", {},
      h("div.stage", {}, canvas,
        h("div.row", {}, h("button.btn", { type: "button", onclick: async () => saveBlob(`flavour-${slug(doc().name)}.png`, await toBlob(canvas)) }, "Download PNG"))),
      h("div.panel", {},
        h("h3", {}, "Capsule image"),
        catalogueBtn, drop, file,
        h("div.row", {}, h("div", { style: "flex:1" }, f("scale", { label: "Image size", type: "range", min: "50", max: "150" })),
          h("button.btn.small.ghost", { type: "button", onclick: () => { doc().sku = null; ws.touch("flavour"); setImage(null); } }, "Remove image")),
        h("p.note", {}, "A picture you drop in is used for this session only. The catalogue pod is remembered."),
        h("h3", {}, "Colour"),
        h("div.row", {}, bgPick, swatches),
        h("h3", {}, "Copy"),
        f("eyebrow", { label: "Top line" }),
        f("name", { label: "Flavour name" }),
        f("notes", { label: "Tasting notes", rows: 2 }),
        intensityField,
        f("avail", { label: "Availability line" }))));

  // A saved catalogue pod comes back with the document.
  if (doc().sku) api("marketing/capsules").then(({ capsules }) => {
    const c = capsules.find((x) => x.sku === doc().sku);
    if (c) setImage(podUrl(c));
  }).catch(() => draw());
  else draw();
  return () => {};
}
