const { redis, getUser } = require('./_lib');
const str = (v, n) => String(v ?? '').slice(0, n);
const IMG = /^[a-z0-9]{6,40}$/;
const imgIds = (a) => new Set((a || []).flatMap((f) => (f.steps || []).map((s) => s.img).filter(Boolean)));

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    // Ai cũng xem được (viewer)
    if (req.method === 'GET') return res.json({ flows: (await redis.get('flows')) || [] });

    // Chỉ admin / editor được ghi
    if (req.method === 'PUT') {
      const u = await getUser(req);
      if (!u || !['admin', 'editor'].includes(u.role)) return res.status(403).json({ error: 'Bạn không có quyền chỉnh sửa' });
      const list = req.body && req.body.flows;
      if (!Array.isArray(list) || list.length > 200) return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
      const flows = list.map((f) => ({
        id: str(f.id, 40),
        title: str(f.title, 200),
        steps: (Array.isArray(f.steps) ? f.steps : []).slice(0, 100).map((s) => ({
          id: str(s.id, 40), name: str(s.name, 200), owner: str(s.owner, 200), note: str(s.note, 2000),
          img: IMG.test(String(s.img || '')) ? String(s.img) : '',
        })),
      }));
      const old = (await redis.get('flows')) || [];
      await redis.set('flows', flows);
      // xóa ảnh không còn được bước nào dùng
      const keep = imgIds(flows);
      const gone = [...imgIds(old)].filter((i) => !keep.has(i));
      if (gone.length) await redis.del(...gone.map((i) => 'img:' + i));
      return res.json({ ok: true });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
