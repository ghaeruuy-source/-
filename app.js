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
const PERMS = [["live", "الرئيسية"], ["map", "الخريطة"], ["drivers", "السائقين"], ["restaurants", "المطاعم"], ["orders", "كل الطلبات"], ["vouchers", "السندات"], ["daily", "الحركة اليومية"], ["boxes", "الصناديق"], ["accounts", "الحسابات"], ["reports", "التقارير"], ["statement", "كشف حساب"], ["zones", "المناطق والأجور"], ["flagged", "أرقام مرفوضة"], ["users", "المستخدمين والصلاحيات"], ["settings", "الإعدادات"]];
const canTab = (k) => { const p = S.profile?.permissions; return !p || p.includes(k) || k === "live" && !p.length; };
const bgDay = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // Baghdad date (UTC+3, no DST)
const VT = { receive: "سند قبض", spend: "سند صرف", pay: "سند دفع" };
function numToWords(num) {
  num = Math.floor(Math.abs(Number(num) || 0));
  if (!num) return "صفر دينار";
  const ones = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
  const tens = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
  const hund = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];
  const u1000 = (n) => {
    const p = []; const h = Math.floor(n / 100), r = n % 100;
    if (h) p.push(hund[h]);
    if (r) p.push(r < 20 ? ones[r] : (r % 10 ? ones[r % 10] + " و" : "") + tens[Math.floor(r / 10)]);
    return p.join(" و");
  };
  const scales = [["", "", ""], ["ألف", "ألفان", "آلاف"], ["مليون", "مليونان", "ملايين"], ["مليار", "ملياران", "مليارات"]];
  const parts = []; let i = 0;
  while (num > 0 && i < scales.length) {
    const n = num % 1000;
    if (n) {
      const [one, two, few] = scales[i];
      parts.unshift(!i ? u1000(n) : n === 1 ? one : n === 2 ? two : n <= 10 ? `${u1000(n)} ${few}` : `${u1000(n)} ${one}`);
    }
    num = Math.floor(num / 1000); i++;
  }
  return parts.join(" و") + " دينار عراقي لا غير";
}
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
try { const cf = localStorage.getItem("jayek_font"); if (cf && FONTS[cf]) { loadFont(cf); document.documentElement.style.setProperty("--font", `"${cf}"`); } } catch (_) {}
function applyBranding() {
  const s = S.settings || {};
  const font = FONTS[s.font_family] ? s.font_family : "IBM Plex Sans Arabic";
  loadFont(font);
  document.documentElement.style.setProperty("--font", `"${font}"`);
  try { localStorage.setItem("jayek_font", font); } catch (_) {}
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
const DCOLORS = ["#E8590C", "#1971C2", "#2F9E44", "#AE3EC9", "#E03131", "#0C8599", "#F08C00", "#5F3DC4", "#C2255C", "#5C940D", "#364FC7", "#862E9C"];
function driverColor(id) {
  const ids = S.people?.filter((p) => p.role === "driver").map((p) => p.id) || [];
  let i = ids.indexOf(id);
  if (i < 0) { i = 0; for (const ch of String(id)) i = (i * 31 + ch.charCodeAt(0)) >>> 0; }
  return DCOLORS[i % DCOLORS.length];
}
const bigDriverIcon = (d, on, bo) => { const c = driverColor(d.id); return L.divIcon({ className: "", iconSize: [56, 70], iconAnchor: [28, 28], popupAnchor: [0, -26],
  html: `<div class="bpin ${!on ? "off" : bo ? "busy" : "free"}" style="--dc:${c}"><div class="bpin-c">🛵${bo ? `<span class="bpin-badge">#${bo.id}</span>` : ""}</div><div class="bpin-l">${esc(d.name)}</div></div>` }); };
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
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "settings" }, (p) => { S.settings = p.new; applyBranding(); })
      .subscribe();
  },
  render(soft = false) {
    const active = S.orders.filter((o) => ACTIVE.includes(o.status));
    const tabs = [["live", `الرئيسية${active.length ? `<span class="pill-count">${active.length}</span>` : ""}`], ["map", "🗺 الخريطة"], ["drivers", "السائقين"], ["restaurants", "المطاعم"], ["orders", "كل الطلبات"], ["vouchers", "السندات"], ["boxes", "💰 الصناديق"], ["daily", "الحركة اليومية"], ["accounts", "الحسابات"], ["reports", "التقارير"], ["zones", "المناطق والأجور"], ["flagged", "أرقام مرفوضة"], ["statement", "كشف حساب"], ["users", "المستخدمين والصلاحيات"], ["settings", "الإعدادات"]].filter(([k]) => canTab(k));
    if (!canTab(S.tab)) S.tab = tabs[0]?.[0] || "live";
    $("#atabs").innerHTML = tabs.map(([k, l]) => `<button class="tab ${S.tab === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("");
    const m = $("#amain");
    // forms shouldn't be wiped by realtime updates
    if (soft && ["settings", "zones", "flagged", "accounts", "orders", "reports", "vouchers", "daily", "users", "statement", "boxes"].includes(S.tab) && m.dataset.view === S.tab) return;
    document.body.classList.toggle("live-mode", S.tab === "map");
    if (S.tab !== "map" && S.maps.admin) { S.maps.admin.remove(); S.maps.admin = null; S.markers = {}; S.lines = {}; S.fitted = false; }
    m.dataset.view = S.tab;
    m.classList.toggle("wide", S.tab === "live");
    if (S.tab === "live") return this.renderLive();
    if (S.tab === "map") return this.renderMap();
    if (S.tab === "accounts") return this.renderAccounts();
    if (S.tab === "reports") return this.renderReports();
    if (S.tab === "vouchers") return this.renderVouchers();
    if (S.tab === "daily") return this.renderDaily();
    if (S.tab === "boxes") return this.renderBoxes();
    if (S.tab === "drivers") return this.renderDrivers();
    if (S.tab === "restaurants") return this.renderRestaurants();
    if (S.tab === "zones") return this.renderZones();
    if (S.tab === "orders") return this.renderOrders();
    if (S.tab === "flagged") return this.renderFlagged();
    if (S.tab === "settings") return this.renderSettings();
    if (S.tab === "users") return this.renderUsers();
    if (S.tab === "statement") return this.renderStatement();
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
      <div class="ldash">
        <aside class="lside">
          <div class="stats mini">
            <div class="stat"><div class="v num">${n.active.length}</div><div class="l">طلبات نشطة</div></div>
            <div class="stat"><div class="v num">${n.online.length}</div><div class="l">سائق متصل</div></div>
            <div class="stat"><div class="v num">${n.delivered.length}</div><div class="l">توصّل اليوم</div></div>
            <div class="stat"><div class="v">${money(n.commission)}</div><div class="l">عمولة اليوم</div></div>
            <div class="stat wide"><div class="v">${money(n.totalDebt)}</div><div class="l">ديون على السائقين</div></div>
          </div>
          <section class="card pad0"><div class="panel-h spread"><span>الطلبات النشطة</span><button class="btn sm ghost" data-tab-go="map">🗺 الخريطة</button></div>
            <div id="liveOrders">${n.active.length ? n.active.map((o) => this.orderRow(o)).join("") : `<div class="empty">ماكو طلبات نشطة هسه</div>`}</div></section>
        </aside>
        <section class="card pad0 lfeed"><div class="panel-h">🔔 آخر الأحداث</div><div id="feed" class="feed-scroll"></div></section>
      </div>`;
    this.renderFeed();
  },
  renderMap() {
    const m = $("#amain");
    if (!S.maps.admin) {
      m.innerHTML = `<div class="live"><div class="map-full" id="adminMap"></div><div class="float-stats" id="liveStats"></div></div>`;
      S.maps.admin = makeMap($("#adminMap"), 14); S.markers = {}; S.lines = {}; S.fitted = false;
      S.maps.admin.zoomControl.setPosition("bottomleft");
      this.fitLive();
    }
    const n = this.liveNumbers();
    $("#liveStats").innerHTML = `
      <div class="fstat"><b class="num">${n.active.length}</b><span>طلبات نشطة</span></div>
      <div class="fstat"><b class="num">${n.online.length}</b><span>سائق متصل</span></div>
      <div class="fstat legend">كل سائق بلونه · <i class="ln dash"></i>رايح للمطعم <i class="ln"></i>استلم الطلب <i class="lg off"></i>مطفي</div>`;
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
    // line restaurant <-> driver for every accepted order, in the driver's color
    S.lines ||= {};
    const keep = {};
    Object.values(busyOrder).forEach((o) => {
      const d = S.drivers[o.driver_id], r = S.restaurants[o.restaurant_id];
      const rl = o.pickup_lat != null ? [o.pickup_lat, o.pickup_lng] : r?.lat != null ? [r.lat, r.lng] : null;
      if (!d || d.lat == null || !rl) return;
      keep[o.id] = 1;
      const pts = [rl, [d.lat, d.lng]], c = driverColor(d.id), toRest = o.status === "accepted";
      const style = { color: c, weight: 5, opacity: 0.9, dashArray: toRest ? "10 10" : null, lineCap: "round" };
      const tip = `#${o.id} · ${esc(d.name)} ${toRest ? "رايح للمطعم" : "استلم الطلب"}`;
      if (S.lines[o.id]) { S.lines[o.id].setLatLngs(pts).setStyle(style); S.lines[o.id].setTooltipContent(tip); }
      else S.lines[o.id] = L.polyline(pts, style).bindTooltip(tip, { sticky: true }).addTo(map);
    });
    Object.keys(S.lines).forEach((id) => { if (!keep[id]) { S.lines[id].remove(); delete S.lines[id]; } });
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
  removedList(role) {
    const xs = S.people.filter((p) => p.role === role && p.removed_at);
    if (!xs.length) return "";
    return `<details class="add-box removed-box"><summary>🗑 ${role === "driver" ? "السواق" : "المطاعم"} المحذوفين (${xs.length})</summary>
      <div class="card table-wrap" style="padding:0;margin-top:8px"><table><thead><tr><th>الاسم</th><th>الرقم</th><th>انحذف</th><th>السبب</th>${role === "driver" ? "<th>دينه</th>" : ""}<th></th></tr></thead><tbody>
      ${xs.map((x) => `<tr class="voided-soft"><td><b>${esc(x.name)}</b></td><td class="num">${esc(x.phone || "")}</td><td class="num">${dateTime(x.removed_at)}</td><td>${esc(x.removed_reason || "")}</td>
        ${role === "driver" ? `<td>${money(S.balances?.[x.id]?.debt || 0)}</td>` : ""}
        <td><div class="row" style="flex-wrap:nowrap">${canTab("statement") ? `<button class="btn sm ghost" data-act="stmt" data-type="${role}" data-id="${x.id}">كشف حساب</button>` : ""}<button class="btn sm" data-act="restoreAcc" data-id="${x.id}">إرجاع</button></div></td></tr>`).join("")}
      </tbody></table></div></details>`;
  },
  removeModal(id) {
    const p = S.people.find((x) => x.id === id); if (!p) return;
    const debt = p.role === "driver" ? Number(S.balances?.[id]?.debt || 0) : 0;
    modal(`<h3>🗑 حذف ${p.role === "driver" ? "السائق" : "المطعم"}: ${esc(p.name)}</h3>
      <p class="small muted">الحساب ينقفل وما يكدر يدخل، ويختفي من القوائم. حساباته وطلباته القديمة تبقى محفوظة، وتكدر ترجعه من قائمة المحذوفين.</p>
      ${debt > 0 ? `<div class="alert warn small">انتبه: عليه دين <b>${money(debt)}</b> ما مسدد. الدين يبقى محفوظ بكشف حسابه.</div>` : ""}
      <form id="rmForm"><div class="field"><label>سبب الحذف (لازم)</label><input name="reason" required placeholder="مثلاً: ترك الشغل"></div>
      <div class="row" style="flex-wrap:nowrap"><button class="btn bad" style="flex:1">حذف</button><button type="button" class="btn ghost" data-close>إلغاء</button></div></form>`, (bg, close) => {
      $("#rmForm", bg).onsubmit = async (e) => {
        e.preventDefault(); const btn = e.target.querySelector("button"); btn.disabled = true;
        try { await rpc("archive_account", { p_id: id, p_reason: e.target.reason.value }); close(); toast("انحذف"); await this.load(); this.render(); }
        catch (err) { toast(errMsg(err), true); btn.disabled = false; }
      };
    });
  },
  // ----- drivers -----
  renderDrivers() {
    const ds = S.people.filter((p) => p.role === "driver" && !p.removed_at);
    const cap = Number(S.settings?.debt_cap || 0);
    $("#amain").innerHTML = `<div class="spread"><h2 style="margin:0">السائقين (${ds.length})</h2><button class="btn primary" data-act="addUser" data-role="driver">+ سائق جديد</button></div>
      <div class="card table-wrap" style="margin-top:12px;padding:0">
      <table><thead><tr><th>الاسم</th><th>الرقم</th><th>الحالة</th><th>الدين</th><th>توصيلات</th><th></th></tr></thead><tbody>
      ${ds.map((d) => { const b = S.balances?.[d.id] || {}; const debt = Number(b.debt || 0);
        return `<tr>
        <td><i class="cdot" style="background:${driverColor(d.id)}"></i><b>${esc(d.name)}</b>${d.vehicle ? `<div class="small muted">${esc(d.vehicle)}</div>` : ""}</td>
        <td>${tel(d.phone)}</td>
        <td>${!d.active ? `<span class="chip st-cancelled">موقوف</span>` : d.online ? `<span class="chip st-delivered">متصل</span>` : `<span class="chip">مطفي</span>`}<div class="small muted">${ago(d.location_at)}</div></td>
        <td><b class="${debt > 0 ? "pos" : ""}">${money(debt)}</b>${cap && debt >= cap ? `<div class="small" style="color:var(--bad)">واصل الحد</div>` : ""}</td>
        <td class="num">${b.delivered_count || 0}</td>
        <td><div class="row" style="flex-wrap:nowrap">
          <button class="btn sm ok" data-act="settle" data-id="${d.id}">تسديد</button>
          <button class="btn sm" data-act="${canTab("statement") ? "stmt" : "ledger"}" data-type="driver" data-id="${d.id}">كشف حساب</button>
          <button class="btn sm ghost" data-act="toggleActive" data-id="${d.id}">${d.active ? "إيقاف" : "تفعيل"}</button>
          <button class="btn sm ghost" data-act="resetPw" data-id="${d.id}">رمز جديد</button>
          <button class="btn sm ghost danger" data-act="removeAcc" data-id="${d.id}">حذف</button>
        </div></td></tr>`; }).join("") || `<tr><td colspan="6" class="empty">ماكو سائقين. ضيف أول سائق.</td></tr>`}
      </tbody></table></div>${this.removedList("driver")}`;
  },
  // ----- restaurants -----
  renderRestaurants() {
    const rs = S.people.filter((p) => p.role === "restaurant" && !p.removed_at);
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
          ${canTab("statement") ? `<button class="btn sm" data-act="stmt" data-type="restaurant" data-id="${r.id}">كشف حساب</button>` : ""}
          <button class="btn sm ghost" data-act="toggleActive" data-id="${r.id}">${r.active ? "إيقاف" : "تفعيل"}</button>
          <button class="btn sm ghost" data-act="resetPw" data-id="${r.id}">رمز جديد</button>
          <button class="btn sm ghost danger" data-act="removeAcc" data-id="${r.id}">حذف</button>
        </div></td></tr>`).join("") || `<tr><td colspan="6" class="empty">ماكو مطاعم. ضيف أول مطعم.</td></tr>`}
      </tbody></table></div>${this.removedList("restaurant")}
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
      <div style="flex:1;min-width:140px"><label>من تاريخ</label><input type="date" id="fFrom" value="${bgDay()}"></div>
      <div style="flex:1;min-width:140px"><label>إلى تاريخ</label><input type="date" id="fTo" value="${bgDay()}"></div>
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
    const month = S.accMonth || bgDay().slice(0, 7);
    S.accMonth = month;
    const [y, mo] = month.split("-").map(Number);
    const from = new Date(y, mo - 1, 1), to = new Date(y, mo, 1);
    const fromD = `${month}-01`, toD = `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, "0")}-01`;
    m.innerHTML = `<div class="spinner" style="margin:40px auto"></div>`;
    const [od, lg, ex, em, ft] = await Promise.all([
      sb.from("orders").select("id,commission,delivery_fee,driver_id").eq("status", "delivered").gte("delivered_at", from.toISOString()).lt("delivered_at", to.toISOString()).limit(10000),
      sb.from("ledger").select("amount,kind,driver_id").gte("created_at", from.toISOString()).lt("created_at", to.toISOString()).limit(10000),
      sb.from("expenses").select("*").eq("void", false).gte("spent_on", fromD).lt("spent_on", toD).order("spent_on", { ascending: false }),
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
    const today = bgDay();
    const allNet = Number(T.commission || 0) + Number(T.other_income || 0) - Number(T.salaries || 0) - Number(T.expenses || 0);
    const cashIn = Number(T.received || 0) + Number(T.capital || 0) + Number(T.other_income || 0);
    const cashOut = Number(T.expenses || 0) + Number(T.salaries || 0) + Number(T.withdrawals || 0) + Number(T.other_payments || 0) + Number(T.driver_payouts || 0);
    const partners = T.partners || [];
    const shareSum = partners.filter((p) => p.active).reduce((a, p) => a + Number(p.share), 0);
    const catRows = Object.entries(byCat).sort((x, y) => y[1] - x[1]);
    const catMax = Math.max(1, ...catRows.map((r) => r[1]));
    m.innerHTML = `
      <div class="spread"><h2 style="margin:0">الحسابات</h2><label class="row" style="margin:0;gap:8px;color:var(--ink)"><span class="small muted">الشهر</span><input type="month" id="accMonth" value="${month}" style="width:auto"></label></div>
      <div class="stats five" style="margin-top:12px">
        <div class="stat"><div class="v">${money(commission)}</div><div class="l">العمولات (${orders.length} طلب)</div></div>
        <div class="stat"><div class="v">${money(received)}</div><div class="l">استلمت من السائقين</div></div>
        <div class="stat"><div class="v">${money(salaries)}</div><div class="l">الرواتب</div></div>
        <div class="stat"><div class="v">${money(other)}</div><div class="l">المصاريف</div></div>
        <div class="stat ${net >= 0 ? "good" : "badv"}"><div class="v">${money(net)}</div><div class="l">صافي الشهر</div></div>
      </div>
      <p class="small muted" style="margin:6px 0 0">ديون على السائقين هسه (ما مستلمة بعد): <b>${money(debt)}</b></p>
      <div class="acc-grid">
        <section class="card">
          <h3>💰 النقد اللي عندكم (من البداية)</h3>
          <div class="acc-line"><span>استلمتوا من السائقين</span><b class="neg">+${money(T.received)}</b></div>
          <div class="acc-line"><span>رأس مال الشركاء</span><b class="neg">+${money(T.capital)}</b></div>
          <div class="acc-line"><span>إيرادات أخرى</span><b class="neg">+${money(T.other_income)}</b></div>
          <div class="acc-line"><span>مصاريف</span><b class="pos">−${money(T.expenses)}</b></div>
          <div class="acc-line"><span>رواتب</span><b class="pos">−${money(T.salaries)}</b></div>
          <div class="acc-line"><span>سحوبات الشركاء</span><b class="pos">−${money(T.withdrawals)}</b></div>
          <div class="acc-line"><span>دفعات أخرى</span><b class="pos">−${money(Number(T.other_payments || 0) + Number(T.driver_payouts || 0))}</b></div>
          <div class="acc-line total"><span>الرصيد</span><b>${money(cashIn - cashOut)}</b></div>
          <p class="small muted" style="margin:8px 0 0">تفاصيل كل صندوق بتبويب <a href="#" data-tab-go="boxes">الصناديق</a></p>
        </section>
        <section class="card">
          <h3>🤝 الشركاء</h3>
          ${partners.length && Math.abs(shareSum - 100) > 0.01 ? `<div class="alert warn small" style="margin-bottom:8px">مجموع النسب ${shareSum}% لازم يكون 100%</div>` : ""}
          <p class="small muted" style="margin:-6px 0 8px">صافي الربح من البداية: <b>${money(allNet)}</b></p>
          ${partners.map((p) => { const due = allNet * Number(p.share) / 100 - Number(p.withdrawals);
            return `<div class="partner"><div class="spread"><b>${esc(p.name)} · ${Number(p.share)}%</b>
              <div class="row" style="flex-wrap:nowrap"><button class="btn sm ok" data-act="pWithdraw" data-id="${p.id}">سحب</button><button class="btn sm" data-act="pCapital" data-id="${p.id}">رأس مال</button><button class="btn sm ghost" data-act="pShare" data-id="${p.id}" data-share="${p.share}">النسبة</button></div></div>
              <div class="small muted">حصته ${money(allNet * Number(p.share) / 100)} · سحب ${money(p.withdrawals)} · رأس ماله ${money(p.capital)}</div>
              <div class="small">باقي إله: <b class="${due >= 0 ? "neg" : "pos"}">${money(due)}</b></div></div>`; }).join("") || `<div class="empty">ضيف الشريكين ونسبة كل واحد</div>`}
          <details class="add-box" ${partners.length ? "" : "open"}><summary>+ إضافة شريك</summary>
          <form id="partnerForm" class="exp-form">
            <input name="name" placeholder="اسم الشريك" required>
            <input name="share" inputmode="numeric" class="ltr" placeholder="النسبة %" required>
            <button class="btn dark">إضافة</button>
          </form></details>
        </section>
        <section class="card">
          <h3>👥 الموظفين والرواتب</h3>
          ${emps.map((e) => { const p = paid[e.id] || 0, left = Math.max(0, Number(e.monthly_salary) - p);
            return `<div class="emp-row"><div class="emp-info"><b>${esc(e.name)}</b>${e.job ? ` <span class="small muted">· ${esc(e.job)}</span>` : ""}${!e.active ? ` <span class="chip st-cancelled">متوقف</span>` : ""}
              <div class="small muted">الراتب ${money(e.monthly_salary)} · انصرف ${money(p)}${left ? ` · باقي <b style="color:var(--warn)">${Number(left).toLocaleString("en-US")}</b>` : " ✓"}</div></div>
              <div class="row emp-act">${e.active ? `<button class="btn sm ok" data-act="paySalary" data-id="${e.id}" data-left="${left}">صرف راتب</button><button class="btn sm" data-act="payAdvance" data-id="${e.id}">صرف سلفة</button>` : ""}
              <button class="btn sm ghost" data-act="toggleEmp" data-id="${e.id}">${e.active ? "إيقاف" : "تفعيل"}</button></div></div>`; }).join("") || `<div class="empty">ماكو موظفين بعد</div>`}
          <details class="add-box" ${emps.length ? "" : "open"}><summary>+ إضافة موظف</summary>
          <form id="empForm" class="exp-form">
            <input name="name" placeholder="اسم الموظف" required>
            <input name="job" placeholder="الوظيفة (محاسب، موزع...)">
            <input name="monthly_salary" inputmode="numeric" class="ltr" placeholder="الراتب الشهري" required>
            <button class="btn dark">إضافة</button>
          </form></details>
        </section>
        <section class="card">
          <h3>🧾 مصاريف الشهر <span class="small muted">(${money(salaries + other)})</span></h3>
          ${catRows.map(([c, v]) => `<div class="bar-row"><span>${esc(c)}</span><div class="bar"><i style="width:${Math.round(v / catMax * 100)}%"></i></div><b>${Number(v).toLocaleString("en-US")}</b></div>`).join("") || `<div class="empty">ماكو مصاريف بهذا الشهر</div>`}
          ${exps.length ? `<details class="add-box"><summary>عرض التفاصيل (${exps.length})</summary>
            ${exps.map((e) => `<div class="ledger-item"><div><b>${esc(e.category)}</b>${e.employee_id ? ` · ${esc(emps.find((x) => x.id === e.employee_id)?.name || "")}` : ""}${e.note ? ` · ${esc(e.note)}` : ""}<div class="small muted">${esc(e.spent_on)}</div></div><b>${money(e.amount)}</b></div>`).join("")}</details>` : ""}
          <p class="small muted" style="margin:8px 0 0">المصاريف تنضاف من تبويب <a href="#" data-tab-go="vouchers">السندات</a></p>
        </section>
      </div>`;
    $("#partnerForm").onsubmit = async (e) => {
      e.preventDefault(); const f = e.target;
      const { error } = await sb.from("partners").insert({ name: f.name.value.trim(), share_percent: toNum(f.share.value) });
      if (error) return toast(errMsg(error), true);
      toast("انضاف الشريك"); this.renderAccounts();
    };
    $("#accMonth").onchange = (e) => { S.accMonth = e.target.value || month; this.renderAccounts(); };
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
    S.repView ||= "profit";
    m.innerHTML = `<div class="seg no-print" style="margin-bottom:12px"><button data-rv="profit" class="${S.repView === "profit" ? "on" : ""}">📈 تقرير الأرباح</button><button data-rv="vouchers" class="${S.repView === "vouchers" ? "on" : ""}">🧾 تقرير السندات</button></div>
      <div class="card no-print"><div class="row">
        ${Object.entries(presets).map(([k, [l]]) => `<button class="btn sm ${S.rep.key === k ? "dark" : "ghost"}" data-preset="${k}">${l}</button>`).join("")}
        <span class="row date-range"><input type="date" id="rFrom" value="${S.rep.from}" style="width:auto"> إلى <input type="date" id="rTo" value="${S.rep.to}" style="width:auto"><button class="btn sm dark" id="rGo">عرض</button></span>
      </div></div><div id="repOut"><div class="spinner" style="margin:40px auto"></div></div>`;
    m.querySelectorAll("[data-preset]").forEach((b) => (b.onclick = () => { const [, f, t] = presets[b.dataset.preset]; S.rep = { key: b.dataset.preset, from: f, to: t }; this.renderReports(); }));
    $("#rGo").onclick = () => { S.rep = { key: "custom", from: $("#rFrom").value, to: $("#rTo").value }; this.renderReports(); };
    m.querySelectorAll("[data-rv]").forEach((b) => (b.onclick = () => { S.repView = b.dataset.rv; this.renderReports(); }));
    if (S.repView === "vouchers") return this.renderVoucherReport();
    const [{ data: R, error }, { data: T }] = await Promise.all([rpc0("profit_report", { p_from: S.rep.from, p_to: S.rep.to }), rpc0("finance_totals")]);
    if (error) { $("#repOut").innerHTML = `<div class="alert bad">${esc(error.message)}</div>`; return; }
    const net = Number(R.commission) + Number(R.other_income || 0) - Number(R.salaries) - Number(R.expenses);
    const partners = (T?.partners || []).filter((p) => p.active);
    const n = (v) => Number(v || 0).toLocaleString("en-US");
    const tbl = (head, rows) => `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${head.length}" class="empty">ماكو بيانات</td></tr>`}</tbody></table></div>`;
    const st = R.by_status || {};
    const totalOrders = Object.values(st).reduce((a, v) => a + v, 0);
    $("#repOut").innerHTML = `
      <div class="spread" style="margin:16px 0 8px"><h2 style="margin:0">تقرير الأرباح · من <span class="num">${S.rep.from}</span> إلى <span class="num">${S.rep.to}</span></h2>
        <div class="row no-print"><button class="btn sm" id="rCsv">⬇ تنزيل Excel</button><button class="btn sm" onclick="window.print()">🖨 طباعة</button></div></div>
      <div class="stats five">
        <div class="stat"><div class="v">${money(Number(R.commission) + Number(R.other_income || 0))}</div><div class="l">الإيرادات (عمولات ${n(R.commission)}${R.other_income ? ` + أخرى ${n(R.other_income)}` : ""})</div></div>
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
  // ----- vouchers (سندات) -----
  async loadVoucherRefs() {
    const [c, p, e] = await Promise.all([
      sb.from("expense_categories").select("*").order("id"),
      sb.from("partners").select("*").order("id"),
      sb.from("employees").select("*").order("name"),
    ]);
    S.cats = c.data || []; S.partners = p.data || []; S.employees = e.data || [];
  },
  async renderVouchers() {
    const m = $("#amain");
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const now = new Date();
    S.vf ||= { type: "", from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
    m.innerHTML = `<div class="spinner" style="margin:40px auto"></div>`;
    await this.loadVoucherRefs();
    let q = sb.from("vouchers").select("*").gte("voucher_date", S.vf.from).lte("voucher_date", S.vf.to).order("voucher_date", { ascending: false }).order("id", { ascending: false }).limit(1000);
    q = S.vf.type === "deleted" ? q.eq("cancelled", true) : q.eq("cancelled", false);
    if (S.vf.type && S.vf.type !== "deleted") q = q.eq("vtype", S.vf.type);
    const { data, error } = await q;
    if (error) { m.innerHTML = `<div class="alert bad">${esc(error.message)}</div>`; return; }
    const sum = (t) => data.filter((v) => v.vtype === t).reduce((a, v) => a + Number(v.amount), 0);
    const del = S.vf.type === "deleted";
    m.innerHTML = `
      <div class="spread"><h2 style="margin:0">السندات</h2>
        <div class="row"><button class="btn ok" data-act="newVoucher" data-type="receive">+ سند قبض</button><button class="btn bad" data-act="newVoucher" data-type="spend">+ سند صرف</button><button class="btn dark" data-act="newVoucher" data-type="pay">+ سند دفع</button></div></div>
      <div class="card" style="margin-top:12px"><div class="row">
        ${[["", "الكل"], ["receive", "قبض"], ["spend", "صرف"], ["pay", "دفع"], ["deleted", "🗑 المحذوفات"]].map(([k, l]) => `<button class="btn sm ${S.vf.type === k ? "dark" : "ghost"}" data-vf="${k}">${l}</button>`).join("")}
        <span class="row date-range"><input type="date" id="vFrom" value="${S.vf.from}" style="width:auto"> إلى <input type="date" id="vTo" value="${S.vf.to}" style="width:auto"></span></div></div>
      ${!del ? `<div class="stats" style="margin-top:12px">
        <div class="stat"><div class="v neg">${money(sum("receive"))}</div><div class="l">مقبوضات</div></div>
        <div class="stat"><div class="v pos">${money(sum("spend"))}</div><div class="l">مصروفات</div></div>
        <div class="stat"><div class="v pos">${money(sum("pay"))}</div><div class="l">مدفوعات</div></div>
        <div class="stat"><div class="v">${money(sum("receive") - sum("spend") - sum("pay"))}</div><div class="l">الفرق</div></div></div>` : `<div class="alert warn" style="margin-top:12px">السندات المحذوفة ما تدخل بالحسابات. تبقى هنا للمراجعة مع سبب الحذف.</div>`}
      <div class="card table-wrap" style="margin-top:12px;padding:0"><table><thead><tr><th>السند</th><th>التاريخ</th><th>الجهة</th><th>التبويب</th><th>المبلغ</th><th>${del ? "سبب الحذف" : "ملاحظة"}</th><th></th></tr></thead><tbody>
        ${data.map((v) => `<tr class="${v.cancelled ? "voided" : ""}"><td><span class="chip vt-${v.vtype}">${VT[v.vtype]} #${v.number}</span></td><td class="num">${v.voucher_date}</td><td>${esc(v.party_name || "—")}</td><td>${esc(v.category || "—")}</td><td><b>${money(v.amount)}</b></td>
          <td class="small">${del ? `${esc(v.cancel_reason || "")}<div class="muted">${dateTime(v.cancelled_at)}</div>` : esc(v.note || "")}</td>
          <td><div class="row" style="flex-wrap:nowrap"><button class="btn sm ghost" data-act="printV" data-id="${v.id}">🖨</button>${!del ? `<button class="btn sm ghost" data-act="cancelV" data-id="${v.id}">حذف</button>` : ""}</div></td></tr>`).join("") || `<tr><td colspan="7" class="empty">ماكو سندات</td></tr>`}
      </tbody></table></div>
      <section class="card" style="margin-top:16px"><h3>تبويبات المصاريف</h3>
        <div class="row">${S.cats.map((c) => `<button class="btn sm ${c.active ? "" : "ghost"}" data-cat="${c.id}" title="تفعيل/إيقاف">${esc(c.name)}${c.active ? "" : " (موقوف)"}</button>`).join("")}</div>
        <form id="catForm" class="row" style="margin-top:10px;flex-wrap:nowrap"><input name="name" placeholder="تبويب جديد (مثلاً: غرامات)" required><button class="btn dark">إضافة</button></form></section>`;
    S.vRows = data;
    m.querySelectorAll("[data-vf]").forEach((b) => (b.onclick = () => { S.vf.type = b.dataset.vf; this.renderVouchers(); }));
    $("#vFrom").onchange = (e) => { S.vf.from = e.target.value; this.renderVouchers(); };
    $("#vTo").onchange = (e) => { S.vf.to = e.target.value; this.renderVouchers(); };
    m.querySelectorAll("[data-cat]").forEach((b) => (b.onclick = async () => { const c = S.cats.find((x) => String(x.id) === b.dataset.cat); await sb.from("expense_categories").update({ active: !c.active }).eq("id", c.id); this.renderVouchers(); }));
    $("#catForm").onsubmit = async (e) => { e.preventDefault(); const { error } = await sb.from("expense_categories").insert({ name: e.target.name.value.trim() }); if (error) return toast(error.message.includes("duplicate") ? "التبويب موجود" : errMsg(error), true); this.renderVouchers(); };
  },
  async voucherModal(type, pre = {}) {
    if (!S.cats) await this.loadVoucherRefs();
    { const { data } = await sb.from("cash_boxes").select("*").eq("active", true).order("is_default", { ascending: false }).order("id"); S.boxes = data || []; }
    const defBox = pre.box_id || S.boxes.find((b) => b.is_default)?.id || S.boxes[0]?.id || "";
    const drivers = S.people.filter((p) => p.role === "driver" && (!p.removed_at || Number(S.balances?.[p.id]?.debt || 0) > 0));
    const today = bgDay();
    const parties = type === "receive" ? [["driver", "سائق (تسديد دين)"], ["partner", "شريك (رأس مال)"], ["other", "جهة أخرى (إيراد)"]]
      : type === "pay" ? [["partner", "شريك (سحب)"], ["driver", "سائق"], ["employee", "موظف (سلفة)"], ["other", "جهة أخرى"]]
      : pre.party_type === "employee" ? [["employee", "موظف"]] : [["other", "جهة"]];
    const pt = pre.party_type || parties[0][0];
    const debtOf = (id) => Number(S.balances?.[id]?.debt || 0);
    const title = pre.party_type === "employee" ? (type === "spend" ? "صرف راتب" : "صرف سلفة") : `${VT[type]} جديد`;
    modal(`<div class="vhead vt-${type}"><h3 style="margin:0">${title}</h3><span class="small">${type === "receive" ? "فلوس داخلة للقاصة" : type === "spend" ? "مصروف ينزل من الأرباح" : "فلوس طالعة من القاصة"}</span></div>
      <form id="vForm" class="vform">
        <input type="hidden" name="party_type" value="${pt}"><input type="hidden" name="party_id" value="${esc(pre.party_id || "")}">
        <label ${parties.length < 2 ? "hidden" : ""}>${type === "receive" ? "استلمنا من" : type === "spend" ? "صرفنا إلى" : "دفعنا إلى"}</label>
        <div class="seg seg-wide" id="ptSeg" ${parties.length < 2 ? "hidden" : ""}>${parties.map(([k, l]) => `<button type="button" data-pt="${k}" class="${k === pt ? "on" : ""}">${l}</button>`).join("")}</div>
        <div id="pSel" style="margin-top:10px"></div>
        ${type === "spend" ? `<div class="field" style="margin-top:12px"><label>نوع المصروف</label><input type="hidden" name="category" value="${esc(pre.category || "مصاريف عامة")}">
          <div class="cat-chips" id="catChips"></div>
          <div class="cat-add" id="catAdd" hidden><input id="catNew" placeholder="اسم المصروف الجديد (مثلاً: غرامات)"><button type="button" class="btn sm dark" id="catSave">إضافة</button><button type="button" class="btn sm ghost" id="catCancel">✕</button></div></div>` : ""}
        ${S.boxes.length > 1 ? `<div class="field"><label>${type === "receive" ? "ينحط بـ" : "ينطلع من"}</label><input type="hidden" name="box_id" value="${defBox}">
          <div class="seg seg-wide" id="boxSeg">${S.boxes.map((b) => `<button type="button" data-box="${b.id}" class="${String(b.id) === String(defBox) ? "on" : ""}">💰 ${esc(b.name)}</button>`).join("")}</div></div>` : `<input type="hidden" name="box_id" value="${defBox}">`}
        <div class="vamount">
          <div class="field" style="flex:1.4"><label>المبلغ (د.ع)</label><input name="amount" inputmode="numeric" class="ltr big-amt" required value="${esc(pre.amount ?? "")}" placeholder="0"></div>
          <div class="field" style="flex:1"><label>التاريخ</label><input type="date" name="date" value="${today}" required></div></div>
        <div id="amtWords" class="small muted" style="margin:-6px 0 10px"></div>
        <div class="field"><label>البيان / ملاحظة</label><input name="note" value="${esc(pre.note || "")}" placeholder="${type === "spend" ? "مثلاً: بانزين للسيارة" : "اختياري"}"></div>
        <div class="row" style="flex-wrap:nowrap"><button class="btn big ${type === "receive" ? "ok" : type === "spend" ? "bad" : "dark"}" style="flex:1">حفظ السند</button><button type="button" class="btn ghost" data-close>إلغاء</button></div>
      </form>`, (bg, close) => {
      const f = $("#vForm", bg);
      const listFor = (t) => t === "driver" ? drivers.map((d) => ({ id: d.id, name: d.name, sub: d.phone, badge: debtOf(d.id) > 0 ? `دينه ${Number(debtOf(d.id)).toLocaleString("en-US")}` : "ما عليه دين", hot: debtOf(d.id) > 0, ic: "🛵" }))
        : t === "partner" ? S.partners.map((x) => ({ id: x.id, name: x.name, sub: x.share_percent != null ? `حصته ${x.share_percent}%` : "", ic: "🤝" }))
        : t === "employee" ? S.employees.filter((e) => e.active).map((x) => ({ id: x.id, name: x.name, sub: [x.job, x.phone].filter(Boolean).join(" · "), badge: x.monthly_salary ? `راتبه ${Number(x.monthly_salary).toLocaleString("en-US")}` : "", ic: "👤" })) : [];
      const LBL = { driver: "السائق", partner: "الشريك", employee: "الموظف" };
      const drawParty = () => {
        const t = f.party_type.value, box = $("#pSel", bg);
        bg.querySelectorAll("[data-pt]").forEach((b) => b.classList.toggle("on", b.dataset.pt === t));
        if (t === "other" && type === "spend") { f.party_id.value = ""; box.innerHTML = ""; return; }
        if (t === "other") { f.party_id.value = ""; box.innerHTML = `<div class="field"><label>الاسم</label><input name="party_name" placeholder="${type === "receive" ? "من منو؟" : "لمنو؟"}" ${type === "spend" ? "" : "required"}></div>`; return; }
        const items = listFor(t);
        if (!items.length) { box.innerHTML = `<div class="alert warn small">ماكو ${LBL[t]}. ${t === "driver" ? "ضيفهم من تبويب السائقين" : "ضيفهم أول من تبويب الحسابات"}</div>`; return; }
        const cur = items.find((x) => String(x.id) === String(f.party_id.value));
        const row = (x) => `<button type="button" class="stm-opt" data-pid="${x.id}"><span class="stm-ic">${x.ic}</span><span class="stm-nm"><b>${esc(x.name)}</b><small>${esc(x.sub || "")}</small></span>${x.badge ? `<span class="chip ${x.hot ? "st-refused" : ""}">${esc(x.badge)}</span>` : ""}</button>`;
        if (cur) {
          box.innerHTML = `<div class="vpicked">${row(cur)}<button type="button" class="btn sm ghost" id="pChange">تغيير</button></div>
            ${t === "driver" && type === "receive" && debtOf(cur.id) > 0 ? `<div class="row" style="margin:8px 0 0"><button type="button" class="btn sm" id="allDebt">كل الدين (${Number(debtOf(cur.id)).toLocaleString("en-US")})</button><button type="button" class="btn sm ghost" id="halfDebt">نصه</button></div>` : ""}`;
          $("#pChange", box).onclick = () => { f.party_id.value = ""; drawParty(); };
          const setAmt = (v) => { f.amount.value = v; words(); };
          $("#allDebt", box) && ($("#allDebt", box).onclick = () => setAmt(debtOf(cur.id)));
          $("#halfDebt", box) && ($("#halfDebt", box).onclick = () => setAmt(Math.round(debtOf(cur.id) / 2)));
          return;
        }
        box.innerHTML = `<div class="stm-box"><span class="stm-glass">🔍</span><input id="pFind" type="search" autocomplete="off" placeholder="ابحث باسم ${LBL[t]}${t === "driver" ? " أو رقمه" : ""}…"></div>
          <div class="vlist" id="pList"></div>`;
        const inp = $("#pFind", box), list = $("#pList", box);
        const draw = () => {
          const q = inp.value.trim(), qp = q.replace(/[^0-9]/g, "");
          const hits = items.filter((x) => !q || x.name.includes(q) || (qp.length >= 3 && String(x.sub || "").includes(qp)))
            .sort((x, y) => (y.hot ? 1 : 0) - (x.hot ? 1 : 0));
          list.innerHTML = hits.map(row).join("") || `<div class="empty" style="padding:12px">ما لكيت أحد</div>`;
        };
        inp.oninput = draw; draw();
        inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); list.querySelector("[data-pid]")?.click(); } };
        list.onclick = (e) => {
          const b = e.target.closest("[data-pid]"); if (!b) return;
          f.party_id.value = b.dataset.pid;
          if (t === "driver" && type === "receive" && !toNum(f.amount.value) && debtOf(b.dataset.pid) > 0) { f.amount.value = debtOf(b.dataset.pid); words(); }
          drawParty(); f.amount.focus();
        };
        setTimeout(() => inp.focus(), 50);
      };
      const boxSeg = $("#boxSeg", bg);
      if (boxSeg) boxSeg.onclick = (e) => { const b = e.target.closest("[data-box]"); if (!b) return; f.box_id.value = b.dataset.box; boxSeg.querySelectorAll("[data-box]").forEach((x) => x.classList.toggle("on", x === b)); };
      if (type === "spend") {
        const chips = $("#catChips", bg), add = $("#catAdd", bg), inpC = $("#catNew", bg);
        const drawCats = () => {
          chips.innerHTML = S.cats.filter((c) => c.active || c.name === f.category.value).map((c) => `<button type="button" class="chip-btn ${c.name === f.category.value ? "on" : ""}" data-cat="${esc(c.name)}">${esc(c.name)}</button>`).join("")
            + `<button type="button" class="chip-btn add" id="catPlus">+ مصروف جديد</button>`;
        };
        drawCats();
        chips.onclick = (e) => {
          const b = e.target.closest("[data-cat]"); if (b) { f.category.value = b.dataset.cat; drawCats(); return; }
          if (e.target.closest("#catPlus")) { add.hidden = false; inpC.focus(); }
        };
        const saveCat = async () => {
          const name = inpC.value.trim(); if (!name) return;
          const ex = S.cats.find((c) => c.name === name);
          if (!ex) {
            const { data, error } = await sb.from("expense_categories").insert({ name }).select().single();
            if (error) return toast(errMsg(error), true);
            S.cats.push(data);
          }
          f.category.value = name; inpC.value = ""; add.hidden = true; drawCats(); toast(`انضاف "${name}"`);
        };
        $("#catSave", bg).onclick = saveCat;
        inpC.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); saveCat(); } };
        $("#catCancel", bg).onclick = () => { add.hidden = true; inpC.value = ""; };
      }
      $("#ptSeg", bg).onclick = (e) => { const b = e.target.closest("[data-pt]"); if (!b) return; f.party_type.value = b.dataset.pt; f.party_id.value = ""; drawParty(); };
      function words() { $("#amtWords", bg).textContent = toNum(f.amount.value) ? `كتابةً: ${numToWords(toNum(f.amount.value))}` : ""; }
      f.amount.oninput = words; drawParty(); words();
      f.onsubmit = async (e) => {
        e.preventDefault(); const btn = f.querySelector("button.big");
        if (f.party_type.value !== "other" && !f.party_id.value) return toast("اختار الاسم من القائمة", true);
        btn.disabled = true;
        try {
          const v = await rpc("create_voucher_box", {
            p_box: f.box_id.value ? Number(f.box_id.value) : null, p_type: type, p_amount: toNum(f.amount.value), p_date: f.date.value, p_category: f.category?.value || null,
            p_party_type: f.party_type.value, p_party_id: f.party_id.value || null, p_party_name: f.party_name?.value || null,
            p_note: f.note.value || null, p_salary_month: pre.salary_month || null,
          });
          close(); toast(`انحفظ ${VT[type]} رقم ${v.number}`);
          modal(`<h3>✓ ${VT[type]} رقم ${v.number}</h3><p>${money(v.amount)} · ${esc(v.party_name || "")}</p>
            <div class="row"><button class="btn dark" id="pv">🖨 طباعة السند</button><button class="btn" data-close>تمام</button></div>`, (bg2, close2) => { $("#pv", bg2).onclick = () => { this.printVoucher(v.id, v); close2(); }; });
          await this.load();
          if (S.tab === "vouchers") this.renderVouchers(); else if (S.tab === "accounts") this.renderAccounts(); else if (S.tab === "daily") this.renderDaily(); else if (S.tab === "boxes") this.renderBoxes();
        } catch (err) { toast(errMsg(err), true); btn.disabled = false; }
      };
    });
  },
  async printVoucher(id, v) {
    if (!v) { const r = await sb.from("vouchers").select("*").eq("id", id).single(); v = r.data; }
    if (!v) return;
    const st = S.settings || {};
    const who = { receive: "استلمنا من السيد/ة", spend: "صرفنا إلى", pay: "دفعنا إلى" }[v.vtype];
    const w = window.open("", "_blank");
    w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${VT[v.vtype]} ${v.number}</title>
      <link href="https://fonts.googleapis.com/css2?family=${(st.font_family || "IBM Plex Sans Arabic").replace(/ /g, "+")}:wght@400;700&display=swap" rel="stylesheet">
      <style>body{font-family:"${st.font_family || "IBM Plex Sans Arabic"}",sans-serif;margin:0;padding:24px;color:#111}.v{max-width:720px;margin:auto;border:2px solid #111;border-radius:12px;padding:24px}
      .h{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid ${st.primary_color || "#E8590C"};padding-bottom:12px;margin-bottom:16px}
      .t{font-size:26px;font-weight:700;color:${st.primary_color || "#E8590C"}}.r{display:flex;gap:8px;margin:12px 0;font-size:17px}.r b{min-width:140px}
      .amt{border:2px dashed #999;border-radius:8px;padding:10px 14px;font-size:22px;font-weight:700;display:inline-block;direction:ltr}
      .sig{display:flex;justify-content:space-between;margin-top:48px;font-size:15px}.sig div{border-top:1px solid #111;padding-top:6px;width:30%;text-align:center}
      .void{color:#c00;font-size:28px;font-weight:700;text-align:center;border:3px solid #c00;padding:6px;margin-bottom:12px}@media print{body{padding:0}}</style></head><body><div class="v">
      ${v.cancelled ? `<div class="void">محذوف — ${esc(v.cancel_reason || "")}</div>` : ""}
      <div class="h"><div><div style="font-size:20px;font-weight:700">${esc(st.app_name || "")}</div><div style="font-size:13px">الحلة${st.support_phone ? " · " + esc(st.support_phone) : ""}</div></div>
        <div style="text-align:left"><div class="t">${VT[v.vtype]}</div><div>رقم: <b>${v.number}</b></div><div>التاريخ: <b>${v.voucher_date}</b></div></div></div>
      <div class="r"><b>المبلغ:</b><span class="amt">${Number(v.amount).toLocaleString("en-US")} IQD</span></div>
      <div class="r"><b>مبلغ قدره:</b><span>${numToWords(Number(v.amount))}</span></div>
      <div class="r"><b>${who}:</b><span>${esc(v.party_name || "—")}</span></div>
      ${v.category ? `<div class="r"><b>التبويب:</b><span>${esc(v.category)}</span></div>` : ""}
      <div class="r"><b>وذلك عن:</b><span>${esc(v.note || "—")}</span></div>
      <div class="sig"><div>المستلم</div><div>المحاسب</div><div>المدير</div></div></div>
      <script>document.fonts.ready.then(()=>setTimeout(()=>print(),300))<\/script></body></html>`);
    w.document.close();
  },
  // ----- daily movement (الحركة اليومية) -----
  async renderVoucherReport() {
    const out = $("#repOut");
    const [vq, bq] = await Promise.all([
      sb.from("vouchers").select("*").gte("voucher_date", S.rep.from).lte("voucher_date", S.rep.to).order("voucher_date").order("id").limit(5000),
      sb.from("cash_boxes").select("id,name"),
    ]);
    if (vq.error) { out.innerHTML = `<div class="alert bad">${esc(vq.error.message)}</div>`; return; }
    const all = vq.data || [], live = all.filter((v) => !v.cancelled), cancelled = all.filter((v) => v.cancelled);
    const bn = (id) => (bq.data || []).find((b) => b.id === id)?.name || "";
    const n = (v) => Number(v || 0).toLocaleString("en-US");
    const sum = (arr) => arr.reduce((a, v) => a + Number(v.amount), 0);
    const by = (t) => live.filter((v) => v.vtype === t);
    const rec = sum(by("receive")), spd = sum(by("spend")), pay = sum(by("pay"));
    const group = (arr, key) => { const g = {}; arr.forEach((v) => { const k = key(v) || "—"; g[k] ||= { n: 0, in: 0, out: 0 }; g[k].n++; v.vtype === "receive" ? (g[k].in += Number(v.amount)) : (g[k].out += Number(v.amount)); }); return Object.entries(g); };
    const cats = group(by("spend"), (v) => v.category).sort((a, b) => b[1].out - a[1].out);
    const catMax = Math.max(1, ...cats.map((c) => c[1].out));
    const parties = group(live, (v) => v.party_name).sort((a, b) => (b[1].in + b[1].out) - (a[1].in + a[1].out)).slice(0, 15);
    const boxes = group(live, (v) => bn(v.box_id));
    const days = group(live, (v) => v.voucher_date).sort((a, b) => a[0].localeCompare(b[0]));
    const PT = { driver: "سائق", partner: "شريك", employee: "موظف", other: "جهة" };
    S.vrType ||= "all";
    const listed = (S.vrType === "cancelled" ? cancelled : S.vrType === "all" ? live : by(S.vrType));
    const tbl = (head, rows, foot = "") => `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${head.length}" class="empty">ماكو بيانات</td></tr>`}${foot}</tbody></table></div>`;
    out.innerHTML = `
      <div class="spread" style="margin:16px 0 8px"><h2 style="margin:0">تقرير السندات · من <span class="num">${S.rep.from}</span> إلى <span class="num">${S.rep.to}</span></h2>
        <div class="row no-print"><button class="btn sm" id="vrCsv">⬇ تنزيل Excel</button><button class="btn sm" onclick="window.print()">🖨 طباعة</button></div></div>
      <div class="stats five">
        <div class="stat"><div class="v neg">${money(rec)}</div><div class="l">سندات القبض (${by("receive").length})</div></div>
        <div class="stat"><div class="v pos">${money(spd)}</div><div class="l">سندات الصرف (${by("spend").length})</div></div>
        <div class="stat"><div class="v pos">${money(pay)}</div><div class="l">سندات الدفع (${by("pay").length})</div></div>
        <div class="stat ${rec - spd - pay >= 0 ? "good" : "badv"}"><div class="v">${money(rec - spd - pay)}</div><div class="l">الفرق (قبض − صرف − دفع)</div></div>
        <div class="stat"><div class="v num">${cancelled.length}</div><div class="l">سندات محذوفة (${n(sum(cancelled))})</div></div>
      </div>
      <div class="acc-grid">
        <section class="card"><h3>المصاريف حسب التبويب</h3>
          ${cats.map(([c, g]) => `<div class="bar-row"><span>${esc(c)} <small class="muted">(${g.n})</small></span><div class="bar"><i style="width:${Math.round(g.out / catMax * 100)}%"></i></div><b>${n(g.out)}</b></div>`).join("") || `<div class="empty">ماكو سندات صرف</div>`}
          ${cats.length ? `<div class="acc-line total"><span>المجموع</span><b>${money(spd)}</b></div>` : ""}</section>
        <section class="card pad0"><div class="panel-h">حسب الجهة (أعلى ${parties.length})</div>
          ${tbl(["الجهة", "عدد", "قبض", "صرف + دفع"], parties.map(([k, g]) => `<tr><td>${esc(k)}</td><td class="num">${g.n}</td><td class="num neg">${g.in ? n(g.in) : ""}</td><td class="num pos">${g.out ? n(g.out) : ""}</td></tr>`))}</section>
        <section class="card pad0"><div class="panel-h">يومياً</div>
          ${tbl(["اليوم", "قبض", "صرف", "دفع", "الفرق"], days.map(([d]) => { const dv = live.filter((v) => v.voucher_date === d); const r = sum(dv.filter((v) => v.vtype === "receive")), sp = sum(dv.filter((v) => v.vtype === "spend")), pa = sum(dv.filter((v) => v.vtype === "pay"));
            return `<tr><td class="num">${d}</td><td class="num neg">${n(r)}</td><td class="num pos">${n(sp)}</td><td class="num pos">${n(pa)}</td><td class="num"><b>${n(r - sp - pa)}</b></td></tr>`; }),
            `<tr class="tot"><td><b>المجموع</b></td><td class="num neg"><b>${n(rec)}</b></td><td class="num pos"><b>${n(spd)}</b></td><td class="num pos"><b>${n(pay)}</b></td><td class="num"><b>${n(rec - spd - pay)}</b></td></tr>`)}</section>
        <section class="card pad0"><div class="panel-h">حسب الصندوق</div>
          ${tbl(["الصندوق", "عدد", "داخل", "طالع", "الفرق"], boxes.map(([k, g]) => `<tr><td>💰 ${esc(k)}</td><td class="num">${g.n}</td><td class="num neg">${n(g.in)}</td><td class="num pos">${n(g.out)}</td><td class="num"><b>${n(g.in - g.out)}</b></td></tr>`))}</section>
      </div>
      <div class="spread" style="margin-top:20px"><h3 style="margin:0">كل السندات (${listed.length})</h3>
        <div class="row no-print">${[["all", "الكل"], ["receive", "قبض"], ["spend", "صرف"], ["pay", "دفع"], ["cancelled", "المحذوفة"]].map(([k, l]) => `<button class="btn sm ${S.vrType === k ? "dark" : "ghost"}" data-vrt="${k}">${l}</button>`).join("")}</div></div>
      <div class="card pad0" style="margin-top:8px">${tbl(["السند", "التاريخ", "الجهة", "التبويب", "الصندوق", "المبلغ", "البيان"],
        listed.map((v) => `<tr class="${v.cancelled ? "voided" : ""}"><td><span class="chip vt-${v.vtype}">${VT[v.vtype]} #${v.number}</span></td><td class="num">${v.voucher_date}</td><td>${esc(v.party_name || "")} <small class="muted">${PT[v.party_type] || ""}</small></td><td>${esc(v.category || "")}</td><td>${esc(bn(v.box_id))}</td><td class="num"><b>${n(v.amount)}</b></td><td>${esc(v.cancelled ? `محذوف: ${v.cancel_reason || ""}` : v.note || "")}</td></tr>`),
        listed.length ? `<tr class="tot"><td colspan="5"><b>المجموع</b></td><td class="num"><b>${n(sum(listed))}</b></td><td></td></tr>` : "")}</div>`;
    out.querySelectorAll("[data-vrt]").forEach((b) => (b.onclick = () => { S.vrType = b.dataset.vrt; this.renderVoucherReport(); }));
    $("#vrCsv").onclick = () => {
      const rows = [["تقرير السندات", S.rep.from, S.rep.to], [], ["قبض", rec], ["صرف", spd], ["دفع", pay], ["الفرق", rec - spd - pay], [],
        ["التبويب", "عدد", "المبلغ"], ...cats.map(([c, g]) => [c, g.n, g.out]), [],
        ["السند", "رقم", "التاريخ", "الجهة", "نوع الجهة", "التبويب", "الصندوق", "المبلغ", "البيان", "الحالة"],
        ...all.map((v) => [VT[v.vtype], v.number, v.voucher_date, v.party_name, PT[v.party_type], v.category, bn(v.box_id), v.amount, v.note, v.cancelled ? `محذوف: ${v.cancel_reason || ""}` : ""])];
      const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `vouchers-${S.rep.from}-${S.rep.to}.csv`; a.click();
    };
  },
  // ----- cash boxes -----
  async renderBoxes() {
    const m = $("#amain");
    if (m.dataset.view !== "boxes" || !m.querySelector("#boxCards")) m.innerHTML = `<div class="spinner" style="margin:40px auto"></div>`;
    const [sum, cl, tr] = await Promise.all([
      rpc0("box_summary"),
      sb.from("box_closings").select("*").order("closed_at", { ascending: false }).limit(30),
      sb.from("box_transfers").select("*").is("closing_id", null).order("created_at", { ascending: false }).limit(20),
    ]);
    if (sum.error) { m.innerHTML = `<div class="alert bad">${esc(sum.error.message)}</div>`; return; }
    const boxes = sum.data || []; S.boxes = boxes;
    const bn = (id) => boxes.find((b) => b.id === id)?.name || "—";
    const total = boxes.reduce((a, b) => a + Number(b.balance), 0);
    m.innerHTML = `
      <div class="spread"><h2 style="margin:0">الصناديق</h2>
        <div class="row"><button class="btn sm" data-bx="transfer">⇄ تحويل بين الصناديق</button><button class="btn sm ghost" data-bx="new">+ صندوق جديد</button></div></div>
      <p class="small muted">كل السندات تنزل بالصندوق اللي تختاره (الافتراضي: ${esc(boxes.find((b) => b.is_default)?.name || "—")}). كل ليلة الساعة 11:59 الصندوق اليومي يتسكر ورصيده يروح للقاصة تلقائياً، وتكدر تسكره بيدك بأي وقت.</p>
      <div class="box-cards" id="boxCards">${boxes.map((b) => `
        <div class="card box-card ${b.close_to ? "" : "main"}">
          <div class="spread"><b class="box-name">💰 ${esc(b.name)}</b>${b.is_default ? `<span class="chip st-delivered">الافتراضي</span>` : !b.close_to ? `<span class="chip">الرئيسي</span>` : ""}</div>
          <div class="box-bal">${money(b.balance)}</div>
          <div class="box-today"><span>اليوم داخل <b class="neg">${money(b.today_in)}</b></span><span>طالع <b class="pos">${money(b.today_out)}</b></span></div>
          ${b.close_to ? `<div class="small muted">يتسكر إلى: ${esc(bn(b.close_to))} · آخر تسكير: ${b.last_closed ? dateTime(b.last_closed) : "ما تسكر بعد"}</div>
            <button class="btn block ${Number(b.balance) ? "primary" : ""}" data-bx="close" data-id="${b.id}" style="margin-top:10px">🔒 تسكير الصندوق الآن</button>` : `<div class="small muted">تتجمع بيه أرصدة الصناديق بعد التسكير</div>`}
        </div>`).join("")}
        <div class="card box-card total"><b>المجموع بكل الصناديق</b><div class="box-bal">${money(total)}</div></div>
      </div>
      <div class="section-title">سجل التسكير</div>
      <div class="card table-wrap" style="padding:0"><table><thead><tr><th>الوقت</th><th>الصندوق</th><th>رصيد البداية</th><th>داخل</th><th>طالع</th><th>رصيد التسكير</th><th>راح إلى</th><th></th></tr></thead><tbody>
        ${(cl.data || []).map((c) => `<tr><td class="num">${dateTime(c.closed_at)}</td><td>${esc(bn(c.box_id))}</td><td class="num">${money(c.opening)}</td><td class="num neg">${money(c.total_in)}</td><td class="num pos">${money(c.total_out)}</td><td><b>${money(c.closing)}</b></td><td>${esc(bn(c.moved_to))}</td><td>${c.auto ? `<span class="chip">تلقائي</span>` : `<span class="chip st-accepted">يدوي</span>`}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">ماكو تسكير بعد</td></tr>`}
      </tbody></table></div>
      ${(tr.data || []).length ? `<div class="section-title">التحويلات اليدوية</div>
      <div class="card table-wrap" style="padding:0"><table><thead><tr><th>الوقت</th><th>من</th><th>إلى</th><th>المبلغ</th><th>ملاحظة</th></tr></thead><tbody>
        ${tr.data.map((t) => `<tr><td class="num">${dateTime(t.created_at)}</td><td>${esc(bn(t.from_box))}</td><td>${esc(bn(t.to_box))}</td><td><b>${money(t.amount)}</b></td><td>${esc(t.note || "")}</td></tr>`).join("")}
      </tbody></table></div>` : ""}`;
    m.querySelectorAll("[data-bx]").forEach((b) => (b.onclick = () => this.boxAction(b.dataset.bx, Number(b.dataset.id), boxes)));
  },
  boxAction(act, id, boxes) {
    const opts = (sel) => boxes.map((b) => `<option value="${b.id}" ${b.id === sel ? "selected" : ""}>${esc(b.name)} (${Number(b.balance).toLocaleString("en-US")})</option>`).join("");
    if (act === "close") {
      const b = boxes.find((x) => x.id === id);
      modal(`<h3>🔒 تسكير ${esc(b.name)}</h3><p>رصيده هسه <b>${money(b.balance)}</b> وراح ينتقل كله إلى <b>${esc(boxes.find((x) => x.id === b.close_to)?.name || "")}</b>، والصندوق يبدي من صفر.</p>
        <div class="field"><label>ملاحظة (اختياري)</label><input id="cNote"></div>
        <div class="row" style="flex-wrap:nowrap"><button class="btn primary" style="flex:1" id="cGo">تسكير</button><button class="btn ghost" data-close>إلغاء</button></div>`, (bg, close) => {
        $("#cGo", bg).onclick = async (e) => { e.target.disabled = true; try { await rpc("close_box", { p_box: id, p_note: $("#cNote", bg).value || null }); close(); toast("تسكر الصندوق"); this.renderBoxes(); } catch (err) { toast(errMsg(err), true); e.target.disabled = false; } };
      });
    }
    if (act === "transfer") {
      const main = boxes.find((b) => !b.close_to)?.id, def = boxes.find((b) => b.is_default)?.id;
      modal(`<h3>⇄ تحويل بين الصناديق</h3><form id="tForm">
        <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label>من</label><select name="from">${opts(main)}</select></div><div class="field" style="flex:1"><label>إلى</label><select name="to">${opts(def)}</select></div></div>
        <div class="field"><label>المبلغ (د.ع)</label><input name="amount" inputmode="numeric" class="ltr big-amt" required></div>
        <div class="field"><label>ملاحظة</label><input name="note" placeholder="مثلاً: فكة للصندوق اليومي"></div>
        <div class="row" style="flex-wrap:nowrap"><button class="btn primary" style="flex:1">تحويل</button><button type="button" class="btn ghost" data-close>إلغاء</button></div></form>`, (bg, close) => {
        $("#tForm", bg).onsubmit = async (e) => { e.preventDefault(); const f = e.target; const btn = f.querySelector("button"); btn.disabled = true;
          try { await rpc("transfer_box", { p_from: Number(f.from.value), p_to: Number(f.to.value), p_amount: toNum(f.amount.value), p_note: f.note.value || null }); close(); toast("تم التحويل"); this.renderBoxes(); } catch (err) { toast(errMsg(err), true); btn.disabled = false; } };
      });
    }
    if (act === "new") {
      const main = boxes.find((b) => !b.close_to)?.id;
      modal(`<h3>صندوق جديد</h3><form id="nbForm">
        <div class="field"><label>اسم الصندوق</label><input name="name" required placeholder="مثلاً: صندوق المساء"></div>
        <div class="field"><label>بنهاية اليوم يتسكر إلى</label><select name="close_to"><option value="">ما يتسكر (صندوق رئيسي)</option>${opts(main)}</select></div>
        <div class="row" style="flex-wrap:nowrap"><button class="btn primary" style="flex:1">إضافة</button><button type="button" class="btn ghost" data-close>إلغاء</button></div></form>`, (bg, close) => {
        $("#nbForm", bg).onsubmit = async (e) => { e.preventDefault(); const f = e.target;
          const { error } = await sb.from("cash_boxes").insert({ name: f.name.value.trim(), close_to: f.close_to.value ? Number(f.close_to.value) : null });
          if (error) return toast(error.message.includes("duplicate") ? "هذا الاسم موجود" : errMsg(error), true);
          close(); toast("انضاف الصندوق"); this.renderBoxes(); };
      });
    }
  },
  async renderDaily() {
    const m = $("#amain");
    S.day ||= new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // Baghdad date
    const shift = (n) => { const d = new Date(S.day + "T12:00:00"); d.setDate(d.getDate() + n); S.day = d.toISOString().slice(0, 10); this.renderDaily(); };
    m.innerHTML = `<div class="spinner" style="margin:40px auto"></div>`;
    const { data, error } = await rpc0("cash_movements", { p_from: S.day, p_to: S.day });
    if (error) { m.innerHTML = `<div class="alert bad">${esc(error.message)}</div>`; return; }
    let bal = Number(data.opening || 0);
    const rows = (data.rows || []).map((r) => { bal += Number(r.in) - Number(r.out); return { ...r, bal }; });
    const tin = rows.reduce((a, r) => a + Number(r.in), 0), tout = rows.reduce((a, r) => a + Number(r.out), 0);
    const n = (v) => (Number(v) ? Number(v).toLocaleString("en-US") : "");
    m.innerHTML = `
      <div class="spread no-print"><h2 style="margin:0">الحركة اليومية</h2>
        <div class="row" style="flex-wrap:nowrap"><button class="btn sm ghost" id="dPrev">→ اليوم السابق</button><input type="date" id="dDay" value="${S.day}" style="width:auto"><button class="btn sm ghost" id="dNext">اليوم التالي ←</button><button class="btn sm" onclick="window.print()">🖨</button></div></div>
      <h3 class="print-only">الحركة اليومية · ${S.day}</h3>
      <div class="stats" style="margin-top:12px">
        <div class="stat"><div class="v">${money(data.opening)}</div><div class="l">رصيد أول اليوم</div></div>
        <div class="stat"><div class="v neg">${money(tin)}</div><div class="l">الداخل</div></div>
        <div class="stat"><div class="v pos">${money(tout)}</div><div class="l">الطالع</div></div>
        <div class="stat"><div class="v">${money(Number(data.opening) + tin - tout)}</div><div class="l">رصيد آخر اليوم</div></div>
      </div>
      <div class="card table-wrap" style="margin-top:12px;padding:0"><table><thead><tr><th>الوقت</th><th>السند</th><th>البيان</th><th>الجهة</th><th>داخل</th><th>طالع</th><th>الرصيد</th></tr></thead><tbody>
        <tr><td></td><td></td><td><b>رصيد أول اليوم</b></td><td></td><td></td><td></td><td class="num"><b>${n(data.opening) || 0}</b></td></tr>
        ${rows.map((r) => `<tr><td class="num">${String(r.at).slice(11, 16)}</td><td>${r.vno ? `<span class="chip vt-${r.vtype}">${VT[r.vtype] || ""} #${r.vno}</span>` : ""}</td><td>${esc(r.label || "")}</td><td>${esc(r.party || "")}</td>
          <td class="num neg">${n(r.in)}</td><td class="num pos">${n(r.out)}</td><td class="num"><b>${n(r.bal) || 0}</b></td></tr>`).join("") || `<tr><td colspan="7" class="empty">ماكو حركة بهذا اليوم</td></tr>`}
        <tr class="tot"><td colspan="4"><b>المجموع</b></td><td class="num neg"><b>${n(tin) || 0}</b></td><td class="num pos"><b>${n(tout) || 0}</b></td><td class="num"><b>${n(Number(data.opening) + tin - tout) || 0}</b></td></tr>
      </tbody></table></div>
      <p class="small muted no-print">الحركة تشمل: تسديدات السائقين، سندات القبض والصرف والدفع، الرواتب، ورأس مال وسحوبات الشركاء. العمولة ما تدخل القاصة إلا لما السائق يسددها.</p>`;
    $("#dPrev").onclick = () => shift(-1); $("#dNext").onclick = () => shift(1);
    $("#dDay").onchange = (e) => { S.day = e.target.value; this.renderDaily(); };
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
    prev();
    // font applies + saves right away, no need to scroll to "حفظ"
    f.font_family.onchange = async () => {
      prev();
      const font = f.font_family.value;
      S.settings = { ...S.settings, font_family: font }; applyBranding();
      const { error } = await sb.from("settings").update({ font_family: font, updated_at: new Date().toISOString() }).eq("id", 1);
      if (error) return toast("ما انحفظ الخط: " + error.message, true);
      toast("تغيّر الخط إلى " + font);
    };
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
      if (act === "removeAcc") return this.removeModal(id);
      if (act === "restoreAcc") { if (!confirm(`إرجاع ${person?.name}؟ يرجع حسابه فعّال ويكدر يدخل.`)) return; await rpc("restore_account", { p_id: id }); toast("رجع الحساب"); await this.load(); return this.render(); }
      if (act === "permUser") return this.permModal(id || null);
      if (act === "stmClear") { S.stm.id = ""; return this.renderStatement(); }
      if (act === "stmt") { S.stm = { ...(S.stm || {}), type: b.dataset.type, id }; S.tab = "statement"; return this.render(); }
      if (act === "settle") return this.voucherModal("receive", { party_type: "driver", party_id: id, amount: Math.max(0, Number(S.balances?.[id]?.debt || 0)) || "" });
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
      if (act === "pWithdraw") return this.voucherModal("pay", { party_type: "partner", party_id: id });
      if (act === "pCapital") return this.voucherModal("receive", { party_type: "partner", party_id: id });
      if (act === "pShare") {
        const v = prompt("النسبة الجديدة %:", b.dataset.share); if (v === null) return;
        const { error } = await sb.from("partners").update({ share_percent: toNum(v) }).eq("id", id);
        if (error) throw error; this.renderAccounts();
      }
      if (act === "delExp") {
        const reason = prompt("سبب الحذف (إجباري):"); if (!reason?.trim()) return toast("لازم تكتب سبب الحذف", true);
        if (b.dataset.voucher) await rpc("cancel_voucher", { p_id: Number(b.dataset.voucher), p_reason: reason });
        else { const { error } = await sb.from("expenses").update({ void: true, note: `محذوف: ${reason}` }).eq("id", id); if (error) throw error; }
        toast("انحذف وانتقل للمحذوفات"); this.renderAccounts();
      }
      if (act === "newVoucher") return this.voucherModal(b.dataset.type, {});
      if (act === "printV") return this.printVoucher(Number(id));
      if (act === "cancelV") {
        const reason = prompt("سبب الحذف (إجباري):"); if (!reason?.trim()) return toast("لازم تكتب سبب الحذف", true);
        await rpc("cancel_voucher", { p_id: Number(id), p_reason: reason }); toast("انحذف السند وانتقل للمحذوفات"); this.renderVouchers();
      }
      if (act === "toggleEmp") { const { data: e } = await sb.from("employees").select("active").eq("id", id).single(); await sb.from("employees").update({ active: !e.active }).eq("id", id); this.renderAccounts(); }
      if (act === "payAdvance") return this.voucherModal("pay", { party_type: "employee", party_id: id, note: "سلفة" });
      if (act === "paySalary") return this.voucherModal("spend", { category: "رواتب", party_type: "employee", party_id: id, amount: b.dataset.left, salary_month: `${S.accMonth || bgDay().slice(0, 7)}-01` });
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
  // ----- users & permissions -----
  renderUsers() {
    const me = S.profile.id;
    const admins = S.people.filter((p) => p.role === "admin");
    const others = S.people.filter((p) => p.role !== "admin" && !p.removed_at);
    const permsTxt = (p) => !p.permissions ? `<span class="chip st-delivered">مدير كامل</span>` : p.permissions.length ? p.permissions.map((k) => `<span class="chip">${(PERMS.find((x) => x[0] === k) || [k, k])[1]}</span>`).join(" ") : `<span class="chip st-cancelled">بدون صلاحيات</span>`;
    const ROLE = { admin: "إدارة", driver: "سائق", restaurant: "مطعم" };
    $("#amain").innerHTML = `
      <div class="spread"><h2 style="margin:0">مستخدمين الإدارة (${admins.length})</h2><button class="btn primary" data-act="permUser">+ مستخدم جديد</button></div>
      <p class="small muted">كل مستخدم يشوف بس التبويبات المؤشرة إله. "مدير كامل" يشوف كلشي ويكدر يضيف مستخدمين.</p>
      <div class="card table-wrap" style="padding:0"><table><thead><tr><th>الاسم</th><th>الرقم</th><th>الحالة</th><th>الصلاحيات</th><th></th></tr></thead><tbody>
      ${admins.map((a) => `<tr><td><b>${esc(a.name)}</b>${a.id === me ? ` <span class="small muted">(إنت)</span>` : ""}</td><td>${tel(a.phone)}</td>
        <td>${a.active ? `<span class="chip st-delivered">فعّال</span>` : `<span class="chip st-cancelled">موقوف</span>`}</td>
        <td style="max-width:420px">${permsTxt(a)}</td>
        <td>${a.id === me ? "" : `<div class="row" style="flex-wrap:nowrap">
          <button class="btn sm" data-act="permUser" data-id="${a.id}">الصلاحيات</button>
          <button class="btn sm ghost" data-act="resetPw" data-id="${a.id}">رمز جديد</button>
          <button class="btn sm ghost" data-act="toggleActive" data-id="${a.id}">${a.active ? "إيقاف" : "تفعيل"}</button></div>`}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="spread" style="margin-top:20px"><h2 style="margin:0">كل الحسابات (${others.length})</h2>
        <div class="row"><button class="btn sm" data-act="addUser" data-role="driver">+ سائق</button><button class="btn sm" data-act="addUser" data-role="restaurant">+ مطعم</button></div></div>
      <div class="card table-wrap" style="margin-top:12px;padding:0"><table><thead><tr><th>الاسم</th><th>النوع</th><th>الرقم</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${others.map((u) => `<tr><td><b>${esc(u.name)}</b></td><td><span class="chip">${ROLE[u.role] || u.role}</span></td><td>${tel(u.phone)}</td>
        <td>${u.active ? `<span class="chip st-delivered">فعّال</span>` : `<span class="chip st-cancelled">موقوف</span>`}</td>
        <td><div class="row" style="flex-wrap:nowrap">
          ${canTab("statement") ? `<button class="btn sm" data-act="stmt" data-type="${u.role}" data-id="${u.id}">كشف حساب</button>` : ""}
          <button class="btn sm ghost" data-act="resetPw" data-id="${u.id}">رمز جديد</button>
          <button class="btn sm ghost" data-act="toggleActive" data-id="${u.id}">${u.active ? "إيقاف" : "تفعيل"}</button></div></td></tr>`).join("") || `<tr><td colspan="5" class="empty">ماكو حسابات</td></tr>`}
      </tbody></table></div>`;
  },
  permModal(id) {
    const u = id ? S.people.find((p) => p.id === id) : null;
    const full = u ? !u.permissions : false;
    const has = (k) => !u ? ["live", "orders"].includes(k) : !u.permissions || u.permissions.includes(k);
    modal(`<h3>${u ? `صلاحيات ${esc(u.name)}` : "مستخدم إدارة جديد"}</h3>
      <form id="pForm">
        ${u ? "" : `<div class="field"><label>الاسم</label><input name="name" required></div>
        <div class="field"><label>رقم الموبايل (يستعمله للدخول)</label><input name="phone" type="tel" inputmode="tel" required></div>
        <div class="field"><label>الرمز (6 أحرف أو أكثر)</label><input name="password" class="ltr" required minlength="6" value="${Math.random().toString().slice(2, 8)}"></div>`}
        <label class="perm-full"><input type="checkbox" name="full" ${full ? "checked" : ""}> <b>مدير كامل</b> <span class="small muted">(كل التبويبات + إضافة مستخدمين)</span></label>
        <div class="perm-grid" id="pGrid">${PERMS.map(([k, l]) => `<label class="perm"><input type="checkbox" name="p" value="${k}" ${has(k) ? "checked" : ""}> ${l}</label>`).join("")}</div>
        <div class="row" style="flex-wrap:nowrap;margin-top:14px"><button class="btn primary" style="flex:1">${u ? "حفظ" : "إنشاء الحساب"}</button><button type="button" class="btn ghost" data-close>إلغاء</button></div>
      </form>`, (bg, close) => {
      const f = $("#pForm", bg);
      const sync = () => { $("#pGrid", bg).style.opacity = f.full.checked ? 0.4 : 1; f.querySelectorAll("[name=p]").forEach((c) => (c.disabled = f.full.checked)); };
      f.full.onchange = sync; sync();
      f.onsubmit = async (e) => {
        e.preventDefault();
        const permissions = f.full.checked ? null : [...f.querySelectorAll("[name=p]:checked")].map((c) => c.value);
        if (permissions && !permissions.length) return toast("اختار صلاحية وحدة على الأقل", true);
        const btn = f.querySelector("button"); btn.disabled = true;
        try {
          if (u) {
            const { error } = await sb.from("profiles").update({ permissions }).eq("id", u.id);
            if (error) throw error; close(); toast("انحفظت الصلاحيات");
          } else {
            const d = Object.fromEntries(new FormData(f));
            await adminUsers({ action: "create", role: "admin", name: d.name, phone: d.phone, password: d.password, permissions });
            close();
            const link = location.origin + location.pathname;
            modal(`<h3>تم ✓</h3><p>دز هذي المعلومات لـ ${esc(d.name)}:</p>
              <div class="card" style="user-select:all;white-space:pre-line">الرابط: ${esc(link)}\nالرقم: ${esc(normPhone(d.phone))}\nالرمز: ${esc(d.password)}</div>
              <div class="row" style="margin-top:12px"><a class="btn ok" target="_blank" rel="noopener" href="https://wa.me/964${normPhone(d.phone).slice(1)}?text=${encodeURIComponent(`هلا ${d.name}، حسابك بإدارة ${S.settings.app_name} جاهز.\nالرابط: ${link}\nالرقم: ${normPhone(d.phone)}\nالرمز: ${d.password}`)}">إرسال واتساب</a><button class="btn" data-close>سد</button></div>`);
          }
          await this.load(); if (S.tab === "users") this.renderUsers();
        } catch (err) { toast(errMsg(err), true); btn.disabled = false; }
      };
    });
  },
  // ----- account statement (driver / restaurant) -----
  async renderStatement() {
    const m = $("#amain");
    const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    S.stm ||= {};
    S.stm.from ||= today.slice(0, 8) + "01"; S.stm.to ||= today;
    const pool = S.people.filter((p) => ["driver", "restaurant"].includes(p.role)).sort((x, y) => x.role.localeCompare(y.role) || x.name.localeCompare(y.name, "ar"));
    const who = pool.find((p) => p.id === S.stm.id);
    if (who) S.stm.type = who.role;
    const RL = { driver: "🛵 سائق", restaurant: "🍽 مطعم" };
    const item = (p) => `<button class="stm-opt" data-pick="${p.id}"><span class="stm-ic">${p.role === "driver" ? "🛵" : "🍽"}</span><span class="stm-nm"><b>${esc(p.name)}</b><small class="num">${esc(p.phone || "")}</small></span><span class="chip">${p.role === "driver" ? "سائق" : "مطعم"}</span></button>`;
    const d = (n) => { const x = new Date(today + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const lm = new Date(today.slice(0, 8) + "01T12:00:00Z"); lm.setUTCMonth(lm.getUTCMonth() - 1);
    const lmTo = new Date(today.slice(0, 8) + "01T12:00:00Z"); lmTo.setUTCDate(0);
    const presets = [["اليوم", today, today], ["آخر 7 أيام", d(-6), today], ["هذا الشهر", today.slice(0, 8) + "01", today], ["الشهر الماضي", lm.toISOString().slice(0, 10), lmTo.toISOString().slice(0, 10)]];
    m.innerHTML = `
      <div class="card no-print stm-search">
        <div class="stm-box"><span class="stm-glass">🔍</span><input id="sFind" type="search" placeholder="ابحث باسم السائق أو المطعم أو رقم الموبايل…" autocomplete="off" value="">
          <div class="stm-sug" id="sSug" hidden></div></div>
        ${who ? `<div class="stm-period">
          <div class="row">${presets.map(([l, f, t]) => `<button class="btn sm ${S.stm.from === f && S.stm.to === t ? "dark" : "ghost"}" data-pf="${f}" data-pt="${t}">${l}</button>`).join("")}</div>
          <span class="row date-range"><input type="date" id="sFrom" value="${S.stm.from}" style="width:auto"> إلى <input type="date" id="sTo" value="${S.stm.to}" style="width:auto"></span>
          <button class="btn sm primary" onclick="window.print()">🖨 طباعة</button></div>` : ""}
      </div>
      <div id="stmBody"></div>`;
    const inp = $("#sFind"), sug = $("#sSug");
    const show = () => {
      const q = inp.value.trim(); const qp = q.replace(/[^0-9]/g, "");
      const hits = pool.filter((p) => !q || p.name.includes(q) || (qp.length >= 3 && (p.phone || "").includes(qp))).slice(0, 12);
      sug.innerHTML = hits.map(item).join("") || `<div class="empty" style="padding:14px">ما لكيت أحد بهذا الاسم</div>`;
      sug.hidden = false;
    };
    inp.oninput = show; inp.onfocus = show;
    inp.onkeydown = (e) => { if (e.key === "Enter") { const f = sug.querySelector("[data-pick]"); if (f) f.click(); } if (e.key === "Escape") sug.hidden = true; };
    if (!this._stmDoc) { this._stmDoc = 1; document.addEventListener("click", (e) => { const sg = $("#sSug"); if (sg && !e.target.closest(".stm-box")) sg.hidden = true; }); }
    const pick = (e) => { const b = e.target.closest("[data-pick]"); if (b) { S.stm.id = b.dataset.pick; this.renderStatement(); } };
    sug.onclick = pick;
    m.querySelectorAll("[data-pf]").forEach((b) => (b.onclick = () => { S.stm.from = b.dataset.pf; S.stm.to = b.dataset.pt; this.renderStatement(); }));
    if ($("#sFrom")) { $("#sFrom").onchange = (e) => { S.stm.from = e.target.value; this.renderStatement(); }; $("#sTo").onchange = (e) => { S.stm.to = e.target.value; this.renderStatement(); }; }
    const body = $("#stmBody");
    body.onclick = pick;
    if (!who) {
      const grp = (r, t) => { const l = pool.filter((p) => p.role === r); return l.length ? `<div class="section-title">${t} (${l.length})</div><div class="stm-grid">${l.map(item).join("")}</div>` : ""; };
      body.innerHTML = pool.length ? `<p class="muted" style="margin:16px 0 0">ابحث فوك، أو اختار من القائمة:</p>${grp("driver", "السواق")}${grp("restaurant", "المطاعم")}` : `<div class="empty">ماكو سواق أو مطاعم</div>`;
      return;
    }
    body.innerHTML = `<div class="spinner" style="margin:40px auto"></div>`;
    const from = `${S.stm.from}T00:00:00+03:00`;
    const toD = new Date(S.stm.to + "T12:00:00Z"); toD.setUTCDate(toD.getUTCDate() + 1);
    const to = `${toD.toISOString().slice(0, 10)}T00:00:00+03:00`;
    const n = (v) => (Number(v) ? Number(v).toLocaleString("en-US") : "");
    const head = `<div class="stm-head"><div><h2 style="margin:0">كشف حساب ${S.stm.type === "driver" ? "سائق" : "مطعم"}: ${esc(who.name)}</h2>
      <div class="small muted">${esc(who.phone || "")} · من ${S.stm.from} إلى ${S.stm.to}</div></div><button class="btn sm ghost no-print" data-act="stmClear">✕ غيّر الحساب</button><div class="print-only small">${esc(S.settings?.app_name || "")}</div></div>`;
    try {
      if (S.stm.type === "driver") {
        const [pre, rows, ords] = await Promise.all([
          sb.from("ledger").select("amount").eq("driver_id", who.id).lt("created_at", from),
          sb.from("ledger").select("*").eq("driver_id", who.id).gte("created_at", from).lt("created_at", to).order("created_at").order("id"),
          sb.from("orders").select("id,status,delivery_fee,commission,order_total").eq("driver_id", who.id).gte("created_at", from).lt("created_at", to),
        ]);
        const err = pre.error || rows.error || ords.error; if (err) throw err;
        const opening = (pre.data || []).reduce((a, l) => a + Number(l.amount), 0);
        let bal = opening, dr = 0, cr = 0;
        const rs = (rows.data || []).map((l) => { const a = Number(l.amount); bal += a; if (a > 0) dr += a; else cr -= a; return { ...l, a, bal }; });
        const del = (ords.data || []).filter((o) => o.status === "delivered");
        const KIND = { commission: "عمولة", settlement: "تسديد", adjustment: "تعديل" };
        body.innerHTML = head + `
          <div class="stats" style="margin-top:12px">
            <div class="stat"><div class="v">${money(opening)}</div><div class="l">رصيد سابق</div></div>
            <div class="stat"><div class="v pos">${money(dr)}</div><div class="l">عليه (عمولات وسلف)</div></div>
            <div class="stat"><div class="v neg">${money(cr)}</div><div class="l">سدّد</div></div>
            <div class="stat"><div class="v">${money(bal)}</div><div class="l">${bal > 0 ? "الباقي بذمته" : bal < 0 ? "له عدنا" : "الرصيد"}</div></div>
          </div>
          <p class="small muted">توصيلات بهذي الفترة: <b>${del.length}</b> طلب · أجور توصيل: <b>${money(del.reduce((a, o) => a + Number(o.delivery_fee || 0), 0))}</b> · عمولة: <b>${money(del.reduce((a, o) => a + Number(o.commission || 0), 0))}</b></p>
          <div class="card table-wrap" style="padding:0"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>عليه</th><th>سدّد</th><th>الرصيد</th></tr></thead><tbody>
            <tr><td></td><td></td><td><b>رصيد سابق</b></td><td></td><td></td><td class="num"><b>${n(opening) || 0}</b></td></tr>
            ${rs.map((l) => `<tr><td class="num">${dateTime(l.created_at)}</td><td><span class="chip">${KIND[l.kind] || l.kind}</span></td><td>${esc(l.note || "")}</td>
              <td class="num pos">${l.a > 0 ? n(l.a) : ""}</td><td class="num neg">${l.a < 0 ? n(-l.a) : ""}</td><td class="num"><b>${n(l.bal) || 0}</b></td></tr>`).join("") || `<tr><td colspan="6" class="empty">ماكو حركات بهذي الفترة</td></tr>`}
            <tr class="tot"><td colspan="3"><b>المجموع</b></td><td class="num pos"><b>${n(dr) || 0}</b></td><td class="num neg"><b>${n(cr) || 0}</b></td><td class="num"><b>${n(bal) || 0}</b></td></tr>
          </tbody></table></div>
          <div class="print-only sig"><div>توقيع السائق</div><div>توقيع المحاسب</div></div>`;
      } else {
        const { data, error } = await sb.from("orders").select("*").eq("restaurant_id", who.id).gte("created_at", from).lt("created_at", to).order("id");
        if (error) throw error;
        const os = data || [], del = os.filter((o) => o.status === "delivered");
        const sum = (a, k) => a.reduce((x, o) => x + Number(o[k] || 0), 0);
        const zn = (id) => S.zones.find((z) => z.id === id)?.name || "";
        body.innerHTML = head + `
          <div class="stats five" style="margin-top:12px">
            <div class="stat"><div class="v num">${os.length}</div><div class="l">كل الطلبات</div></div>
            <div class="stat"><div class="v num">${del.length}</div><div class="l">توصّلت</div></div>
            <div class="stat"><div class="v num">${os.filter((o) => ["refused", "cancelled"].includes(o.status)).length}</div><div class="l">مرفوضة / ملغية</div></div>
            <div class="stat"><div class="v">${money(sum(del, "order_total"))}</div><div class="l">قيمة الطلبات الواصلة</div></div>
            <div class="stat"><div class="v">${money(sum(del, "delivery_fee"))}</div><div class="l">أجور التوصيل</div></div>
          </div>
          <div class="card table-wrap" style="margin-top:12px;padding:0"><table><thead><tr><th>#</th><th>التاريخ</th><th>الزبون</th><th>المنطقة</th><th>السائق</th><th>قيمة الطلب</th><th>التوصيل</th><th>الحالة</th></tr></thead><tbody>
            ${os.map((o) => `<tr class="${["refused", "cancelled"].includes(o.status) ? "voided" : ""}"><td class="num">${o.id}</td><td class="num">${dateTime(o.created_at)}</td><td>${esc(o.customer_name || "")}<div class="small muted num">${esc(o.customer_phone || "")}</div></td>
              <td>${esc(zn(o.zone_id))}</td><td>${esc(S.drivers[o.driver_id]?.name || "")}</td><td class="num">${n(o.order_total)}</td><td class="num">${n(o.delivery_fee)}</td><td>${chip(o.status)}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">ماكو طلبات بهذي الفترة</td></tr>`}
            <tr class="tot"><td colspan="5"><b>مجموع الواصلة (${del.length})</b></td><td class="num"><b>${n(sum(del, "order_total")) || 0}</b></td><td class="num"><b>${n(sum(del, "delivery_fee")) || 0}</b></td><td></td></tr>
          </tbody></table></div>
          <div class="print-only sig"><div>توقيع المطعم</div><div>توقيع المحاسب</div></div>`;
      }
    } catch (err) { body.innerHTML = `<div class="alert bad">${esc(errMsg(err))}</div>`; }
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
