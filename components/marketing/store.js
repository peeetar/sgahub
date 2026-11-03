// The Marketing HQ workspace: the six documents, loaded once, edited in
// memory and saved to the Hub with a version so two people can't silently
// overwrite each other. This repo is public: anything naming a person lives in
// the documents, never in the defaults below.
import { ApiError } from "./api.js";
import { confirmDialog, relative } from "./ui.js";

export const TOOLS = ["overview", "announce", "flavour", "howto", "linkedin", "cv"];
const SAVE_AFTER_MS = 1500;
const LEGACY_KEY = "sga-coffee-space-v1";

// The prices come from the machine's real bundles, never typed in.
export function priceLines(bundles) {
  const lines = bundles.map((b) => `${b.coffees} for €${b.cents / 100}`);
  return lines.length ? lines : ["Ask the SGA for prices"];
}

export function defaults(tool, { bundles = [] } = {}) {
  const prices = priceLines(bundles);
  const priceText = prices.join(" · ");
  switch (tool) {
    case "overview": return {
      stats_override: {}, check: { lib: true }, people: [], credits: {}, suggested: {},
      timeline: [
        { date: "", title: "Announce the opening", note: "Say when and where, and mention the free coffee hour.", tool: "announce", cta: "Post the announcement" },
        { date: "2026-11-09", title: "Opening day at the Bissell Library", note: "Dispenser live. Free coffee hour, 2–3 pm.", tool: "howto", cta: "Post the how-to carousel" },
        { date: "2026-11-16", title: "First flavour spotlight", note: "One flavour a week keeps the account active.", tool: "flavour", cta: "Make a flavour drop" },
        { date: "2026-12-09", title: "One month running", note: "Count the numbers, thank the team.", tool: "linkedin", cta: "Write the LinkedIn post" },
      ],
    };
    case "announce": return {
      theme: "burgundy", eyebrow: "SGA × Bissell Library × Maker's Society", headline: "Coffee is coming to the library.",
      body: "The SGA Coffee Space opens at the Bissell Library: a student-built capsule dispenser with prepaid credit. Free coffee on opening day, 2–3 pm. Sign in with your student ID, pick a flavour and brew.",
      dateLabel: "Opens", date: "9 November", prices: prices.join("\n"), handle: "@act_studentgov",
      caption: `The SGA Coffee Space opens on 9 November at the Bissell Library, with free coffee from 2 to 3 pm.\n\nA dispenser designed and 3D printed on campus by the Maker's Society, and prepaid credit you top up with the SGA.\n\n${priceText}\nTop up at SGA events, at the SGA office (C Hall basement), or DM us here.\n\nA project by the Student Government Association with the Maker's Society, hosted by the Bissell Library.\n\n#AnatoliaAmericanUniversity #SGACoffeeSpace`,
    };
    case "flavour": return {
      bg: "#C8914A", eyebrow: "New flavour", name: "Vanilla", notes: "Sweet, smooth and mellow, with a soft vanilla finish",
      intensity: 6, avail: "Now in the dispenser", scale: 100, sku: null,
    };
    case "howto": return {
      theme: "burgundy", slides: [
        { t: "How to get your coffee", b: "Five steps at the SGA Coffee Space, Bissell Library." },
        { t: "Top up your credit", b: `Pay cash at any SGA event, at the SGA office in the C Hall basement, or DM @act_studentgov and a member will top you up on campus.\n${priceText}` },
        { t: "Sign in at the kiosk", b: "Tap the screen and enter your student ID and PIN. Your balance shows at the top." },
        { t: "Pick your flavour", b: "Choose a flavour. The dispenser drops your capsule from its column." },
        { t: "Brew it", b: "Take a cup, put the capsule in the Nespresso machine and press the button. Lids and creamer are on the shelf." },
        { t: "Leave it tidy", b: "Used capsule goes in the capsule bin. Wipe any spills. The library hosts us, so we keep it clean." },
        { t: "Questions?", b: "DM us or find us at the SGA office. Enjoy your coffee." },
      ],
    };
    case "linkedin": return {
      imgTitle: "1 month", imgSub: "of the SGA Coffee Space at the Bissell Library",
      opener: "One month ago we opened the SGA Coffee Space at the Bissell Library, and it has been running every day since.",
      story: "What started as an idea at an SGA meeting became a real piece of campus infrastructure: a six-column capsule dispenser, 3D printed in PETG and driven by servos, with a Raspberry Pi touchscreen kiosk and prepaid student credit. It was designed and built on campus by students.",
      host: "A big thank you to the Bissell Library for hosting us and trusting students to run a service in their space.",
      next: "Next up: more flavours, the last two dispenser columns, and sharing the design with other student groups.",
      tags: "#AnatoliaAmericanUniversity #StudentGovernment #MakerSpace #3DPrinting #RaspberryPi #StudentLeadership",
    };
    case "cv": return { people: {}, location: "Thessaloniki, Greece", sender_name: "", sender_title: "SGA President" };
    default: return {};
  }
}

