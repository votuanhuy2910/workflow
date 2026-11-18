const { redis, getUser, newPw } = require('./_lib');
const ROLES = ['viewer', 'editor', 'admin'];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const me = await getUser(req);
    if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Chỉ Admin được quản lý người dùng' });

    if (req.method === 'GET') {
      const all = (await redis.hgetall('users')) || {};
      return res.json({ users: Object.entries(all).map(([username, r]) => ({ username, role: r.role })) });
    }
    if (req.method === 'POST') {
      const { username = '', password = '', role = 'viewer' } = req.body || {};
      if (!/^[a-z0-9._-]{3,32}$/i.test(username)) return res.status(400).json({ error: 'Tên đăng nhập 3-32 ký tự (chữ, số, . _ -)' });
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'Quyền không hợp lệ' });
      if (username === process.env.ADMIN_USER) return res.status(400).json({ error: 'Tên này dành cho tài khoản Admin gốc' });
      const old = await redis.hget('users', username);
      if (!old && password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });
      if (password && password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });
      const cred = password ? newPw(password) : { salt: old.salt, hash: old.hash };
      await redis.hset('users', { [username]: { ...cred, role } });
      return res.json({ ok: true });
    }
    if (req.method === 'DELETE') {
      await redis.hdel('users', String(req.query.username || ''));
      return res.json({ ok: true });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
