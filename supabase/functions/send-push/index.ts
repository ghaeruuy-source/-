// Sends Web Push notifications. Called only by the database trigger (orders_notify_push).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const STATUS: Record<string, string> = {
  accepted: "السائق قبل الطلب وجاي للمطعم",
  picked_up: "السائق استلم الطلب",
  delivered: "توصّل الطلب ✓",
  refused: "الزبون رفض أو ما رد",
};
const fmt = (n: unknown) => Number(n || 0).toLocaleString("en-US");

Deno.serve(async (req) => {
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: secrets } = await db.from("app_secrets").select("key,value");
    const sec = Object.fromEntries((secrets || []).map((s) => [s.key, s.value]));
    if (!sec.push_secret || req.headers.get("x-push-secret") !== sec.push_secret) return new Response("forbidden", { status: 403 });

    const { type, order_id, user_id } = await req.json();
    const { data: o } = await db.from("orders").select("*").eq("id", order_id).maybeSingle();
    if (!o) return new Response("no order", { status: 404 });
    const [{ data: subs }, { data: rest }, { data: zone }, { data: st }] = await Promise.all([
      db.from("push_subscriptions").select("*").eq("user_id", user_id),
      db.from("profiles").select("name").eq("id", o.restaurant_id).maybeSingle(),
      db.from("zones").select("name").eq("id", o.zone_id).maybeSingle(),
      db.from("settings").select("app_name").eq("id", 1).maybeSingle(),
    ]);
    if (!subs?.length) return Response.json({ sent: 0 });

    let payload;
    if (type === "offer") {
      if (o.status !== "offered" || o.offered_driver_id !== user_id) return Response.json({ skipped: true });
      payload = {
        title: `طلب جديد #${o.id} 🛵`,
        body: `${rest?.name || "مطعم"} ← ${zone?.name || ""} · ربحك ${fmt(Number(o.delivery_fee) - Number(o.commission))} د.ع · افتح بسرعة`,
        tag: `offer-${o.id}`, requireInteraction: true, vibrate: [400, 200, 400, 200, 400],
      };
    } else {
      payload = { title: `طلب #${o.id} · ${o.customer_name}`, body: STATUS[o.status] || o.status, tag: `order-${o.id}` };
    }
    payload = { ...payload, app: st?.app_name || "جايك بالطريق", url: "./" };

    webpush.setVapidDetails("mailto:noreply@jayek.app", sec.vapid_public, sec.vapid_private);
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: type === "offer" ? 60 : 3600, urgency: "high" });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
        else console.error("push failed", code, (e as Error).message);
      }
    }));
    return Response.json({ sent });
  } catch (e) {
    console.error(e);
    return new Response(String((e as Error).message || e), { status: 500 });
  }
});
