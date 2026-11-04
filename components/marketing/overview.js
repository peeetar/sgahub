// Overview: the charter, key dates, sign-offs, launch numbers and the one
// team list every other tool reads.
import { fill, h } from "./dom.js";
import { chip, field, sheet } from "./ui.js";
import { KINDS, creditOf, suggestedTitle } from "./people.js";

const CHECKS = [
  ["board", "SGA board approves the ~€475 proposal"],
  ["adv", "SGA advisor's sign-off"],
  ["makers", "Maker's Society funding approved"],
  ["lib", "Bissell Library hosting confirmed"],
  ["water", "Water supply confirmed (Hellas Spring quote)"],
  ["titles", "Every credited person has confirmed their title"],
  ["counts", "Launch numbers pulled from the kiosk database"],
];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const STAT_FIELDS = [["coffees", "Coffees served", "coffees_served"], ["students", "Students registered", "students_registered"],
  ["flavours", "Flavours", "flavours_offered"], ["days", "Days running", "days_running"]];

const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
function relWords(diff) {
  if (diff > 1) return `in ${diff} days`;
  if (diff === 1) return "tomorrow";
  if (diff === 0) return "today";
  return diff === -1 ? "yesterday" : `${-diff} days ago`;
}

export function render(root, mk) {
  const { ws, toast, go } = mk;
  const doc = () => ws.doc("overview");
  const touch = () => ws.touch("overview");

  const status = h("span.chip");
  const timelineList = h("ul.timeline.tl");
  const rosterBox = h("div.roster");
  const statBox = h("div.statgrid");

  function renderTimeline() {
    const today = dayStart(new Date());
    fill(timelineList, ...doc().timeline.map((e) => {
      const dt = e.date ? new Date(`${e.date}T00:00:00`) : null;
      const when = dt ? relWords(Math.round((dt - today) / 864e5)) : "no date yet";
      return h("li", {},
        dt ? h("div.d", {}, dt.getDate(), h("small", {}, MONTHS[dt.getMonth()])) : h("div.d", {}, "–"),
        h("div", {}, h("b", {}, e.title), h("div.rel", {}, `${e.note} · ${when}`),
          h("a", { href: `#${e.tool}`, onclick: (ev) => { ev.preventDefault(); go(e.tool); } }, `${e.cta} →`)));
    }));
    const launch = doc().timeline.find((e) => e.tool === "howto") || doc().timeline[0];
    if (!launch?.date) { status.textContent = "Launch date not set"; status.className = "chip warn"; return; }
    const d = Math.round((dayStart(`${launch.date}T00:00:00`) - today) / 864e5);
    status.textContent = d > 0 ? `${d} days to launch` : `Live · day ${1 - d}`;
    status.className = `chip ${d > 0 ? "warn" : "ok"}`;
  }

  function editDates() {
    const rows = doc().timeline.map((e) => ({
      e, date: h("input", { type: "date", value: e.date }), title: h("input", { type: "text", value: e.title, maxlength: "80" }),
    }));
    const save = h("button.btn", { type: "submit" }, "Save");
    const form = h("form.stack", {}, ...rows.map((r) => h("div.two", {}, field("Event", r.title), field("Date", r.date))),
      h("div.row.end", {}, save));
    const panel = sheet("Key dates", form);
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      rows.forEach((r) => { r.e.date = r.date.value; r.e.title = r.title.value.trim() || r.e.title; });
      touch(); renderTimeline(); panel.close();
    });
  }

  // --- launch numbers: live, with a typed override per field -------------------
  function renderStats() {
    const over = doc().stats_override || (doc().stats_override = {});
    fill(statBox, ...STAT_FIELDS.map(([key, label, liveKey]) => {
      const live = ws.launch[liveKey];
      const input = h("input", { type: "text", value: over[key] || "", placeholder: String(live), maxlength: "12", "aria-label": label });
      const src = h("span.src", {});
      const mark = () => { const typed = input.value.trim() !== ""; src.replaceChildren(chip(typed ? "Typed in" : "Live", typed ? "warn" : "ok")); };
      input.addEventListener("input", () => {
        const v = input.value.trim();
        if (v) over[key] = v; else delete over[key];
        mark(); touch(); mk.changed("stats");
      });
      mark();
      return h("label.f", {}, h("span", {}, label), input, src);
    }));
  }

  // --- team and credited roles ------------------------------------------------------
  function saveCredit(person, patch) {
    const credits = doc().credits || (doc().credits = {});
    credits[person.id] = { ...credits[person.id], ...patch };
    touch();
    mk.changed("roster");
  }

  function adminRow(a) {
    const credit = creditOf(ws, a.id);
    const role = h("input", { type: "text", value: credit.credited_role || "", maxlength: "60", "aria-label": `Credited role for ${a.name}`,
      placeholder: suggestedTitle(ws, a) || "Not credited" });
    const grp = h("select", { "aria-label": `Group for ${a.name}` }, h("option", { value: "" }, "—"),
      ...ws.groups.map((g) => h("option", { value: g, selected: g === credit.grp }, g)));
    role.addEventListener("change", () => saveCredit(a, { credited_role: role.value.trim() }));
    grp.addEventListener("change", () => saveCredit(a, { grp: grp.value }));
    return h("div.rrow", {}, h("div.who", {}, a.name, h("small", {}, credit.credited_role ? "Credited" : "Not credited")), role, grp, h("span"));
  }

  function extraRow(p, i) {
    const list = doc().people;
    const name = h("input", { type: "text", value: p.name, maxlength: "60", "aria-label": "Name" });
    const role = h("input", { type: "text", value: p.role, maxlength: "60", "aria-label": "Role" });
    const kind = h("select", { "aria-label": "Group" }, ...KINDS.map(([v, l]) => h("option", { value: v, selected: v === p.kind }, l)));
    const edit = () => { p.name = name.value; p.role = role.value; p.kind = kind.value; touch(); mk.changed("roster"); };
    [name, role].forEach((el) => el.addEventListener("input", edit));
    kind.addEventListener("change", edit);
    return h("div.rrow", {}, name, role, kind,
      h("button.x", { type: "button", title: "Remove", "aria-label": `Remove ${p.name || "this person"}`,
        onclick: () => { list.splice(i, 1); touch(); mk.changed("roster"); renderRoster(); } }, "×"));
  }

  function renderRoster() {
    fill(rosterBox,
      h("div.rrow.rhead", {}, h("span", {}, "Name"), h("span", {}, "Credited role"), h("span", {}, "Group"), h("span")),
      ...ws.team.map(adminRow),
      doc().people.length ? h("p.note", {}, "Credited, but not on the People page:") : null,
      ...doc().people.map(extraRow));
  }

  function useSuggested() {
    const todo = ws.team.filter((a) => !creditOf(ws, a.id).credited_role && suggestedTitle(ws, a));
    if (!todo.length) { toast("Everyone with a suggestion already has a title."); return; }
    todo.forEach((a) => saveCredit(a, { credited_role: suggestedTitle(ws, a) }));
    renderRoster();
    toast(`Filled ${todo.length} title${todo.length === 1 ? "" : "s"}. Confirm each one with the person.`);
  }

  const prices = ws.bundles.map((b) => `${b.coffees} for €${b.cents / 100}`).join(" · ");
  const suggestedBtn = h("button.btn.small.ghost", { type: "button", onclick: useSuggested }, "Use suggested titles");

  root.append(
    h("div.hero", {},
      h("div.card.charter", {},
        h("div.row", {}, h("span.eyebrow", {}, "Project charter · 2026–27"), status),
        h("h2", {}, "SGA Coffee Space"),
        h("p", { style: "margin:0;max-width:60ch" }, "A student-built, self-service capsule coffee kiosk at the Bissell Library. Students top up prepaid credit, sign in on a touchscreen kiosk with their student ID and PIN, and the dispenser releases the capsule they chose."),
        h("dl", {},
          h("dt", {}, "Run by"), h("dd", {}, "Student Government Association"),
          h("dt", {}, "Built with"), h("dd", {}, "Maker's Society (mechatronics, 3D printing, electronics)"),
          h("dt", {}, "Hosted by"), h("dd", {}, "Bissell Library, Anatolia American University"),
          h("dt", {}, "Pricing"), h("dd", {}, prices || "—"),
          h("dt", {}, "Top up at"), h("dd", {}, "SGA events · SGA office, C Hall basement · DM @act_studentgov"),
          h("dt", {}, "Hardware"), h("dd", {}, "6-column PETG dispenser, SG90 servos, Raspberry Pi + 11″ touchscreen, Nespresso Inissia"))),
      h("div.card.stack", {},
        h("div.row", {}, h("span.eyebrow", { style: "flex:1" }, "Key dates and what to post"),
          h("button.btn.small.ghost", { type: "button", onclick: editDates }, "Edit dates")),
        timelineList)),
    h("div.grid2", {},
      h("div.panel", {},
        h("h3", {}, "Sign-offs that make it official"),
        h("div.checks", {}, ...CHECKS.map(([key, label]) => {
          const box = h("input", { type: "checkbox", checked: !!doc().check[key] });
          box.addEventListener("change", () => { doc().check[key] = box.checked; touch(); });
          return h("label", {}, box, h("span", {}, label));
        })),
        h("p.note", {}, "Get each approval in writing (an email is enough) and keep it under Documents. That paper trail is what lets people list this on a CV with confidence.")),
      h("div.panel", {},
        h("h3", {}, "Launch numbers"),
        h("p.note", {}, ws.piOk ? "Counted from the kiosk. Type over one to use your own (“300+” is fine). Only real numbers: an invented figure is not."
          : "The kiosk isn't reachable right now, so these are the last numbers it gave. Type over one if you know better."),
        statBox)),
    h("div.panel", {},
      h("div.row", { style: "justify-content:space-between" }, h("h3", {}, "Team and credited roles"),
        h("div.row", {}, suggestedBtn,
          h("button.btn.small.ghost", { type: "button", onclick: () => {
            doc().people.push({ id: `p${Date.now().toString(36)}`, name: "", role: "", kind: "advisor" });
            touch(); renderRoster(); rosterBox.querySelector(".rrow:last-child input")?.focus();
          } }, "+ Add credited person"))),
      h("p.note", {}, "One list feeds the LinkedIn thank-you and the CV kit. Titles here are what people will put on their CVs, so confirm each one with the person before posting. Empty role = not credited. The team comes from the People page."),
      rosterBox));

  renderTimeline(); renderStats(); renderRoster();
}
