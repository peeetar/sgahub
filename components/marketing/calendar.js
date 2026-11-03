// Content calendar: what goes out when, who owns it, and the posts the machine's
// own numbers suggest. A month grid on a desk, an agenda on a phone. The morning
// reminder is /api/calendar/remind, on a Vercel cron.
import { api } from "./api.js";
import { fill, h } from "./dom.js";
import { busy, chip, confirmDialog, empty, field, segmented, sheet } from "./ui.js";

const STATUS_KIND = { idea: "neutral", draft: "warn", ready: "ok", posted: "ok" };
const CHANNELS = ["LinkedIn", "Instagram", "Social", "Poster", "Email"];
const TOOL_NAMES = { overview: "Overview", announce: "Announcement", flavour: "Flavour drop", howto: "How-to carousel", linkedin: "One-month post", cv: "CV kit" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s) => new Date(`${s}T00:00:00`);

export async function render(view, ctx) {
  const { toast } = ctx;
  const root = h("div.cal");
  view.append(root);

  let mode = "month";                        // month | list
  let cursor = new Date(); cursor.setDate(1); cursor.setHours(0, 0, 0, 0);
  let data = null, generation = 0;

  function range() {
    if (mode === "list") {
      const from = new Date(); from.setDate(from.getDate() - 7);
      const to = new Date(); to.setDate(to.getDate() + 90);
      return [iso(from), iso(to)];
    }
    const first = new Date(cursor);
    first.setDate(1 - ((first.getDay() + 6) % 7));                // back to the Monday
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    last.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));   // on to the Sunday
    return [iso(first), iso(last)];
  }

  async function load() {
    const mine = ++generation;
    const [from, to] = range();
    try {
      const res = await api(`calendar?from=${from}&to=${to}`);
      if (mine !== generation) return;
      data = res;
      draw();
    } catch (err) {
      if (mine === generation) fill(root, empty("Couldn’t load the calendar.", err.message));
    }
  }

  // --- the editor ---------------------------------------------------------------------
  function editor(row) {
    const isNew = !row.id;
    const date = h("input", { type: "date", value: row.date || iso(new Date()), required: true });
    const channel = h("input", { type: "text", value: row.channel || "", list: "cal-channels", maxlength: "40", required: true, placeholder: "LinkedIn, Instagram…" });
    const title = h("input", { type: "text", value: row.title || "", maxlength: "120", required: true });
    const status = h("select", {}, ...data.statuses.map((s) => h("option", { value: s, selected: s === (row.status || "idea") }, s)));
    const owner = h("select", {}, h("option", { value: "" }, "Nobody yet"),
      ...data.owners.map((o) => h("option", { value: o.email, selected: o.email === row.owner }, o.name)));
    const tool = h("select", {}, h("option", { value: "" }, "—"),
      ...data.tools.filter((t) => t !== "overview").map((t) => h("option", { value: t, selected: t === row.tool }, TOOL_NAMES[t] || t)));
    const notes = h("textarea", { rows: "4", maxlength: "1000" });
    notes.value = row.notes || "";
    const open = h("a.small", { href: "/marketing", style: "font-weight:600" }, "Open in Marketing HQ →");
    const syncOpen = () => { open.hidden = !tool.value; open.href = `/marketing#${tool.value}`; };
    tool.addEventListener("change", syncOpen); syncOpen();
    const save = h("button.btn", { type: "submit" }, isNew ? "Add to calendar" : "Save");
    const remove = isNew ? null : h("button.btn.ghost.danger", { type: "button", onclick: async () => {
      if (!(await confirmDialog({ title: "Delete this entry?", body: row.title, confirm: "Delete", danger: true }))) return;
      try { await api(`calendar/${row.id}`, { method: "DELETE" }); panel.close(); toast("Deleted."); load(); } catch (err) { toast(err.message); }
    } }, "Delete");

    const form = h("form.stack", {},
      h("datalist", { id: "cal-channels" }, ...CHANNELS.map((c) => h("option", { value: c }))),
      field("Title", title), h("div.two", {}, field("Date", date), field("Channel", channel)),
      h("div.two", {}, field("Status", status), field("Owner", owner)),
      field("Asset made in", tool), open, field("Notes", notes),
      h("div.row.end", {}, remove, save));
    const panel = sheet(isNew ? "New entry" : "Edit entry", form);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = { date: date.value, channel: channel.value, title: title.value, status: status.value,
        owner: owner.value || null, tool: tool.value || null, notes: notes.value };
      if (row.source) body.source = row.source;
      try {
        await busy(save, api(isNew ? "calendar" : `calendar/${row.id}`, { method: isNew ? "POST" : "PUT", body }));
        panel.close(); toast(isNew ? "Added." : "Saved."); load();
      } catch (err) { toast(err.message); }
    });
    title.focus();
  }

  // --- pieces ---------------------------------------------------------------------------
  const ownerName = (email) => data.owners.find((o) => o.email === email)?.name || email;
  const itemButton = (r) => h("button.item", { type: "button", class: `item ${r.status}`, title: `${r.title} · ${r.channel} · ${r.status}`, onclick: () => editor(r) },
    r.title);

  function suggestions() {
    if (!data.suggestions.length) return null;
    return h("section.stack", {}, h("h2.section-title", {}, "Worth a post"),
      h("div.suggest", {}, ...data.suggestions.map((s) => h("div.card", {},
        h("b", {}, s.title), h("span.small.muted", {}, `${s.why} · ${s.date}`),
        h("div.row", {}, chip(s.channel), s.tool ? chip(TOOL_NAMES[s.tool] || s.tool) : null,
          h("span", { style: "flex:1" }),
          h("button.btn.small", { type: "button", onclick: () => editor({ date: s.date, channel: s.channel, title: s.title, status: "idea", tool: s.tool, source: s.key }) }, "Add to calendar"))))));
  }

  function agenda(rows, extraClass = "") {
    if (!rows.length) return h(`div${extraClass}`, {}, empty("Nothing planned.", "Add an entry, or take one of the suggestions above."));
    return h(`ul.timeline${extraClass}`, {}, ...rows.map((r) => h("li", { style: "grid-template-columns: 96px minmax(0,1fr) auto" },
      h("span.mono.small", {}, parse(r.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })),
      h("div", {}, h("button.linkish", { type: "button", onclick: () => editor(r), style: "font-weight:600;text-align:left" }, r.title),
        h("div.small.muted", {}, [r.channel, r.owner ? ownerName(r.owner) : null].filter(Boolean).join(" · "))),
      chip(r.status, STATUS_KIND[r.status]))));
  }

  function monthGrid() {
    const [from] = range();
    const start = parse(from), today = iso(new Date());
    const byDay = {};
    data.rows.forEach((r) => (byDay[r.date] ||= []).push(r));
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      if (i === 35 && d.getMonth() !== cursor.getMonth()) break;   // no empty sixth row
      const key = iso(d);
      cells.push(h("div.day", { class: `day${d.getMonth() !== cursor.getMonth() ? " out" : ""}${key === today ? " today" : ""}` },
        h("button.linkish.n", { type: "button", "aria-label": `Add an entry on ${key}`, onclick: () => editor({ date: key }) }, d.getDate()),
        ...(byDay[key] || []).map(itemButton)));
    }
    return h("div.month", {}, ...DOW.map((n) => h("div.dow", {}, n)), ...cells);
  }

  function draw() {
    const nav = mode === "month" ? h("div.row", {},
      h("button.btn.small.ghost", { type: "button", "aria-label": "Previous month", onclick: () => { cursor.setMonth(cursor.getMonth() - 1); load(); } }, "←"),
      h("b", { style: "min-width:9ch;text-align:center" }, `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`),
      h("button.btn.small.ghost", { type: "button", "aria-label": "Next month", onclick: () => { cursor.setMonth(cursor.getMonth() + 1); load(); } }, "→"),
      h("button.btn.small.ghost", { type: "button", onclick: () => { cursor = new Date(); cursor.setDate(1); cursor.setHours(0, 0, 0, 0); load(); } }, "Today")) : null;
    const rows = mode === "month" ? data.rows.filter((r) => parse(r.date).getMonth() === cursor.getMonth()) : data.rows;
    fill(root,
      h("div.mk-bar", {},
        h("div.row", {}, segmented([["month", "Month"], ["list", "List"]], mode, (k) => { mode = k; load(); }, "View"), nav),
        h("button.btn", { type: "button", onclick: () => editor({}) }, "Add entry")),
      suggestions(),
      mode === "month" ? h("div.stack", {}, monthGrid(), agenda(rows, ".agenda-only")) : agenda(rows));
  }

  await load();
}
