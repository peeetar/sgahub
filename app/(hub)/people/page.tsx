import { DbDown } from "@/components/hub/bits";
import { currentTerm, ensureSchema, sql } from "@/lib/db";
import PeopleBoard, { type Person, type Role } from "./PeopleBoard";

export const metadata = { title: "People · SGA Hub" };

export default async function People({ searchParams }: { searchParams: Promise<{ term?: string }> }) {
  try {
    await ensureSchema();
    const q = sql();
    const current = await currentTerm();
    const { term: asked } = await searchParams;
    const terms = ((await q`SELECT DISTINCT term FROM hub_people ORDER BY term DESC`) as { term: string }[]).map((r) => r.term);
    const allTerms = [...new Set([current, ...terms])].sort().reverse();
    const term = asked && allTerms.includes(asked) ? asked : current;
    const roles = (await q`SELECT id, title, duties, seats FROM hub_roles ORDER BY sort, title`) as Role[];
    const people = (await q`SELECT id, name, role_id, email, notion_user_id, notes, term, username FROM hub_people WHERE term = ${term} ORDER BY name`) as Person[];
    return <PeopleBoard roles={roles} people={people} term={term} current={current} terms={allTerms} />;
  } catch (err) {
    return <main className="hubpage"><header className="hubpage__head"><h1>People</h1></header><DbDown err={err} /></main>;
  }
}
