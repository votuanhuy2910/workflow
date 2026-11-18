const crypto = require('crypto');
const { redis, getUser } = require('./_lib');
const ID = /^[a-z0-9]{6,40}$/;
const PREFIX = 'data:image/jpeg;base64,';

module.exports = async (req, res) => {
  try {
    // Ai cũng xem được ảnh
    if (req.method === 'GET') {
      const id = String(req.query.id || '');
      if (!ID.test(id)) return res.status(400).end();
      const b64 = await redis.get('img:' + id);
      if (!b64) return res.status(404).end();
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.status(200).send(Buffer.from(String(b64), 'base64'));
    }
    // Chỉ Admin / Editor được tải ảnh lên (ảnh đã nén JPEG ở trình duyệt)
    if (req.method === 'POST') {
      const u = await getUser(req);
      if (!u || !['admin', 'editor'].includes(u.role)) return res.status(403).json({ error: 'Bạn không có quyền tải ảnh' });
      const d = String((req.body && req.body.data) || '');
      if (!d.startsWith(PREFIX) || d.length > 700000) return res.status(400).json({ error: 'Ảnh không hợp lệ hoặc quá lớn' });
      const id = crypto.randomBytes(8).toString('hex');
      await redis.set('img:' + id, d.slice(PREFIX.length));
      return res.json({ id });
    }
    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
