// One list of people for the LinkedIn thank-you and the CV kit: the Hub's People
// page for this term, plus credited-only people who aren't on it (advisors, the
// library). How each one is credited is kept in the Overview document.
export const KINDS = [["team", "Project team"], ["advisor", "Advisor"], ["host", "Host (thanks)"], ["none", "Not credited"]];
export const ORG_BY_GROUP = {
  SGA: "Student Government Association, Anatolia American University",
  "Maker's Society": "Maker's Society, Anatolia American University",
  Library: "Bissell Library, Anatolia American University",
};
const DEFAULT_ORG = ORG_BY_GROUP.SGA;

// Suggested titles and CV bullets, keyed by first name (team) or id (extras).
// They name people, so they live in the Overview document, never in this
// public repo. Only ever a starting point: nothing is applied until someone clicks.
const firstName = (name) => String(name || "").trim().split(/\s+/)[0].toLowerCase();
const suggestions = (ws) => ws.doc("overview").suggested || {};

export function suggestedTitle(ws, person) { return suggestions(ws)[firstName(person.name)]?.role || ""; }

/** How someone on the People page is credited: {credited_role, grp}. */
export function creditOf(ws, id) { return ws.doc("overview").credits?.[id] || {}; }

/** Everyone the tools can mention, with their CV details filled in. */
export function roster(ws) {
  const cv = ws.doc("cv").people || {};
  const build = (base, key, suggestKey) => {
    const s = suggestions(ws)[suggestKey] || {};
    const own = cv[key] || {};
    return {
      ...base, key,
      org: own.org ?? s.org ?? ORG_BY_GROUP[base.grp] ?? DEFAULT_ORG,
      start: own.start ?? "Sep 2026", end: own.end ?? "Present",
      bullets: own.bullets ?? s.bullets ?? "", skills: own.skills ?? s.skills ?? "",
    };
  };
  const team = ws.team.map((a) => {
    const credit = creditOf(ws, a.id);
    return build({
      id: a.id, email: a.email, name: a.name, role: credit.credited_role || "", grp: credit.grp || null,
      kind: credit.credited_role ? "team" : "none", admin: true,
    }, a.id, firstName(a.name));
  });
  const extras = (ws.doc("overview").people || []).map((p) => build({ ...p, admin: false }, p.id, p.id));
  return [...team, ...extras];
}

export const credited = (people) => people.filter((p) => p.kind !== "none" && p.name.trim());
export const cvPeople = (people) => credited(people).filter((p) => p.kind !== "host");

/** The four launch numbers: typed override if there is one, else the live count. */
export function stats(ws) {
  const over = ws.doc("overview").stats_override || {};
  const live = ws.launch;
  const pick = (k, liveValue) => (String(over[k] ?? "").trim() || String(liveValue));
  return {
    coffees: pick("coffees", live.coffees_served), students: pick("students", live.students_registered),
    flavours: pick("flavours", live.flavours_offered), days: pick("days", live.days_running),
  };
}

export function fillNumbers(text, s) {
  return String(text || "").replace(/\{coffees\}/g, s.coffees).replace(/\{students\}/g, s.students)
    .replace(/\{flavours\}/g, s.flavours).replace(/\{days\}/g, s.days);
}
