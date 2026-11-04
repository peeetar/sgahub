// How-to carousel: cover, numbered steps, sign-off. Thumbnails are drawn
// small; only the selected slide is drawn at full size.
import { h } from "./dom.js";
import { busy, loadJSZip } from "./ui.js";
import { F, THEMES, bound, capRow, eyebrow, fit, fitLine, lines, rr, saveBlob, scheduler, setF, themePicker, toBlob } from "./shared.js";

export function drawSlide(c, i, car, handle, scale = 1) {
  const x = c.getContext("2d"), W = 1080, H = 1350, Pd = 84, sl = car.slides, n = sl.length, s = sl[i], t = THEMES[car.theme] || THEMES.burgundy;
  x.setTransform(scale, 0, 0, scale, 0, 0);
  x.textBaseline = "alphabetic";
  const kind = i === 0 ? "cover" : i === n - 1 ? "end" : "step";
  const paper = car.theme === "cream"
    ? { bg: "#FBF7F0", fg: "#3B1119", soft: "rgba(59,17,25,.76)", accent: "#1D3B30", line: "rgba(59,17,25,.16)" }
    : { bg: "#F3ECDF", fg: "#2A1216", soft: "rgba(42,18,22,.76)", accent: t.bg, line: "rgba(42,18,22,.16)" };
  const th = kind === "step" ? paper : t;
  const hh = handle || "@act_studentgov";
  x.fillStyle = th.bg; x.fillRect(0, 0, W, H);
  eyebrow(x, "How to · SGA Coffee Space", Pd, 112, kind === "step" ? th.soft : t.accent, 20);
  eyebrow(x, `${String(i + 1).padStart(2, "0")} / ${String(n).padStart(2, "0")}`, W - Pd, 112, kind === "step" ? th.soft : t.accent, 20, "right");
  const sw = (W - 2 * Pd - (n - 1) * 8) / n;
  for (let k = 0; k < n; k++) { x.fillStyle = k <= i ? (kind === "step" ? th.accent : t.accent) : th.line; rr(x, Pd + k * (sw + 8), 138, sw, 6, 3); }
  if (kind === "cover") {
    x.fillStyle = t.fg;
    const hs = fit(x, s.t, F.disp, "", W - 2 * Pd, 460, 150, 64, 1.0);
    const hn = lines(x, s.t, Pd, 270 + hs * 0.8, W - 2 * Pd, hs);
    x.fillStyle = t.soft; setF(x, 40, F.body, "400");
    lines(x, s.b, Pd, 270 + hn * hs + 70, W - 2 * Pd - 60, 56);
    capRow(x, 1030, 58, Pd, W - Pd);
    eyebrow(x, hh, Pd, 1296, t.soft, 22); eyebrow(x, "Swipe  →", W - Pd, 1296, t.accent, 22, "right");
  } else if (kind === "step") {
    x.fillStyle = th.accent; setF(x, 400, F.disp, ""); x.fillText(String(i), Pd - 12, 590);
    eyebrow(x, `Step ${i}`, Pd, 680, th.soft, 22);
    x.fillStyle = th.fg;
    const ts = fit(x, s.t, F.disp, "", W - 2 * Pd, 210, 100, 52, 1.02);
    const tn = lines(x, s.t, Pd, 720 + ts * 0.82, W - 2 * Pd, ts * 1.02);
    x.fillStyle = th.soft;
    const by = 720 + tn * ts * 1.02 + 40;
    const bs = fit(x, s.b, F.body, "400", W - 2 * Pd - 40, Math.max(100, 1230 - by), 40, 26, 1.42);
    lines(x, s.b, Pd, by + bs, W - 2 * Pd - 40, bs * 1.42);
    x.fillStyle = th.line; x.fillRect(Pd, 1258, W - 2 * Pd, 2);
    eyebrow(x, "Bissell Library", Pd, 1302, th.soft, 20); eyebrow(x, "Swipe  →", W - Pd, 1302, th.accent, 20, "right");
  } else {
    x.fillStyle = t.fg;
    const hs = fit(x, s.t, F.disp, "", W - 2 * Pd, 300, 140, 60, 1.0);
    const hn = lines(x, s.t, Pd, 300 + hs * 0.8, W - 2 * Pd, hs);
    x.fillStyle = t.soft; setF(x, 40, F.body, "400");
    const bn = lines(x, s.b, Pd, 300 + hn * hs + 64, W - 2 * Pd - 60, 56);
    x.fillStyle = t.accent; fitLine(x, hh, F.disp, "", W - 2 * Pd, 110, 50);
    x.fillText(hh, Pd, Math.min(900, 300 + hn * hs + 64 + bn * 56 + 150));
    capRow(x, 1060, 58, Pd, W - Pd);
    eyebrow(x, "SGA × Bissell Library × Maker's Society", Pd, 1296, t.soft, 20); eyebrow(x, "Anatolia American University", W - Pd, 1296, t.soft, 20, "right");
  }
  x.setTransform(1, 0, 0, 1, 0, 0);
}

