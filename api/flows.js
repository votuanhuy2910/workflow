const { redis, getUser, getVersion, commit } = require('./_lib');
const str = (v, n) => String(v ?? '').slice(0, n);
const IMG = /^[a-z0-9]{6,40}$/;

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
