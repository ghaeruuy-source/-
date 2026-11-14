# جايك بالطريق — نسخة تجريبية (MVP)

تطبيق واحد يشتغل على أي موبايل (أندرويد وآيفون) ومن الكمبيوتر. بعد تسجيل الدخول، كل حساب يشوف الواجهة الخاصة بيه: **مطعم**، أو **سائق**، أو **إدارة**.

## أول تشغيل
1. افتح الرابط. أول مرة يطلب منك تسوي **حساب المدير** (اسمك، رقمك، رمز).
2. من **المناطق والأجور** ضيف مناطق الحلة وأجرة كل منطقة.
3. من **الإعدادات** حدد العمولة (مبلغ ثابت أو نسبة من أجرة التوصيل)، وحد الدين، ومهلة القبول (30 ثانية).
4. من **المطاعم** و**السائقين** سوّي الحسابات. بعد كل حساب يطلعلك زر يرسل الرابط والرقم والرمز بالواتساب.

## تثبيته على الموبايل مثل التطبيق
- **آيفون (Safari):** زر المشاركة ← "إضافة إلى الشاشة الرئيسية".
- **أندرويد (Chrome):** القائمة ⋮ ← "تثبيت التطبيق" أو "إضافة للشاشة الرئيسية".

## طريقة الشغل
- **المطعم:** يكتب اسم الزبون ورقمه والمنطقة والعنوان ومبلغ الطلب، ويضغط "اطلب سائق". إذا الرقم سبق ورفض أو ما رد يطلعله تنبيه أحمر. يتابع حالة الطلب ويشوف السائق على الخريطة.
- **السائق:** يشغّل زر "متصل"، فينرسل موقعه. الطلب يروح لأقرب سائق فاضي، وإذا ما قبل خلال 30 ثانية ينتقل للي بعده. بعد القبول يضغط بالتسلسل: استلمت ← انطلقت ← توصّل. أو يضغط "الزبون رفض / ما رد"، وهنا الرقم يتسجل كرافض.
- **الفلوس:** السائق يدفع مبلغ الطلب للمطعم، ويستلم من الزبون مبلغ الطلب + أجرة التوصيل. عمولتك تنضاف دين على السائق مع كل طلب يتوصّل. السائق يسدد نقداً وانت تأشر "تسديد" من صفحة السائقين. إذا وصل دينه للحد، ما توصله طلبات جديدة لحد ما يسدد.

## ملاحظات مهمة بهذي النسخة
- **السائق لازم يخلي التطبيق مفتوح والشاشة شغالة** حتى يوصله الطلب ويتحدث موقعه. هذا حد من حدود تطبيقات الويب، خصوصاً بالآيفون. بالنسخة الجاية (تطبيق متجر) يصير الموقع والإشعارات بالخلفية.
- تغيير الاسم واللوگو واللون من الإعدادات، ويطبّق على الكل مباشرة.
- إذا أحد نسى رمزه: من الإدارة اضغط "رمز جديد".

---

## Technical notes
- **Frontend:** static PWA at the repo root (vanilla JS, supabase-js 2.45.4, Leaflet 1.9.4 + OpenStreetMap). No build step. Connection settings live in `config.js`.
- **Backend:** Supabase project `jayek-delivery` (ref `pvhypcxlbhfwxlpmzxtm`, eu-central-1).
  - Schema, RLS and business logic: `supabase/001_schema.sql` (+ `002_grants.sql`).
  - Dispatch: `dispatch_order()` picks the nearest online, active, non-blocked driver with fresh GPS. A `pg_cron` job runs `sweep_dispatch()` every 5 seconds, which moves expired offers to the next driver and retries orders with no driver.
  - Accounts: the `admin-users` Edge Function creates users. Login is phone + password, and the phone maps to `<phone>@jayek.app`. The first admin can be created only while no admin exists.
- **Phase 2 ideas:** native app (Capacitor/Expo) for background GPS and push notifications, driver wallets/prepaid balance, reports export.
