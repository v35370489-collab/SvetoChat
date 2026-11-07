const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();

const SMTP_PASS = defineSecret('SMTP_PASS');
const SMTP_HOST = defineString('SMTP_HOST');
const SMTP_PORT = defineString('SMTP_PORT', { default: '465' });
const SMTP_USER = defineString('SMTP_USER');
const MAIL_FROM = defineString('MAIL_FROM');

const MAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const OPTS = { region: 'us-central1', secrets: [SMTP_PASS] };

// 1) Отправка 6-значного кода на почту
exports.sendCode = onCall(OPTS, async (req) => {
  const email = String((req.data || {}).email || '').trim().toLowerCase();
  if (!MAIL_RE.test(email) || email.length > 120) throw new HttpsError('invalid-argument', 'Некорректная почта');
  const ref = db.collection('codes').doc(sha(email));
  const old = await ref.get();
  if (old.exists && Date.now() - old.data().sent < 45000)
    throw new HttpsError('resource-exhausted', 'Подождите минуту перед повторной отправкой кода');
  const code = String(crypto.randomInt(100000, 1000000));
  await ref.set({ h: sha(email + ':' + code), exp: Date.now() + 10 * 60 * 1000, tries: 0, sent: Date.now() });
  const tr = nodemailer.createTransport({
    host: SMTP_HOST.value(), port: Number(SMTP_PORT.value()), secure: Number(SMTP_PORT.value()) === 465,
    auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() },
  });
  try {
    await tr.sendMail({
      from: MAIL_FROM.value(), to: email, subject: `Код входа SvetoChat: ${code}`,
      text: `Ваш код входа в SvetoChat: ${code}\nОн действует 10 минут. Если это были не вы, просто проигнорируйте письмо.`,
      html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:420px;margin:auto;padding:24px"><h2 style="margin:0 0 8px">SvetoChat</h2><p style="color:#555">Ваш код входа:</p><p style="font-size:34px;letter-spacing:8px;font-weight:700;margin:8px 0">${code}</p><p style="color:#888;font-size:13px">Код действует 10 минут. Если это были не вы, просто проигнорируйте письмо.</p></div>`,
    });
  } catch (e) {
    console.error('mail error', e);
    await ref.delete();
    throw new HttpsError('unavailable', 'Не удалось отправить письмо. Попробуйте позже.');
  }
  return { ok: true };
});

// 2) Проверка кода и вход (возвращает custom token Firebase Auth)
exports.verifyCode = onCall({ region: 'us-central1' }, async (req) => {
  const email = String((req.data || {}).email || '').trim().toLowerCase();
  const code = String((req.data || {}).code || '').trim();
  if (!MAIL_RE.test(email) || !/^\d{6}$/.test(code)) throw new HttpsError('invalid-argument', 'Неверные данные');
  const ref = db.collection('codes').doc(sha(email));
  const d = await ref.get();
  if (!d.exists) throw new HttpsError('failed-precondition', 'Сначала запросите код');
  const v = d.data();
  if (Date.now() > v.exp) { await ref.delete(); throw new HttpsError('deadline-exceeded', 'Код устарел, запросите новый'); }
  if (v.tries >= 5) { await ref.delete(); throw new HttpsError('resource-exhausted', 'Слишком много попыток, запросите новый код'); }
  const ok = crypto.timingSafeEqual(Buffer.from(v.h), Buffer.from(sha(email + ':' + code)));
  if (!ok) { await ref.update({ tries: v.tries + 1 }); throw new HttpsError('permission-denied', 'Неверный код'); }
  await ref.delete();
  let user;
  try { user = await admin.auth().getUserByEmail(email); }
  catch (e) { user = await admin.auth().createUser({ email, emailVerified: true }); }
  return { token: await admin.auth().createCustomToken(user.uid) };
});
