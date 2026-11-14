/* جايك بالطريق — one app for restaurants, drivers and the admin. */
(() => {
"use strict";

const C = window.JAYEK_CONFIG;
const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// ---------- state ----------
const S = {
  session: null, profile: null, settings: null, zones: [],
  orders: [], restaurants: {}, drivers: {}, channel: null,
  tab: null, timers: [], maps: {}, watchId: null, wakeLock: null,
  lastSent: null, lastOfferId: null,
};

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const app = () => $("#app");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => `<bdi dir="ltr" class="num">${Number(n || 0).toLocaleString("en-US")}</bdi> د.ع`;
const normPhone = (p) => {
  let d = String(p || "").replace(/[^0-9٠-٩]/g, "").replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c));
  if (d.startsWith("964")) d = "0" + d.slice(3);
  if (d.startsWith("7") && d.length === 10) d = "0" + d;
  return d;
};
const toNum = (v) => Number(String(v || "").replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c)).replace(/[^0-9.]/g, "")) || 0;
const time = (t) => (t ? new Date(t).toLocaleTimeString("ar-IQ", { hour: "numeric", minute: "2-digit" }) : "");
const dateTime = (t) => (t ? new Date(t).toLocaleString("ar-IQ", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const ago = (t) => {
  if (!t) return "—";
  const s = Math.round((Date.now() - new Date(t)) / 1000);
  if (s < 60) return "هسه";
  if (s < 3600) return `قبل ${Math.round(s / 60)} د`;
  return `قبل ${Math.round(s / 3600)} س`;
};
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const tel = (p) => `<a class="num" href="tel:${esc(p)}">${esc(p)}</a>`;

const STATUS = {
  searching: "نبحث عن سائق",
  offered: "بانتظار قبول السائق",
  accepted: "السائق جاي للمطعم",
  picked_up: "السائق استلم الطلب",
  on_the_way: "بالطريق للزبون",
  delivered: "توصّل",
  refused: "مرفوض / ما رد",
  cancelled: "ملغي",
};
const ACTIVE = ["searching", "offered", "accepted", "picked_up", "on_the_way"];
const chip = (s) => `<span class="chip st-${s}">${STATUS[s] || s}</span>`;
const zoneName = (id) => S.zones.find((z) => z.id === id)?.name || "—";

function toast(msg, err = false) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3500);
}
function errMsg(e) {
  const m = e?.message || String(e);
  if (/Invalid login/i.test(m)) return "الرقم أو الرمز غلط";
  if (/Failed to fetch|NetworkError/i.test(m)) return "ماكو انترنت، جرب مرة ثانية";
  return m;
}
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}
const rpc0 = (name, args) => sb.rpc(name, args);
async function adminUsers(body) {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(`${C.supabaseUrl}/functions/v1/admin-users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", apikey: C.supabaseKey,
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || "صار خطأ");
  return j;
}
function clearTimers() { S.timers.forEach(clearInterval); S.timers = []; }
function every(ms, fn) { S.timers.push(setInterval(fn, ms)); }
function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("الموبايل ما يدعم تحديد الموقع"));
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => rej(new Error(e.code === 1 ? "لازم تسمح بالموقع من إعدادات المتصفح" : "ما گدرنا نحدد الموقع")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  });
}
function beep() {
  try {
    const ctx = beep.ctx || (beep.ctx = new (window.AudioContext || window.webkitAudioContext)());
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
    });
  } catch (_) {}
  try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch (_) {}
}
function notify(title, body) {
  try {
    if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
      navigator.serviceWorker?.getRegistration().then((r) => r ? r.showNotification(title, { body, icon: "icon-192.png", tag: "offer", renotify: true }) : new Notification(title, { body }));
    }
  } catch (_) {}
}
// ---------- web push ----------
const urlB64 = (b) => { const p = "=".repeat((4 - (b.length % 4)) % 4); const r = atob((b + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
const Push = {
  supported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; },
  isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); },
  standalone() { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; },
  state() {
    if (!this.supported()) return this.isIOS() && !this.standalone() ? "ios-install" : "unsupported";
    return Notification.permission; // default | granted | denied
  },
  async enable(silent = false) {
    if (!this.supported()) { if (!silent) toast(this.isIOS() ? "بالآيفون: ضيف التطبيق للشاشة الرئيسية أول، وافتحه منها" : "هذا المتصفح ما يدعم الإشعارات", true); return false; }
    const perm = Notification.permission === "granted" ? "granted" : silent ? Notification.permission : await Notification.requestPermission();
    if (perm !== "granted") { if (!silent) toast("لازم تسمح بالإشعارات من إعدادات المتصفح", true); return false; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(C.vapidPublicKey) });
    const j = sub.toJSON();
    await rpc("save_push_subscription", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent.slice(0, 200) });
    S.pushOn = true;
    if (!silent) toast("الإشعارات تفعّلت ✓");
    return true;
  },
  async refresh() { try { if (this.supported() && Notification.permission === "granted") await this.enable(true); } catch (_) {} },
  async disable() {
    try {
      const reg = await navigator.serviceWorker?.getRegistration(); const sub = await reg?.pushManager?.getSubscription();
      if (sub) { await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
    } catch (_) {}
    S.pushOn = false;
  },
  banner(who) {
    const st = this.state();
    if (st === "granted" || st === "unsupported") return "";
    const why = who === "driver" ? "حتى يوصلك الطلب حتى لو التطبيق مسدود" : "حتى توصلك حالة الطلبات حتى لو التطبيق مسدود";
    if (st === "ios-install") return `<div class="alert warn" style="margin-top:12px">${why}: اضغط زر المشاركة <b>⬆︎</b> ← <b>إضافة إلى الشاشة الرئيسية</b>، وافتح التطبيق من الأيقونة.</div>`;
    if (st === "denied") return `<div class="alert bad" style="margin-top:12px">الإشعارات مسدودة. فعّلها من إعدادات المتصفح للموقع ${why}.</div>`;
    return `<div class="alert info spread" style="margin-top:12px"><span>${why}</span><button class="btn sm dark" data-act="push">فعّل الإشعارات</button></div>`;
  },
};
document.addEventListener("click", async (e) => {
  const b = e.target.closest('[data-act="push"]'); if (!b) return;
  b.disabled = true;
  const ok = await Push.enable().catch((err) => { toast(errMsg(err), true); return false; });
  if (ok) b.closest(".alert")?.remove(); else b.disabled = false;
});

function modal(html, onMount) {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener("click", (e) => { if (e.target === bg || e.target.closest("[data-close]")) bg.remove(); });
  document.body.appendChild(bg);
  onMount?.(bg, () => bg.remove());
  return bg;
}

// ---------- branding ----------
const FONTS = {
  "IBM Plex Sans Arabic": "400;500;600;700", "Cairo": "400;500;600;700", "Tajawal": "400;500;700",
  "Almarai": "400;700;800", "Noto Kufi Arabic": "400;500;600;700", "Readex Pro": "400;500;600;700",
  "Changa": "400;500;600;700", "El Messiri": "400;500;600;700", "Rubik": "400;500;600;700", "Baloo Bhaijaan 2": "400;500;600;700",
};
function loadFont(f) {
  if (!FONTS[f] || (loadFont.done ||= {})[f]) return;
  loadFont.done[f] = 1;
  const l = document.createElement("link"); l.rel = "stylesheet";
  l.href = `https://fonts.googleapis.com/css2?family=${f.replace(/ /g, "+")}:wght@${FONTS[f]}&display=swap`;
  document.head.appendChild(l);
}
function applyBranding() {
  const s = S.settings || {};
  const font = FONTS[s.font_family] ? s.font_family : "IBM Plex Sans Arabic";
  loadFont(font);
  document.documentElement.style.setProperty("--font", `"${font}"`);
  const color = s.primary_color || "#E8590C";
  document.documentElement.style.setProperty("--brand", color);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", color);
  document.title = s.app_name || "جايك بالطريق";
}
const logoHtml = (cls = "dot") => {
  const s = S.settings || {};
  return s.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : `<span class="${cls}">${esc((s.app_name || "ج").trim()[0])}</span>`;
};
function topbar(subtitle) {
  return `<header class="topbar">
    <div class="brand">${logoHtml()}<span>${esc(S.settings?.app_name || "جايك بالطريق")}</span></div>
    <div class="who"><div>${esc(S.profile?.name || "")}</div><div class="small">${esc(subtitle)}</div></div>
    <button class="btn sm ghost" data-act="logout">خروج</button>
  </header>`;
}

// ---------- maps ----------
function makeMap(el, zoom = 13) {
  const m = L.map(el, { zoomControl: true, attributionControl: true }).setView(C.mapCenter, zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
  return m;
}
const driverIcon = (d, busy) => L.divIcon({ className: "", html: `<div class="drv-pin ${!d.online ? "off" : busy ? "busy" : ""}">${esc((d.name || "س").trim()[0])}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
const restIcon = () => L.divIcon({ className: "", html: `<div class="rest-pin">🍽</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
const bigDriverIcon = (d, on, bo) => L.divIcon({ className: "", iconSize: [56, 70], iconAnchor: [28, 28], popupAnchor: [0, -26],
  html: `<div class="bpin ${!on ? "off" : bo ? "busy" : "free"}"><div class="bpin-c">🛵${bo ? `<span class="bpin-badge">#${bo.id}</span>` : ""}</div><div class="bpin-l">${esc(d.name)}</div></div>` });
const bigRestIcon = (r) => L.divIcon({ className: "", iconSize: [56, 64], iconAnchor: [28, 22], popupAnchor: [0, -20],
  html: `<div class="bpin rest"><div class="bpin-c">🍽</div><div class="bpin-l">${esc(r.name)}</div></div>` });

// ---------- boot ----------
async function boot() {
  const { data: st } = await sb.from("settings").select("*").eq("id", 1).maybeSingle();
  S.settings = st || {};
  applyBranding();
  const { data: { session } } = await sb.auth.getSession();
  S.session = session;
  if (!session) {
    let setup = false;
    try { setup = await rpc("needs_setup"); } catch (_) {}
    return setup ? renderSetup() : renderLogin();
  }
  const { data: prof, error } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  if (error || !prof) { await sb.auth.signOut(); return renderLogin("الحساب غير موجود، راجع الإدارة"); }
  if (!prof.active) { await sb.auth.signOut(); return renderLogin("حسابك موقوف، راجع الإدارة"); }
  S.profile = prof;
  Push.refresh();
  const { data: zones } = await sb.from("zones").select("*").order("name");
  S.zones = zones || [];
  if (prof.role === "restaurant") return Restaurant.start();
  if (prof.role === "driver") return Driver.start();
  if (prof.role === "admin") return Admin.start();
}

function renderLogin(msg) {
  app().innerHTML = `<div class="login"><div class="card">
    <div class="logo">${logoHtml("x")}</div>
    <h1>${esc(S.settings?.app_name || "جايك بالطريق")}</h1>
    <p class="sub">سجل دخول برقم موبايلك</p>
    ${msg ? `<div class="alert bad" style="margin-bottom:12px">${esc(msg)}</div>` : ""}
    <form id="loginForm">
      <div class="field"><label>رقم الموبايل</label><input name="phone" type="tel" inputmode="tel" placeholder="07xx xxx xxxx" required autocomplete="username"></div>
      <div class="field"><label>الرمز</label><input name="password" type="password" required autocomplete="current-password"></div>
      <button class="btn primary block big">دخول</button>
    </form>
    <p class="small muted" style="text-align:center;margin:14px 0 0">الحسابات تنسوي من الإدارة. إذا نسيت الرمز راجع الإدارة.</p>
  </div></div>`;
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), b = e.target.querySelector("button");
    b.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: `${normPhone(f.get("phone"))}@${C.phoneDomain}`, password: f.get("password") });
    b.disabled = false;
    if (error) return toast(errMsg(error), true);
    boot();
  };
}

function renderSetup() {
  app().innerHTML = `<div class="login"><div class="card">
    <div class="logo">${logoHtml("x")}</div>
    <h1>أول تشغيل</h1>
    <p class="sub">سوّي حساب المدير (صاحب الشركة). هذا ينطلب مرة وحدة بس.</p>
    <form id="setupForm">
      <div class="field"><label>اسمك</label><input name="name" required></div>
      <div class="field"><label>رقم موبايلك</label><input name="phone" type="tel" inputmode="tel" placeholder="07xx xxx xxxx" required></div>
      <div class="field"><label>الرمز (6 أحرف أو أكثر)</label><input name="password" type="password" minlength="6" required autocomplete="new-password"></div>
      <button class="btn primary block big">إنشاء حساب المدير</button>
    </form></div></div>`;
  $("#setupForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), b = e.target.querySelector("button");
    b.disabled = true;
    try {
      await adminUsers({ action: "create", role: "admin", ...f });
      const { error } = await sb.auth.signInWithPassword({ email: `${normPhone(f.phone)}@${C.phoneDomain}`, password: f.password });
      if (error) throw error;
      boot();
    } catch (err) { toast(errMsg(err), true); b.disabled = false; }
  };
}

async function logout() {
  if (S.profile?.role === "driver" && S.profile.online) { try { await rpc("driver_set_online", { p_online: false }); } catch (_) {} }
  Driver.stopGps?.();
  await Push.disable();
  clearTimers();
  if (S.channel) sb.removeChannel(S.channel);
  Object.values(S.maps).forEach((m) => m?.remove?.());
  Object.assign(S, { session: null, profile: null, orders: [], channel: null, maps: {}, tab: null });
  await sb.auth.signOut();
  boot();
}
document.addEventListener("click", (e) => { if (e.target.closest('[data-act="logout"]')) logout(); });

// =====================================================================
// RESTAURANT
// =====================================================================
const Restaurant = {
  async start() {
    S.tab = "new";
    app().innerHTML = `${topbar("مطعم / محل")}
      <nav class="tabs" id="rtabs"></nav>
      <main class="wrap narrow" id="rmain"></main>`;
    $("#rtabs").onclick = (e) => { const t = e.target.closest("[data-tab]"); if (t) { S.tab = t.dataset.tab; this.render(); } };
    $("#rmain").onclick = (e) => this.onClick(e);
    await this.load();
    this.subscribe();
    every(20000, () => this.load());
    every(1000, () => this.tick());
  },
  async load() {
    const since = new Date(Date.now() - 3 * 864e5).toISOString();
    const { data } = await sb.from("orders").select("*").eq("restaurant_id", S.profile.id)
      .or(`status.in.(${ACTIVE.join(",")}),created_at.gte.${since}`).order("id", { ascending: false }).limit(200);
    S.orders = data || [];
    await this.loadDrivers();
    this.render();
  },
  async loadDrivers() {
    const ids = [...new Set(S.orders.filter((o) => o.driver_id && ACTIVE.includes(o.status)).map((o) => o.driver_id))];
    if (!ids.length) return;
    const { data } = await sb.from("profiles").select("id,name,phone,lat,lng,location_at,vehicle").in("id", ids);
    (data || []).forEach((d) => (S.drivers[d.id] = d));
  },
  subscribe() {
    S.channel = sb.channel("rest-" + S.profile.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${S.profile.id}` }, async (p) => {
        const o = p.new; const i = S.orders.findIndex((x) => x.id === o.id);
        const prev = i >= 0 ? S.orders[i] : null;
        if (i >= 0) S.orders[i] = o; else S.orders.unshift(o);
        if (prev && prev.status !== o.status) toast(`طلب #${o.id}: ${STATUS[o.status]}`);
        if (o.driver_id && !S.drivers[o.driver_id]) await this.loadDrivers();
        this.render();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, (p) => {
        if (S.drivers[p.new.id]) { S.drivers[p.new.id] = { ...S.drivers[p.new.id], ...p.new }; this.updateTrackMap(); }
        if (p.new.id === S.profile.id) S.profile = { ...S.profile, ...p.new };
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "settings" }, (p) => { S.settings = p.new; applyBranding(); })
      .subscribe();
  },
  render() {
    const active = S.orders.filter((o) => ACTIVE.includes(o.status));
    $("#rtabs").innerHTML = [["new", "طلب سائق"], ["active", `النشطة${active.length ? `<span class="pill-count">${active.length}</span>` : ""}`], ["history", "السجل"]]
      .map(([k, l]) => `<button class="tab ${S.tab === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("");
    const m = $("#rmain");
    if (S.tab === "new") {
      if (m.dataset.view === "new") return; // keep form state
      m.dataset.view = "new";
      m.innerHTML = this.formHtml();
      this.bindForm();
      return;
    }
    m.dataset.view = S.tab;
    if (S.tab === "active") {
      m.innerHTML = active.length ? active.map((o) => this.orderCard(o)).join("") : `<div class="card empty">ماكو طلبات نشطة هسه</div>`;
    } else {
      const done = S.orders.filter((o) => !ACTIVE.includes(o.status));
      const today = done.filter((o) => o.created_at >= startOfToday());
      const delivered = today.filter((o) => o.status === "delivered");
      m.innerHTML = `<div class="stats" style="grid-template-columns:repeat(2,1fr)">
          <div class="stat"><div class="v num">${delivered.length}</div><div class="l">توصّل اليوم</div></div>
          <div class="stat"><div class="v">${money(delivered.reduce((a, o) => a + Number(o.order_total), 0))}</div><div class="l">قيمة طلبات اليوم</div></div>
        </div><div class="section-title">آخر 3 أيام</div>
        ${done.length ? done.map((o) => this.orderCard(o, true)).join("") : `<div class="card empty">ماكو طلبات بعد</div>`}`;
    }
  },
  formHtml() {
    const noLoc = S.profile.lat == null;
    return `${Push.banner("restaurant").replace('margin-top:12px', 'margin-bottom:12px')}
    ${noLoc ? `<div class="alert warn" style="margin-bottom:12px">موقع المطعم غير محدد. حدده حتى نرسل أقرب سائق.<div style="margin-top:8px"><button class="btn sm dark" data-act="setloc">حدد موقعي هسه</button></div></div>` : ""}
    <form class="card" id="orderForm" autocomplete="off">
      <h2>طلب سائق جديد</h2>
      <div class="field"><label>اسم الزبون</label><input name="name" required></div>
      <div class="field"><label>رقم الزبون</label><input name="phone" type="tel" inputmode="tel" placeholder="07xx xxx xxxx" required><div id="phoneWarn"></div></div>
      <div class="field"><label>المنطقة</label>
        <select name="zone" required><option value="">اختار المنطقة</option>
          ${S.zones.filter((z) => z.active).map((z) => `<option value="${z.id}">${esc(z.name)} — ${Number(z.delivery_fee).toLocaleString("en-US")} د.ع</option>`).join("")}
        </select></div>
      <div class="field"><label>العنوان بالتفصيل</label><input name="address" placeholder="قرب... / شارع... / بيت..." required></div>
      <div class="field"><label>مبلغ الطلب (بدون توصيل)</label><input name="total" type="text" inputmode="numeric" placeholder="مثلاً 15000" required></div>
      <div class="field"><label>ملاحظات (اختياري)</label><input name="notes"></div>
      <div id="sum" class="alert info" hidden></div>
      <button class="btn primary block big" style="margin-top:12px">اطلب سائق</button>
    </form>
    ${!noLoc ? `<p class="small muted" style="text-align:center">موقع المطعم محفوظ · <a href="#" data-act="setloc">حدّثه</a></p>` : ""}`;
  },
  bindForm() {
    const f = $("#orderForm");
    const upd = () => {
      const z = S.zones.find((x) => String(x.id) === f.zone.value), t = toNum(f.total.value);
      const box = $("#sum");
      if (!z || !t) { box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = `الزبون يدفع: <b>${money(t + Number(z.delivery_fee))}</b> <span class="small">(${money(t)} طلب + ${money(z.delivery_fee)} توصيل)</span>`;
    };
    f.zone.onchange = upd; f.total.oninput = upd;
    f.phone.onblur = async () => {
      const p = normPhone(f.phone.value); const w = $("#phoneWarn"); w.innerHTML = "";
      if (p.length < 10) return;
      try {
        const r = await rpc("check_phone", { p_phone: p });
        if (r?.refused_count > 0) w.innerHTML = `<div class="alert bad" style="margin-top:6px">⚠️ هذا الرقم رفض أو ما رد ${r.refused_count} مرة قبل</div>`;
      } catch (_) {}
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const b = f.querySelector("button.big"); b.disabled = true;
      try {
        let pos = {};
        if (S.profile.lat == null) { try { pos = await getPosition(); } catch (_) {} }
        const o = await rpc("create_order", {
          p_customer_name: f.name.value, p_customer_phone: normPhone(f.phone.value), p_zone_id: Number(f.zone.value),
          p_address: f.address.value, p_order_total: toNum(f.total.value), p_notes: f.notes.value || null,
          p_lat: pos.lat ?? null, p_lng: pos.lng ?? null,
        });
        if (pos.lat && S.profile.lat == null) Object.assign(S.profile, pos);
        if (!S.orders.find((x) => x.id === o.id)) S.orders.unshift(o);
        f.reset(); $("#sum").hidden = true; $("#phoneWarn").innerHTML = "";
        toast(o.status === "offered" ? `طلب #${o.id} انرسل لأقرب سائق` : `طلب #${o.id} انسجل، نبحث عن سائق فاضي`);
        S.tab = "active"; this.render();
      } catch (err) { toast(errMsg(err), true); }
      b.disabled = false;
    };
  },
  orderCard(o, compact = false) {
    const d = o.driver_id ? S.drivers[o.driver_id] : null;
    const canCancel = ["searching", "offered", "accepted"].includes(o.status);
    return `<div class="card order">
      <div class="head"><span class="id">#${o.id} · ${esc(o.customer_name)}</span>${chip(o.status)}</div>
      <dl class="kv">
        <dt>الرقم</dt><dd>${tel(o.customer_phone)}</dd>
        <dt>المنطقة</dt><dd>${esc(zoneName(o.zone_id))} — ${esc(o.address)}</dd>
        <dt>المبلغ</dt><dd>${money(o.order_total)} + ${money(o.delivery_fee)} توصيل</dd>
        ${d ? `<dt>السائق</dt><dd>${esc(d.name)} · ${tel(d.phone)}</dd>` : ""}
        <dt>الوقت</dt><dd>${compact ? dateTime(o.created_at) : time(o.created_at)}</dd>
        ${o.close_reason ? `<dt>ملاحظة</dt><dd>${esc(o.close_reason)}</dd>` : ""}
      </dl>
      ${o.status === "offered" && o.offer_expires_at ? `<div class="small muted" style="margin-top:8px" data-exp="${o.offer_expires_at}"></div>` : ""}
      ${!compact ? `<div class="row" style="margin-top:12px">
        ${d && ["accepted", "picked_up", "on_the_way"].includes(o.status) ? `<button class="btn sm dark" data-act="track" data-id="${o.id}">شوف السائق على الخريطة</button>` : ""}
        ${canCancel ? `<button class="btn sm ghost" data-act="cancel" data-id="${o.id}">إلغاء</button>` : ""}
      </div>` : ""}
    </div>`;
  },
  tick() {
    document.querySelectorAll("[data-exp]").forEach((el) => {
      const s = Math.max(0, Math.round((new Date(el.dataset.exp) - Date.now()) / 1000));
      el.textContent = s > 0 ? `السائق عنده ${s} ثانية يقبل، بعدها ينتقل للي بعده` : "ننقله للسائق اللي بعده...";
    });
  },
  async onClick(e) {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const id = Number(b.dataset.id);
    if (b.dataset.act === "setloc") {
      e.preventDefault();
      try {
        const p = await getPosition();
        await rpc("restaurant_set_location", { p_lat: p.lat, p_lng: p.lng });
        Object.assign(S.profile, p);
        toast("تم حفظ موقع المطعم");
        $("#rmain").dataset.view = ""; this.render();
      } catch (err) { toast(errMsg(err), true); }
    }
    if (b.dataset.act === "cancel") {
      if (!confirm(`تلغي طلب #${id}؟`)) return;
      try { await rpc("cancel_order", { oid: id, reason: "ألغاه المطعم" }); toast("انلغى الطلب"); this.load(); } catch (err) { toast(errMsg(err), true); }
    }
    if (b.dataset.act === "track") this.openTrack(id);
  },
  openTrack(id) {
    const o = S.orders.find((x) => x.id === id); const d = S.drivers[o?.driver_id];
    modal(`<h3>السائق ${esc(d?.name || "")}</h3><div class="map" id="trackMap"></div>
      <p class="small muted" id="trackInfo"></p><button class="btn block" data-close>سد</button>`, (bg) => {
      const m = makeMap($("#trackMap", bg), 14);
      S.maps.track = { map: m, orderId: id, bg };
      if (S.profile.lat) L.marker([S.profile.lat, S.profile.lng], { icon: restIcon() }).addTo(m);
      this.updateTrackMap();
      new MutationObserver(() => { if (!document.body.contains(bg)) { m.remove(); S.maps.track = null; } }).observe(document.body, { childList: true });
    });
  },
  updateTrackMap() {
    const t = S.maps.track; if (!t) return;
    const o = S.orders.find((x) => x.id === t.orderId); const d = S.drivers[o?.driver_id];
    if (!d || d.lat == null) { $("#trackInfo", t.bg).textContent = "موقع السائق غير متوفر حالياً"; return; }
    if (!t.marker) { t.marker = L.marker([d.lat, d.lng], { icon: driverIcon({ ...d, online: true }, true) }).addTo(t.map); t.map.setView([d.lat, d.lng], 15); }
    else t.marker.setLatLng([d.lat, d.lng]);
    $("#trackInfo", t.bg).textContent = `آخر تحديث للموقع: ${ago(d.location_at)}`;
  },
};

// =====================================================================
// DRIVER
// =====================================================================
const Driver = {
  async start() {
    S.tab = "home";
    app().innerHTML = `${topbar("سائق")}<nav class="tabs" id="dtabs"></nav><main class="wrap narrow" id="dmain"></main>`;
    $("#dtabs").onclick = (e) => { const t = e.target.closest("[data-tab]"); if (t) { S.tab = t.dataset.tab; this.render(); } };
    $("#dmain").onclick = (e) => this.onClick(e);
    S.ledger = [];
    await this.load();
    this.subscribe();
    if (S.profile.online) this.startGps();
    every(15000, () => this.load());
    every(1000, () => this.tick());
    document.addEventListener("visibilitychange", () => { if (!document.hidden && S.profile?.online) { this.requestWake(); this.load(); } });
  },
  async load() {
    const me = S.profile.id;
    const since = new Date(Date.now() - 2 * 864e5).toISOString();
    const [{ data: orders }, { data: ledger }, { data: prof }] = await Promise.all([
      sb.from("orders").select("*").or(`offered_driver_id.eq.${me},and(driver_id.eq.${me},or(status.in.(accepted,picked_up,on_the_way),created_at.gte.${since}))`).order("id", { ascending: false }).limit(100),
      sb.from("ledger").select("*").eq("driver_id", me).order("id", { ascending: false }).limit(100),
      sb.from("profiles").select("*").eq("id", me).maybeSingle(),
    ]);
    S.orders = orders || [];
    S.ledger = ledger || [];
    if (prof) S.profile = prof;
    await this.loadRestaurants();
    this.render();
  },
  async loadRestaurants() {
    const ids = [...new Set(S.orders.map((o) => o.restaurant_id))].filter((id) => !S.restaurants[id]);
    if (!ids.length) return;
    const { data } = await sb.from("profiles").select("id,name,phone,address,lat,lng").in("id", ids);
    (data || []).forEach((r) => (S.restaurants[r.id] = r));
  },
  subscribe() {
    const me = S.profile.id;
    const onOrder = async (p) => {
      const o = p.new; if (!o?.id) return;
      const i = S.orders.findIndex((x) => x.id === o.id);
      if (i >= 0) S.orders[i] = o; else S.orders.unshift(o);
      await this.loadRestaurants();
      this.render();
    };
    S.channel = sb.channel("drv-" + me)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `offered_driver_id=eq.${me}` }, onOrder)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `driver_id=eq.${me}` }, onOrder)
      .on("postgres_changes", { event: "*", schema: "public", table: "ledger", filter: `driver_id=eq.${me}` }, () => this.load())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "settings" }, (p) => { S.settings = p.new; applyBranding(); this.render(); })
      .subscribe((status) => { if (status === "SUBSCRIBED") this.load(); });
  },
  debt() { return S.ledger.reduce((a, l) => a + Number(l.amount), 0); },
  currentOffer() {
    return S.orders.find((o) => o.status === "offered" && o.offered_driver_id === S.profile.id && new Date(o.offer_expires_at) > Date.now());
  },
  render() {
    const offer = this.currentOffer();
    if (offer && S.lastOfferId !== offer.id) {
      S.lastOfferId = offer.id; beep();
      notify("طلب جديد!", `${S.restaurants[offer.restaurant_id]?.name || ""} → ${zoneName(offer.zone_id)}`);
      if (S.tab !== "home") S.tab = "home";
    }
    $("#dtabs").innerHTML = [["home", "الرئيسية"], ["history", "طلباتي"], ["account", "حسابي"]]
      .map(([k, l]) => `<button class="tab ${S.tab === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("");
    const m = $("#dmain");
    if (S.tab === "home") m.innerHTML = this.homeHtml(offer);
    else if (S.tab === "history") m.innerHTML = this.historyHtml();
    else m.innerHTML = this.accountHtml();
    this.tick();
  },
  homeHtml(offer) {
    const p = S.profile, st = S.settings || {};
    const debt = this.debt(), cap = Number(st.debt_cap || 0), blocked = cap > 0 && debt >= cap;
    const active = S.orders.filter((o) => o.driver_id === p.id && ["accepted", "picked_up", "on_the_way"].includes(o.status));
    const gps = S.gpsError ? `<span style="color:var(--bad)">${esc(S.gpsError)}</span>` : p.online ? `الموقع ينرسل · ${ago(p.location_at)}` : "مطفي، ما توصلك طلبات";
    return `
      ${Push.banner("driver")}
      <div class="card online-toggle" style="margin-top:12px">
        <div><div style="font-weight:700;font-size:18px">${p.online ? "متصل 🟢" : "غير متصل"}</div><div class="small muted" id="gpsInfo">${gps}</div></div>
        <button class="switch ${p.online ? "on" : ""}" data-act="toggle" aria-label="تشغيل/إطفاء"></button>
      </div>
      ${blocked ? `<div class="alert bad" style="margin-top:12px">ديونك وصلت ${money(debt)} (الحد ${money(cap)}). ما توصلك طلبات جديدة لحد ما تسدد للإدارة.</div>` : ""}
      ${p.online ? `<div class="alert info small" style="margin-top:12px">${Push.state() === "granted" ? "إذا سديت التطبيق يوصلك إشعار بالطلب، بس موقعك يوقف يتحدث. الأفضل تخليه مفتوح وانت شغال." : "خلي الصفحة مفتوحة والشاشة شغالة حتى يوصلك الطلب ويتحدث موقعك."}</div>` : ""}
      ${offer ? this.offerHtml(offer) : ""}
      ${active.map((o) => this.activeHtml(o)).join("")}
      ${!offer && !active.length && p.online ? `<div class="card empty" style="margin-top:12px">بانتظار طلب... 🛵</div>` : ""}
      <div class="stats" style="grid-template-columns:repeat(2,1fr);margin-top:12px">
        <div class="stat"><div class="v">${money(debt)}</div><div class="l">بذمتك للإدارة${cap ? ` (الحد ${Number(cap).toLocaleString("en-US")})` : ""}</div></div>
        <div class="stat"><div class="v num">${S.orders.filter((o) => o.status === "delivered" && o.driver_id === p.id && o.delivered_at >= startOfToday()).length}</div><div class="l">توصيلات اليوم</div></div>
      </div>`;
  },
  offerHtml(o) {
    const r = S.restaurants[o.restaurant_id] || {};
    return `<div class="card offer" style="margin-top:12px">
      <div class="spread"><h2 style="margin:0">طلب جديد #${o.id}</h2><div class="countdown num" data-cd="${o.offer_expires_at}"></div></div>
      <div class="bar" style="margin:8px 0 12px"><i data-bar="${o.offer_expires_at}"></i></div>
      <dl class="kv">
        <dt>من</dt><dd><b>${esc(r.name || "مطعم")}</b>${r.address ? ` — ${esc(r.address)}` : ""}</dd>
        <dt>إلى</dt><dd><b>${esc(zoneName(o.zone_id))}</b> — ${esc(o.address)}</dd>
      </dl>
      <div class="money">
        <div><span>تدفع للمطعم</span><b>${money(o.order_total)}</b></div>
        <div class="hl"><span>تستلم من الزبون</span><b>${money(Number(o.order_total) + Number(o.delivery_fee))}</b></div>
        <div><span>ربحك</span><b>${money(Number(o.delivery_fee) - Number(o.commission))}</b></div>
      </div>
      <div class="row" style="margin-top:14px;flex-wrap:nowrap">
        <button class="btn ok big" style="flex:2" data-act="accept" data-id="${o.id}">قبول</button>
        <button class="btn ghost big" style="flex:1" data-act="decline" data-id="${o.id}">رفض</button>
      </div></div>`;
  },
  activeHtml(o) {
    const r = S.restaurants[o.restaurant_id] || {};
    const next = { accepted: ["picked_up", "استلمت الطلب من المطعم"], picked_up: ["on_the_way", "انطلقت للزبون"], on_the_way: ["delivered", "توصّل ✓ استلمت المبلغ"] }[o.status];
    const mapsLink = r.lat ? `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}` : null;
    return `<div class="card order" style="margin-top:12px">
      <div class="head"><span class="id">#${o.id}</span>${chip(o.status)}</div>
      <dl class="kv">
        <dt>المطعم</dt><dd><b>${esc(r.name || "")}</b> · ${tel(r.phone || "")}${r.address ? `<br><span class="small muted">${esc(r.address)}</span>` : ""}</dd>
        <dt>الزبون</dt><dd><b>${esc(o.customer_name)}</b> · ${tel(o.customer_phone)}</dd>
        <dt>العنوان</dt><dd>${esc(zoneName(o.zone_id))} — ${esc(o.address)}</dd>
        ${o.notes ? `<dt>ملاحظات</dt><dd>${esc(o.notes)}</dd>` : ""}
      </dl>
      <div class="money">
        <div><span>تدفع للمطعم</span><b>${money(o.order_total)}</b></div>
        <div class="hl"><span>تستلم من الزبون</span><b>${money(Number(o.order_total) + Number(o.delivery_fee))}</b></div>
        <div><span>ربحك</span><b>${money(Number(o.delivery_fee) - Number(o.commission))}</b></div>
      </div>
      <div class="stack" style="margin-top:14px">
        ${next ? `<button class="btn primary block big" data-act="status" data-st="${next[0]}" data-id="${o.id}">${next[1]}</button>` : ""}
        <div class="row">
          <a class="btn sm" href="tel:${esc(o.customer_phone)}">اتصل بالزبون</a>
          ${mapsLink && o.status === "accepted" ? `<a class="btn sm" target="_blank" rel="noopener" href="${mapsLink}">طريق المطعم</a>` : ""}
          ${o.status !== "accepted" ? `<button class="btn sm bad" data-act="refused" data-id="${o.id}">الزبون رفض / ما رد</button>` : ""}
        </div>
      </div></div>`;
  },
  historyHtml() {
    const mine = S.orders.filter((o) => o.driver_id === S.profile.id && !["accepted", "picked_up", "on_the_way"].includes(o.status));
    if (!mine.length) return `<div class="card empty">ماكو طلبات بآخر يومين</div>`;
    return mine.map((o) => `<div class="card order"><div class="head"><span class="id">#${o.id} · ${esc(S.restaurants[o.restaurant_id]?.name || "")}</span>${chip(o.status)}</div>
      <div class="small muted">${esc(zoneName(o.zone_id))} · ${dateTime(o.created_at)} · توصيل ${money(o.delivery_fee)} · عمولة ${money(o.commission)}</div></div>`).join("");
  },
  accountHtml() {
    const debt = this.debt();
    return `<div class="card"><div class="spread"><h2 style="margin:0">بذمتك للإدارة</h2><b style="font-size:22px">${money(debt)}</b></div>
      <p class="small muted" style="margin:6px 0 0">العمولة تنضاف على كل طلب توصّل. سدد نقداً للإدارة وهي تأشرها.</p></div>
      <div class="section-title">الحركات</div>
      <div class="card">${S.ledger.length ? S.ledger.map((l) => `<div class="ledger-item"><div>${esc(l.note || (l.kind === "settlement" ? "تسديد" : l.kind === "commission" ? "عمولة" : "تعديل"))}<div class="small muted">${dateTime(l.created_at)}</div></div><b class="${Number(l.amount) > 0 ? "pos" : "neg"}">${Number(l.amount) > 0 ? "+" : ""}${money(l.amount)}</b></div>`).join("") : `<div class="empty">ماكو حركات</div>`}</div>`;
  },
  tick() {
    // keep ringing every 3 seconds while an offer is waiting
    const off = this.currentOffer();
    if (off && Math.round((new Date(off.offer_expires_at) - Date.now()) / 1000) % 3 === 0) beep();
    document.querySelectorAll("[data-cd]").forEach((el) => {
      const s = Math.max(0, Math.round((new Date(el.dataset.cd) - Date.now()) / 1000));
      el.textContent = s;
      if (s === 0 && !el.dataset.gone) { el.dataset.gone = 1; setTimeout(() => this.render(), 600); }
    });
    const total = Number(S.settings?.offer_timeout_sec || 30);
    document.querySelectorAll("[data-bar]").forEach((el) => {
      const s = Math.max(0, (new Date(el.dataset.bar) - Date.now()) / 1000);
      el.style.width = `${Math.min(100, (s / total) * 100)}%`;
    });
  },
  async onClick(e) {
    const b = e.target.closest("[data-act]"); if (!b || b.tagName === "A") return;
    const id = Number(b.dataset.id);
    try {
      if (b.dataset.act === "toggle") {
        const on = !S.profile.online;
        if (on) {
          try { await Push.enable(Push.state() !== "default"); } catch (_) {}
          beep.ctx || beep(); // unlock audio on iOS with a user gesture
          const pos = await getPosition();
          await rpc("driver_location", { p_lat: pos.lat, p_lng: pos.lng });
          Object.assign(S.profile, pos, { location_at: new Date().toISOString() });
        }
        await rpc("driver_set_online", { p_online: on });
        S.profile.online = on;
        on ? this.startGps() : this.stopGps();
        this.render();
      }
      if (b.dataset.act === "accept") { b.disabled = true; await rpc("driver_respond", { oid: id, p_accept: true }); toast("قبلت الطلب، روح للمطعم"); await this.load(); }
      if (b.dataset.act === "decline") { b.disabled = true; await rpc("driver_respond", { oid: id, p_accept: false }); await this.load(); }
      if (b.dataset.act === "status") {
        if (b.dataset.st === "delivered" && !confirm("متأكد توصّل الطلب واستلمت المبلغ؟")) return;
        b.disabled = true; await rpc("driver_update_status", { oid: id, p_status: b.dataset.st }); await this.load();
      }
      if (b.dataset.act === "refused") {
        const note = prompt("شنو صار؟ (رفض الطلب / ما يرد / عنوان غلط ...)", "ما رد");
        if (note === null) return;
        await rpc("driver_update_status", { oid: id, p_status: "refused", p_note: note || null });
        toast("تم تسجيل الرفض، رجّع الطلب للمطعم"); await this.load();
      }
    } catch (err) { toast(errMsg(err), true); this.load(); }
  },
  startGps() {
    if (!navigator.geolocation || S.watchId != null) return;
    this.requestWake();
    S.watchId = navigator.geolocation.watchPosition(async (p) => {
      S.gpsError = null;
      const pos = { lat: p.coords.latitude, lng: p.coords.longitude }, now = Date.now();
      const last = S.lastSent;
      const moved = !last ? Infinity : Math.hypot((pos.lat - last.lat) * 111000, (pos.lng - last.lng) * 93000);
      if (last && now - last.t < 8000 && moved < 40) return;
      if (last && now - last.t < 4000) return;
      S.lastSent = { ...pos, t: now };
      try { await rpc("driver_location", { p_lat: pos.lat, p_lng: pos.lng }); S.profile.location_at = new Date().toISOString(); Object.assign(S.profile, pos); const g = $("#gpsInfo"); if (g) g.textContent = "الموقع ينرسل · هسه"; } catch (_) {}
    }, (e) => { S.gpsError = e.code === 1 ? "لازم تسمح بالموقع" : "الـGPS ما يشتغل"; const g = $("#gpsInfo"); if (g) g.textContent = S.gpsError; },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    // heartbeat so the server knows we're still here even when standing still
    every(60000, async () => { if (S.profile?.online && S.profile.lat != null) { try { await rpc("driver_location", { p_lat: S.profile.lat, p_lng: S.profile.lng }); S.profile.location_at = new Date().toISOString(); } catch (_) {} } });
  },
  stopGps() {
    if (S.watchId != null) navigator.geolocation.clearWatch(S.watchId);
    S.watchId = null;
    try { S.wakeLock?.release(); } catch (_) {}
    S.wakeLock = null;
  },
  async requestWake() { try { if ("wakeLock" in navigator) S.wakeLock = await navigator.wakeLock.request("screen"); } catch (_) {} },
};

// =====================================================================
// ADMIN
// =====================================================================
const Admin = {
  async start() {
    S.tab = "live";
    app().innerHTML = `${topbar("الإدارة")}<nav class="tabs" id="atabs"></nav><main class="wrap" id="amain"></main>`;
    $("#atabs").onclick = (e) => { const t = e.target.closest("[data-tab]"); if (t) { S.tab = t.dataset.tab; this.render(); } };
    $("#amain").addEventListener("click", (e) => this.onClick(e));
    $("#amain").addEventListener("click", (e) => { const g = e.target.closest("[data-tab-go]"); if (g) { S.tab = g.dataset.tabGo; this.render(); } });
    window.addEventListener("resize", () => { if (S.tab === "map") this.fitLive(); });
    $("#amain").addEventListener("click", (e) => {
      if (e.target.closest("[data-act], a")) return;
      const row = e.target.closest("[data-focus]"); if (!row) return;
      S.focusOrder = Number(row.dataset.focus); S.tab = "map"; this.render();
    });
    await this.load();
    this.subscribe();
    every(20000, () => this.load());
    every(1000, () => document.querySelectorAll("[data-exp]").forEach((el) => {
      const s = Math.max(0, Math.round((new Date(el.dataset.exp) - Date.now()) / 1000)); el.textContent = `${s} ث`;
    }));
  },
  async load() {
    const since = new Date(Date.now() - 864e5).toISOString();
    const [o, p, b, z] = await Promise.all([
      sb.from("orders").select("*").or(`status.in.(${ACTIVE.join(",")}),created_at.gte.${since}`).order("id", { ascending: false }).limit(500),
      sb.from("profiles").select("*").order("created_at"),
      sb.from("driver_balances").select("*"),
      sb.from("zones").select("*").order("name"),
    ]);
    S.orders = o.data || [];
    S.people = p.data || [];
    S.balances = Object.fromEntries((b.data || []).map((x) => [x.driver_id, x]));
    S.zones = z.data || [];
    S.people.forEach((x) => (x.role === "driver" ? (S.drivers[x.id] = x) : x.role === "restaurant" ? (S.restaurants[x.id] = x) : 0));
    if (!S.feed) this.buildFeed();
    this.render(true);
  },
  subscribe() {
    S.channel = sb.channel("admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (p) => {
        const o = p.new; if (!o?.id) return;
        const i = S.orders.findIndex((x) => x.id === o.id);
        const prev = i >= 0 ? S.orders[i] : null;
        if (i >= 0) S.orders[i] = o; else S.orders.unshift(o);
        if (!prev) this.pushFeed(o, "created");
        else if (prev.status !== o.status && o.status !== "searching") this.pushFeed(o, o.status);
        else if (o.status === "offered" && prev.offered_driver_id !== o.offered_driver_id) this.pushFeed(o, "offered");
        this.render(true);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, (p) => {
        const x = p.new; if (!x?.id) return;
        const i = S.people.findIndex((y) => y.id === x.id);
        if (i >= 0) S.people[i] = x; else S.people.push(x);
        if (x.role === "driver") { S.drivers[x.id] = x; this.updateMap(); if (S.tab === "drivers") this.render(); }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ledger" }, () => this.load())
      .subscribe();
  },
  render(soft = false) {
    const active = S.orders.filter((o) => ACTIVE.includes(o.status));
    const tabs = [["live", `الرئيسية${active.length ? `<span class="pill-count">${active.length}</span>` : ""}`], ["map", "🗺 الخريطة"], ["drivers", "السائقين"], ["restaurants", "المطاعم"], ["orders", "كل الطلبات"], ["accounts", "الحسابات"], ["reports", "التقارير"], ["zones", "المناطق والأجور"], ["flagged", "أرقام مرفوضة"], ["settings", "الإعدادات"]];
    $("#atabs").innerHTML = tabs.map(([k, l]) => `<button class="tab ${S.tab === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("");
    const m = $("#amain");
    // forms shouldn't be wiped by realtime updates
    if (soft && ["settings", "zones", "flagged", "accounts", "orders", "reports"].includes(S.tab) && m.dataset.view === S.tab) return;
    document.body.classList.toggle("live-mode", S.tab === "map");
    if (S.tab !== "map" && S.maps.admin) { S.maps.admin.remove(); S.maps.admin = null; S.markers = {}; S.fitted = false; }
    m.dataset.view = S.tab;
    if (S.tab === "live") return this.renderLive();
    if (S.tab === "map") return this.renderMap();
    if (S.tab === "accounts") return this.renderAccounts();
    if (S.tab === "reports") return this.renderReports();
    if (S.tab === "drivers") return this.renderDrivers();
    if (S.tab === "restaurants") return this.renderRestaurants();
    if (S.tab === "zones") return this.renderZones();
    if (S.tab === "orders") return this.renderOrders();
    if (S.tab === "flagged") return this.renderFlagged();
    if (S.tab === "settings") return this.renderSettings();
  },
  // ----- live -----
  liveNumbers() {
    const active = S.orders.filter((o) => ACTIVE.includes(o.status));
    const delivered = S.orders.filter((o) => o.created_at >= startOfToday() && o.status === "delivered");
    const stale = Number(S.settings?.location_stale_min || 10) * 60000;
    const online = Object.values(S.drivers).filter((d) => d.online && d.active && Date.now() - new Date(d.location_at) < stale);
    const totalDebt = Object.values(S.balances || {}).reduce((a, b) => a + Number(b.debt || 0), 0);
    return { active, delivered, online, totalDebt, commission: delivered.reduce((a, o) => a + Number(o.commission), 0) };
  },
  renderLive() {
    const n = this.liveNumbers();
    $("#amain").innerHTML = `
      <div class="stats five">
        <div class="stat"><div class="v num">${n.active.length}</div><div class="l">طلبات نشطة</div></div>
        <div class="stat"><div class="v num">${n.online.length}</div><div class="l">سائق متصل هسه</div></div>
        <div class="stat"><div class="v num">${n.delivered.length}</div><div class="l">توصّل اليوم</div></div>
        <div class="stat"><div class="v">${money(n.commission)}</div><div class="l">عمولة اليوم</div></div>
        <div class="stat"><div class="v">${money(n.totalDebt)}</div><div class="l">ديون على السائقين</div></div>
      </div>
      <div class="dash">
        <section class="card pad0"><div class="panel-h spread"><span>الطلبات النشطة</span><button class="btn sm ghost" data-tab-go="map">🗺 افتح الخريطة</button></div>
          <div id="liveOrders">${n.active.length ? n.active.map((o) => this.orderRow(o)).join("") : `<div class="empty">ماكو طلبات نشطة هسه</div>`}</div></section>
        <section class="card pad0"><div class="panel-h">آخر الأحداث</div><div id="feed" class="feed-scroll"></div></section>
      </div>`;
    this.renderFeed();
  },
  renderMap() {
    const m = $("#amain");
    if (!S.maps.admin) {
      m.innerHTML = `<div class="live"><div class="map-full" id="adminMap"></div><div class="float-stats" id="liveStats"></div></div>`;
      S.maps.admin = makeMap($("#adminMap"), 14); S.markers = {}; S.fitted = false;
      S.maps.admin.zoomControl.setPosition("bottomleft");
      this.fitLive();
    }
    const n = this.liveNumbers();
    $("#liveStats").innerHTML = `
      <div class="fstat"><b class="num">${n.active.length}</b><span>طلبات نشطة</span></div>
      <div class="fstat"><b class="num">${n.online.length}</b><span>سائق متصل</span></div>
      <div class="fstat legend"><i class="lg free"></i>فاضي <i class="lg busy"></i>عنده طلب <i class="lg off"></i>مطفي</div>`;
    this.updateMap();
    if (S.focusOrder) {
      const o = S.orders.find((x) => x.id === S.focusOrder); S.focusOrder = null;
      const d = S.drivers[o?.driver_id || o?.offered_driver_id], r = S.restaurants[o?.restaurant_id];
      const target = d?.lat != null ? [d.lat, d.lng] : r?.lat != null ? [r.lat, r.lng] : null;
      if (target) { S.fitted = true; setTimeout(() => { S.maps.admin.setView(target, 16); (S.markers["d" + d?.id] || S.markers["r" + r?.id])?.openPopup(); }, 120); }
    }
  },
  fitLive() {
    const t = $("#atabs").getBoundingClientRect().bottom;
    document.documentElement.style.setProperty("--live-top", `${Math.round(t)}px`);
    setTimeout(() => S.maps.admin?.invalidateSize(), 50);
  },
  // activity feed: built from order timestamps, then extended live
  buildFeed() {
    const ev = [];
    S.orders.filter((o) => o.created_at >= startOfToday()).forEach((o) => {
      ev.push(this.feedItem(o, "created", o.created_at));
      if (o.accepted_at) ev.push(this.feedItem(o, "accepted", o.accepted_at));
      if (o.picked_up_at) ev.push(this.feedItem(o, "picked_up", o.picked_up_at));
      if (o.delivered_at) ev.push(this.feedItem(o, "delivered", o.delivered_at));
      if (["refused", "cancelled"].includes(o.status) && o.closed_at) ev.push(this.feedItem(o, o.status, o.closed_at));
    });
    S.feed = ev.sort((a, b) => new Date(b.t) - new Date(a.t)).slice(0, 60);
  },
  feedItem(o, kind, t) {
    const r = S.restaurants[o.restaurant_id]?.name || "مطعم";
    const d = S.drivers[o.driver_id || o.offered_driver_id]?.name || "السائق";
    const z = zoneName(o.zone_id);
    const map = {
      created: ["🍽", `<b>${esc(r)}</b> طلب سائق · طلب #${o.id} إلى ${esc(z)}`],
      offered: ["📨", `انرسل طلب #${o.id} إلى <b>${esc(d)}</b>`],
      accepted: ["🛵", `<b>${esc(d)}</b> وافق على طلب #${o.id} من ${esc(r)}`],
      picked_up: ["📦", `<b>${esc(d)}</b> استلم طلب #${o.id} من ${esc(r)}`],
      on_the_way: ["➡️", `<b>${esc(d)}</b> بالطريق للزبون · طلب #${o.id}`],
      delivered: ["✅", `<b>${esc(d)}</b> وصّل طلب #${o.id}`],
      refused: ["⛔", `الزبون رفض طلب #${o.id} (${esc(o.customer_name)})`],
      cancelled: ["✖️", `انلغى طلب #${o.id} من ${esc(r)}`],
    };
    const [icon, html] = map[kind] || ["•", `طلب #${o.id}: ${STATUS[kind] || kind}`];
    return { icon, html, t, kind, id: o.id };
  },
  pushFeed(o, kind) {
    const it = this.feedItem(o, kind, new Date().toISOString());
    (S.feed = S.feed || []).unshift(it); S.feed = S.feed.slice(0, 60); it.fresh = true;
    if (kind !== "offered") { toast(it.html.replace(/<[^>]+>/g, "")); if (["created", "accepted", "refused"].includes(kind)) beep(); }
  },
  renderFeed() {
    const el = $("#feed"); if (!el) return;
    el.innerHTML = (S.feed || []).length ? S.feed.map((f) => `<div class="feed-item ${f.fresh ? "fresh" : ""} k-${f.kind}"><span class="fi">${f.icon}</span><div>${f.html}<div class="small muted">${time(f.t)} · ${ago(f.t)}</div></div></div>`).join("") : `<div class="empty">ماكو أحداث اليوم بعد</div>`;
    (S.feed || []).forEach((f) => (f.fresh = false));
  },
  orderRow(o) {
    const r = S.restaurants[o.restaurant_id], d = S.drivers[o.driver_id || o.offered_driver_id];
    const waiting = ["searching", "offered"].includes(o.status);
    return `<div class="lorder" data-focus="${o.id}">
      <div class="spread"><b>#${o.id} · ${esc(r?.name || "")}</b>${chip(o.status)}</div>
      <div class="small">${esc(o.customer_name)} · ${tel(o.customer_phone)} · ${esc(zoneName(o.zone_id))}</div>
      <div class="small muted">${money(o.order_total)} + ${money(o.delivery_fee)} · ${time(o.created_at)}${d ? ` · ${o.status === "offered" ? "معروض على" : "السائق"}: <b>${esc(d.name)}</b>` : ""}${o.status === "offered" ? ` · <span data-exp="${o.offer_expires_at}"></span>` : ""}</div>
      <div class="row" style="margin-top:6px">
        ${waiting ? `<button class="btn sm dark" data-act="assign" data-id="${o.id}">إرسال لسائق</button>` : ""}
        ${o.driver_id ? `<button class="btn sm ghost" data-act="forceDeliver" data-id="${o.id}">تأشير توصّل</button>` : ""}
        <button class="btn sm ghost" data-act="cancelOrder" data-id="${o.id}">إلغاء</button>
      </div>
    </div>`;
  },
  assignModal(oid) {
    const o = S.orders.find((x) => x.id === oid); if (!o) return;
    const stale = Number(S.settings?.location_stale_min || 10) * 60000;
    const busy = new Set(S.orders.filter((x) => ["accepted", "picked_up", "on_the_way"].includes(x.status)).map((x) => x.driver_id));
    const km = (d) => (o.pickup_lat == null || d.lat == null ? null : Math.hypot((d.lat - o.pickup_lat) * 111, (d.lng - o.pickup_lng) * 93.5));
    const list = Object.values(S.drivers).filter((d) => d.active).map((d) => ({ d, km: km(d), fresh: d.online && Date.now() - new Date(d.location_at) < stale }))
      .sort((a, b) => (b.fresh - a.fresh) || ((a.km ?? 999) - (b.km ?? 999)));
    modal(`<h3>إرسال طلب #${o.id} لسائق</h3><p class="small muted" style="margin-top:-8px">يوصله عرض ويكدر يقبل أو يرفض خلال ${S.settings?.offer_timeout_sec || 30} ثانية.</p>
      ${list.map(({ d, km, fresh }) => `<div class="ledger-item" style="align-items:center"><div><b>${esc(d.name)}</b>
        <div class="small muted">${fresh ? "متصل" : "غير متصل"}${busy.has(d.id) ? " · عنده طلب" : ""}${km != null ? ` · ${km.toFixed(1)} كم` : ""}</div></div>
        <button class="btn sm ${fresh && !busy.has(d.id) ? "primary" : "ghost"}" data-pick="${d.id}">إرسال</button></div>`).join("") || `<div class="empty">ماكو سائقين</div>`}
      <button class="btn block" data-close style="margin-top:12px">سد</button>`, (bg, close) => {
      bg.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-pick]"); if (!b) return;
        b.disabled = true;
        try { await rpc("admin_offer", { oid, p_driver: b.dataset.pick }); toast("انرسل العرض للسائق"); close(); this.load(); }
        catch (err) { toast(errMsg(err), true); b.disabled = false; }
      });
    });
  },
  updateMap() {
    const map = S.maps.admin; if (!map) return;
    const busyOrder = {};
    S.orders.filter((o) => ["accepted", "picked_up", "on_the_way"].includes(o.status)).forEach((o) => (busyOrder[o.driver_id] = o));
    const stale = Number(S.settings?.location_stale_min || 10) * 60000;
    Object.values(S.drivers).forEach((d) => {
      const k = "d" + d.id;
      if (d.lat == null || !d.active) { if (S.markers[k]) { S.markers[k].remove(); delete S.markers[k]; } return; }
      const on = d.online && Date.now() - new Date(d.location_at) < stale;
      const bo = busyOrder[d.id];
      const icon = bigDriverIcon(d, on, bo);
      const pop = `<b>${esc(d.name)}</b> · ${tel(d.phone)}<br>${on ? "متصل" : "غير متصل"} · آخر موقع ${ago(d.location_at)}${bo ? `<br>طلب #${bo.id}: ${STATUS[bo.status]}<br>${esc(S.restaurants[bo.restaurant_id]?.name || "")} ← ${esc(zoneName(bo.zone_id))}` : ""}<br>الدين: ${money(S.balances?.[d.id]?.debt || 0)}`;
      if (S.markers[k]) S.markers[k].setLatLng([d.lat, d.lng]).setIcon(icon).setPopupContent(pop).setZIndexOffset(bo ? 1000 : on ? 500 : 0);
      else S.markers[k] = L.marker([d.lat, d.lng], { icon, zIndexOffset: bo ? 1000 : on ? 500 : 0 }).bindPopup(pop).addTo(map);
    });
    Object.values(S.restaurants).forEach((r) => {
      if (r.lat == null || S.markers["r" + r.id]) return;
      S.markers["r" + r.id] = L.marker([r.lat, r.lng], { icon: bigRestIcon(r) }).bindPopup(`<b>${esc(r.name)}</b><br>${tel(r.phone)}`).addTo(map);
    });
    if (!S.fitted) {
      const pts = Object.values(S.markers).map((mk) => mk.getLatLng());
      if (pts.length) {
        const mob = innerWidth <= 760;
        map.fitBounds(L.latLngBounds(pts), { maxZoom: 15, paddingTopLeft: [40, mob ? 90 : 90], paddingBottomRight: [40, 50] });
        S.fitted = true;
      }
    }
  },
  // ----- drivers -----
  renderDrivers() {
    const ds = S.people.filter((p) => p.role === "driver");
    const cap = Number(S.settings?.debt_cap || 0);
    $("#amain").innerHTML = `<div class="spread"><h2 style="margin:0">السائقين (${ds.length})</h2><button class="btn primary" data-act="addUser" data-role="driver">+ سائق جديد</button></div>
      <div class="card table-wrap" style="margin-top:12px;padding:0">
      <table><thead><tr><th>الاسم</th><th>الرقم</th><th>الحالة</th><th>الدين</th><th>توصيلات</th><th></th></tr></thead><tbody>
      ${ds.map((d) => { const b = S.balances?.[d.id] || {}; const debt = Number(b.debt || 0);
        return `<tr>
        <td><b>${esc(d.name)}</b>${d.vehicle ? `<div class="small muted">${esc(d.vehicle)}</div>` : ""}</td>
        <td>${tel(d.phone)}</td>
        <td>${!d.active ? `<span class="chip st-cancelled">موقوف</span>` : d.online ? `<span class="chip st-delivered">متصل</span>` : `<span class="chip">مطفي</span>`}<div class="small muted">${ago(d.location_at)}</div></td>
        <td><b class="${debt > 0 ? "pos" : ""}">${money(debt)}</b>${cap && debt >= cap ? `<div class="small" style="color:var(--bad)">واصل الحد</div>` : ""}</td>
        <td class="num">${b.delivered_count || 0}</td>
        <td><div class="row" style="flex-wrap:nowrap">
          <button class="btn sm ok" data-act="settle" data-id="${d.id}">تسديد</button>
          <button class="btn sm" data-act="ledger" data-id="${d.id}">الحساب</button>
          <button class="btn sm ghost" data-act="toggleActive" data-id="${d.id}">${d.active ? "إيقاف" : "تفعيل"}</button>
          <button class="btn sm ghost" data-act="resetPw" data-id="${d.id}">رمز جديد</button>
        </div></td></tr>`; }).join("") || `<tr><td colspan="6" class="empty">ماكو سائقين. ضيف أول سائق.</td></tr>`}
      </tbody></table></div>`;
  },
  // ----- restaurants -----
  renderRestaurants() {
    const rs = S.people.filter((p) => p.role === "restaurant");
    const today = S.orders.filter((o) => o.created_at >= startOfToday());
    $("#amain").innerHTML = `<div class="spread"><h2 style="margin:0">المطاعم والمحلات (${rs.length})</h2><button class="btn primary" data-act="addUser" data-role="restaurant">+ مطعم جديد</button></div>
      <div class="card table-wrap" style="margin-top:12px;padding:0">
      <table><thead><tr><th>الاسم</th><th>الرقم</th><th>العنوان</th><th>الموقع</th><th>طلبات اليوم</th><th></th></tr></thead><tbody>
      ${rs.map((r) => `<tr>
        <td><b>${esc(r.name)}</b>${!r.active ? ` <span class="chip st-cancelled">موقوف</span>` : ""}</td>
        <td>${tel(r.phone)}</td>
        <td class="small">${esc(r.address || "—")}${r.zone_id ? ` · ${esc(zoneName(r.zone_id))}` : ""}</td>
        <td class="small">${r.lat != null ? "✓ محدد" : `<span style="color:var(--warn)">غير محدد</span>`}</td>
        <td class="num">${today.filter((o) => o.restaurant_id === r.id).length}</td>
        <td><div class="row" style="flex-wrap:nowrap">
          <button class="btn sm ghost" data-act="toggleActive" data-id="${r.id}">${r.active ? "إيقاف" : "تفعيل"}</button>
          <button class="btn sm ghost" data-act="resetPw" data-id="${r.id}">رمز جديد</button>
        </div></td></tr>`).join("") || `<tr><td colspan="6" class="empty">ماكو مطاعم. ضيف أول مطعم.</td></tr>`}
      </tbody></table></div>
      <p class="small muted">موقع المطعم يتحدد من موبايل المطعم نفسه أول مرة يطلب سائق (أو من زر "حدد موقعي").</p>`;
  },
  // ----- zones -----
  renderZones() {
    $("#amain").innerHTML = `<div class="card narrow" style="margin:0 auto">
      <h2>المناطق وأجور التوصيل</h2>
      <p class="small muted" style="margin-top:-6px">أجرة التوصيل ثابتة لكل منطقة. الزبون يدفعها للسائق فوق مبلغ الطلب.</p>
      <div id="zoneList">${S.zones.map((z) => `<div class="row" style="flex-wrap:nowrap;margin-bottom:8px" data-zone="${z.id}">
        <input value="${esc(z.name)}" data-f="name" style="flex:2">
        <input value="${z.delivery_fee}" data-f="fee" inputmode="numeric" style="flex:1" class="ltr">
        <button class="btn sm ${z.active ? "" : "bad"}" data-act="zoneActive" data-id="${z.id}" title="تفعيل/إيقاف">${z.active ? "فعالة" : "موقوفة"}</button>
        <button class="btn sm dark" data-act="zoneSave" data-id="${z.id}">حفظ</button></div>`).join("") || `<div class="empty">ماكو مناطق بعد</div>`}</div>
      <div class="hr"></div>
      <form id="zoneAdd" class="row" style="flex-wrap:nowrap">
        <input name="name" placeholder="اسم المنطقة (مثلاً: حي بابل)" required style="flex:2">
        <input name="fee" placeholder="الأجرة" inputmode="numeric" required style="flex:1" class="ltr">
        <button class="btn primary">إضافة</button>
      </form></div>`;
    $("#zoneAdd").onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await sb.from("zones").insert({ name: e.target.name.value.trim(), delivery_fee: toNum(e.target.fee.value) });
      if (error) return toast(error.message.includes("duplicate") ? "المنطقة موجودة" : error.message, true);
      toast("انضافت المنطقة"); $("#amain").dataset.view = ""; await this.load();
    };
  },
  // ----- all orders -----
  async renderOrders() {
    const m = $("#amain");
    m.innerHTML = `<div class="card"><div class="row">
      <div style="flex:1;min-width:140px"><label>من تاريخ</label><input type="date" id="fFrom" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div style="flex:1;min-width:140px"><label>إلى تاريخ</label><input type="date" id="fTo" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div style="flex:1;min-width:140px"><label>الحالة</label><select id="fSt"><option value="">الكل</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      <button class="btn dark" id="fGo" style="align-self:end">عرض</button></div></div>
      <div id="ordersOut" style="margin-top:12px"></div>`;
    const go = async () => {
      const from = new Date($("#fFrom").value + "T00:00:00"), to = new Date($("#fTo").value + "T23:59:59");
      let q = sb.from("orders").select("*").gte("created_at", from.toISOString()).lte("created_at", to.toISOString()).order("id", { ascending: false }).limit(1000);
      if ($("#fSt").value) q = q.eq("status", $("#fSt").value);
      const { data, error } = await q; if (error) return toast(error.message, true);
      const del = data.filter((o) => o.status === "delivered");
      $("#ordersOut").innerHTML = `<div class="stats">
        <div class="stat"><div class="v num">${data.length}</div><div class="l">طلبات</div></div>
        <div class="stat"><div class="v num">${del.length}</div><div class="l">توصّل</div></div>
        <div class="stat"><div class="v">${money(del.reduce((a, o) => a + Number(o.delivery_fee), 0))}</div><div class="l">أجور توصيل</div></div>
        <div class="stat"><div class="v">${money(del.reduce((a, o) => a + Number(o.commission), 0))}</div><div class="l">عمولتك</div></div></div>
        <div class="card table-wrap" style="margin-top:12px;padding:0"><table><thead><tr><th>#</th><th>الوقت</th><th>المطعم</th><th>الزبون</th><th>المنطقة</th><th>المبلغ</th><th>التوصيل</th><th>السائق</th><th>الحالة</th></tr></thead><tbody>
        ${data.map((o) => `<tr><td class="num">${o.id}</td><td class="small">${dateTime(o.created_at)}</td><td>${esc(S.restaurants[o.restaurant_id]?.name || "")}</td>
          <td>${esc(o.customer_name)}<div class="small">${tel(o.customer_phone)}</div></td><td>${esc(zoneName(o.zone_id))}</td>
          <td>${money(o.order_total)}</td><td>${money(o.delivery_fee)}</td><td>${esc(S.drivers[o.driver_id]?.name || "—")}</td><td>${chip(o.status)}</td></tr>`).join("") || `<tr><td colspan="9" class="empty">ماكو طلبات</td></tr>`}
        </tbody></table></div>`;
    };
    $("#fGo").onclick = go; go();
  },
  // ----- flagged -----
  async renderFlagged() {
    const { data } = await sb.from("flagged_phones").select("*").order("updated_at", { ascending: false });
    $("#amain").innerHTML = `<div class="card narrow" style="margin:0 auto"><h2>أرقام رفضت أو ما ردت</h2>
      <p class="small muted" style="margin-top:-6px">المطعم يشوف تنبيه لما يكتب واحد من هذي الأرقام.</p>
      ${(data || []).map((f) => `<div class="ledger-item"><div><b>${tel(f.phone)}</b> · ${f.refused_count} مرة<div class="small muted">${esc(f.note || "")} · ${dateTime(f.updated_at)}</div></div>
        <button class="btn sm ghost" data-act="unflag" data-phone="${esc(f.phone)}">شيله</button></div>`).join("") || `<div class="empty">ماكو أرقام</div>`}</div>`;
  },
  // ----- accounts -----
  async renderAccounts() {
    const m = $("#amain");
    const month = S.accMonth || new Date().toISOString().slice(0, 7);
    S.accMonth = month;
    const [y, mo] = month.split("-").map(Number);
    const from = new Date(y, mo - 1, 1), to = new Date(y, mo, 1);
    const fromD = `${month}-01`, toD = `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, "0")}-01`;
    m.innerHTML = `<div class="spinner" style="margin:40px auto"></div>`;
    const [od, lg, ex, em, ft] = await Promise.all([
      sb.from("orders").select("id,commission,delivery_fee,driver_id").eq("status", "delivered").gte("delivered_at", from.toISOString()).lt("delivered_at", to.toISOString()).limit(10000),
      sb.from("ledger").select("amount,kind,driver_id").gte("created_at", from.toISOString()).lt("created_at", to.toISOString()).limit(10000),
      sb.from("expenses").select("*").gte("spent_on", fromD).lt("spent_on", toD).order("spent_on", { ascending: false }),
      sb.from("employees").select("*").order("active", { ascending: false }).order("name"),
      sb.rpc("finance_totals"),
    ]);
    const T = ft.data || {};
    if (ex.error) { m.innerHTML = `<div class="alert bad">${esc(ex.error.message)}</div>`; return; }
    const orders = od.data || [], ledger = lg.data || [], exps = ex.data || [], emps = em.data || [];
    const commission = orders.reduce((a, o) => a + Number(o.commission), 0);
    const received = -ledger.filter((l) => l.kind === "settlement").reduce((a, l) => a + Number(l.amount), 0);
    const salaries = exps.filter((e) => e.category === "رواتب").reduce((a, e) => a + Number(e.amount), 0);
    const other = exps.filter((e) => e.category !== "رواتب").reduce((a, e) => a + Number(e.amount), 0);
    const net = commission - salaries - other;
    const debt = Object.values(S.balances || {}).reduce((a, b) => a + Number(b.debt || 0), 0);
    const byCat = {}; exps.forEach((e) => (byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount)));
    const paid = {}; exps.filter((e) => e.employee_id).forEach((e) => (paid[e.employee_id] = (paid[e.employee_id] || 0) + Number(e.amount)));
    const CATS = ["إيجار", "وقود", "إعلانات", "اتصالات وإنترنت", "صيانة", "مكتب ولوازم", "أخرى"];
    const today = new Date().toISOString().slice(0, 10);
    const allNet = Number(T.commission || 0) + Number(T.adjustments || 0) - Number(T.salaries || 0) - Number(T.expenses || 0);
    const cashIn = Number(T.received || 0) + Number(T.capital || 0);
    const cashOut = Number(T.expenses || 0) + Number(T.salaries || 0) + Number(T.withdrawals || 0);
    const partners = T.partners || [];
    const shareSum = partners.filter((p) => p.active).reduce((a, p) => a + Number(p.share), 0);
    m.innerHTML = `
      <h2 style="margin:0 0 12px">الحسابات</h2>
      <div class="dash" style="margin-top:0">
        <section class="card">
          <h3>💰 القاصة (النقد اللي عندكم هسه)</h3>
          <div class="acc-line"><span>استلمتوا من السائقين (عمولات)</span><b class="neg">+${money(T.received)}</b></div>
          <div class="acc-line"><span>رأس مال دخّله الشركاء</span><b class="neg">+${money(T.capital)}</b></div>
          <div class="acc-line"><span>مصاريف</span><b class="pos">−${money(T.expenses)}</b></div>
          <div class="acc-line"><span>رواتب</span><b class="pos">−${money(T.salaries)}</b></div>
          <div class="acc-line"><span>سحوبات الشركاء</span><b class="pos">−${money(T.withdrawals)}</b></div>
          <div class="acc-line total"><span>الرصيد بالقاصة</span><b>${money(cashIn - cashOut)}</b></div>
          <p class="small muted" style="margin:8px 0 0">وبرّه القاصة: ديون على السائقين ما استلمتوها بعد <b>${money(T.debt)}</b></p>
        </section>
        <section class="card">
          <h3>🤝 الشركاء</h3>
          ${partners.length && Math.abs(shareSum - 100) > 0.01 ? `<div class="alert warn small" style="margin-bottom:8px">مجموع النسب ${shareSum}% لازم يكون 100%</div>` : ""}
          <p class="small muted" style="margin:-6px 0 8px">صافي ربح الشركة من البداية: <b>${money(allNet)}</b> (العمولات − الرواتب − المصاريف)</p>
          ${partners.map((p) => { const due = allNet * Number(p.share) / 100 - Number(p.withdrawals);
            return `<div class="partner"><div class="spread"><b>${esc(p.name)} · ${Number(p.share)}%</b>
              <div class="row" style="flex-wrap:nowrap"><button class="btn sm ok" data-act="pWithdraw" data-id="${p.id}">سحب</button><button class="btn sm" data-act="pCapital" data-id="${p.id}">رأس مال</button><button class="btn sm ghost" data-act="pShare" data-id="${p.id}" data-share="${p.share}">النسبة</button></div></div>
              <div class="small muted">حصته من الربح ${money(allNet * Number(p.share) / 100)} · سحب ${money(p.withdrawals)} · رأس ماله ${money(p.capital)}</div>
              <div class="small">باقي إله: <b class="${due >= 0 ? "neg" : "pos"}">${money(due)}</b></div></div>`; }).join("") || `<div class="empty">ضيف الشريكين ونسبة كل واحد</div>`}
          <form id="partnerForm" class="exp-form" style="margin-top:10px">
            <input name="name" placeholder="اسم الشريك" required>
            <input name="share" inputmode="numeric" class="ltr" placeholder="النسبة %" required>
            <button class="btn dark">إضافة شريك</button>
          </form>
        </section>
      </div>
      <div class="spread" style="margin-top:24px"><h2 style="margin:0">حسابات الشهر</h2><input type="month" id="accMonth" value="${month}" style="width:auto"></div>
      <div class="stats five" style="margin-top:12px">
        <div class="stat"><div class="v">${money(commission)}</div><div class="l">العمولات (${orders.length} طلب)</div></div>
        <div class="stat"><div class="v">${money(received)}</div><div class="l">استلمت من السائقين</div></div>
        <div class="stat"><div class="v">${money(salaries)}</div><div class="l">الرواتب</div></div>
        <div class="stat"><div class="v">${money(other)}</div><div class="l">المصاريف</div></div>
        <div class="stat ${net >= 0 ? "good" : "badv"}"><div class="v">${money(net)}</div><div class="l">الصافي (عمولات − رواتب − مصاريف)</div></div>
      </div>
      <p class="small muted">ديون على السائقين هسه (ما مستلمة بعد): <b>${money(debt)}</b></p>
      <div class="dash">
        <section class="card">
          <h3>المصاريف</h3>
          <form id="expForm" class="exp-form">
            <input type="date" name="spent_on" value="${today.startsWith(month) ? today : fromD}" required>
            <select name="category">${CATS.map((c) => `<option>${c}</option>`).join("")}</select>
            <input name="amount" inputmode="numeric" class="ltr" placeholder="المبلغ" required>
            <input name="note" placeholder="ملاحظة (اختياري)">
            <button class="btn primary">إضافة</button>
          </form>
          ${Object.keys(byCat).length ? `<div class="row" style="margin:10px 0">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<span class="chip">${esc(c)}: ${Number(v).toLocaleString("en-US")}</span>`).join("")}</div>` : ""}
          ${exps.map((e) => `<div class="ledger-item"><div><b>${esc(e.category)}</b>${e.employee_id ? ` · ${esc(emps.find((x) => x.id === e.employee_id)?.name || "")}` : ""}${e.note ? ` · ${esc(e.note)}` : ""}<div class="small muted">${esc(e.spent_on)}</div></div>
            <div class="row" style="flex-wrap:nowrap"><b>${money(e.amount)}</b><button class="btn sm ghost" data-act="delExp" data-id="${e.id}" title="حذف">✕</button></div></div>`).join("") || `<div class="empty">ماكو مصاريف بهذا الشهر</div>`}
        </section>
        <section class="card">
          <h3>الموظفين والرواتب</h3>
          ${emps.map((e) => { const p = paid[e.id] || 0, left = Math.max(0, Number(e.monthly_salary) - p);
            return `<div class="ledger-item" style="align-items:center"><div><b>${esc(e.name)}</b>${e.job ? ` · ${esc(e.job)}` : ""}${!e.active ? ` <span class="chip st-cancelled">متوقف</span>` : ""}
              <div class="small muted">الراتب ${money(e.monthly_salary)} · انصرف ${money(p)}${left ? ` · باقي <b style="color:var(--warn)">${Number(left).toLocaleString("en-US")}</b>` : " ✓"}</div></div>
              <div class="row" style="flex-wrap:nowrap">${e.active ? `<button class="btn sm ok" data-act="paySalary" data-id="${e.id}" data-left="${left}">صرف راتب</button>` : ""}
              <button class="btn sm ghost" data-act="toggleEmp" data-id="${e.id}">${e.active ? "إيقاف" : "تفعيل"}</button></div></div>`; }).join("") || `<div class="empty">ماكو موظفين بعد</div>`}
          <div class="hr"></div>
          <form id="empForm" class="exp-form">
            <input name="name" placeholder="اسم الموظف" required>
            <input name="job" placeholder="الوظيفة (محاسب، موزع...)">
            <input name="monthly_salary" inputmode="numeric" class="ltr" placeholder="الراتب الشهري" required>
            <button class="btn dark">إضافة موظف</button>
          </form>
        </section>
      </div>`;
    $("#partnerForm").onsubmit = async (e) => {
      e.preventDefault(); const f = e.target;
      const { error } = await sb.from("partners").insert({ name: f.name.value.trim(), share_percent: toNum(f.share.value) });
      if (error) return toast(errMsg(error), true);
      toast("انضاف الشريك"); this.renderAccounts();
    };
    $("#accMonth").onchange = (e) => { S.accMonth = e.target.value || month; this.renderAccounts(); };
    $("#expForm").onsubmit = async (e) => {
      e.preventDefault(); const f = e.target;
      const { error } = await sb.from("expenses").insert({ spent_on: f.spent_on.value, category: f.category.value, amount: toNum(f.amount.value), note: f.note.value || null });
      if (error) return toast(errMsg(error), true);
      toast("انضاف المصروف"); this.renderAccounts();
    };
    $("#empForm").onsubmit = async (e) => {
      e.preventDefault(); const f = e.target;
      const { error } = await sb.from("employees").insert({ name: f.name.value.trim(), job: f.job.value || null, monthly_salary: toNum(f.monthly_salary.value) });
      if (error) return toast(errMsg(error), true);
      toast("انضاف الموظف"); this.renderAccounts();
    };
  },
  // ----- reports -----
  async renderReports() {
    const m = $("#amain");
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const now = new Date();
    const presets = {
      today: ["اليوم", iso(now), iso(now)],
      yesterday: ["أمس", iso(new Date(now - 864e5)), iso(new Date(now - 864e5))],
      week: ["آخر 7 أيام", iso(new Date(now - 6 * 864e5)), iso(now)],
      month: ["هذا الشهر", iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)],
      last: ["الشهر الماضي", iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))],
    };
    S.rep ||= { key: "month", from: presets.month[1], to: presets.month[2] };
    m.innerHTML = `<div class="card no-print"><div class="row">
        ${Object.entries(presets).map(([k, [l]]) => `<button class="btn sm ${S.rep.key === k ? "dark" : "ghost"}" data-preset="${k}">${l}</button>`).join("")}
        <span class="row" style="flex-wrap:nowrap;margin-inline-start:auto"><input type="date" id="rFrom" value="${S.rep.from}" style="width:auto"> إلى <input type="date" id="rTo" value="${S.rep.to}" style="width:auto"><button class="btn sm dark" id="rGo">عرض</button></span>
      </div></div><div id="repOut"><div class="spinner" style="margin:40px auto"></div></div>`;
    m.querySelectorAll("[data-preset]").forEach((b) => (b.onclick = () => { const [, f, t] = presets[b.dataset.preset]; S.rep = { key: b.dataset.preset, from: f, to: t }; this.renderReports(); }));
    $("#rGo").onclick = () => { S.rep = { key: "custom", from: $("#rFrom").value, to: $("#rTo").value }; this.renderReports(); };
    const [{ data: R, error }, { data: T }] = await Promise.all([rpc0("profit_report", { p_from: S.rep.from, p_to: S.rep.to }), rpc0("finance_totals")]);
    if (error) { $("#repOut").innerHTML = `<div class="alert bad">${esc(error.message)}</div>`; return; }
    const net = Number(R.commission) - Number(R.salaries) - Number(R.expenses);
    const partners = (T?.partners || []).filter((p) => p.active);
    const n = (v) => Number(v || 0).toLocaleString("en-US");
    const tbl = (head, rows) => `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${head.length}" class="empty">ماكو بيانات</td></tr>`}</tbody></table></div>`;
    const st = R.by_status || {};
    const totalOrders = Object.values(st).reduce((a, v) => a + v, 0);
    $("#repOut").innerHTML = `
      <div class="spread" style="margin:16px 0 8px"><h2 style="margin:0">تقرير الأرباح · من <span class="num">${S.rep.from}</span> إلى <span class="num">${S.rep.to}</span></h2>
        <div class="row no-print"><button class="btn sm" id="rCsv">⬇ تنزيل Excel</button><button class="btn sm" onclick="window.print()">🖨 طباعة</button></div></div>
      <div class="stats five">
        <div class="stat"><div class="v">${money(R.commission)}</div><div class="l">العمولات (الإيراد)</div></div>
        <div class="stat"><div class="v">${money(R.salaries)}</div><div class="l">الرواتب</div></div>
        <div class="stat"><div class="v">${money(R.expenses)}</div><div class="l">المصاريف</div></div>
        <div class="stat ${net >= 0 ? "good" : "badv"}"><div class="v">${money(net)}</div><div class="l">صافي الربح</div></div>
        <div class="stat"><div class="v">${money(R.received)}</div><div class="l">نقد استلمتوه من السائقين</div></div>
      </div>
      <div class="dash">
        <section class="card"><h3>توزيع الربح على الشركاء</h3>
          ${partners.length ? partners.map((p) => `<div class="acc-line"><span>${esc(p.name)} (${Number(p.share)}%)</span><b>${money(net * Number(p.share) / 100)}</b></div>`).join("") : `<div class="small muted">ضيف الشركاء ونسبهم من تبويب الحسابات.</div>`}
          <div class="hr"></div>
          <h3>الطلبات</h3>
          <div class="acc-line"><span>كل الطلبات</span><b class="num">${totalOrders}</b></div>
          <div class="acc-line"><span>توصّلت</span><b class="num">${n(R.orders)}</b></div>
          <div class="acc-line"><span>رفض / ما رد</span><b class="num">${n(st.refused)}</b></div>
          <div class="acc-line"><span>ملغية</span><b class="num">${n(st.cancelled)}</b></div>
          <div class="acc-line"><span>قيمة الطلبات الموصلة</span><b>${money(R.order_value)}</b></div>
          <div class="acc-line"><span>أجور التوصيل (للسائقين)</span><b>${money(R.delivery_fees)}</b></div>
          <div class="acc-line"><span>معدل العمولة بالطلب</span><b>${money(R.orders ? Math.round(R.commission / R.orders) : 0)}</b></div>
          ${Object.keys(R.by_category || {}).length ? `<div class="hr"></div><h3>المصاريف حسب النوع</h3>${Object.entries(R.by_category).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<div class="acc-line"><span>${esc(c)}</span><b>${money(v)}</b></div>`).join("")}` : ""}
        </section>
        <section class="card"><h3>يوم بيوم</h3>
          ${tbl(["اليوم", "طلبات", "عمولة", "مصروف", "الصافي", "نقد مستلم"], (R.by_day || []).filter((d) => d.orders || d.spent || d.received).reverse().map((d) => `<tr><td class="num">${d.day}</td><td class="num">${d.orders}</td><td class="num">${n(d.commission)}</td><td class="num">${n(d.spent)}</td><td class="num ${d.commission - d.spent >= 0 ? "neg" : "pos"}">${n(d.commission - d.spent)}</td><td class="num">${n(d.received)}</td></tr>`))}
        </section>
      </div>
      <section class="card" style="margin-top:16px"><h3>حسب السائق</h3>
        ${tbl(["السائق", "طلبات", "أجور توصيل", "عمولة", "سدد بالفترة", "دينه هسه"], (R.by_driver || []).map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.orders}</td><td class="num">${n(r.fees)}</td><td class="num">${n(r.commission)}</td><td class="num">${n(r.paid)}</td><td class="num ${r.debt_now > 0 ? "pos" : ""}">${n(r.debt_now)}</td></tr>`))}</section>
      <div class="dash">
        <section class="card"><h3>حسب المطعم</h3>
          ${tbl(["المطعم", "طلبات", "قيمة الطلبات", "عمولة"], (R.by_restaurant || []).map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.orders}</td><td class="num">${n(r.value)}</td><td class="num">${n(r.commission)}</td></tr>`))}</section>
        <section class="card"><h3>حسب المنطقة</h3>
          ${tbl(["المنطقة", "طلبات", "أجور توصيل", "عمولة"], (R.by_zone || []).map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.orders}</td><td class="num">${n(r.fees)}</td><td class="num">${n(r.commission)}</td></tr>`))}</section>
      </div>`;
    $("#rCsv").onclick = () => {
      const rows = [["تقرير الأرباح", S.rep.from, S.rep.to], [], ["العمولات", R.commission], ["الرواتب", R.salaries], ["المصاريف", R.expenses], ["صافي الربح", net], ["نقد مستلم", R.received], [],
        ...partners.map((p) => [`حصة ${p.name} (${p.share}%)`, Math.round(net * p.share / 100)]), [],
        ["اليوم", "طلبات", "عمولة", "مصروف", "الصافي", "نقد مستلم"], ...(R.by_day || []).map((d) => [d.day, d.orders, d.commission, d.spent, d.commission - d.spent, d.received]), [],
        ["السائق", "طلبات", "أجور توصيل", "عمولة", "سدد", "دينه هسه"], ...(R.by_driver || []).map((r) => [r.name, r.orders, r.fees, r.commission, r.paid, r.debt_now]), [],
        ["المطعم", "طلبات", "قيمة الطلبات", "عمولة"], ...(R.by_restaurant || []).map((r) => [r.name, r.orders, r.value, r.commission]), [],
        ["المنطقة", "طلبات", "أجور توصيل", "عمولة"], ...(R.by_zone || []).map((r) => [r.name, r.orders, r.fees, r.commission])];
      const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `تقرير-${S.rep.from}-${S.rep.to}.csv`; a.click();
    };
  },
  // ----- settings -----
  renderSettings() {
    const s = S.settings || {};
    $("#amain").innerHTML = `<form class="card narrow" id="setForm" style="margin:0 auto">
      <h2>الإعدادات</h2>
      <div class="section-title" style="margin-top:0">الهوية</div>
      <div class="field"><label>اسم التطبيق</label><input name="app_name" value="${esc(s.app_name)}" required></div>
      <div class="field"><label>رابط اللوگو (صورة مربعة)</label><input name="logo_url" class="ltr" value="${esc(s.logo_url || "")}" placeholder="https://..."></div>
      <div class="field"><label>اللون الرئيسي</label><div class="row" style="flex-wrap:nowrap"><input type="color" name="primary_color" value="${esc(s.primary_color)}" style="width:64px;padding:4px;height:48px"><span class="small muted">يتغير عند الكل مباشرة</span></div></div>
      <div class="field"><label>الخط</label><select name="font_family">${Object.keys(FONTS).map((f) => `<option value="${f}" ${(s.font_family || "IBM Plex Sans Arabic") === f ? "selected" : ""}>${f}</option>`).join("")}</select>
        <div id="fontPreview" class="card" style="margin-top:8px;font-size:18px;box-shadow:none">جايك بالطريق — طلب جديد #125 · ربحك 2,500 د.ع</div></div>
      <div class="field"><label>رقم الدعم</label><input name="support_phone" type="tel" value="${esc(s.support_phone || "")}"></div>
      <div class="section-title">العمولة والديون</div>
      <div class="field"><label>نوع العمولة</label><select name="commission_type">
        <option value="fixed" ${s.commission_type === "fixed" ? "selected" : ""}>مبلغ ثابت على كل طلب</option>
        <option value="percent" ${s.commission_type === "percent" ? "selected" : ""}>نسبة من أجرة التوصيل</option></select></div>
      <div class="field"><label id="commLbl">قيمة العمولة</label><input name="commission_value" inputmode="numeric" class="ltr" value="${s.commission_value}"></div>
      <div class="field"><label>حد الدين (يوقف الطلبات عن السائق لحد ما يسدد) — 0 = بلا حد</label><input name="debt_cap" inputmode="numeric" class="ltr" value="${s.debt_cap}"></div>
      <div class="section-title">التوزيع</div>
      <div class="field"><label>مهلة قبول السائق (ثانية)</label><input name="offer_timeout_sec" inputmode="numeric" class="ltr" value="${s.offer_timeout_sec}"></div>
      <div class="field"><label>كم طلب بنفس الوقت للسائق</label><input name="max_active_per_driver" inputmode="numeric" class="ltr" value="${s.max_active_per_driver}"></div>
      <div class="field"><label>السائق يعتبر غير متصل إذا موقعه ما تحدث خلال (دقيقة)</label><input name="location_stale_min" inputmode="numeric" class="ltr" value="${s.location_stale_min}"></div>
      <button class="btn primary block big">حفظ</button>
      <p class="small muted">العمولة الجديدة تنطبق على الطلبات الجديدة فقط.</p>
    </form>`;
    const f = $("#setForm");
    const lbl = () => ($("#commLbl").textContent = f.commission_type.value === "percent" ? "النسبة % من أجرة التوصيل" : "مبلغ العمولة (د.ع) على كل طلب");
    f.commission_type.onchange = lbl; lbl();
    const prev = () => { loadFont(f.font_family.value); $("#fontPreview").style.fontFamily = `"${f.font_family.value}"`; };
    f.font_family.onchange = prev; prev();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const v = {
        app_name: f.app_name.value.trim(), font_family: f.font_family.value, logo_url: f.logo_url.value.trim() || null, primary_color: f.primary_color.value,
        support_phone: f.support_phone.value.trim() || null, commission_type: f.commission_type.value,
        commission_value: toNum(f.commission_value.value), debt_cap: toNum(f.debt_cap.value),
        offer_timeout_sec: Math.max(10, toNum(f.offer_timeout_sec.value) || 30),
        max_active_per_driver: Math.max(1, toNum(f.max_active_per_driver.value) || 1),
        location_stale_min: Math.max(2, toNum(f.location_stale_min.value) || 10), updated_at: new Date().toISOString(),
      };
      const { data, error } = await sb.from("settings").update(v).eq("id", 1).select().single();
      if (error) return toast(error.message, true);
      S.settings = data; applyBranding(); toast("انحفظت الإعدادات");
      app().querySelector(".brand").innerHTML = `${logoHtml()}<span>${esc(S.settings.app_name)}</span>`;
    };
  },
  // ----- actions -----
  async onClick(e) {
    const b = e.target.closest("[data-act]"); if (!b || b.tagName === "A") return;
    const id = b.dataset.id, act = b.dataset.act;
    const person = S.people?.find((p) => p.id === id);
    try {
      if (act === "assign") return this.assignModal(Number(id));
      if (act === "cancelOrder") { if (!confirm(`إلغاء طلب #${id}؟`)) return; await rpc("cancel_order", { oid: Number(id), reason: "ألغته الإدارة" }); toast("انلغى"); }
      if (act === "forceDeliver") { if (!confirm(`تأشير طلب #${id} كـ توصّل؟ (تنحسب العمولة على السائق)`)) return; await rpc("driver_update_status", { oid: Number(id), p_status: "delivered" }); toast("تم"); }
      if (act === "toggleActive") {
        const { error } = await sb.from("profiles").update({ active: !person.active, ...(person.active ? { online: false } : {}) }).eq("id", id);
        if (error) throw error; toast(person.active ? "انوقف الحساب" : "انفعل الحساب"); await this.load();
      }
      if (act === "resetPw") {
        const pw = prompt(`رمز جديد لـ ${person.name} (6 أحرف أو أكثر)`); if (!pw) return;
        await adminUsers({ action: "reset_password", user_id: id, password: pw }); toast("تغير الرمز. بلّغه بالرمز الجديد");
      }
      if (act === "addUser") return this.addUserModal(b.dataset.role);
      if (act === "settle") return this.settleModal(id);
      if (act === "ledger") return this.ledgerModal(id);
      if (act === "zoneSave") {
        const row = b.closest("[data-zone]");
        const { error } = await sb.from("zones").update({ name: row.querySelector('[data-f="name"]').value.trim(), delivery_fee: toNum(row.querySelector('[data-f="fee"]').value) }).eq("id", id);
        if (error) throw error; toast("انحفظت"); $("#amain").dataset.view = ""; await this.load();
      }
      if (act === "zoneActive") {
        const z = S.zones.find((x) => String(x.id) === id);
        const { error } = await sb.from("zones").update({ active: !z.active }).eq("id", id); if (error) throw error;
        $("#amain").dataset.view = ""; await this.load();
      }
      if (act === "pWithdraw" || act === "pCapital") {
        const amt = prompt(act === "pWithdraw" ? "مبلغ السحب:" : "مبلغ رأس المال المدخل:"); if (!amt || !toNum(amt)) return;
        const note = prompt("ملاحظة (اختياري):") || null;
        const { error } = await sb.from("partner_transactions").insert({ partner_id: Number(id), kind: act === "pWithdraw" ? "withdrawal" : "capital", amount: toNum(amt), note });
        if (error) throw error; toast("انسجل"); this.renderAccounts();
      }
      if (act === "pShare") {
        const v = prompt("النسبة الجديدة %:", b.dataset.share); if (v === null) return;
        const { error } = await sb.from("partners").update({ share_percent: toNum(v) }).eq("id", id);
        if (error) throw error; this.renderAccounts();
      }
      if (act === "delExp") { if (!confirm("تحذف هذا المصروف؟")) return; const { error } = await sb.from("expenses").delete().eq("id", id); if (error) throw error; toast("انحذف"); this.renderAccounts(); }
      if (act === "toggleEmp") { const { data: e } = await sb.from("employees").select("active").eq("id", id).single(); await sb.from("employees").update({ active: !e.active }).eq("id", id); this.renderAccounts(); }
      if (act === "paySalary") {
        const amt = prompt("مبلغ الراتب المصروف:", b.dataset.left || ""); if (!amt) return;
        const month = S.accMonth || new Date().toISOString().slice(0, 7);
        const today = new Date().toISOString().slice(0, 10);
        const { error } = await sb.from("expenses").insert({ category: "رواتب", amount: toNum(amt), employee_id: Number(id), salary_month: `${month}-01`, spent_on: today.startsWith(month) ? today : `${month}-01`, note: `راتب ${month}` });
        if (error) throw error; toast("انسجل الراتب"); this.renderAccounts();
      }
      if (act === "unflag") { await sb.from("flagged_phones").delete().eq("phone", b.dataset.phone); this.renderFlagged(); }
    } catch (err) { toast(errMsg(err), true); }
  },
  addUserModal(role) {
    const isR = role === "restaurant";
    modal(`<h3>${isR ? "مطعم / محل جديد" : "سائق جديد"}</h3>
      <form id="uForm">
        <div class="field"><label>${isR ? "اسم المطعم" : "اسم السائق"}</label><input name="name" required></div>
        <div class="field"><label>رقم الموبايل (يستعمله للدخول)</label><input name="phone" type="tel" inputmode="tel" required></div>
        <div class="field"><label>الرمز (6 أحرف أو أكثر)</label><input name="password" class="ltr" required minlength="6" value="${Math.random().toString().slice(2, 8)}"></div>
        ${isR ? `<div class="field"><label>العنوان</label><input name="address"></div>
          <div class="field"><label>المنطقة</label><select name="zone_id"><option value="">—</option>${S.zones.map((z) => `<option value="${z.id}">${esc(z.name)}</option>`).join("")}</select></div>`
        : `<div class="field"><label>نوع المركبة / رقمها (اختياري)</label><input name="vehicle"></div>`}
        <div class="row" style="flex-wrap:nowrap"><button class="btn primary" style="flex:1">إنشاء الحساب</button><button type="button" class="btn ghost" data-close>إلغاء</button></div>
      </form>`, (bg, close) => {
      $("#uForm", bg).onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target)); const btn = e.target.querySelector("button"); btn.disabled = true;
        try {
          await adminUsers({ action: "create", role, ...f, zone_id: f.zone_id ? Number(f.zone_id) : null });
          close();
          const link = location.origin + location.pathname;
          modal(`<h3>تم ✓</h3><p>دز هذي المعلومات لـ ${esc(f.name)}:</p>
            <div class="card" style="user-select:all;white-space:pre-line">الرابط: ${esc(link)}\nالرقم: ${esc(normPhone(f.phone))}\nالرمز: ${esc(f.password)}</div>
            <div class="row" style="margin-top:12px"><a class="btn ok" target="_blank" rel="noopener" href="https://wa.me/964${normPhone(f.phone).slice(1)}?text=${encodeURIComponent(`هلا ${f.name}، حسابك على ${S.settings.app_name} جاهز.\nالرابط: ${link}\nالرقم: ${normPhone(f.phone)}\nالرمز: ${f.password}`)}">إرسال واتساب</a><button class="btn" data-close>سد</button></div>`);
          this.load();
        } catch (err) { toast(errMsg(err), true); btn.disabled = false; }
      };
    });
  },
  settleModal(id) {
    const d = S.drivers[id], debt = Number(S.balances?.[id]?.debt || 0);
    modal(`<h3>تسديد — ${esc(d.name)}</h3><p>الدين الحالي: <b>${money(debt)}</b></p>
      <form id="sForm">
        <div class="field"><label>نوع الحركة</label><select name="kind"><option value="settlement">تسديد نقدي (ينقص الدين)</option><option value="adjustment">تعديل يدوي (+ يزيد / − ينقص)</option></select></div>
        <div class="field"><label>المبلغ</label><input name="amount" class="ltr" inputmode="numeric" value="${debt > 0 ? debt : ""}" required></div>
        <div class="field"><label>ملاحظة</label><input name="note" placeholder="مثلاً: سدد نقداً"></div>
        <div class="row" style="flex-wrap:nowrap"><button class="btn ok" style="flex:1">تأكيد</button><button type="button" class="btn ghost" data-close>إلغاء</button></div>
      </form>`, (bg, close) => {
      $("#sForm", bg).onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target; const raw = String(f.amount.value).trim(); const neg = /^[-−]/.test(raw);
        const amt = toNum(raw) * (f.kind.value === "adjustment" && neg ? -1 : 1);
        if (!amt) return toast("اكتب المبلغ", true);
        try { await rpc("admin_ledger_entry", { p_driver: id, p_amount: amt, p_kind: f.kind.value, p_note: f.note.value || (f.kind.value === "settlement" ? "تسديد نقدي" : "تعديل") }); close(); toast("انسجلت"); this.load(); }
        catch (err) { toast(errMsg(err), true); }
      };
    });
  },
  async ledgerModal(id) {
    const { data } = await sb.from("ledger").select("*").eq("driver_id", id).order("id", { ascending: false }).limit(200);
    const debt = (data || []).reduce((a, l) => a + Number(l.amount), 0);
    modal(`<h3>حساب ${esc(S.drivers[id]?.name)}</h3><p>الرصيد: <b>${money(debt)}</b> بذمته</p>
      ${(data || []).map((l) => `<div class="ledger-item"><div>${esc(l.note || l.kind)}<div class="small muted">${dateTime(l.created_at)}</div></div><b class="${Number(l.amount) > 0 ? "pos" : "neg"}">${Number(l.amount) > 0 ? "+" : ""}${money(l.amount)}</b></div>`).join("") || `<div class="empty">ماكو حركات</div>`}
      <button class="btn block" data-close style="margin-top:12px">سد</button>`);
  },
};

// ---------- go ----------
sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT" && S.profile) { S.profile = null; boot(); } });
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => { r.update(); setInterval(() => r.update(), 5 * 60000); }).catch(() => {});
  // a new version took over: reload once so everyone runs the latest app
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !window.__reloaded) { window.__reloaded = true; location.reload(); } });
}
boot().catch((e) => { app().innerHTML = `<div class="login"><div class="card"><div class="alert bad">${esc(errMsg(e))}</div><button class="btn block" style="margin-top:12px" onclick="location.reload()">حاول مرة ثانية</button></div></div>`; });
})();
