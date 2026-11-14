// Admin user management: create restaurant/driver/admin accounts, reset passwords.
// Login is phone + password; phone is mapped to a synthetic email.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

function normPhone(p: string) {
  let d = (p || "").replace(/[^0-9]/g, "");
  if (d.startsWith("964")) d = "0" + d.slice(3);
  if (d.startsWith("7") && d.length === 10) d = "0" + d;
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const body = await req.json();
    const action = body.action || "create";

    // who is calling?
    const { count: adminCount } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
    const bootstrap = (adminCount ?? 0) === 0;
    let callerIsAdmin = false, callerCanUsers = bootstrap;
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    if (token) {
      const { data } = await admin.auth.getUser(token);
      if (data?.user) {
        const { data: prof } = await admin.from("profiles").select("role,active,permissions").eq("id", data.user.id).maybeSingle();
        callerIsAdmin = prof?.role === "admin" && prof?.active;
        callerCanUsers = callerIsAdmin && (prof.permissions == null || prof.permissions.includes("users"));
      }
    }
    if (!callerIsAdmin && !(bootstrap && action === "create" && body.role === "admin")) {
      return json({ error: "غير مصرح" }, 403);
    }

    if (action === "create") {
      const role = body.role;
      if (!["admin", "restaurant", "driver"].includes(role)) return json({ error: "نوع الحساب غلط" }, 400);
      if (role === "admin" && !callerCanUsers) return json({ error: "ما عندك صلاحية المستخدمين" }, 403);
      const permissions = role === "admin" && !bootstrap && Array.isArray(body.permissions) ? body.permissions.map(String) : null;
      const phone = normPhone(body.phone);
      if (phone.length < 10) return json({ error: "رقم الهاتف غير صحيح" }, 400);
      if (!body.name?.trim()) return json({ error: "الاسم مطلوب" }, 400);
      if (!body.password || body.password.length < 6) return json({ error: "الرمز لازم 6 أحرف أو أكثر" }, 400);
      // a removed (archived) account holding this phone gives it up
      const { data: old } = await admin.from("profiles").select("id").eq("phone", phone).not("removed_at", "is", null).maybeSingle();
      if (old) {
        await admin.auth.admin.updateUserById(old.id, { email: `removed-${old.id}@jayek.app` });
        await admin.from("profiles").update({ phone: `${phone}-محذوف` }).eq("id", old.id);
      }
      const { data: u, error } = await admin.auth.admin.createUser({
        email: `${phone}@jayek.app`,
        password: body.password,
        email_confirm: true,
        user_metadata: { role, name: body.name },
      });
      if (error) return json({ error: error.message.includes("already") ? "هذا الرقم مسجل من قبل" : error.message }, 400);
      const { error: e2 } = await admin.from("profiles").insert({
        id: u.user!.id, role, name: body.name.trim(), phone,
        address: body.address || null, zone_id: body.zone_id || null,
        lat: body.lat ?? null, lng: body.lng ?? null, vehicle: body.vehicle || null, permissions,
        vehicle_type: role === "driver" && ["motorcycle", "car"].includes(body.vehicle_type) ? body.vehicle_type : null,
        vehicle_info: role === "driver" && body.vehicle_info && typeof body.vehicle_info === "object" ? body.vehicle_info : null,
        biz_type: role === "restaurant" ? (String(body.biz_type || "").trim().slice(0, 30) || "restaurant") : null,
      });
      if (e2) {
        await admin.auth.admin.deleteUser(u.user!.id);
        return json({ error: e2.message.includes("duplicate") ? "هذا الرقم مسجل من قبل" : e2.message }, 400);
      }
      return json({ ok: true, id: u.user!.id });
    }

    if (action === "reset_password") {
      if (!body.password || body.password.length < 6) return json({ error: "الرمز لازم 6 أحرف أو أكثر" }, 400);
      const { data: target } = await admin.from("profiles").select("role").eq("id", body.user_id).maybeSingle();
      if (target?.role === "admin" && !callerCanUsers) return json({ error: "ما عندك صلاحية المستخدمين" }, 403);
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
