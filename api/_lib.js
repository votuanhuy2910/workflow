const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});
const SECRET = process.env.SESSION_SECRET || '';
const sign = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('base64url');

function makeToken(username) {
  const p = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + 7 * 864e5 })).toString('base64url');
  return p + '.' + sign(p);
}
function readToken(t) {
  if (!t || !SECRET) return null;
  const [p, s] = t.split('.');
  if (!p || !s) return null;
  const e = sign(p);
  if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
  try {
    const d = JSON.parse(Buffer.from(p, 'base64url').toString());
    return d.exp > Date.now() ? d.u : null;
  } catch { return null; }
}
function getCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(name + '='));
  return m ? m.slice(name.length + 1) : null;
}
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const newPw = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return { salt, hash: hashPw(pw, salt) }; };
const same = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

// Trả về { username, role } hoặc null (chưa đăng nhập = viewer)
async function getUser(req) {
  const u = readToken(getCookie(req, 'sid'));
  if (!u) return null;
  if (process.env.ADMIN_USER && u === process.env.ADMIN_USER) return { username: u, role: 'admin', fixed: true };
  const rec = await redis.hget('users', u);
  return rec ? { username: u, role: rec.role } : null;
}
const sessionCookie = (token, maxAge = 604800) =>
  `sid=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

// ---------- Phiên bản dữ liệu, lịch sử thay đổi ----------
const MAX_HIST = 50;
const CAS = "local v=tonumber(redis.call('get',KEYS[1]) or '0') if v~=tonumber(ARGV[1]) then return -1 end redis.call('set',KEYS[2],ARGV[2]) redis.call('set',KEYS[1],v+1) return v+1";
const getVersion = async () => Number(await redis.get('flows:ver')) || 0;
const imgIds = (a) => new Set((a || []).flatMap((f) => (f.steps || []).map((s) => s.img).filter(Boolean)));

function diffFlows(a, b) {
  const out = [];
  const A = new Map(a.map((f) => [f.id, f])), B = new Map(b.map((f) => [f.id, f]));
  const t = (f) => '“' + (f.title || 'chưa đặt tên') + '”';
  for (const f of b) {
    const o = A.get(f.id);
    if (!o) { out.push('Thêm quy trình ' + t(f)); continue; }
    if (o.title !== f.title) out.push('Đổi tên quy trình ' + t(o) + ' → ' + t(f));
    const OS = new Map(o.steps.map((s) => [s.id, s])), NS = new Map(f.steps.map((s) => [s.id, s]));
    for (const s of f.steps) {
      const p = OS.get(s.id);
      if (!p) out.push('Thêm bước “' + s.name + '” vào ' + t(f));
      else if (['name', 'owner', 'note', 'img'].some((k) => (p[k] || '') !== (s[k] || ''))) out.push('Sửa bước “' + s.name + '” trong ' + t(f));
    }
    for (const s of o.steps) if (!NS.has(s.id)) out.push('Xóa bước “' + s.name + '” khỏi ' + t(f));
    const ro = o.steps.filter((s) => NS.has(s.id)).map((s) => s.id).join();
    const rn = f.steps.filter((s) => OS.has(s.id)).map((s) => s.id).join();
    if (ro !== rn) out.push('Sắp xếp lại các bước của ' + t(f));
  }
  for (const f of a) if (!B.has(f.id)) out.push('Xóa quy trình ' + t(f));
  const oa = a.map((f) => f.id).filter((id) => B.has(id)).join();
  const nb = b.map((f) => f.id).filter((id) => A.has(id)).join();
  if (oa !== nb) out.push('Sắp xếp lại thứ tự quy trình');
  return out.length ? out : ['Không có thay đổi nội dung'];
}

// Xóa ảnh mồ côi khi một bản lịch sử cũ bị loại bỏ
async function trimHistory(cur) {
  while ((await redis.llen('history')) > MAX_HIST) {
    const d = await redis.rpop('history');
    if (!d) break;
    const snap = (await redis.get('hist:' + d.n)) || [];
    await redis.del('hist:' + d.n);
    const rest = await redis.lrange('history', 0, -1);
    const snaps = rest.length ? await redis.mget(...rest.map((h) => 'hist:' + h.n)) : [];
    const keep = new Set([...imgIds(cur), ...snaps.flatMap(imgIds)]);
    const gone = [...imgIds(snap)].filter((i) => !keep.has(i));
    if (gone.length) await redis.del(...gone.map((i) => 'img:' + i));
  }
}

// Ghi dữ liệu nếu phiên bản khớp (so sánh-và-ghi nguyên tử). Trả về { version } hoặc { conflict: true }
async function commit(flows, expect, user, summary) {
  const old = (await redis.get('flows')) || [];
  const n = Number(await redis.eval(CAS, ['flows:ver', 'flows'], [String(expect), JSON.stringify(flows)]));
  if (n === -1) return { conflict: true };
  const sm = summary ? [summary] : diffFlows(old, flows);
  await redis.set('hist:' + n, flows);
  await redis.lpush('history', {
    n, at: Date.now(), by: user.username,
    summary: sm.slice(0, 6).concat(sm.length > 6 ? ['…và ' + (sm.length - 6) + ' thay đổi khác'] : []),
  });
  await trimHistory(flows);
  return { version: n };
}

module.exports = { redis, makeToken, getUser, newPw, hashPw, same, sessionCookie, getVersion, commit, MAX_HIST };
