import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in · SGA Hub" };

export default async function Login() {
  if (await currentSession()) redirect("/");
  return (
    <main className="center center--brand">
      <div className="card card--narrow">
        <p className="brand brand--big"><span className="brand__mark">SGA</span> Hub</p>
        <LoginForm passwordEnabled={!!process.env.HUB_PASSWORD} />
        <a className="btn btn--block" href="/pos">Selling merch? Open the till</a>
      </div>
    </main>
  );
}
