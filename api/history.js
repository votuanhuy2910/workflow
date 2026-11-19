const { redis, getUser, getVersion, commit, MAX_HIST } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const u = await getUser(req);
    if (!u || !['admin', 'editor'].includes(u.role)) return res.status(403).json({ error: 'Bạn không có quyền xem lịch sử' });

    if (req.method === 'GET') {
      return res.json({ history: await redis.lrange('history', 0, MAX_HIST - 1) });
    }
    // Khôi phục: chỉ Admin
    if (req.method === 'POST') {
      if (u.role !== 'admin') return res.status(403).json({ error: 'Chỉ Admin được khôi phục' });
      const n = Number((req.body || {}).n);
      const snap = await redis.get('hist:' + n);
      if (!snap) return res.status(404).json({ error: 'Không tìm thấy phiên bản này (có thể đã bị xóa khỏi lịch sử)' });
      for (let k = 0; k < 3; k++) {
        const r = await commit(snap, await getVersion(), u, 'Khôi phục về trạng thái sau thay đổi #' + n);
        if (!r.conflict) return res.json({ ok: true, version: r.version });
      }
      return res.status(409).json({ error: 'Có người khác đang sửa, hãy thử lại' });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