// Like the old tool: saved objects merge over the defaults one level deep
// (so a field added later still gets its default); arrays and primitives
// are replaced whole.
export function merge(base, saved) {
  if (!saved || typeof saved !== "object") return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(saved)) {
    const plain = (o) => o && typeof o === "object" && !Array.isArray(o);
    out[k] = plain(base[k]) && plain(v) ? { ...base[k], ...v } : v;
  }
  return out;
}

export async function openWorkspace({ api, toast, onStatus = () => {}, onReload = () => {} }) {
  const loaded = await api("marketing/workspace");
  const { bundles, launch, pi_ok: piOk, groups } = loaded;
  const docs = {}, versions = {}, dirty = new Set(), timers = {};
  let status = "saved", saving = Promise.resolve(), disposed = false;
  const meta = {};
  TOOLS.forEach((tool) => {
    docs[tool] = merge(defaults(tool, { bundles }), loaded.docs[tool].doc);
    versions[tool] = loaded.docs[tool].version;
    meta[tool] = loaded.docs[tool];
  });

  function setStatus(next) { status = next; onStatus(next); }

  async function saveTool(tool) {
    if (!dirty.has(tool)) return;
    dirty.delete(tool);
    setStatus("saving");
    try {
      const res = await api(`marketing/docs/${tool}`, { method: "PUT", body: { doc: docs[tool], version: versions[tool] } });
      versions[tool] = res.version;
      meta[tool] = res;
      if (dirty.has(tool)) schedule(tool);
      else if (!dirty.size) setStatus("saved");
    } catch (err) {
      if (err instanceof ApiError && err.code === "conflict") await conflict(tool, err.data);
      else { dirty.add(tool); setStatus("error"); toast(err.message); }
    }
  }

  async function conflict(tool, theirs) {
    setStatus("conflict");
    const who = theirs.updated_by_name || "Someone";
    const overwrite = await confirmDialog({
      title: `${who} changed this ${theirs.updated_at ? relative(theirs.updated_at) : "just now"}`,
      body: "Overwrite with what you have, or reload their version? Reloading drops your unsaved edits here.",
      confirm: "Overwrite with mine",
    });
    versions[tool] = theirs.version;
    if (overwrite) { dirty.add(tool); await saveTool(tool); return; }
    docs[tool] = merge(defaults(tool, { bundles }), theirs.doc);
    meta[tool] = theirs;
    if (!dirty.size) setStatus("saved");
    onReload(tool);
  }

  function schedule(tool) {
    clearTimeout(timers[tool]);
    timers[tool] = setTimeout(() => { saving = saving.then(() => saveTool(tool)); }, SAVE_AFTER_MS);
  }

  return {
    bundles, launch, piOk, groups,
    team: loaded.team,
    get status() { return status; },
    doc: (tool) => docs[tool],
    meta: (tool) => meta[tool],
    /** Call after changing docs[tool]. */
    touch(tool) { if (disposed) return; dirty.add(tool); setStatus("unsaved"); schedule(tool); },
    /** Save whatever is waiting, now. */
    async flush() {
      for (const tool of [...dirty]) { clearTimeout(timers[tool]); saving = saving.then(() => saveTool(tool)); }
      await saving;
    },
    /** Load everything again (after an import). */
    async reloadAll() {
      const res = await api("marketing/workspace");
      TOOLS.forEach((tool) => {
        docs[tool] = merge(defaults(tool, { bundles }), res.docs[tool].doc);
        versions[tool] = res.docs[tool].version;
        meta[tool] = res.docs[tool];
      });
      this.team = res.team;
    },
    isFresh: () => TOOLS.every((t) => versions[t] === 0),
    dispose() { disposed = true; Object.values(timers).forEach(clearTimeout); },
  };
}

// The old tool's browser data, if this origin happens to hold any.
export function legacyBlob() {
  try { return localStorage.getItem(LEGACY_KEY); } catch { return null; }
}
export const LEGACY_DEVTOOLS_HINT = `copy(localStorage['${LEGACY_KEY}'])`;
