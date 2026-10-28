const http = require("http"), fs = require("fs"), fsp = fs.promises, path = require("path"), crypto = require("crypto");
const { promisify } = require("util"), { Pool } = require("pg");
const scrypt = promisify(crypto.scrypt);
const PORT = +process.env.PORT || 3541, DATA = process.env.DATA_DIR || "/data", PUB = path.join(__dirname, "public");
const SIGNUP_CODE = process.env.SIGNUP_CODE || "";
const QUOTA = (+process.env.USER_QUOTA_MB || 2000) * 1048576, MAXIMG = 10 * 1048576;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text UNIQUE NOT NULL, pass text NOT NULL, wa_number text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS days(user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, day date NOT NULL, t_in text NOT NULL DEFAULT '08:00', t_out text NOT NULL DEFAULT '', PRIMARY KEY(user_id, day));
CREATE TABLE IF NOT EXISTS notes(id text NOT NULL, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, day date NOT NULL, time text NOT NULL, cat text NOT NULL, zone text NOT NULL DEFAULT '', body text NOT NULL, PRIMARY KEY(user_id, id));
CREATE INDEX IF NOT EXISTS notes_day ON notes(user_id, day);
CREATE TABLE IF NOT EXISTS photos(id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, day date NOT NULL, note_id text, size int NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, id));
CREATE INDEX IF NOT EXISTS photos_day ON photos(user_id, day);
ALTER TABLE days ADD COLUMN IF NOT EXISTS sent_on date;
ALTER TABLE days ADD COLUMN IF NOT EXISTS journal jsonb NOT NULL DEFAULT '{}';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS bloc text NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS niveau text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS obs(id text NOT NULL, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, day date NOT NULL, bloc text NOT NULL DEFAULT '', niveau text NOT NULL DEFAULT '', zone text NOT NULL DEFAULT '', body text NOT NULL, company text NOT NULL DEFAULT '', priority text NOT NULL DEFAULT 'normale', due date, status text NOT NULL DEFAULT 'ouvert', closed date, PRIMARY KEY(user_id, id));
CREATE INDEX IF NOT EXISTS obs_status ON obs(user_id, status);`;

const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, NID = /^[\w-]{1,40}$/;
const str = (v, n) => String(v == null ? "" : v).slice(0, n);
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const same = (a, b) => crypto.timingSafeEqual(Buffer.from(sha(a)), Buffer.from(sha(b)));
const photoPath = (uid, id) => path.join(DATA, "photos", uid, id.toLowerCase() + ".jpg");
const err = (code, message) => Object.assign(new Error(message), { code });

const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
function readBody(req, max) {
  return new Promise((ok, ko) => {
    const ch = []; let n = 0;
    req.on("data", c => { n += c.length; if (n > max) { ko(err(413, "Fichier trop gros.")); req.destroy(); return; } ch.push(c); });
    req.on("end", () => ok(Buffer.concat(ch))); req.on("error", ko);
  });
}
async function readJson(req) { const b = await readBody(req, 1e6); try { return JSON.parse(b.toString() || "{}"); } catch { throw err(400, "JSON invalide."); } }
function cookie(req, name) { const m = (req.headers.cookie || "").split(/;\s*/).find(c => c.startsWith(name + "=")); return m ? m.slice(name.length + 1) : ""; }

async function hash(pw) { const salt = crypto.randomBytes(16); return salt.toString("hex") + ":" + (await scrypt(pw, salt, 64)).toString("hex"); }
async function verify(pw, stored) { const [s, h] = stored.split(":"); return crypto.timingSafeEqual(await scrypt(pw, Buffer.from(s, "hex"), 64), Buffer.from(h, "hex")); }
async function newSession(req, res, uid) {
  const t = crypto.randomBytes(32).toString("hex");
  await pool.query("INSERT INTO sessions VALUES($1,$2,now()+interval '90 days')", [sha(t), uid]);
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `sid=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=7776000${secure}`);
}
async function currentUser(req) {
  const t = cookie(req, "sid"); if (!t) return null;
  const r = await pool.query("SELECT u.id, u.username, u.wa_number, u.settings FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()", [sha(t)]);
  return r.rows[0] || null;
}
const tries = new Map();
const limited = k => { const now = Date.now(), a = (tries.get(k) || []).filter(t => now - t < 60000); tries.set(k, a); return a.length >= 10; };
const strike = k => { const a = tries.get(k) || []; a.push(Date.now()); tries.set(k, a); };
setInterval(() => tries.clear(), 600000).unref();

async function api(req, res, url) {
  const p = url.pathname, m = req.method, ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress).split(",")[0].trim();
  if (p === "/api/register" && m === "POST") {
    if (limited("r" + ip)) throw err(429, "Trop d’essais, patientez une minute.");
    strike("r" + ip);
    const b = await readJson(req), u = str(b.username, 40).trim().toLowerCase(), pw = str(b.password, 200);
    if (!/^[a-z0-9._-]{3,40}$/.test(u)) throw err(400, "Identifiant : 3 à 40 caractères (lettres, chiffres, . _ -).");
    if (pw.length < 8) throw err(400, "Mot de passe : 8 caractères minimum.");
    if (SIGNUP_CODE && !same(str(b.code, 100), SIGNUP_CODE)) throw err(403, "Code d’inscription incorrect.");
    try {
      const r = await pool.query("INSERT INTO users(username, pass) VALUES($1,$2) RETURNING id", [u, await hash(pw)]);
      await newSession(req, res, r.rows[0].id); return json(res, 200, { ok: true });
    } catch (e) { if (e.code === "23505") throw err(409, "Cet identifiant existe déjà."); throw e; }
  }
  if (p === "/api/login" && m === "POST") {
    const b = await readJson(req), u = str(b.username, 40).trim().toLowerCase(), key = "l" + ip + u;
    if (limited(key)) throw err(429, "Trop d’essais, patientez une minute.");
    const r = await pool.query("SELECT id, pass FROM users WHERE username=$1", [u]);
    if (!r.rows[0] || !(await verify(str(b.password, 200), r.rows[0].pass))) { strike(key); throw err(401, "Identifiant ou mot de passe incorrect."); }
    await newSession(req, res, r.rows[0].id); return json(res, 200, { ok: true });
  }
  const U = await currentUser(req);
  if (!U) throw err(401, "Connexion requise.");
  if (p === "/api/logout" && m === "POST") {
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [sha(cookie(req, "sid"))]);
    res.setHeader("Set-Cookie", "sid=; HttpOnly; Path=/; Max-Age=0"); return json(res, 200, { ok: true });
  }
  if (p === "/api/data" && m === "GET") {
    const q = (s) => pool.query(s, [U.id]);
    const [d, n, ph, ob] = await Promise.all([
      q("SELECT day::text d, t_in, t_out, sent_on::text s, journal FROM days WHERE user_id=$1"),
      q("SELECT id, day::text d, time, cat, zone, bloc, niveau, body FROM notes WHERE user_id=$1 ORDER BY day, time"),
      q("SELECT id, day::text d, note_id FROM photos WHERE user_id=$1 ORDER BY created_at"),
      q("SELECT id, day::text d, bloc, niveau, zone, body, company, priority, due::text due, status, closed::text closed FROM obs WHERE user_id=$1 ORDER BY day, id")]);
    return json(res, 200, {
      username: U.username, num: U.wa_number, settings: U.settings || {},
      days: d.rows.map(r => ({ date: r.d, arr: r.t_in, out: r.t_out, sent: r.s || "", journal: r.journal || {} })),
      notes: n.rows.map(r => ({ id: r.id, date: r.d, time: r.time, cat: r.cat, zone: r.zone, bloc: r.bloc, niveau: r.niveau, text: r.body })),
      photos: ph.rows.map(r => ({ id: r.id, date: r.d, note: r.note_id })),
      obs: ob.rows.map(r => ({ id: r.id, day: r.d, bloc: r.bloc, niveau: r.niveau, zone: r.zone, text: r.body, company: r.company, priority: r.priority, due: r.due || "", status: r.status, closed: r.closed || "" }))
    });
  }
  if (p === "/api/settings" && m === "PUT") {
    const b = await readJson(req);
    if (b.num !== undefined) await pool.query("UPDATE users SET wa_number=$1 WHERE id=$2", [str(b.num, 20).replace(/\D/g, ""), U.id]);
    if (b.settings && typeof b.settings === "object") {
      const t = b.settings, list = a => (Array.isArray(a) ? a : []).slice(0, 40).map(v => str(v, 40).trim()).filter(Boolean);
      const o = { blocs: list(t.blocs), niveaux: list(t.niveaux), company: str(t.company, 120), project: str(t.project, 200), promoter: str(t.promoter, 200), author: str(t.author, 200), attendees: str(t.attendees, 1500) };
      if (t.lastPv && Number.isInteger(t.lastPv.num) && DATE.test(t.lastPv.date)) o.lastPv = { num: t.lastPv.num, date: t.lastPv.date };
      await pool.query("UPDATE users SET settings=$1::jsonb WHERE id=$2", [JSON.stringify(o), U.id]);
    }
    return json(res, 200, { ok: true });
  }
  let x = p.match(/^\/api\/day\/(\d{4}-\d{2}-\d{2})$/);
  if (x && m === "PUT") {
    const date = x[1], b = await readJson(req);
    const arr = TIME.test(b.arr) ? b.arr : "08:00", out = TIME.test(b.out) ? b.out : "";
    const notes = (Array.isArray(b.notes) ? b.notes : []).slice(0, 500).filter(n => n && typeof n.id === "string" && NID.test(n.id));
    const J = b.journal && typeof b.journal === "object" ? b.journal : {}, journal = {};
    ["meteo", "inbar", "other", "stoppage", "material", "deliveries", "remarks"].forEach(k => { const v = str(J[k], k === "remarks" ? 2000 : 300).trim(); if (v) journal[k] = v; });
    const gone = [], c = await pool.connect();
    try {
      await c.query("BEGIN");
      if (notes.length || out || Object.keys(journal).length) await c.query("INSERT INTO days(user_id,day,t_in,t_out,sent_on,journal) VALUES($1,$2,$3,$4,$5::date,$6::jsonb) ON CONFLICT(user_id,day) DO UPDATE SET t_in=$3, t_out=$4, sent_on=$5::date, journal=$6::jsonb", [U.id, date, arr, out, DATE.test(b.sent) ? b.sent : null, JSON.stringify(journal)]);
      else await c.query("DELETE FROM days WHERE user_id=$1 AND day=$2", [U.id, date]);
      const rm = await c.query("DELETE FROM notes WHERE user_id=$1 AND day=$2 AND NOT (id = ANY($3)) RETURNING id", [U.id, date, notes.map(n => n.id)]);
      if (rm.rowCount) {
        const ph = await c.query("DELETE FROM photos WHERE user_id=$1 AND note_id = ANY($2) RETURNING id", [U.id, rm.rows.map(r => r.id)]);
        ph.rows.forEach(r => gone.push(r.id));
      }
      for (const n of notes)
        await c.query("INSERT INTO notes(id,user_id,day,time,cat,zone,bloc,niveau,body) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id,id) DO UPDATE SET day=$3, time=$4, cat=$5, zone=$6, bloc=$7, niveau=$8, body=$9",
          [n.id, U.id, date, TIME.test(n.time) ? n.time : "00:00", str(n.cat, 60), str(n.zone, 120), str(n.bloc, 40), str(n.niveau, 40), str(n.text, 5000)]);
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
    gone.forEach(id => fsp.unlink(photoPath(U.id, id)).catch(() => {}));
    return json(res, 200, { ok: true });
  }
  x = p.match(/^\/api\/obs\/([\w-]{1,40})$/);
  if (x) {
    const id = x[1];
    if (m === "PUT") {
      const b = await readJson(req);
      if (!DATE.test(b.day)) throw err(400, "Date invalide.");
      const status = ["ouvert", "en cours", "levé"].includes(b.status) ? b.status : "ouvert", prio = b.priority === "urgente" ? "urgente" : "normale";
      const due = DATE.test(b.due) ? b.due : null, closed = status === "levé" && DATE.test(b.closed) ? b.closed : null;
      await pool.query("INSERT INTO obs(id,user_id,day,bloc,niveau,zone,body,company,priority,due,status,closed) VALUES($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10::date,$11,$12::date) ON CONFLICT(user_id,id) DO UPDATE SET day=$3::date, bloc=$4, niveau=$5, zone=$6, body=$7, company=$8, priority=$9, due=$10::date, status=$11, closed=$12::date",
        [id, U.id, b.day, str(b.bloc, 40), str(b.niveau, 40), str(b.zone, 120), str(b.text, 3000), str(b.company, 120), prio, due, status, closed]);
      return json(res, 200, { ok: true });
    }
    if (m === "DELETE") {
      await pool.query("DELETE FROM obs WHERE user_id=$1 AND id=$2", [U.id, id]);
      const ph = await pool.query("DELETE FROM photos WHERE user_id=$1 AND note_id=$2 RETURNING id", [U.id, id]);
      ph.rows.forEach(r => fsp.unlink(photoPath(U.id, r.id)).catch(() => {}));
      return json(res, 200, { ok: true });
    }
  }
  x = p.match(/^\/api\/photo\/([0-9a-f-]{36})$/i);
  if (x && UUID.test(x[1])) {
    const id = x[1].toLowerCase();
    if (m === "PUT") {
      const date = url.searchParams.get("date") || "", note = url.searchParams.get("note") || null;
      if (!DATE.test(date) || (note && !NID.test(note))) throw err(400, "Paramètres invalides.");
      const buf = await readBody(req, MAXIMG);
      if (!(buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF)) throw err(415, "Seules les photos JPEG sont acceptées.");
      if ((await pool.query("SELECT 1 FROM photos WHERE user_id=$1 AND id=$2", [U.id, id])).rowCount) return json(res, 200, { ok: true });
      const used = +(await pool.query("SELECT COALESCE(SUM(size),0) s FROM photos WHERE user_id=$1", [U.id])).rows[0].s;
      if (used + buf.length > QUOTA) throw err(413, "Espace photos plein.");
      const f = photoPath(U.id, id); await fsp.mkdir(path.dirname(f), { recursive: true }); await fsp.writeFile(f, buf);
      try { await pool.query("INSERT INTO photos(id,user_id,day,note_id,size) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [id, U.id, date, note, buf.length]); }
      catch (e) { fsp.unlink(f).catch(() => {}); throw e; }
      return json(res, 200, { ok: true });
    }
    const own = (await pool.query("SELECT 1 FROM photos WHERE user_id=$1 AND id=$2", [U.id, id])).rowCount;
    if (!own) throw err(404, "Photo introuvable.");
    if (m === "GET") {
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
      return fs.createReadStream(photoPath(U.id, id)).on("error", () => res.end()).pipe(res);
    }
    if (m === "DELETE") {
      await pool.query("DELETE FROM photos WHERE user_id=$1 AND id=$2", [U.id, id]);
      fsp.unlink(photoPath(U.id, id)).catch(() => {}); return json(res, 200, { ok: true });
    }
  }
  throw err(404, "Introuvable.");
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };
const SEC = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'" };

const server = http.createServer(async (req, res) => {
  for (const k in SEC) res.setHeader(k, SEC[k]);
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/healthz") { await pool.query("SELECT 1"); return json(res, 200, { ok: true }); }
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    const p = url.pathname === "/" ? "/index.html" : url.pathname, file = path.join(PUB, path.normalize(p));
    if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (e, d) => {
      if (e) { res.writeHead(404); return res.end("Introuvable"); }
      const h = { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" };
      if (p === "/sw.js" || p === "/index.html") h["Cache-Control"] = "no-cache";
      res.writeHead(200, h); res.end(d);
    });
  } catch (e) {
    const code = e.code && Number.isInteger(e.code) ? e.code : /^22/.test(e.code || "") ? 400 : 500;
    if (code === 500) console.error(e);
    if (!res.headersSent) json(res, code, { error: code === 500 ? "Erreur serveur." : /^22/.test(e.code || "") ? "Données invalides." : e.message });
  }
});

(async () => {
  for (let i = 0; ; i++) {
    try { await pool.query(SCHEMA); break; } catch (e) { if (i > 30) { console.error(e); process.exit(1); } console.log("Base de données pas prête, nouvel essai…"); await new Promise(r => setTimeout(r, 2000)); }
  }
  server.listen(PORT, () => console.log("Carnet de chantier sur le port " + PORT));
})();
