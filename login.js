// Đăng nhập bằng TÊN ĐĂNG NHẬP: tìm email tương ứng ở phía máy chủ rồi đăng nhập Supabase.
// Trình duyệt không bao giờ nhận được email của người khác.
// Dùng lại 2 biến đã có trên Netlify: SUPABASE_URL và SUPABASE_SECRET_KEY.
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_llD39mxTvjldNmfwFPrtyw_oomwxF78';

function reply(status, obj) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
const BAD = () => reply(401, { message: 'Sai tên đăng nhập hoặc mật khẩu.' });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { message: 'Method not allowed' });

  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const secret = process.env.SUPABASE_SECRET_KEY || '';
  if (!base || !secret) return reply(500, { message: 'Máy chủ chưa cấu hình.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { message: 'Dữ liệu không hợp lệ.' }); }
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[a-z0-9_]{3,20}$/.test(username) || password.length < 6 || password.length > 200) return BAD();

  // 1) Tìm email theo tên đăng nhập (chỉ máy chủ làm được nhờ khoá bí mật)
  const h = { apikey: secret };
  if (!secret.startsWith('sb_')) h.Authorization = 'Bearer ' + secret;
  let email = '';
  try {
    const r = await fetch(base + '/rest/v1/profiles?select=email&limit=1&username=eq.' + encodeURIComponent(username), { headers: h });
    if (!r.ok) return reply(500, { message: 'Không kết nối được, bạn thử lại.' });
    const rows = await r.json();
    email = rows && rows[0] && rows[0].email ? rows[0].email : '';
  } catch (e) {
    return reply(500, { message: 'Không kết nối được, bạn thử lại.' });
  }
  if (!email) return BAD();

  // 2) Đăng nhập bằng email + mật khẩu, chỉ trả về token
  try {
    const r = await fetch(base + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: PUBLISHABLE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) return BAD();
    const j = await r.json();
    if (!j.access_token || !j.refresh_token) return BAD();
    return reply(200, { access_token: j.access_token, refresh_token: j.refresh_token });
  } catch (e) {
    return reply(500, { message: 'Không kết nối được, bạn thử lại.' });
  }
};
