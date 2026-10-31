import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Security model
 * - The BROWSER is read-only: it reads through Row Level Security with the user's session,
 *   and the database refuses any insert/update/delete from it (migration_05).
 * - Every WRITE goes through an API route, which first checks the user's role, validates the input,
 *   applies the business rules (approval gate, flags, audit log), and only then writes with the
 *   server-only service key. That key never reaches the browser (no NEXT_PUBLIC_ prefix).
 */
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

let adminClient: SupabaseClient | null = null;
function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing");
  adminClient ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } });
  return adminClient;
}

export type Role = "employee" | "recruiter" | "admin";
export type Ctx = { sb: SupabaseClient; user: User; role: Role };
export const HR: Role[] = ["recruiter", "admin"];

/** For pages (server components): user session client, reads go through Row Level Security. */
export async function requireUser(): Promise<Ctx | null> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: prof } = await sb.from("profiles").select("role").eq("id", data.user.id).single();
  return { sb, user: data.user, role: (prof?.role as Role) ?? "employee" }; // unknown profile = least privilege
}

/**
 * For API routes: checks login AND role, then returns a server-side client that can write.
 * Returns a Response to send back when the check fails.
 */
export async function requireRole(roles: Role[]): Promise<Ctx | Response> {
  const ctx = await requireUser();
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!roles.includes(ctx.role)) return Response.json({ error: "Forbidden for your role" }, { status: 403 });
  return { ...ctx, sb: serviceClient() };
}

export async function audit(
  ctx: Ctx,
  actor_type: "human" | "ai" | "system",
  action: string,
  entity: string,
  entity_id: string | null,
  details: Record<string, unknown> = {}
) {
  // actor and actor_type are set by the server only (the browser cannot write to the audit log)
  const { error } = await ctx.sb.from("audit_log").insert({ actor: ctx.user.id, actor_type, action, entity, entity_id, details });
  if (error) console.error("AUDIT WRITE FAILED", action, error.message);
}
