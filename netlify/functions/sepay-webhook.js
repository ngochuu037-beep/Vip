// Nhận thông báo tiền vào từ SePay và cộng số dư cho khách (qua Supabase).
// Biến môi trường cần đặt trên Netlify:
//   SEPAY_API_KEY        chuỗi bí mật tự đặt, giống hệt ô API Key khi tạo webhook ở SePay
//   SUPABASE_URL         https://xxxx.supabase.co
//   SUPABASE_SECRET_KEY  khoá bí mật (Secret key / service_role) của Supabase - KHÔNG để lộ
const crypto = require('crypto');

const CODE_RE = /NAP[A-Z0-9]{6}/;

function reply(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body };
}
const OK = '{"success": true}';                 // SePay cần đúng dạng này
const FAIL = (msg) => JSON.stringify({ success: false, message: msg });

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, FAIL('Method not allowed'));

  const apiKey = process.env.SEPAY_API_KEY;
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SECRET_KEY;
  if (!apiKey || !supaUrl || !supaKey) return reply(500, FAIL('Server chưa cấu hình'));

  // 1) Xác thực: SePay gửi header  Authorization: Apikey <KEY>
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!safeEqual(auth, 'Apikey ' + apiKey)) return reply(401, FAIL('Unauthorized'));

  // 2) Đọc dữ liệu
  let p;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
    p = JSON.parse(raw);
  } catch (e) {
    return reply(400, FAIL('Bad JSON'));
  }

  // Chỉ xử lý tiền VÀO. Tiền ra thì bỏ qua nhưng vẫn trả thành công để SePay không gửi lại
  if (p.transferType !== 'in') return reply(200, OK);

  // 3) Lấy mã nạp: ưu tiên trường code của SePay, không có thì tìm trong nội dung chuyển khoản
  let code = '';
  const fromCode = String(p.code || '').toUpperCase().match(CODE_RE);
  const fromContent = String(p.content || '').toUpperCase().match(CODE_RE);
  if (fromCode) code = fromCode[0]; else if (fromContent) code = fromContent[0];

  // 4) Cộng tiền bằng hàm SQL (tự chống cộng trùng theo id giao dịch)
  const headers = { 'Content-Type': 'application/json', apikey: supaKey };
  if (!supaKey.startsWith('sb_')) headers.Authorization = 'Bearer ' + supaKey;

  let res;
  try {
    res = await fetch(supaUrl.replace(/\/$/, '') + '/rest/v1/rpc/credit_topup', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_sepay_id: p.id,
        p_code: code,
        p_amount: p.transferAmount,
        p_content: p.content || '',
        p_raw: p,
      }),
    });
  } catch (e) {
    console.error('Không gọi được Supabase:', e);
    return reply(500, FAIL('Supabase unreachable'));       // lỗi -> SePay sẽ tự gửi lại
  }

  if (!res.ok) {
    console.error('Supabase lỗi', res.status, await res.text());
    return reply(500, FAIL('Supabase error'));
  }
  console.log('SePay', p.id, code || '(không có mã)', await res.text());
  return reply(200, OK);
};
