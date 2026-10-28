/**
 * Auth.gs
 * Authentication: password hashing, sessions, rate limiting, OTP, forgot/change password.
 *
 * HONEST NOTES
 *  - Apps Script has no bcrypt/PBKDF2. Passwords are protected with a unique random salt, a
 *    secret "pepper" kept in Script Properties, and 1200 rounds of HMAC-SHA256. Plain text
 *    passwords are never stored or logged.
 *  - Sessions live in CacheService (server side). The browser only holds a random token.
 *    Cache may be cleared by Google at any time; the user then simply signs in again.
 *  - Identity is by email/phone + password (Admin) and email/phone (Employee), as requested.
 *    The web app does NOT rely on Google account identity.
 *
 * NOTE: pepper_() lives ONLY in this file. Delete any copy of pepper_() from Code.gs.
 */

const PBKDF_ITER = 1200;

/* ---------------- crypto helpers ---------------- */
function randomToken_() { return (Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }
function sha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}
function cache_() { return CacheService.getScriptCache(); }
function pepper_() {
  const p = PropertiesService.getScriptProperties();
  let v = p.getProperty('PEPPER');
  if (!v) { v = randomToken_() + randomToken_(); p.setProperty('PEPPER', v); }
  return v;
}
function derive_(password, salt) {
  const key = Utilities.newBlob(pepper_() + salt).getBytes();
  let h = Utilities.computeHmacSha256Signature(Utilities.newBlob(salt + ':' + password).getBytes(), key);
  for (let i = 1; i < PBKDF_ITER; i++) h = Utilities.computeHmacSha256Signature(h, key);
  return Utilities.base64Encode(h);
}
function safeEq_(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
function setCred_(adminId, password) {
  const salt = randomToken_().slice(0, 32);
  PropertiesService.getScriptProperties().setProperty('CRED_' + adminId,
    JSON.stringify({ salt: salt, hash: derive_(password, salt), updated: Date.now() }));
}
function getCred_(adminId) {
  const raw = PropertiesService.getScriptProperties().getProperty('CRED_' + adminId);
  return raw ? JSON.parse(raw) : null;
}
function clearCred_(adminId) { PropertiesService.getScriptProperties().deleteProperty('CRED_' + adminId); }
function verifyPassword_(password, cred) { return safeEq_(derive_(password, cred.salt), cred.hash); }
function getSV_(adminId) { return parseInt(PropertiesService.getScriptProperties().getProperty('SV_' + adminId) || '0', 10) || 0; }
function bumpSessionVersion_(adminId) {
  PropertiesService.getScriptProperties().setProperty('SV_' + adminId, String(getSV_(adminId) + 1));
}
function validatePassword_(pwd) {
  const min = Math.max(6, SN_('PASSWORD_MIN_LENGTH'));
  if (String(pwd || '').length < min) fail_('Password must be at least ' + min + ' characters.');
  if (!/[A-Za-z]/.test(pwd) || !/\d/.test(pwd)) fail_('Password must contain both letters and numbers.');
}

/* ---------------- rate limiting ---------------- */
/** Fixed window: at most `max` calls per `windowSec`. The window does NOT extend while traffic continues. */
function throttle_(key, max, windowSec) {
  const c = cache_(), now = Date.now();
  let o = null;
  try { o = JSON.parse(c.get(key) || 'null'); } catch (e) { o = null; }
  if (!o || typeof o.s !== 'number' || now - o.s > windowSec * 1000) o = { n: 0, s: now };
  if (o.n >= max) return false;
  o.n++;
  c.put(key, JSON.stringify(o), Math.min(Math.max(windowSec, 1), 21600));
  return true;
}
function isLocked_(prefix, key) { return !!cache_().get(prefix + 'LOCK_' + key); }
function recordFail_(prefix, key) {
  const c = cache_();
  const ttl = Math.min(Math.max(SN_('LOCKOUT_MINUTES'), 1) * 60, 21600);
  const k = prefix + 'FAIL_' + key;
  const n = (parseInt(c.get(k) || '0', 10) || 0) + 1;
  if (n >= Math.max(SN_('MAX_LOGIN_ATTEMPTS'), 1)) { c.put(prefix + 'LOCK_' + key, '1', ttl); c.remove(k); }
  else c.put(k, String(n), ttl);
  return n;
}
function clearFails_(prefix, key) { cache_().remove(prefix + 'FAIL_' + key); cache_().remove(prefix + 'LOCK_' + key); }
function identKey_(ident) {
  const s = String(ident || '').trim();
  return sha256Hex_(s.indexOf('@') > -1 ? normEmail_(s) : normPhone_(s));
}
function lockMsg_() { return 'Too many failed attempts. Please try again after ' + SN_('LOCKOUT_MINUTES') + ' minutes.'; }

/* ---------------- sessions ---------------- */
function sessionKey_(t) { return 'S_' + sha256Hex_(t); }
function authErr_() { return new UserError('Your session has expired. Please sign in again.', 'AUTH'); }
function createSession_(role, subject, minutes) {
  const token = randomToken_();
  const s = {
    role: role, id: subject.id, email: subject.email || '', name: subject.name || '',
    sv: role === 'ADMIN' ? getSV_(subject.id) : 0, iat: Date.now()
  };
  cache_().put(sessionKey_(token), JSON.stringify(s), Math.min(Math.max(minutes, 1) * 60, 21600));
  return token;
}
function getSession_(token, role) {
  if (!token || typeof token !== 'string' || token.length < 40) throw authErr_();
  const key = sessionKey_(token);
  const raw = cache_().get(key);
  if (!raw) throw authErr_();
  const s = JSON.parse(raw);
  if (s.role !== role || (Date.now() - s.iat) > 12 * 3600 * 1000) { cache_().remove(key); throw authErr_(); }
  if (role === 'ADMIN' && s.sv !== getSV_(s.id)) { cache_().remove(key); throw authErr_(); }
  const minutes = role === 'ADMIN' ? SN_('ADMIN_SESSION_MINUTES') : SN_('EMPLOYEE_SESSION_MINUTES');
  cache_().put(key, raw, Math.min(Math.max(minutes, 1) * 60, 21600));   // sliding expiry
  return s;
}
function sessionLogout_(ctx) {
  cache_().remove(sessionKey_(ctx.token));
  log_(ctx, ctx.role + '_LOGOUT', 'SECURITY', ctx.id, '', '', '', 'SUCCESS');
  return { done: true };
}

/* ---------------- lookups ---------------- */
function findEmployeeByIdent_(ident) {
  const s = String(ident || '').trim();
  const isMail = s.indexOf('@') > -1;
  const em = normEmail_(s), ph = normPhone_(s);
  return readAll_('EMP').filter(e =>
    String(e['Status']) !== 'Deleted' &&   // employees in the Bin can never sign in
    (isMail ? normEmail_(e['Email']) === em : (ph.length === 10 && normPhone_(e['Phone']) === ph))
  )[0] || null;
}
function findAdminByIdent_(ident) {
  const s = String(ident || '').trim();
  const isMail = s.indexOf('@') > -1;
  const em = normEmail_(s), ph = normPhone_(s);
  return readAll_('ADM').filter(a => isMail ? normEmail_(a['Email']) === em : (ph.length === 10 && normPhone_(a['Phone']) === ph))[0] || null;
}
function getAdminById_(id) {
  return readAll_('ADM').filter(a => String(a['Admin ID']) === String(id))[0] || null;
}
function checkIdentFormat_(ident) {
  const s = String(ident || '').trim();
  if (!s) fail_('Please enter your email address or mobile number.');
  if (s.indexOf('@') > -1) { if (!isEmail_(s)) fail_('Please enter a valid email address.'); }
  else if (normPhone_(s).length !== 10) fail_('Please enter a valid 10-digit mobile number.');
  return s;
}

/* ---------------- OTP ---------------- */
function genOtp_() {
  const hex = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  return pad_(parseInt(hex, 16) % 1000000, 6);
}
function storeOtp_(key, otp) {
  const salt = randomToken_().slice(0, 16);
  const mins = Math.max(SN_('OTP_VALID_MINUTES'), 1);
  cache_().put(key, JSON.stringify({ h: sha256Hex_(salt + otp + pepper_()), s: salt, a: 0, x: Date.now() + mins * 60000 }),
    Math.min(mins * 60, 21600));
}
function checkOtp_(key, code) {
  const c = cache_();
  const raw = c.get(key);
  if (!raw) fail_('This code has expired or is invalid. Please request a new code.');
  const o = JSON.parse(raw);
  if (Date.now() > o.x) { c.remove(key); fail_('This code has expired. Please request a new code.'); }
  o.a = (o.a || 0) + 1;
  const max = Math.max(SN_('OTP_MAX_ATTEMPTS'), 1);
  if (!safeEq_(sha256Hex_(o.s + String(code || '').trim() + pepper_()), o.h)) {
    if (o.a >= max) { c.remove(key); fail_('Too many wrong attempts. The code is cancelled. Please request a new code.'); }
    c.put(key, JSON.stringify(o), Math.max(Math.ceil((o.x - Date.now()) / 1000), 1));
    fail_('Incorrect code. Attempts left: ' + (max - o.a) + '.');
  }
  c.remove(key);
  return true;
}

/* ---------------- EMPLOYEE LOGIN ---------------- */
function employeeSessionResult_(emp) {
  const mins = SN_('EMPLOYEE_SESSION_MINUTES');
  const token = createSession_('EMPLOYEE', { id: emp['Employee ID'], email: emp['Email'] || emp['Phone'], name: emp['Employee Name'] }, mins);
  log_({ email: emp['Email'] || emp['Phone'], role: 'EMPLOYEE' }, 'EMPLOYEE_LOGIN', 'SECURITY', emp['Employee ID'], '', '', '', 'SUCCESS');
  return { token: token, user: { id: emp['Employee ID'], name: emp['Employee Name'] }, config: clientConfig_(), sessionMinutes: mins };
}

function employeeLogin_(ctx, p) {
  if (!SB_('SYSTEM_ACTIVE')) fail_('The leave portal is temporarily closed. Please contact Admin.');
  const ident = checkIdentFormat_(p.identifier);
  const key = identKey_(ident);
  if (isLocked_('E', key)) fail_(lockMsg_(), 'LOCK');
  if (!throttle_('E_GLOBAL', 600, 600)) fail_('The system is busy. Please try again in a few minutes.', 'LOCK');
  const emp = findEmployeeByIdent_(ident);
  if (!emp || String(emp['Status']) !== 'Active') {
    recordFail_('E', key);
    log_({ email: ident, role: 'ANONYMOUS' }, 'EMPLOYEE_LOGIN_FAILED', 'SECURITY', '', '', '', 'No active employee match', 'FAILURE');
    fail_('We could not find an active employee with these details. Please check them, or contact Admin.');
  }
  if (S_('EMPLOYEE_LOGIN_MODE') === 'EMAIL_OTP') {
    if (!isEmail_(emp['Email'])) fail_('No registered email is available for verification. Please contact Admin.');
    if (!throttle_('EOTP_SEND_' + key, 3, 900)) fail_('Too many code requests. Please try again later.', 'LOCK');
    const otp = genOtp_();
    storeOtp_('EOTP_' + emp['Employee ID'], otp);
    const r = sendOtpMail_(emp['Email'], emp['Employee Name'], otp, 'Employee sign-in');
    if (!r.ok) fail_('We could not send the verification email. Please contact Admin.');
    return { step: 'OTP', message: 'A 6-digit code has been emailed to your registered email address.' };
  }
  clearFails_('E', key);
  return employeeSessionResult_(emp);
}

function employeeVerifyOtp_(ctx, p) {
  const ident = checkIdentFormat_(p.identifier);
  const key = identKey_(ident);
  if (isLocked_('E', key)) fail_(lockMsg_(), 'LOCK');
  const emp = findEmployeeByIdent_(ident);
  if (!emp || String(emp['Status']) !== 'Active') fail_('Invalid details. Please start again.');
  try { checkOtp_('EOTP_' + emp['Employee ID'], p.code); }
  catch (e) {
    recordFail_('E', key);
    log_({ email: ident, role: 'ANONYMOUS' }, 'EMPLOYEE_OTP_FAILED', 'SECURITY', emp['Employee ID'], '', '', e.message, 'FAILURE');
    throw e;
  }
  clearFails_('E', key);
  return employeeSessionResult_(emp);
}

function employeeCtx_(token) {
  const s = getSession_(token, 'EMPLOYEE');
  if (!SB_('SYSTEM_ACTIVE')) fail_('The leave portal is temporarily closed. Please contact Admin.', 'AUTH');
  const emp = getEmpById_(s.id);
  if (!emp || String(emp['Status']) !== 'Active') { cache_().remove(sessionKey_(token)); throw authErr_(); }
  return { role: 'EMPLOYEE', id: emp['Employee ID'], email: emp['Email'] || emp['Phone'], emp: emp, token: token };
}

/* ---------------- ADMIN LOGIN ---------------- */
function adminLogin_(ctx, p) {
  const ident = String(p.identifier || '').trim();
  const pwd = String(p.password || '');
  if (!ident || !pwd) fail_('Please enter your email or mobile number and your password.');
  const key = identKey_(ident);
  if (isLocked_('A', key)) {
    log_({ email: ident, role: 'ANONYMOUS' }, 'ADMIN_LOGIN_BLOCKED', 'SECURITY', '', '', '', 'Account temporarily locked', 'FAILURE');
    fail_(lockMsg_(), 'LOCK');
  }
  const admin = findAdminByIdent_(ident);
  const cred = admin ? getCred_(admin['Admin ID']) : null;
  let ok = false;
  if (admin && cred && String(admin['Status']) === 'Active') ok = verifyPassword_(pwd, cred);
  else derive_(pwd, 'timing-equaliser');                 // keep timing similar for unknown users
  if (!ok) {
    recordFail_('A', key);
    log_({ email: ident, role: 'ANONYMOUS' }, 'ADMIN_LOGIN_FAILED', 'SECURITY', admin ? admin['Admin ID'] : '', '', '', 'Invalid credentials', 'FAILURE');
    fail_('Invalid login details. If this is your first time, or you forgot your password, use "Forgot password?".');
  }
  clearFails_('A', key);
  const mins = SN_('ADMIN_SESSION_MINUTES');
  const token = createSession_('ADMIN', { id: admin['Admin ID'], email: admin['Email'], name: admin['Admin Name'] }, mins);
  log_({ email: admin['Email'], role: 'ADMIN' }, 'ADMIN_LOGIN', 'SECURITY', admin['Admin ID'], '', '', '', 'SUCCESS');
  return {
    token: token, sessionMinutes: mins, config: clientConfig_(),
    admin: { id: admin['Admin ID'], name: admin['Admin Name'], email: admin['Email'], role: admin['Role'] }
  };
}

function adminMe_(ctx) {
  return { admin: { id: ctx.id, name: ctx.name, email: ctx.email, role: ctx.adminRole }, config: clientConfig_() };
}

/* ---------------- FORGOT PASSWORD (security code to registered email) ---------------- */
function adminForgotStart_(ctx, p) {
  const ident = checkIdentFormat_(p.identifier);
  const key = identKey_(ident);
  const resp = {
    message: 'If the details match an authorized administrator, a security code has been sent to the registered email address. It is valid for ' +
      SN_('OTP_VALID_MINUTES') + ' minutes.'
  };
  if (!throttle_('FSEND_' + key, 3, 900)) fail_('Too many requests. Please try again after some time.', 'LOCK');
  const admin = findAdminByIdent_(ident);
  if (!admin || String(admin['Status']) !== 'Active' || !isEmail_(admin['Email'])) {
    log_({ email: ident, role: 'ANONYMOUS' }, 'ADMIN_RESET_REQUEST_REJECTED', 'SECURITY', '', '', '', 'No active admin match', 'FAILURE');
    return resp;
  }
  const otp = genOtp_();
  storeOtp_('AOTP_' + admin['Admin ID'], otp);
  const r = sendOtpMail_(admin['Email'], admin['Admin Name'], otp, 'Admin password reset');
  log_({ email: admin['Email'], role: 'ADMIN' }, 'ADMIN_RESET_CODE_SENT', 'SECURITY', admin['Admin ID'], '', '', r.ok ? 'Code emailed' : 'Email failed: ' + r.error, r.ok ? 'SUCCESS' : 'FAILURE');
  return resp;
}

function adminForgotComplete_(ctx, p) {
  const ident = checkIdentFormat_(p.identifier);
  const key = identKey_(ident);
  const admin = findAdminByIdent_(ident);
  if (!admin || String(admin['Status']) !== 'Active') fail_('This code has expired or is invalid. Please request a new code.');
  try { checkOtp_('AOTP_' + admin['Admin ID'], p.code); }
  catch (e) {
    log_({ email: admin['Email'], role: 'ADMIN' }, 'ADMIN_RESET_CODE_FAILED', 'SECURITY', admin['Admin ID'], '', '', e.message, 'FAILURE');
    throw e;
  }
  const pwd = String(p.newPassword || '');
  if (pwd !== String(p.confirmPassword || '')) fail_('The two passwords do not match.');
  validatePassword_(pwd);
  setCred_(admin['Admin ID'], pwd);
  bumpSessionVersion_(admin['Admin ID']);               // ends every existing session
  clearFails_('A', key);
  sendPasswordResetConfirmation_(admin);
  log_({ email: admin['Email'], role: 'ADMIN' }, 'ADMIN_PASSWORD_RESET', 'SECURITY', admin['Admin ID'], '', '', 'Password reset via security code; sessions invalidated', 'SUCCESS');
  return { message: 'Your password has been set. Please sign in with your new password.' };
}

/* ---------------- CHANGE PASSWORD (signed-in admin) ---------------- */
function adminChangePassword_(ctx, p) {
  const cred = getCred_(ctx.id);
  if (!cred || !verifyPassword_(String(p.currentPassword || ''), cred)) {
    log_(ctx, 'ADMIN_PASSWORD_CHANGE_FAILED', 'SECURITY', ctx.id, '', '', 'Current password wrong', 'FAILURE');
    fail_('Your current password is incorrect.');
  }
  const pwd = String(p.newPassword || '');
  if (pwd !== String(p.confirmPassword || '')) fail_('The two new passwords do not match.');
  if (pwd === String(p.currentPassword)) fail_('The new password must be different from the current password.');
  validatePassword_(pwd);
  setCred_(ctx.id, pwd);
  bumpSessionVersion_(ctx.id);
  sendPasswordResetConfirmation_(ctx.admin);
  log_(ctx, 'ADMIN_PASSWORD_CHANGED', 'SECURITY', ctx.id, '', '', 'Password changed; all sessions ended', 'SUCCESS');
  return { message: 'Password changed. Please sign in again.' };
}

function adminCtx_(token) {
  const s = getSession_(token, 'ADMIN');
  const a = getAdminById_(s.id);
  if (!a || String(a['Status']) !== 'Active') { cache_().remove(sessionKey_(token)); throw authErr_(); }
  return { role: 'ADMIN', adminRole: a['Role'], id: a['Admin ID'], email: a['Email'], name: a['Admin Name'], admin: a, token: token };
}
