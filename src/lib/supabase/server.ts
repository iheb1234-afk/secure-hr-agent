import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";

// Server client acting AS THE LOGGED-IN USER → every query goes through Row Level Security.
// We never use the service_role key in the app.
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* called from a Server Component: ignore */
        }
      },
    },
  });
}

export type Ctx = { sb: SupabaseClient; user: User; role: "recruiter" | "admin" };

export async function requireUser(): Promise<Ctx | null> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: prof } = await sb.from("profiles").select("role").eq("id", data.user.id).single();
  return { sb, user: data.user, role: (prof?.role as Ctx["role"]) ?? "recruiter" };
}

export async function audit(
  ctx: Ctx,
  actor_type: "human" | "ai" | "system",
  action: string,
  entity: string,
  entity_id: string | null,
  details: Record<string, unknown> = {}
) {
  await ctx.sb.from("audit_log").insert({ actor: ctx.user.id, actor_type, action, entity, entity_id, details });
}
