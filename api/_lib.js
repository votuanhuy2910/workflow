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

// DIFF-START
const q = (v) => '“' + v + '”';
const cut = (v, n = 80) => { v = String(v ?? '').replace(/\s+/g, ' ').trim(); return v.length > n ? v.slice(0, n) + '…' : v; };
const val = (v) => (String(v || '').trim() ? q(cut(v)) : '(trống)');
const dim = (t) => t.g.length + '×' + t.g[0].length;
const tableTexts = (t) => t.g.flat().filter((c) => !c.x && String(c.t || '').trim()).map((c) => c.t.trim());

function tableDetails(a, b) {
  if (!a && !b) return [];
  if (!a) return ['Thêm bảng ' + dim(b) + ' (hàng × cột)'];
  if (!b) return ['Xóa bảng ' + dim(a)];
  const out = [];
  if (!!a.h !== !!b.h) out.push('Hàng tiêu đề của bảng: ' + (b.h ? 'bật' : 'tắt'));
  if (dim(a) !== dim(b)) {
    out.push('Kích thước bảng: ' + dim(a) + ' → ' + dim(b) + ' (hàng × cột)');
    const A = tableTexts(a), B = tableTexts(b);
    B.filter((x) => !A.includes(x)).slice(0, 4).forEach((x) => out.push('Bảng: thêm nội dung ' + val(x)));
    A.filter((x) => !B.includes(x)).slice(0, 4).forEach((x) => out.push('Bảng: bỏ nội dung ' + val(x)));
    return out;
  }
  let merged = false;
  const cells = [];
  a.g.forEach((row, r) => row.forEach((c, k) => {
    const d = b.g[r][k];
    if (c.cs !== d.cs || c.rs !== d.rs || !!c.x !== !!d.x) merged = true;
    if (String(c.t || '') !== String(d.t || '')) cells.push('Bảng, hàng ' + (r + 1) + ' cột ' + (k + 1) + ': ' + val(c.t) + ' → ' + val(d.t));
  }));
  if (merged) out.push('Bảng: thay đổi cách gộp/tách ô');
  out.push(...cells.slice(0, 6));
  if (cells.length > 6) out.push('Bảng: …và ' + (cells.length - 6) + ' ô khác đổi nội dung');
  return out;
}
function stepEdits(p, s) {
  const d = [];
  if (p.name !== s.name) d.push('Tên bước: ' + val(p.name) + ' → ' + val(s.name));
  if ((p.owner || '') !== (s.owner || '')) d.push('Đơn vị phụ trách: ' + val(p.owner) + ' → ' + val(s.owner));
  if ((p.note || '') !== (s.note || '')) d.push(!p.note ? 'Thêm ghi chú: ' + val(s.note) : !s.note ? 'Xóa ghi chú: ' + val(p.note) : 'Ghi chú: ' + val(p.note) + ' → ' + val(s.note));
  if ((p.img || '') !== (s.img || '')) d.push(!p.img ? 'Thêm hình minh họa' : !s.img ? 'Xóa hình minh họa' : 'Đổi hình minh họa');
  d.push(...tableDetails(p.table, s.table));
  return d;
}
function stepInfo(s) {
  const d = [];
  if (s.owner) d.push('Đơn vị phụ trách: ' + val(s.owner));
  if (s.note) d.push('Ghi chú: ' + val(s.note));
  if (s.img) d.push('Có hình minh họa');
  if (s.table) d.push('Có bảng ' + dim(s.table) + ' (hàng × cột)');
  return d;
}
const names = (arr, n = 8) => arr.slice(0, n).map((s) => s.name || s.title || '(chưa đặt tên)').join(' → ') + (arr.length > n ? ' …' : '');

// Trả về danh sách thay đổi: { op: add|edit|del|move, scope: flow|step, flow, step?, details: [] }
function diffFlows(a, b) {
  const out = [];
  const A = new Map(a.map((f) => [f.id, f])), B = new Map(b.map((f) => [f.id, f]));
  const T = (f) => f.title || 'chưa đặt tên';
  for (const f of b) {
    const o = A.get(f.id);
    if (!o) {
      out.push({ op: 'add', scope: 'flow', flow: T(f), details: [f.steps.length ? 'Gồm ' + f.steps.length + ' bước: ' + names(f.steps, 6) : 'Quy trình trống, chưa có bước'] });
      continue;
    }
    if (o.title !== f.title) out.push({ op: 'edit', scope: 'flow', flow: T(f), details: ['Tiêu đề: ' + val(o.title) + ' → ' + val(f.title)] });
    const OS = new Map(o.steps.map((s) => [s.id, s])), NS = new Map(f.steps.map((s) => [s.id, s]));
    for (const s of f.steps) {
      const p = OS.get(s.id);
      if (!p) out.push({ op: 'add', scope: 'step', flow: T(f), step: s.name, details: stepInfo(s) });
      else {
        const d = stepEdits(p, s);
        if (d.length) out.push({ op: 'edit', scope: 'step', flow: T(f), step: s.name, details: d });
      }
    }
    for (const s of o.steps) if (!NS.has(s.id)) out.push({ op: 'del', scope: 'step', flow: T(f), step: s.name, details: [] });
    const ro = o.steps.filter((s) => NS.has(s.id)).map((s) => s.id).join();
    const rn = f.steps.filter((s) => OS.has(s.id)).map((s) => s.id).join();
    if (ro !== rn) out.push({ op: 'move', scope: 'flow', flow: T(f), details: ['Thứ tự các bước mới: ' + names(f.steps)] });
  }
  for (const f of a) if (!B.has(f.id)) out.push({ op: 'del', scope: 'flow', flow: T(f), details: [f.steps.length ? 'Đã xóa cùng ' + f.steps.length + ' bước: ' + names(f.steps, 6) : 'Quy trình trống, không có bước nào'] });
  const oa = a.map((f) => f.id).filter((id) => B.has(id)).join();
  const nb = b.map((f) => f.id).filter((id) => A.has(id)).join();
  if (oa !== nb) out.push({ op: 'move', scope: 'flow', flow: '', details: ['Thứ tự quy trình mới: ' + names(b)] });
  const MAX = 40;
  const res = out.slice(0, MAX).map((c) => ({ ...c, details: c.details.length > 12 ? c.details.slice(0, 12).concat('…và ' + (c.details.length - 12) + ' thay đổi khác') : c.details }));
  if (out.length > MAX) res.push({ op: 'edit', scope: 'flow', flow: '', details: ['…và ' + (out.length - MAX) + ' thay đổi khác'] });
  return res;
}
// DIFF-END

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
  await redis.set('hist:' + n, flows);
  await redis.lpush('history', { n, at: Date.now(), by: user.username, note: summary || '', changes: diffFlows(old, flows) });
  await trimHistory(flows);
  return { version: n };
}

module.exports = { redis, makeToken, getUser, newPw, hashPw, same, sessionCookie, getVersion, commit, MAX_HIST };
