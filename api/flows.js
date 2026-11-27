const { redis, getUser, getVersion, commit } = require('./_lib');
const str = (v, n) => String(v ?? '').slice(0, n);
const IMG = /^[a-z0-9]{6,40}$/;
const span = (v) => Math.min(20, Math.max(1, parseInt(v, 10) || 1));
// Bảng: { h: có hàng tiêu đề, g: lưới ô [{ t: chữ, cs: gộp cột, rs: gộp hàng, x: ô bị gộp }] }
function cleanTable(t) {
  if (!t || !Array.isArray(t.g) || !t.g.length || t.g.length > 60) return null;
  const C = Array.isArray(t.g[0]) ? t.g[0].length : 0;
  if (!C || C > 20) return null;
  const g = [];
  for (const row of t.g) {
    if (!Array.isArray(row) || row.length !== C) return null;
    g.push(row.map((c) => ({ t: str(c && c.t, 500), cs: span(c && c.cs), rs: span(c && c.rs), x: !!(c && c.x) })));
  }
  return { h: !!t.h, g };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    // Ai cũng xem được (viewer). ?check=1 chỉ trả về số phiên bản để kiểm tra có thay đổi không
    if (req.method === 'GET') {
      if (req.query.check) return res.json({ version: await getVersion() });
      const [flows, version] = await Promise.all([redis.get('flows'), getVersion()]);
      return res.json({ flows: flows || [], version });
    }

    // Chỉ admin / editor được ghi
    if (req.method === 'PUT') {
      const u = await getUser(req);
      if (!u || !['admin', 'editor'].includes(u.role)) return res.status(403).json({ error: 'Bạn không có quyền chỉnh sửa' });
      const body = req.body || {};
      const list = body.flows;
      const version = Number(body.version);
      if (!Array.isArray(list) || list.length > 200 || !Number.isInteger(version)) return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
      const flows = list.map((f) => ({
        id: str(f.id, 40),
        title: str(f.title, 200),
        steps: (Array.isArray(f.steps) ? f.steps : []).slice(0, 100).map((s) => ({
          id: str(s.id, 40), name: str(s.name, 200), owner: str(s.owner, 200), note: str(s.note, 2000),
          img: IMG.test(String(s.img || '')) ? String(s.img) : '',
          table: cleanTable(s.table),
        })),
      }));
      const r = await commit(flows, version, u);
      if (r.conflict) {
        const last = await redis.lindex('history', 0);
        return res.status(409).json({
          error: 'Dữ liệu đã bị người khác thay đổi',
          version: await getVersion(), by: last && last.by, at: last && last.at,
        });
      }
      return res.json({ ok: true, version: r.version });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