const pad = (n) => String(n).padStart(2, "0");

export function render(root, mk) {
  const { ws, toast } = mk;
  const car = () => ws.doc("howto");
  const handle = () => ws.doc("announce").handle;
  let sel = 0;
  const canvas = h("canvas.preview", { width: 1080, height: 1350, "aria-label": "Carousel slide preview" });
  const thumbs = h("div.thumbs");
  const list = h("div.slides");

  const drawMain = scheduler(() => { if (sel >= car().slides.length) sel = 0; drawSlide(canvas, sel, car(), handle()); });
  const drawThumb = (i) => { const c = thumbs.children[i]; if (c) drawSlide(c, i, car(), handle(), 0.2); };
  const drawThumbs = scheduler(() => {
    const n = car().slides.length;
    while (thumbs.children.length < n) {
      const i = thumbs.children.length;
      thumbs.append(h("canvas", { width: 216, height: 270, tabindex: "0", role: "button", "aria-label": `Slide ${i + 1}`,
        onclick: () => select(i), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(i); } } }));
    }
    while (thumbs.children.length > n) thumbs.lastChild.remove();
    for (let i = 0; i < n; i++) { drawThumb(i); thumbs.children[i].classList.toggle("on", i === sel); }
  });

  function select(i) {
    if (sel === i) return;
    sel = i;
    [...list.children].forEach((c, k) => c.classList.toggle("on", k === i));
    [...thumbs.children].forEach((c, k) => c.classList.toggle("on", k === i));
    drawMain();
  }

  function renderSlides() {
    const slides = car().slides, n = slides.length;
    list.replaceChildren(...slides.map((s, i) => {
      const kind = i === 0 ? "Cover" : i === n - 1 ? "Closing" : `Step ${i}`;
      const title = h("input", { type: "text", value: s.t, "aria-label": `Slide ${i + 1} title` });
      const text = h("textarea", { rows: "3", "aria-label": `Slide ${i + 1} text` });
      text.value = s.b;
      const card = h("div.scard", {}, h("header", {}, h("span", {}, `${pad(i + 1)} · ${kind}`),
        kind.startsWith("Step") && n > 3
          ? h("button.btn.small.ghost", { type: "button", onclick: () => { slides.splice(i, 1); sel = Math.min(sel, slides.length - 1); ws.touch("howto"); renderSlides(); drawMain(); drawThumbs(); } }, "Remove")
          : null), title, text);
      if (i === sel) card.classList.add("on");
      const pick = () => select(i);
      title.addEventListener("focus", pick); text.addEventListener("focus", pick);
      title.addEventListener("input", () => { s.t = title.value; ws.touch("howto"); drawMain(); drawThumbs(); });
      text.addEventListener("input", () => { s.b = text.value; ws.touch("howto"); drawMain(); drawThumbs(); });
      return card;
    }));
  }

  async function downloadZip(button) {
    const JSZip = await loadJSZip();
    const zip = new JSZip(), c = document.createElement("canvas");
    c.width = 1080; c.height = 1350;
    for (let i = 0; i < car().slides.length; i++) {
      drawSlide(c, i, car(), handle());
      zip.file(`coffee-howto-${pad(i + 1)}.png`, await toBlob(c));
    }
    saveBlob("coffee-howto-carousel.zip", await zip.generateAsync({ type: "blob" }));
  }
  const zipBtn = h("button.btn.ghost", { type: "button", onclick: () => busy(zipBtn, downloadZip()).catch((e) => toast(e.message)) }, "Download all (.zip)");

  root.append(
    h("header.head", {}, h("div.eyebrow", {}, "Instagram carousel · 4:5"), h("h1", {}, "How to use the Coffee Space"),
      h("p", {}, "First slide is the cover, last slide is the sign-off, everything between is a numbered step. Click a slide to edit it.")),
    h("div.editor", {},
      h("div.stage", {}, canvas, thumbs,
        h("div.row", {},
          h("button.btn", { type: "button", onclick: async () => saveBlob(`coffee-howto-${pad(sel + 1)}.png`, await toBlob(canvas)) }, "Download this slide"), zipBtn)),
      h("div.panel", {},
        h("h3", {}, "Look"),
        themePicker(car().theme, (id) => { car().theme = id; ws.touch("howto"); drawMain(); drawThumbs(); }),
        h("div.row", { style: "justify-content:space-between" }, h("h3", {}, "Slides"),
          h("button.btn.small.ghost", { type: "button", onclick: () => {
            const at = car().slides.length - 1;
            car().slides.splice(at, 0, { t: "New step", b: "Describe what to do." });
            sel = at; ws.touch("howto"); renderSlides(); drawMain(); drawThumbs();
          } }, "+ Add step")),
        list)));
  renderSlides(); drawMain(); drawThumbs();
  return () => {};
}
