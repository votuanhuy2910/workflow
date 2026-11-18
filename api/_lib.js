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

module.exports = { redis, makeToken, getUser, newPw, hashPw, same, sessionCookie };
