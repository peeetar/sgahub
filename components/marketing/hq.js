// Marketing HQ: six tools, each document saved to the Hub with a version,
// canvases drawn in the browser, nothing image-shaped stored.
import { api } from "./api.js";
import { fill, h } from "./dom.js";
import { busy, chip, empty, field, segmented, sheet } from "./ui.js";
import { fontsReady } from "./shared.js";
import { LEGACY_DEVTOOLS_HINT, legacyBlob, openWorkspace } from "./store.js";
import * as announce from "./announce.js";
import * as cv from "./cv.js";
import * as flavour from "./flavour.js";
import * as howto from "./howto.js";
import * as linkedin from "./linkedin.js";
import * as overview from "./overview.js";

const MODULES = { overview, announce, flavour, howto, linkedin, cv };

const SUBS = [
  ["overview", "Overview", "Charter, team, sign-offs"],
  ["announce", "Announcement", "Instagram · 1080×1350"],
  ["flavour", "Flavour drop", "Instagram · capsule PNG"],
  ["howto", "How-to carousel", "Instagram · multi-slide"],
  ["linkedin", "One-month post", "LinkedIn · text + image"],
  ["cv", "CV kit", "Entries to send the team"],
];

const STATUS_WORDS = { saved: ["Saved", "ok"], unsaved: ["Unsaved changes", "warn"], saving: ["Saving…", "neutral"],
  conflict: ["Someone else saved first", "warn"], error: ["Couldn’t save", "bad"] };

export async function render(view, ctx) {
  const { toast } = ctx;
  const shell = h("div.mk");
  view.append(shell);

  let ws;
  try {
    ws = await openWorkspace({ api, toast, onStatus: showStatus, onReload: () => show(current) });
  } catch (err) {
    fill(shell, empty("Couldn’t open Marketing HQ.", err.message));
    return;
  }

  const statusChip = h("span");
  const body = h("div.mk");
  const asked = location.hash.replace(/^#/, "");
  let current = SUBS.some(([id]) => id === asked) ? asked : SUBS[0][0];
  let cleanup = null, shownToken = 0;
  const listeners = new Set();

  function showStatus(state) {
    const [text, kind] = STATUS_WORDS[state] || STATUS_WORDS.saved;
    statusChip.replaceChildren(chip(text, kind));
  }

  const nav = segmented(SUBS.map(([id, title]) => [id, title]), current, (id) => go(id), "Tool");
  const bar = h("div.mk-bar", {}, nav, h("div.tools", {}, statusChip,
    h("button.btn.small.ghost", { type: "button", onclick: importSheet }, "Import")));
  fill(shell, bar, h("p.mk-sub", {}, SUBS.find(([id]) => id === current)[2]), body);

  // What the tools can tell each other: the roster or the numbers changed.
  const mk = {
    ws, ctx, toast, go, refresh: () => show(current),
    changed: (what) => listeners.forEach((fn) => fn(what)),
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };

  async function show(id) {
    const token = ++shownToken;
    if (cleanup) { try { cleanup(); } catch { /* the old tool is gone anyway */ } cleanup = null; }
    listeners.clear();
    fill(body);
    current = id;
    await fontsReady();
    if (token !== shownToken) return;
    cleanup = MODULES[id].render(body, mk) || null;
    shell.querySelector(".mk-sub").textContent = SUBS.find(([sid]) => sid === id)[2];
  }

  function go(id) {
    try { history.pushState(null, "", `#${id}`); } catch { /* the hash is a convenience */ }
    for (const b of nav.children) b.setAttribute("aria-pressed", String(b.dataset.key === id));
    show(id);
  }

  // --- bring people and old drafts in ----------------------------------------------------
  function importSheet() {
    const old = legacyBlob();
    const area = h("textarea", { placeholder: "Paste the JSON here", spellcheck: "false" });
    if (old) area.value = old;
    const file = h("input", { type: "file", accept: ".json,application/json" });
    const overwrite = h("input", { type: "checkbox" });
    const result = h("div.stack");
    const preview = h("button.btn", { type: "button" }, "Preview");
    const apply = h("button.btn", { type: "button", disabled: true }, "Import");
    file.addEventListener("change", async () => { if (file.files[0]) area.value = await file.files[0].text(); });

    async function run(applyIt) {
      const res = await api("marketing/import", { method: "POST", body: { data: area.value, apply: applyIt, overwrite: overwrite.checked } });
      if (!applyIt) {
        fill(result, h("p", {}, "This would write: ", h("b", {}, Object.keys(res.docs).join(", ") || "nothing")),
          res.existing.length ? h("p.note", {}, `Already saved, so skipped unless you tick overwrite: ${res.existing.join(", ")}`) : null,
          ...res.notes.map((n) => h("p.note", {}, n)));
        apply.disabled = !Object.keys(res.docs).length;
        return;
      }
      await ws.reloadAll();
      toast(`Imported ${res.written.length} tool${res.written.length === 1 ? "" : "s"}.`);
      panel.close();
      show(current);
    }
    preview.addEventListener("click", () => busy(preview, run(false)).catch((e) => toast(e.message)));
    apply.addEventListener("click", () => busy(apply, run(true)).catch((e) => toast(e.message)));

    const panel = sheet("Import", h("div.stack.mk-import", {},
      h("p.note", {}, "Choose the people file, or paste drafts from the old single-file tool. Those were saved in that browser tab: open the old file, press F12, choose Console, run ",
        h("code", {}, LEGACY_DEVTOOLS_HINT), " and paste the result here."),
      area, field("Or choose a file", file),
      h("label.check", {}, overwrite, " Overwrite tools that already have saved content"),
      h("div.row", {}, preview, apply), result));
  }

  const onLeave = (e) => { if (ws.status === "unsaved" || ws.status === "saving") { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", onLeave);
  showStatus("saved");
  await show(current);

  return () => {
    window.removeEventListener("beforeunload", onLeave);
    shownToken++;
    if (cleanup) { try { cleanup(); } catch { /* leaving anyway */ } }
    ws.flush().finally(() => ws.dispose());
  };
}
