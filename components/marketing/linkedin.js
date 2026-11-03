// One-month post: a square image plus the post text, built from the team
// list and the launch numbers, so the numbers and names can't drift apart.
import { h } from "./dom.js";
import { F, THEMES, bound, capRow, eyebrow, fit, fitLine, lines, saveBlob, scheduler, outputBox, toBlob } from "./shared.js";
import { fillNumbers, roster, stats } from "./people.js";

export function drawLi(c, li, st) {
  const x = c.getContext("2d"), W = 1200, Pd = 90, t = THEMES.green;
  x.textBaseline = "alphabetic";
  x.fillStyle = t.bg; x.fillRect(0, 0, W, W);
  eyebrow(x, "SGA Coffee Space", Pd, 128, t.accent, 24);
  x.fillStyle = t.fg;
  const ts = fitLine(x, li.imgTitle, F.disp, "", W - 2 * Pd, 250, 90);
  x.fillText(li.imgTitle, Pd, 190 + ts * 0.8);
  x.fillStyle = t.soft;
  const ss = fit(x, li.imgSub, F.disp, "", W - 2 * Pd - 120, 150, 60, 34, 1.1);
  lines(x, li.imgSub, Pd, 190 + ts * 0.8 + 40 + ss, W - 2 * Pd - 120, ss * 1.1);
  capRow(x, 730, 40, Pd, Pd + 520);
  const items = [[st.coffees, "Coffees served"], [st.students, "Students registered"], [st.flavours, "Flavours"]];
  const cw = (W - 2 * Pd) / 3;
  x.fillStyle = t.line; x.fillRect(Pd, 820, W - 2 * Pd, 2);
  items.forEach(([v, lab], k) => {
    const X = Pd + k * cw + (k ? 36 : 0);
    if (k) { x.fillStyle = t.line; x.fillRect(Pd + k * cw, 860, 2, 170); }
    x.fillStyle = t.fg; fitLine(x, String(v), F.disp, "", cw - 60, 110, 50); x.fillText(String(v), X, 960);
    eyebrow(x, lab, X, 1010, t.accent, 18);
  });
  x.fillStyle = t.line; x.fillRect(Pd, 1070, W - 2 * Pd, 2);
  eyebrow(x, "SGA × Bissell Library × Maker's Society", Pd, 1126, t.soft, 20);
  eyebrow(x, "Anatolia American University", W - Pd, 1126, t.soft, 20, "right");
}

export function liText(li, st, people) {
  const named = (kind) => people.filter((p) => p.kind === kind && p.name.trim());
  const team = named("team"), adv = named("advisor");
  const L = [li.opener, "", `In the first ${st.days} days:`, `· ${st.coffees} coffees served`, `· ${st.students} students registered`,
    `· ${st.flavours} flavours in rotation`, "", li.story, "",
    "This was a joint project of the Student Government Association and the Maker's Society, hosted by the Bissell Library at Anatolia American University. Thank you to everyone who made it happen:", ""];
  if (team.length) { L.push("Project team"); team.forEach((p) => L.push(`${p.name} — ${p.role}`)); L.push(""); }
  if (adv.length) { L.push("Advisors"); adv.forEach((p) => L.push(`${p.name} — ${p.role}`)); L.push(""); }
  if (people.some((p) => p.kind === "host") && li.host) L.push(li.host, "");
  if (li.next) L.push(li.next, "");
  L.push(li.tags);
  return fillNumbers(L.join("\n"), st).trim();
}

export function render(root, mk) {
  const { ws, toast } = mk;
  const canvas = h("canvas.preview", { width: 1200, height: 1200, "aria-label": "LinkedIn image preview" });
  const post = outputBox("Post text", 18, toast);
  const drawImg = scheduler(() => drawLi(canvas, ws.doc("linkedin"), stats(ws)));
  const text = () => post.set(liText(ws.doc("linkedin"), stats(ws), roster(ws)), 3000);
  const both = () => { drawImg(); text(); };
  const f = (key, opts) => bound(mk, "linkedin", key, { ...opts, onInput: both });

  root.append(
    h("header.head", {}, h("div.eyebrow", {}, "LinkedIn · post after one month"), h("h1", {}, "One month of the Coffee Space"),
      h("p", {}, "The post pulls names and roles from the team list and numbers from Launch numbers on the Overview. On LinkedIn, type @ before each name so people get tagged.")),
    h("div.editor", {},
      h("div.stage", {}, canvas,
        h("div.row", {}, h("button.btn", { type: "button", onclick: async () => saveBlob("coffee-space-one-month.png", await toBlob(canvas)) }, "Download image")),
        post.el),
      h("div.panel", {},
        h("h3", {}, "Image"),
        h("div.two", {}, f("imgTitle", { label: "Big line" }), f("imgSub", { label: "Under it" })),
        h("h3", {}, "Post copy"),
        f("opener", { label: "Opening", rows: 3 }),
        f("story", { label: "The story", rows: 4 }),
        f("host", { label: "Library thank-you", rows: 2 }),
        f("next", { label: "What's next", rows: 2 }),
        f("tags", { label: "Hashtags" }),
        h("p.note", {}, "Add or rename people on the Overview tab. Anyone with no credited role is left out."))));
  both();
  return mk.onChange(both);
}
