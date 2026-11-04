// CV kit: a ready-to-paste CV entry, the LinkedIn fields and a message to
// send each contributor. Bullets fill {coffees} {students} {flavours} {days}
// from the launch numbers.
import { h } from "./dom.js";
import { field } from "./ui.js";
import { cvPeople, fillNumbers, roster, stats } from "./people.js";
import { outputBox } from "./shared.js";

export function build(p, st, cv) {
  const bl = fillNumbers(p.bullets, st).split("\n").map((s) => s.trim()).filter(Boolean);
  const dot = bl.map((b) => `• ${b}`).join("\n");
  const entry = `${p.role} | SGA Coffee Space\n${p.org} · ${cv.location}\n${p.start} – ${p.end}\n${dot}`;
  const section = p.kind === "advisor" ? "Volunteer experience or Projects" : "Projects (associated with Anatolia American University) or Volunteer experience";
  const li = `Title: ${p.role}\nProject / Organisation: SGA Coffee Space — ${p.org}\nSection: ${section}\nDates: ${p.start} – ${p.end}\nLocation: ${cv.location}\n\nDescription:\n${dot}\n\nSkills: ${p.skills}\nMedia: link the SGA one-month LinkedIn post`;
  const first = p.name.replace(/^Dr\.?\s+/, "").split(" ")[0];
  const parts = p.name.split(" ");
  const greeting = p.name.startsWith("Dr") ? `${parts[0]} ${parts[parts.length - 1]}` : first;
  const sign = [cv.sender_name, cv.sender_title].filter(Boolean).join("\n");
  const msg = p.kind === "advisor"
    ? `Dear ${greeting},\n\nThe SGA Coffee Space has now been running for a month, and we have credited you as ${p.role} in our announcement. Thank you for your support throughout the project.\n\nIn case it is useful for your records or service reporting, here is a short description of your role:\n\n${entry}\n\nPlease let me know if you would like the title or wording changed.\n\nBest regards,\n${sign}`
    : `Hi ${first}!\n\nThe SGA Coffee Space has been running for a month, and your work on it belongs on your CV. Here is a suggested entry. Use it as is or adjust it:\n\n${entry}\n\nHow to add it:\n• CV: under Projects or Leadership & Activities (or Experience if you don't have much there yet)\n• LinkedIn: Projects (associated with Anatolia American University) or Volunteer experience, title “${p.role}”, and link our one-month post in Media\n• Skills to add: ${p.skills}\n\nKeep the title exactly as it is above so it matches the post. If anyone ever needs your role confirmed, point them to me.\n\nThank you for everything,\n${cv.sender_name || ""}`;
  return { entry, li, msg };
}

export function render(root, mk) {
  const { ws, toast } = mk;
  const cvDoc = () => ws.doc("cv");
  let selKey = null;
  const people = () => cvPeople(roster(ws));
  const current = () => people().find((p) => p.key === selKey) || people()[0];

  const picker = h("div.people");
  const who = h("h3");
  const entry = outputBox("CV entry", 9, toast), li = outputBox("LinkedIn fields", 10, toast), msg = outputBox("Message to send them", 14, toast);

  const inputs = {};
  const detail = (key, label, opts = {}) => {
    const control = opts.rows ? h("textarea", { rows: String(opts.rows), "aria-label": label }) : h("input", { type: "text", "aria-label": label });
    inputs[key] = control;
    control.addEventListener("input", () => {
      const p = current();
      if (!p) return;
      const own = { org: p.org, start: p.start, end: p.end, bullets: p.bullets, skills: p.skills };
      own[key] = control.value;
      cvDoc().people[p.key] = own;
      ws.touch("cv");
      outputs();
    });
    return field(label, control, opts.hint);
  };
  const top = (key, label) => {
    const control = h("input", { type: "text", value: cvDoc()[key] || "", "aria-label": label });
    control.addEventListener("input", () => { cvDoc()[key] = control.value; ws.touch("cv"); outputs(); });
    return field(label, control);
  };

  function outputs() {
    const p = current();
    if (!p) { [entry, li, msg].forEach((o) => o.set("")); return; }
    const out = build(p, stats(ws), cvDoc());
    entry.set(out.entry); li.set(out.li); msg.set(out.msg);
  }

  function load() {
    const list = people();
    const p = current();
    selKey = p?.key ?? null;
    picker.replaceChildren(...list.map((q) => h("button", { type: "button", "aria-pressed": String(q.key === selKey),
      onclick: () => { selKey = q.key; load(); } }, q.name)));
    if (!p) { who.textContent = "Nobody credited yet"; outputs(); return; }
    who.textContent = `${p.name} · ${p.role}`;
    inputs.org.value = p.org; inputs.start.value = p.start; inputs.end.value = p.end;
    inputs.bullets.value = p.bullets; inputs.skills.value = p.skills;
    outputs();
  }

  root.append(
    h("header.head", {}, h("div.eyebrow", {}, "Send to each contributor"), h("h1", {}, "CV kit"),
      h("p", {}, "Pick a person, adjust their bullets, then copy the message. It includes a ready-to-paste CV entry and the LinkedIn fields.")),
    picker,
    h("div.editor", {},
      h("div.stage", { style: "position:static" }, entry.el, li.el, msg.el),
      h("div.panel", {},
        who,
        detail("org", "Organisation line"),
        h("div.two", {}, detail("start", "From"), detail("end", "To")),
        detail("bullets", "Bullets", { rows: 8, hint: "one per line · {coffees} {students} {flavours} {days} fill in from Launch numbers" }),
        detail("skills", "Skills to add on LinkedIn"),
        h("h3", {}, "For every entry"),
        top("location", "Location"),
        h("div.two", {}, top("sender_name", "Message signed by"), top("sender_title", "Their title")))),
    h("div.panel", {},
      h("h3", {}, "How to put it on a CV"),
      h("ol.how", {},
        h("li", {}, h("b", {}, "Pick the section. "), "Students: “Projects” or “Leadership & Activities”. With little work history, “Experience” is fine: it was real work with a defined role, just unpaid. Faculty and staff: “Service” or “Student mentoring”."),
        h("li", {}, h("b", {}, "Use the same title everywhere. "), "CV, LinkedIn and the one-month post should match word for word, so anyone who checks finds the same thing."),
        h("li", {}, h("b", {}, "Format: "), "Role | Project, then organisation and location, then dates, then 2–4 bullets that start with a verb (Designed, Led, Managed, Built)."),
        h("li", {}, h("b", {}, "Only real numbers. "), "Use the launch figures once they are counted from the kiosk database. “Around 300” is fine; an invented figure is not."),
        h("li", {}, h("b", {}, "On LinkedIn: "), "add it under Projects (associated with Anatolia American University) or under Volunteer experience with “Student Government Association” as the organisation. Link the one-month post in the Media field."),
        h("li", {}, h("b", {}, "For interviews: "), "prepare a 30-second version. What problem it solved, what you personally did, what came out of it."))));
  load();
  return mk.onChange(() => load());
}
