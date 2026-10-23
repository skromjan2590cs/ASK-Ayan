const fs = require("fs");
const path = require("path");

// ───────────────────────── Storage ─────────────────────────
const DB_DIR = path.join(__dirname, "cache");
const DB_FILE = path.join(DB_DIR, "silenttag.json");
let db = {};
try {
  fs.mkdirSync(DB_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
} catch (_) { db = {}; }

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (_) {}
  }, 5000);
}

function getThread(tid) {
  if (!db[tid]) db[tid] = { since: Date.now(), mode: "funny", users: {}, ignore: [], tagged: {}, auto: false, freq: "normal", nextAuto: 0 };
  return db[tid];
}

// ───────────────────────── Helpers ─────────────────────────
const MAX_PER_MSG = 20;       // এক মেসেজে সর্বোচ্চ ট্যাগ
const MAX_TOTAL_ALL = 60;     // `all` মোডে মোট সর্বোচ্চ ট্যাগ
const USER_TAG_COOLDOWN = 30 * 60 * 1000; // একই ইউজারকে ৩০ মিনিটে ১ বারের বেশি ট্যাগ নয়
const DEFAULT_THRESHOLD = 24 * 60 * 60 * 1000;

const bnDigits = n => String(n).replace(/\d/g, d => "০১২৩৪৫৬৭৮৯"[d]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseDuration(str) {
  const m = /^(\d+)\s*(m|h|d)$/i.exec(str || "");
  if (!m) return null;
  const v = parseInt(m[1], 10);
  const unit = { m: 60e3, h: 3600e3, d: 86400e3 }[m[2].toLowerCase()];
  return v * unit;
}

function formatDuration(ms) {
  const d = Math.floor(ms / 86400e3);
  const h = Math.floor((ms % 86400e3) / 3600e3);
  const m = Math.floor((ms % 3600e3) / 60e3);
  const parts = [];
  if (d) parts.push(`${bnDigits(d)} দিন`);
  if (h) parts.push(`${bnDigits(h)} ঘণ্টা`);
  if (!d && m) parts.push(`${bnDigits(m)} মিনিট`);
  return parts.join(" ") || "কয়েক সেকেন্ড";
}

// ───────────────────────── Captions ─────────────────────────
const CAPTIONS = {
  funny: [
    "👀 অনলাইনে থেকে চুপিচুপি চ্যাট দেখা বন্ধ করো! কিছু একটা লেখো...",
    "👻 গ্রুপে এত নীরবতা কেন? সবাই কি ভূত হয়ে গেছো নাকি?",
    "🤐 আঙ্গুলে কি জং ধরেছে? একটা মেসেজ দিতে এত কষ্ট!",
    "🕵️‍♂️ সিআইডি ডাকা লাগবে! এরা অনলাইনে থেকেও গায়েব!",
    "🍿 শুধু পপকর্ন খেয়ে চ্যাট দেখলে হবে না, কথাও বলো!",
    "📡 নেটওয়ার্ক ঠিক আছে তো? নাকি শুধু সিন করার প্ল্যান?",
    "🦗 গ্রুপে ঝিঁঝিঁ পোকার ডাক শোনা যাচ্ছে... কেউ আছো?",
    "🧘 এত মৌনতা! সাধনা করছো নাকি ভাই?",
    "🚨 জরুরি নোটিশ: নীরবতা ভঙ্গ করার সময় হয়েছে!"
  ],
  roast: [
    "🔥 সিন করার রাজারা, আজ একটু টাইপও করো!",
    "💀 গ্রুপে থেকে কোনো কনট্রিবিউশন নেই, শুধু জায়গা দখল!",
    "🪦 তোমাদের শেষ মেসেজ খুঁজতে প্রত্নতত্ত্ববিদ লাগবে!",
    "😏 'হুম' ও তো একটা মেসেজ, সেটাও দিতে পারো না?",
    "🐢 কচ্ছপও তোমাদের চেয়ে বেশি অ্যাক্টিভ!"
  ],
  soft: [
    "💬 কেমন আছো সবাই? অনেকদিন তোমাদের কথা শুনি না!",
    "🌸 গ্রুপটা তোমাদের ছাড়া ফাঁকা লাগছে, একটু কথা বলো!",
    "🤗 যা মনে আসে লিখে ফেলো, সবাই শুনতে চায়!",
    "☕ চা-কফি নিয়ে আড্ডায় যোগ দাও!"
  ]
};

function levelTag(silentMs, neverSeen) {
  if (neverSeen) return "👻 রহস্যময় মেম্বার (কখনো দেখিনি)";
  const d = silentMs / 86400e3;
  if (d >= 7) return `🦖 ফসিল — ${formatDuration(silentMs)} চুপ`;
  if (d >= 3) return `🧟 জম্বি — ${formatDuration(silentMs)} চুপ`;
  if (d >= 1) return `😴 ঘুমন্ত — ${formatDuration(silentMs)} চুপ`;
  return `👀 নীরব দর্শক — ${formatDuration(silentMs)} চুপ`;
}

// ───────────────────────── Core ─────────────────────────
async function getNames(api, ids) {
  const out = {};
  try {
    const info = await api.getUserInfo(ids);
    for (const id of ids) out[id] = info[id]?.name || "বন্ধু";
  } catch (_) {
    for (const id of ids) out[id] = "বন্ধু";
  }
  return out;
}

function buildMessage(header, rows) {
  // rows: [{ id, name, line }] — fromIndex সহ নির্ভুল mention তৈরি
  let body = header;
  const mentions = [];
  rows.forEach((r, i) => {
    const tag = `@${r.name}`;
    const prefix = `${i + 1}. `;
    body += prefix;
    mentions.push({ tag, id: r.id, fromIndex: body.length });
    body += `${tag}\n   ↳ ${r.line}\n`;
  });
  return { body, mentions };
}

async function collectSilent(api, event, thr, threshold, { skipCooldown = true } = {}) {
  const info = await api.getThreadInfo(event.threadID);
  const botID = api.getCurrentUserID();
  const now = Date.now();

  const candidates = [];
  for (const id of info.participantIDs) {
    if (id === botID || id === event.senderID) continue;
    if (thr.ignore.includes(id)) continue;
    if (skipCooldown && thr.tagged[id] && now - thr.tagged[id] < USER_TAG_COOLDOWN) continue;

    const u = thr.users[id];
    const last = u?.last;
    const silentMs = last ? now - last : now - thr.since;
    const neverSeen = !last;
    // যাদের ট্র্যাকিং শুরুর পর কখনো দেখা যায়নি, তারা threshold পার হলেই silent
    if (silentMs >= threshold) candidates.push({ id, silentMs, neverSeen, count: u?.count || 0 });
  }
  return { info, candidates };
}

async function isAdmin(api, event) {
  const botAdmins = (global.GoatBot?.config?.adminBot || []).map(String);
  if (botAdmins.includes(String(event.senderID))) return true;
  try {
    const info = await api.getThreadInfo(event.threadID);
    return (info.adminIDs || []).some(a => String(a.id || a) === String(event.senderID));
  } catch (_) { return false; }
}

// ───────────────────────── Auto random tagger ─────────────────────────
// কোনো নির্দিষ্ট সময় নেই। চ্যাটে মেসেজ আসলে, র‍্যান্ডম চান্স + র‍্যান্ডম গ্যাপ মিলে গেলে তবেই বট নিজে থেকে ট্যাগ করে।
const H = 3600e3;
const FREQ = {
  low:    { chance: 0.05, min: 3 * H,   max: 12 * H },
  normal: { chance: 0.10, min: 1 * H,   max: 6 * H  },
  high:   { chance: 0.20, min: 0.5 * H, max: 3 * H  }
};
const AUTO_COOLDOWN = 3 * H; // একই ইউজারকে অটো-ট্যাগের মধ্যে ন্যূনতম গ্যাপ
const randBetween = (a, b) => a + Math.random() * (b - a);
const randomGap = thr => { const f = FREQ[thr.freq] || FREQ.normal; return randBetween(f.min, f.max); };

const AUTO_SOLO = [
  "🕵️ {tags}, তোমাকে {dur} ধরে কিছু বলতে দেখি না... সব ঠিক আছে তো, নাকি বট-এর চোখ ফাঁকি দিচ্ছো?",
  "📣 এই যে {tags}! গ্রুপের CCTV বলছে তুমি {dur} ধরে নিঃশব্দ। একটা 'হাই' তো দাও!",
  "🦗 {tags} ভাই/আপু, তোমার জন্য গ্রুপে ঝিঁঝিঁ পোকা ডাকছে। কিছু একটা বলে ওদের থামাও!",
  "🔔 টুং টাং! {tags}, তোমার নীরবতার {dur} পূর্ণ হয়েছে। অভিনন্দন! এবার একটা মেসেজ দিয়ে রেকর্ড ভাঙো 😆",
  "👻 {tags}, তুমি কি জীবিত? জীবিত থাকলে অন্তত একটা ইমোজি দাও!",
  "🍵 {tags}, চা ঠান্ডা হয়ে গেল, আড্ডা জমছে না। তুমি কই?",
  "📡 {tags} এর সিগন্যাল {dur} ধরে পাওয়া যাচ্ছে না। কেউ খোঁজ নাও তো!",
  "🧘 {tags} মৌনব্রত পালন করছে নাকি? ব্রত ভাঙার সময় হয়েছে!",
  "🎤 মাইক টেস্টিং... ১, ২, ৩... {tags} শুনতে পাচ্ছো? উত্তর দাও!",
  "🚨 নীরবতা অ্যালার্ট! {tags} গ্রুপে আছে কিন্তু কথা বলছে না। সন্দেহজনক 🤨"
];

const AUTO_GROUP = [
  "🕵️ {tags}, তোমরা সবাই কি গোপন মিটিং করছো? এত চুপ কেন!",
  "👀 {tags}, তোমরা শুধু দেখো আর দেখো... একটু বলোও তো!",
  "🦗 {tags}, তোমাদের নীরবতায় গ্রুপের ঝিঁঝিঁ পোকারাও অবাক!",
  "👻 {tags}, তোমরা কি সবাই একসাথে ভূত হয়ে গেলে? কেউ একজন অন্তত 'আছি' বলো!",
  "📢 জরুরি ঘোষণা! {tags} — সর্বোচ্চ {dur} নীরবতার অপরাধে তোমাদের একটা করে মেসেজ দিতে বাধ্য করা হলো 😂",
  "🍿 {tags}, দর্শক হয়ে সিনেমা দেখার দিন শেষ, এবার তোমরাও অভিনয় করো!",
  "🚨 {tags}, বট রিপোর্ট করছে: তোমরা অনলাইনে থেকেও ডুব দিয়েছো। ভেসে ওঠো!",
  "🤐 {tags}, তোমাদের কি ঠোঁটে চেইন লাগানো? আজ চেইন খোলার দিন!"
];

function buildAuto(template, rows, dur) {
  const filled = template.replace("{dur}", dur);
  const [before, after = ""] = filled.split("{tags}");
  let body = before;
  const mentions = [];
  rows.forEach((r, i) => {
    if (i > 0) body += i === rows.length - 1 ? " আর " : ", ";
    const tag = `@${r.name}`;
    mentions.push({ tag, id: r.id, fromIndex: body.length });
    body += tag;
  });
  body += after;
  return { body, mentions };
}

async function maybeAutoTag(api, event) {
  const thr = getThread(event.threadID);
  if (!thr.auto) return;

  const now = Date.now();
  if (!thr.nextAuto) { thr.nextAuto = now + randomGap(thr); scheduleSave(); return; }
  if (now < thr.nextAuto) return;

  const f = FREQ[thr.freq] || FREQ.normal;
  if (Math.random() > f.chance) return; // প্রতিবার না, মাঝে মাঝে

  // পরের বারের জন্য নতুন র‍্যান্ডম গ্যাপ এখনই সেট (ডুপ্লিকেট ট্রিগার আটকাতে)
  thr.nextAuto = now + randomGap(thr);
  scheduleSave();

  const threshold = pick([6, 12, 24, 48]) * H;
  const { candidates } = await collectSilent(api, event, thr, threshold);
  const fresh = candidates.filter(c => !thr.tagged[c.id] || now - thr.tagged[c.id] > AUTO_COOLDOWN);
  if (!fresh.length) { thr.nextAuto = now + randBetween(20 * 60e3, 60 * 60e3); return; }

  // বেশিরভাগ সময় ১ জন, কখনো ২-৩ জন
  const n = Math.min(fresh.length, Math.random() < 0.65 ? 1 : (Math.random() < 0.6 ? 2 : 3));
  const chosen = shuffle(fresh).slice(0, n);
  const names = await getNames(api, chosen.map(c => c.id));
  const rows = chosen.map(c => ({ id: c.id, name: names[c.id] }));
  const maxSilent = Math.max(...chosen.map(c => c.silentMs));
  const dur = chosen.some(c => c.neverSeen) && n === 1 ? "অনেকক্ষণ" : formatDuration(maxSilent);

  const { body, mentions } = buildAuto(pick(n === 1 ? AUTO_SOLO : AUTO_GROUP), rows, dur);

  await sleep(randBetween(3000, 45000)); // মানুষের মতো একটু দেরিতে
  await api.sendMessage({ body, mentions }, event.threadID);

  const t = Date.now();
  chosen.forEach(c => (thr.tagged[c.id] = t));
  scheduleSave();
}

// ───────────────────────── Command ─────────────────────────
module.exports = {
  config: {
    name: "silenttag",
    aliases: ["silent", "ghost", "abual"],
    version: "2.1.0",
    author: "GoatBot Custom",
    countDown: 10,
    role: 0,
    shortDescription: {
      en: "Smart silent-member tagger",
      bn: "স্মার্টভাবে নীরব মেম্বারদের ট্যাগ করুন"
    },
    longDescription: {
      en: "Tracks real activity and tags members who have actually been silent, with funny/roast/soft captions, leaderboards and admin controls."
    },
    category: "fun",
    guide: {
      en:
        "{p}silenttag → ২৪ ঘণ্টার বেশি চুপ থাকা ৫ জনকে ট্যাগ\n" +
        "{p}silenttag 3d | 12h | 30m → কাস্টম সময়\n" +
        "{p}silenttag <সংখ্যা> → কতজনকে ট্যাগ (সর্বোচ্চ ২০)\n" +
        "{p}silenttag all [সময়] → সবাইকে ট্যাগ (অ্যাডমিন)\n" +
        "{p}silenttag top → সবচেয়ে চুপ ১০ জন\n" +
        "{p}silenttag active → সবচেয়ে অ্যাক্টিভ ১০ জন\n" +
        "{p}silenttag stats → গ্রুপ পরিসংখ্যান\n" +
        "{p}silenttag mode funny|roast|soft → ধরন (অ্যাডমিন)\n" +
        "{p}silenttag auto on|off|low|normal|high → র‍্যান্ডম অটো-ট্যাগ (অ্যাডমিন)\n" +
        "{p}silenttag ignore @user → ট্যাগ লিস্ট থেকে বাদ/যোগ (অ্যাডমিন)\n" +
        "{p}silenttag reset → ডাটা রিসেট (অ্যাডমিন)"
    }
  },

  // প্রতিটি মেসেজে অ্যাক্টিভিটি রেকর্ড
  onChat: async function ({ event, api }) {
    try {
      const { threadID, senderID } = event;
      if (!threadID || !senderID || senderID === api.getCurrentUserID()) return;
      const thr = getThread(threadID);
      const u = thr.users[senderID] || (thr.users[senderID] = { last: 0, count: 0 });
      u.last = Date.now();
      u.count++;
      scheduleSave();
      maybeAutoTag(api, event).catch(e => console.error("[silenttag:auto]", e));
    } catch (_) {}
  },

  onStart: async function ({ api, event, args, message }) {
    const { threadID, senderID, mentions } = event;
    const thr = getThread(threadID);
    const sub = (args[0] || "").toLowerCase();

    try {
      // ───── top / active ─────
      if (sub === "top" || sub === "active") {
        const info = await api.getThreadInfo(threadID);
        const botID = api.getCurrentUserID();
        const now = Date.now();
        const list = info.participantIDs
          .filter(id => id !== botID)
          .map(id => {
            const u = thr.users[id];
            return { id, count: u?.count || 0, silentMs: u?.last ? now - u.last : now - thr.since, never: !u?.last };
          });

        const sorted = sub === "top"
          ? list.sort((a, b) => b.silentMs - a.silentMs)
          : list.sort((a, b) => b.count - a.count);
        const top = sorted.slice(0, 10);
        const names = await getNames(api, top.map(t => t.id));

        const medals = ["🥇", "🥈", "🥉"];
        let text = sub === "top" ? "🏆 সবচেয়ে নীরব ১০ জন\n\n" : "🔥 সবচেয়ে অ্যাক্টিভ ১০ জন\n\n";
        top.forEach((t, i) => {
          const m = medals[i] || `${bnDigits(i + 1)}.`;
          text += sub === "top"
            ? `${m} ${names[t.id]} — ${t.never ? "কখনো দেখিনি" : formatDuration(t.silentMs)}\n`
            : `${m} ${names[t.id]} — ${bnDigits(t.count)} মেসেজ\n`;
        });
        return message.reply(text);
      }

      // ───── stats ─────
      if (sub === "stats") {
        const info = await api.getThreadInfo(threadID);
        const now = Date.now();
        const total = info.participantIDs.length;
        const tracked = Object.keys(thr.users).length;
        const msgs = Object.values(thr.users).reduce((s, u) => s + u.count, 0);
        const active24 = Object.values(thr.users).filter(u => now - u.last < 86400e3).length;
        return message.reply(
          `📊 গ্রুপ পরিসংখ্যান\n\n` +
          `👥 মোট মেম্বার: ${bnDigits(total)}\n` +
          `🧾 ট্র্যাকড মেম্বার: ${bnDigits(tracked)}\n` +
          `💬 মোট মেসেজ (ট্র্যাকিং শুরু থেকে): ${bnDigits(msgs)}\n` +
          `🟢 গত ২৪ ঘণ্টায় অ্যাক্টিভ: ${bnDigits(active24)}\n` +
          `🔇 নীরব (২৪ঘ+): ${bnDigits(Math.max(total - active24, 0))}\n` +
          `🎭 মোড: ${thr.mode}\n` +
          `🎲 অটো-ট্যাগ: ${thr.auto ? "চালু (" + thr.freq + ")" : "বন্ধ"}\n` +
          `🚫 ইগনোর লিস্ট: ${bnDigits(thr.ignore.length)} জন\n` +
          `⏱ ট্র্যাকিং শুরু: ${formatDuration(now - thr.since)} আগে`
        );
      }

      // ───── admin-only subcommands ─────
      if (["mode", "ignore", "reset", "auto"].includes(sub)) {
        if (!(await isAdmin(api, event))) return message.reply("🔒 এই কমান্ড শুধু অ্যাডমিনদের জন্য!");

        if (sub === "auto") {
          const v = (args[1] || "").toLowerCase();
          if (v === "off") {
            thr.auto = false;
            scheduleSave();
            return message.reply("🔕 অটো-ট্যাগ বন্ধ করা হলো।");
          }
          if (v === "on" || FREQ[v]) {
            thr.auto = true;
            if (FREQ[v]) thr.freq = v;
            thr.nextAuto = 0;
            scheduleSave();
            return message.reply(`🎲 অটো-ট্যাগ চালু! (ফ্রিকোয়েন্সি: ${thr.freq})\nনির্দিষ্ট সময় নেই, বট নিজের খেয়ালে মাঝে মাঝে মজা করে ট্যাগ করবে 😎`);
          }
          return message.reply(
            `🎲 অটো-ট্যাগ: ${thr.auto ? "চালু" : "বন্ধ"} | ফ্রিকোয়েন্সি: ${thr.freq}\n` +
            "ব্যবহার: silenttag auto on | off | low | normal | high"
          );
        }

        if (sub === "mode") {
          const m = (args[1] || "").toLowerCase();
          if (!CAPTIONS[m]) return message.reply("❓ ব্যবহার: silenttag mode funny | roast | soft");
          thr.mode = m;
          scheduleSave();
          return message.reply(`🎭 মোড সেট হয়েছে: ${m}`);
        }

        if (sub === "ignore") {
          const ids = Object.keys(mentions || {});
          if (!ids.length) return message.reply("❓ কাউকে @mention করুন।");
          const added = [], removed = [];
          for (const id of ids) {
            const i = thr.ignore.indexOf(id);
            if (i >= 0) { thr.ignore.splice(i, 1); removed.push(id); }
            else { thr.ignore.push(id); added.push(id); }
          }
          scheduleSave();
          return message.reply(
            (added.length ? `🚫 ইগনোর লিস্টে যোগ: ${bnDigits(added.length)} জন\n` : "") +
            (removed.length ? `✅ ইগনোর লিস্ট থেকে বাদ: ${bnDigits(removed.length)} জন` : "")
          );
        }

        if (sub === "reset") {
          db[threadID] = undefined;
          delete db[threadID];
          getThread(threadID);
          scheduleSave();
          return message.reply("♻️ এই গ্রুপের সব ট্র্যাকিং ডাটা রিসেট হয়েছে।");
        }
      }

      // ───── tag mode ─────
      const isAll = sub === "all";
      if (isAll && !(await isAdmin(api, event))) {
        return message.reply("🔒 'all' মোড শুধু অ্যাডমিনদের জন্য!");
      }

      let threshold = DEFAULT_THRESHOLD;
      let count = 5;
      for (const a of args.slice(isAll ? 1 : 0)) {
        const dur = parseDuration(a);
        if (dur) threshold = dur;
        else if (/^\d+$/.test(a)) count = Math.min(Math.max(parseInt(a, 10), 1), MAX_PER_MSG);
      }

      const { candidates } = await collectSilent(api, event, thr, threshold);

      if (!candidates.length) {
        return message.reply(
          `🎉 গত ${formatDuration(threshold)} এ সবাই অ্যাক্টিভ (বা সম্প্রতি ট্যাগ করা হয়েছে)!\n` +
          `💡 ট্র্যাকিং শুরু হয়েছে ${formatDuration(Date.now() - thr.since)} আগে, তাই আগের ডাটা নেই।`
        );
      }

      // সবচেয়ে বেশি চুপ যারা তাদের অগ্রাধিকার, কিন্তু একটু র‍্যান্ডমনেস
      const ordered = isAll
        ? candidates.sort((a, b) => b.silentMs - a.silentMs).slice(0, MAX_TOTAL_ALL)
        : shuffle(candidates.sort((a, b) => b.silentMs - a.silentMs).slice(0, count * 3)).slice(0, count);

      const names = await getNames(api, ordered.map(c => c.id));
      const rows = ordered.map(c => ({ id: c.id, name: names[c.id], line: levelTag(c.silentMs, c.neverSeen) }));

      const caption = pick(CAPTIONS[thr.mode] || CAPTIONS.funny);
      const header = `📢 Hey Silent Watchers!\n\n${caption}\n⏳ সীমা: ${formatDuration(threshold)} | 👥 ${bnDigits(rows.length)} জন\n\n`;

      // চাঙ্কে ভাগ করে পাঠানো
      const chunks = [];
      for (let i = 0; i < rows.length; i += MAX_PER_MSG) chunks.push(rows.slice(i, i + MAX_PER_MSG));

      for (let i = 0; i < chunks.length; i++) {
        const { body, mentions: m } = buildMessage(i === 0 ? header : `📢 (পর্ব ${bnDigits(i + 1)})\n\n`, chunks[i]);
        await api.sendMessage({ body, mentions: m }, threadID);
        if (i < chunks.length - 1) await sleep(1500);
      }

      const now = Date.now();
      ordered.forEach(c => (thr.tagged[c.id] = now));
      scheduleSave();
    } catch (err) {
      console.error("[silenttag]", err);
      return message.reply("❌ কমান্ডটি রান করতে সমস্যা হয়েছে, আবার চেষ্টা করুন।");
    }
  }
};
