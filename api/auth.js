const { redis, makeToken, getUser, hashPw, same, sessionCookie } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const action = req.query.action;
  try {
    if (!process.env.SESSION_SECRET) return res.status(500).json({ error: 'Thiếu biến môi trường SESSION_SECRET' });
    if (action === 'me') return res.json({ user: await getUser(req) });
    if (action === 'logout') {
      res.setHeader('Set-Cookie', sessionCookie('', 0));
      return res.json({ ok: true });
    }
    if (action === 'login' && req.method === 'POST') {
      const { username = '', password = '' } = req.body || {};
      let ok = false;
      if (process.env.ADMIN_USER && username === process.env.ADMIN_USER) {
        ok = same(password, process.env.ADMIN_PASSWORD || '');
      } else {
        const rec = await redis.hget('users', username);
        ok = !!rec && same(hashPw(password, rec.salt), rec.hash);
      }
      if (!ok) return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
      const token = makeToken(username);
      res.setHeader('Set-Cookie', sessionCookie(token));
      return res.json({ user: await getUser({ headers: { cookie: 'sid=' + token } }) });
    }
    res.status(400).json({ error: 'Yêu cầu không hợp lệ' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
