/**
 * Leave.gs
 * Leave engine: validation, ledger & balances, e-mails, employee API, maintenance (monthly credit / lapse / year-end expiry).
 *
 * LEDGER MODEL (all balances are derived from LEAVE LEDGER, nothing is ever deleted)
 *  CREDIT   monthly credit            LAPSE   unused month-scoped leave expiring at month end (CL by policy)
 *  USE      approved leave (debit)    EXPIRY  unused year-scoped leave expiring at year end (SL by policy)
 *  REVERSAL cancel/edit of approved   ADJUST  manual Admin correction (credit or debit)
 *  CL is "month-scoped" (balance is per month, lapses monthly). SL is "year-scoped" (balance carries within the year).
 */

const LEAVE_NAMES = { CL: 'Casual Leave', SL: 'Sick Leave', OTHER: 'Other Leave' };
let _HOL = null;

/* ================= small helpers ================= */
function plain_(o) { return JSON.parse(JSON.stringify(o === undefined ? null : o)); }
function setCell_(key, row, col, val) { sh_(key).getRange(row, COLS[key].indexOf(col) + 1).setValue(val); }
function getEmpById_(id) { return readAll_('EMP').filter(e => String(e['Employee ID']) === String(id))[0] || null; }
function getApp_(id) { return readAll_('APP').filter(a => String(a['Application ID']) === String(id))[0] || null; }
function trim_(s) { return String(s).trim(); }
function monthScoped_(type) {
  if (type === 'CL') return !SB_('CL_CARRY_FORWARD');
  if (type === 'SL') return !SB_('SL_CARRY_FORWARD');
  return false;
}
function daysByMonth_(days) {
  const m = {};
  days.forEach(d => { const k = d.getFullYear() + '-' + (d.getMonth() + 1); m[k] = (m[k] || 0) + 1; });
  return m;
}
function webAppUrl_() {
  let u = S_('WEB_APP_URL');
  if (!u) { try { u = ScriptApp.getService().getUrl() || ''; } catch (e) { u = ''; } }
  return u;
}
function adminEmails_() {
  const l = S_('ADMIN_NOTIFICATION_EMAIL').split(/[,;]/).map(trim_).filter(isEmail_);
  return (l.length ? l : [OWNER_EMAIL_]).join(',');
}

function allowedLeaves_(emp) {
  const raw = String(emp['Allowed Leaves'] || '').trim().toUpperCase();
  if (!raw) return ['CL', 'SL', 'OTHER'];
  if (raw === 'NONE') return [];
  return raw.split(',').map(trim_).filter(x => ['CL', 'SL', 'OTHER'].indexOf(x) > -1);
}

function empOut_(e) {
  return {
    id: e['Employee ID'], name: e['Employee Name'], email: e['Email'], phone: String(e['Phone'] || ''),
    department: e['Department'], designation: e['Designation'], joining: iso_(e['Joining Date']), status: e['Status'],
    cl: e['CL Balance'], sl: e['SL Balance'], allowed: allowedLeaves_(e)
  };
}
function appOut_(a) {
  return {
    id: a['Application ID'], submitted: dt_(a['Submission Timestamp']), empId: a['Employee ID'], empName: a['Employee Name'],
    email: a['Employee Email'], type: a['Leave Type'], durType: a['Duration Type'], from: iso_(a['From Date']), to: iso_(a['To Date']),
    fromD: dmy_(a['From Date']), toD: dmy_(a['To Date']), duration: a['Duration'], reason: a['Reason'],
    hasDoc: !!a['Medical Document ID'], status: a['Status'], remarks: a['Admin Remarks'], reviewedBy: a['Reviewed By'],
    reviewedAt: dt_(a['Reviewed At']), noticeOverride: a['Notice Override'], overrideReason: a['Override Reason'], source: a['Entry Source']
  };
}
function holidaySet_() {
  if (_HOL) return _HOL;
  const s = {};
  readAll_('HOL').forEach(h => { if (String(h['Status']) === 'Active' && h['Holiday Date'] instanceof Date) s[iso_(h['Holiday Date'])] = 1; });
  _HOL = s;
  return s;
}

/* ================= duration / notice ================= */
function leaveDays_(from, to) {
  const working = S_('DURATION_MODE') === 'WORKING';
  const off = String(S_('WEEKLY_OFF_DAYS')).split(',').map(trim_).filter(x => x !== '').map(Number);
  const hol = (working && SB_('EXCLUDE_HOLIDAYS_FROM_DURATION')) ? holidaySet_() : {};
  const out = [];
  for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d <= to; d = addDays_(d, 1)) {
    if (working && (off.indexOf(d.getDay()) > -1 || hol[iso_(d)])) continue;
    out.push(d);
  }
  return out;
}
function noticeRequiredHours_(type, duration) {
  let h = type === 'CL' ? SN_('CL_NOTICE_HOURS') : type === 'OTHER' ? SN_('OTHER_NOTICE_HOURS') : SN_('SL_NOTICE_HOURS');
  if (SB_('ADDITIONAL_NOTICE_ENABLED') &&
    S_('ADDITIONAL_NOTICE_APPLIES_TO').toUpperCase().split(',').map(trim_).indexOf(type) > -1) {
    const d = duration >= SN_('LONG_LEAVE_MIN_DAYS') ? SN_('LONG_LEAVE_NOTICE_DAYS') : SN_('SHORT_LEAVE_NOTICE_DAYS');
    h = Math.max(h, d * 24);
  }
  return h;
}
function leaveStart_(from) {
  const t = /^(\d{1,2}):(\d{2})$/.exec(S_('LEAVE_START_TIME') || '09:00');
  return new Date(from.getFullYear(), from.getMonth(), from.getDate(), t ? +t[1] : 9, t ? +t[2] : 0);
}
function findOverlap_(empId, from, to, excludeId) {
  const f = iso_(from), t = iso_(to);
  return readAll_('APP').filter(a => String(a['Employee ID']) === String(empId) &&
    ['PENDING', 'APPROVED'].indexOf(String(a['Status'])) > -1 &&
    String(a['Application ID']) !== String(excludeId || '') &&
    iso_(a['From Date']) <= t && f <= iso_(a['To Date']))[0] || null;
}

/* ================= ledger index ================= */
function ledIndex_(rows) {
  const m = {}, cr = {}, cy = {};
  const key = (e, t, y, mo) => [e, t, y, mo].join('|');
  const add = (e, t, y, mo, delta) => {
    const k1 = key(e, t, y, mo), k2 = key(e, t, y, '*');
    m[k1] = r2_((m[k1] || 0) + delta); m[k2] = r2_((m[k2] || 0) + delta);
  };
  const markCredit = (e, t, y, mo, amt) => { cr[key(e, t, y, mo)] = 1; const k = key(e, t, y, 'Y'); cy[k] = r2_((cy[k] || 0) + amt); };
  rows.forEach(r => {
    const e = String(r['Employee ID']), t = r['Leave Type'], y = Number(r['Leave Year']), mo = Number(r['Month']);
    add(e, t, y, mo, (Number(r['Credit']) || 0) - (Number(r['Debit']) || 0));
    if (r['Transaction Type'] === 'CREDIT') markCredit(e, t, y, mo, Number(r['Credit']) || 0);
  });
  return {
    bal: (e, t, y, mo) => m[key(String(e), t, y, (mo === null || mo === undefined) ? '*' : mo)] || 0,
    add: (e, t, y, mo, d) => add(String(e), t, y, mo, d),
    hasCredit: (e, t, y, mo) => !!cr[key(String(e), t, y, mo)],
    yearCredits: (e, t, y) => cy[key(String(e), t, y, 'Y')] || 0,
    markCredit: (e, t, y, mo, a) => markCredit(String(e), t, y, mo, a)
  };
}
function ledPost_(idx, out, who, it) {
  const scoped = monthScoped_(it.type);
  let opening = '', closing = '';
  if (it.type !== 'OTHER') {
    opening = idx.bal(it.emp, it.type, it.year, scoped ? it.month : null);
    closing = r2_(opening + (it.credit || 0) - (it.debit || 0));
  }
  out.push({
    'Transaction ID': uid_('TXN'), 'Employee ID': it.emp, 'Leave Year': it.year, 'Month': it.month, 'Leave Type': it.type,
    'Transaction Type': it.tx, 'Credit': it.credit || 0, 'Debit': it.debit || 0, 'Opening Balance': opening, 'Closing Balance': closing,
    'Related Application ID': it.appId || '', 'Remarks': it.remarks || '', 'Created At': new Date(), 'Created By': who
  });
  idx.add(it.emp, it.type, it.year, it.month, (it.credit || 0) - (it.debit || 0));
  if (it.tx === 'CREDIT') idx.markCredit(it.emp, it.type, it.year, it.month, it.credit || 0);
}
function postUse_(idx, out, who, empId, type, days, appId, remarks) {
  const g = daysByMonth_(days);
  Object.keys(g).forEach(k => {
    const p = k.split('-').map(Number);
    ledPost_(idx, out, who, { emp: empId, year: p[0], month: p[1], type: type, tx: 'USE', debit: g[k], appId: appId, remarks: remarks });
  });
}
/** Reverses the net USE recorded for an application. Needs the full ledger rows (not an index). */
function postReversal_(idx, out, who, rows, appId, remarks) {
  const net = {};
  rows.concat([]).forEach(r => {
    if (String(r['Related Application ID']) !== String(appId)) return;
    if (r['Transaction Type'] !== 'USE' && r['Transaction Type'] !== 'REVERSAL') return;
    const k = [r['Employee ID'], r['Leave Type'], r['Leave Year'], r['Month']].join('|');
    net[k] = (net[k] || 0) + (r['Transaction Type'] === 'USE' ? (Number(r['Debit']) || 0) : -(Number(r['Credit']) || 0));
  });
  out.forEach(r => {   // reversals already queued in this operation
    if (String(r['Related Application ID']) !== String(appId) || r['Transaction Type'] !== 'REVERSAL') return;
    const k = [r['Employee ID'], r['Leave Type'], r['Leave Year'], r['Month']].join('|');
    net[k] = (net[k] || 0) - (Number(r['Credit']) || 0);
  });
  Object.keys(net).forEach(k => {
    if (net[k] <= 0.0001) return;
    const p = k.split('|');
    ledPost_(idx, out, who, { emp: p[0], year: Number(p[2]), month: Number(p[3]), type: p[1], tx: 'REVERSAL', credit: r2_(net[k]), appId: appId, remarks: remarks });
  });
}

/* ================= balance check ================= */
function pendingReserve_(empId, type, excludeId) {
  const res = {};
  readAll_('APP').forEach(a => {
    if (String(a['Employee ID']) !== String(empId) || a['Status'] !== 'PENDING' || a['Leave Type'] !== type) return;
    if (String(a['Application ID']) === String(excludeId || '')) return;
    if (!(a['From Date'] instanceof Date) || !(a['To Date'] instanceof Date)) return;
    const g = daysByMonth_(leaveDays_(a['From Date'], a['To Date']));
    Object.keys(g).forEach(k => { res[k] = (res[k] || 0) + g[k]; });
  });
  return res;
}
/** actual=false: employee submission (future months are checked at approval). actual=true: approval time. */
function checkBalance_(empId, type, days, idx, excludeId, actual) {
  if (type === 'OTHER') return { ok: true, lines: [], message: '' };
  const need = daysByMonth_(days);
  const reserve = actual ? {} : pendingReserve_(empId, type, excludeId);
  const t = today_(), cy = t.getFullYear(), cm = t.getMonth() + 1;
  const scoped = monthScoped_(type);
  const groups = {};
  Object.keys(need).forEach(k => {
    const p = k.split('-').map(Number);
    const gk = scoped ? k : String(p[0]);
    if (!groups[gk]) groups[gk] = { y: p[0], m: scoped ? p[1] : null, need: 0, reserved: 0 };
    groups[gk].need += need[k];
    groups[gk].reserved += (reserve[k] || 0);
  });
  const lines = []; let ok = true; const msgs = [];
  Object.keys(groups).forEach(gk => {
    const g = groups[gk];
    const future = g.y > cy || (scoped && g.y === cy && g.m > cm);
    const avail = r2_(idx.bal(empId, type, g.y, g.m) - g.reserved);
    const label = scoped ? (MONTHS[g.m - 1] + ' ' + g.y) : String(g.y);
    const short = g.need > avail + 0.0001;
    const skip = future && !actual;
    lines.push({ label: label, need: g.need, avail: avail, future: skip });
    if (short && !skip) {
      ok = false;
      msgs.push('Insufficient ' + LEAVE_NAMES[type] + ' balance for ' + label + ' (needed ' + g.need + ', available ' + avail + ').');
    }
  });
  return { ok: ok, lines: lines, message: msgs.join(' ') };
}

/* ================= validation (single source of truth) ================= */
/**
 * emp: employee row. p: {leaveType,durationType,fromDate,toDate,reason}.
 * opt: {admin, noticeOverride, negOverride, overrideReason, excludeId, idx, info}
 */
function validateLeave_(emp, p, opt) {
  opt = opt || {};
  const info = opt.info || {};
  const type = String(p.leaveType || '').toUpperCase();
  if (['CL', 'SL', 'OTHER'].indexOf(type) < 0) fail_('Please select a leave type.');
  if (!opt.admin && allowedLeaves_(emp).indexOf(type) < 0)
    fail_(LEAVE_NAMES[type] + ' is not assigned to you. Please contact Admin.');
  const single = String(p.durationType || 'SINGLE').toUpperCase() !== 'MULTI';
  const from = parseYmd_(p.fromDate);
  if (!from) fail_(single ? 'Please select the leave date.' : 'Please select the From Date.');
  const to = single ? from : parseYmd_(p.toDate);
  if (!to) fail_('Please select the To Date.');
  if (from > to) fail_('From Date cannot be after To Date.');
  if ((to - from) / 86400000 > 365) fail_('The leave period is too long. Please check the dates.');
  if (from.getFullYear() !== to.getFullYear()) fail_('Leave cannot span two calendar years. Please submit separate applications.');
  const days = leaveDays_(from, to);
  if (!days.length) fail_('The selected dates contain no countable leave days (weekly off / holidays). Please check the dates.');
  const dur = days.length;
  info.duration = dur;
  info.medRequired = type === 'SL' && dur > SN_('MEDICAL_PROOF_THRESHOLD_DAYS');
  const reason = String(p.reason || '').trim();
  if (reason.length < 3) fail_(type === 'OTHER' ? 'A reason is mandatory for Other Leave.' : 'Please enter the reason for leave.');
  if (reason.length > 500) fail_('Reason is too long (maximum 500 characters).');

  const t0 = today_();
  if (!opt.admin) {
    const maxBack = type === 'SL' ? SN_('MAX_BACKDATE_DAYS') : 0;
    if (from < addDays_(t0, -maxBack)) fail_(type === 'SL'
      ? 'Sick Leave can be applied for at most ' + maxBack + ' day(s) in the past. Please contact Admin.'
      : 'Past dates are not allowed. Please contact Admin.');
  }
  // notice period
  const reqH = noticeRequiredHours_(type, dur);
  const hoursBefore = (leaveStart_(from).getTime() - Date.now()) / 3600000;
  let noticeBreach = false;
  if (reqH > 0 && hoursBefore < reqH && !(opt.admin && from < t0)) noticeBreach = true;
  info.noticeHours = reqH;
  if (noticeBreach) {
    if (opt.admin) {
      if (!SB_('ADMIN_NOTICE_OVERRIDE')) fail_('Admin notice override is switched off in Settings.');
      if (!opt.noticeOverride || String(opt.overrideReason || '').trim().length < 3)
        fail_('This leave is inside the ' + reqH + '-hour notice period. Tick "Notice override" and enter the override reason.', 'OVERRIDE');
    } else if (SB_('SHORT_NOTICE_BLOCK')) {
      fail_('This leave request is within the ' + reqH + '-hour notice period. Please contact Admin.');
    }
  }
  const ov = findOverlap_(emp['Employee ID'], from, to, opt.excludeId);
  if (ov) fail_('An ' + (ov['Status'] === 'APPROVED' ? 'approved' : 'pending') + ' leave (' + ov['Application ID'] + ', ' +
    dmy_(ov['From Date']) + ' to ' + dmy_(ov['To Date']) + ') already overlaps these dates.');

  const idx = opt.idx || ledIndex_(readAll_('LED'));
  const bal = checkBalance_(emp['Employee ID'], type, days, idx, opt.excludeId, !!opt.admin);
  let negUsed = false;
  if (!bal.ok) {
    if (opt.admin) {
      if (!(opt.negOverride && SB_('ADMIN_NEGATIVE_OVERRIDE') && String(opt.overrideReason || '').trim().length >= 3))
        fail_(bal.message + ' To go ahead, tick "Balance override" and enter a reason.', 'OVERRIDE');
      negUsed = true;
    } else {
      fail_(bal.message + ' You may apply for Other Leave, or contact Admin.');
    }
  }
  info.balance = bal.lines;
  return {
    type: type, single: single, from: from, to: to, days: days, duration: dur, reason: reason,
    medRequired: info.medRequired, noticeBreach: noticeBreach, negUsed: negUsed, balance: bal
  };
}

/* ================= medical document ================= */
function saveMedical_(f, emp, appId) {
  if (!f || !f.data || !f.name) fail_('The medical document is missing.');
  const ext = String(f.name).split('.').pop().toLowerCase();
  if (['pdf', 'jpg', 'jpeg', 'png'].indexOf(ext) < 0) fail_('Only PDF, JPG, JPEG or PNG files are allowed.');
  let bytes;
  try { bytes = Utilities.base64Decode(String(f.data)); } catch (e) { fail_('The uploaded file could not be read. Please try again.'); }
  const max = SN_('MAX_UPLOAD_MB') * 1024 * 1024;
  if (bytes.length < 100) fail_('The uploaded file looks empty.');
  if (bytes.length > max) fail_('The file is larger than ' + SN_('MAX_UPLOAD_MB') + ' MB.');
  const b = bytes.slice(0, 4).map(x => x & 255);
  const isPdf = b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
  const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
  const isJpg = b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
  if (!((ext === 'pdf' && isPdf) || (ext === 'png' && isPng) || ((ext === 'jpg' || ext === 'jpeg') && isJpg)))
    fail_('The file content does not match its type. Please upload a genuine PDF, JPG or PNG.');
  const mime = isPdf ? 'application/pdf' : isPng ? 'image/png' : 'image/jpeg';
  const blob = Utilities.newBlob(bytes, mime, appId + '_' + emp['Employee ID'] + '.' + ext);
  const file = DriveApp.getFolderById(docFolderId_()).createFile(blob);
  try { file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) { /* domain policy may block; file stays private by default */ }
  return { id: file.getId(), url: file.getUrl() };
}

/* ================= e-mail ================= */
function sendMail_(to, subject, html) {
  try {
    if (!to) return { ok: false, error: 'No recipient' };
    const text = String(html || '')
      .replace(/<(br|\/div|\/tr|\/p|\/h3)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&middot;/g, '-').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n').trim();
    MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, body: text || subject, name: S_('COMPANY_NAME') });
    return { ok: true };
  } catch (e) {
    log_({ role: 'SYSTEM' }, 'EMAIL_FAILED', 'NOTIFICATION', '', '', '', subject + ' -> ' + to + ' : ' + e, 'FAILURE');
    return { ok: false, error: String(e) };
  }
}
function mailHtml_(title, rows, note, withLink, extraHtml) {
  const url = webAppUrl_();
  const font = 'font-family:Arial,Helvetica,sans-serif;';
  let h = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:#f2f5f9;" bgcolor="#f2f5f9">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f2f5f9"><tr><td align="center" style="padding:12px 8px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #d9e2ec;">' +
    '<tr><td bgcolor="#0f3d5e" style="background:#0f3d5e;color:#ffffff;padding:14px 16px;font-size:16px;font-weight:bold;' + font + '">' +
    esc_(S_('COMPANY_NAME')) + ' - Leave Management</td></tr>' +
    '<tr><td style="padding:16px;color:#222222;font-size:15px;line-height:1.5;' + font + '">' +
    '<div style="font-size:18px;font-weight:bold;color:#0f3d5e;margin:0 0 12px;">' + esc_(title) + '</div>';
  if (rows && rows.length) {
    h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">';
    rows.forEach(r => {
      h += '<tr><td style="padding:9px 0;border-bottom:1px solid #e3e8ee;' + font + '">' +
        '<div style="font-size:12px;color:#667788;font-weight:bold;">' + esc_(r[0]) + '</div>' +
        '<div style="font-size:15px;color:#222222;">' + esc_(r[1]) + '</div></td></tr>';
    });
    h += '</table>';
  }
  if (extraHtml) h += extraHtml;
  if (note) h += '<p style="margin:14px 0 0;font-size:14px;color:#444444;">' + esc_(note) + '</p>';
  if (withLink && url) h += '<p style="margin:18px 0 0;"><a href="' + esc_(url) + '" style="display:inline-block;background:#0f3d5e;color:#ffffff;padding:12px 22px;text-decoration:none;font-weight:bold;font-size:15px;">Open Leave Portal</a></p>';
  h += '</td></tr></table></td></tr></table></body></html>';
  return h;
}
function sendOtpMail_(to, name, otp, purpose) {
  const mins = SN_('OTP_VALID_MINUTES');
  return sendMail_(to, S_('COMPANY_NAME') + ' - security code', mailHtml_(purpose + ' - security code',
    [['Hello', name], ['Your security code', otp], ['Valid for', mins + ' minutes']],
    'Do not share this code with anyone. If you did not request it, please ignore this email.', false));
}
function sendPasswordResetConfirmation_(admin) {
  return sendMail_(admin['Email'], S_('COMPANY_NAME') + ' - Admin password changed', mailHtml_('Admin password changed',
    [['Admin', admin['Admin Name']], ['Time', dt_(new Date())]],
    'Your Admin password was set or changed and all sessions were signed out. If this was not you, contact the system owner immediately.', true));
}
function notifyAdminNew_(a, row) {
  if (!SB_('NOTIFY_ADMIN_INSTANT')) { setCell_('APP', row, 'Admin Notified', 'OFF'); return; }
  const r = sendMail_(adminEmails_(), 'New leave application ' + a['Application ID'] + ' - ' + a['Employee Name'], mailHtml_('New leave application',
    [['Application ID', a['Application ID']], ['Employee', a['Employee Name'] + ' (' + a['Employee ID'] + ')'], ['Leave type', LEAVE_NAMES[a['Leave Type']]],
      ['Dates', dmy_(a['From Date']) + ' to ' + dmy_(a['To Date'])], ['Duration', a['Duration'] + ' day(s)'], ['Reason', a['Reason']]],
    'Please review and approve or reject this application.', true));
  setCell_('APP', row, 'Admin Notified', r.ok ? 'Y' : 'ERR');
}
function notifyEmployee_(a, decision) {
  try {
    if (!a || !SB_('NOTIFY_EMPLOYEE_DECISION')) return;
    if (String(a['Employee Notified']) === decision) return;
    const row = getApp_(a['Application ID']);
    if (!isEmail_(a['Employee Email'])) {
      if (row) setCell_('APP', row._row, 'Employee Notified', 'NOEMAIL');
      log_({ role: 'SYSTEM' }, 'EMAIL_SKIPPED', 'NOTIFICATION', a['Application ID'], '', '', 'Employee has no e-mail', 'FAILURE');
      return;
    }
    const cancelled = decision === 'CANCELLED';
    const title = cancelled ? 'Your approved leave has been cancelled by Admin' : 'Leave application ' + decision;
    const subject = (cancelled ? 'Approved leave cancelled - ' : 'Leave ' + decision + ' - ') + a['Application ID'];
    const r = sendMail_(a['Employee Email'], subject, mailHtml_(title,
      [['Application ID', a['Application ID']], ['Decision', decision], ['Leave type', LEAVE_NAMES[a['Leave Type']]],
        ['Dates', dmy_(a['From Date']) + ' to ' + dmy_(a['To Date'])], ['Duration', a['Duration'] + ' day(s)'],
        ['Admin remarks', a['Admin Remarks'] || '-'], ['Decision time', dt_(new Date())]],
      cancelled ? 'Your leave balance has been updated. Please contact Admin if you have any questions.' : '', false));
    if (row) setCell_('APP', row._row, 'Employee Notified', r.ok ? decision : 'ERR');
  } catch (e) {
    log_({ role: 'SYSTEM' }, 'EMAIL_FAILED', 'NOTIFICATION', a ? a['Application ID'] : '', '', '', String(e), 'ERROR');
  }
}
function sendDailyPendingReminder_(force) {
  const props = PropertiesService.getScriptProperties(), todayS = iso_(new Date());
  if (!force) {
    if (!SB_('DAILY_REMINDER_ENABLED')) return { sent: false, reason: 'Daily reminder is switched off.' };
    if (props.getProperty('LAST_REMINDER') === todayS) return { sent: false, reason: 'Already sent today.' };
  }
  const pend = readAll_('APP').filter(a => a['Status'] === 'PENDING');
  if (!pend.length) return { sent: false, reason: 'No pending applications.' };
  let h = '<table style="border-collapse:collapse;width:100%;font-size:13px"><tr style="background:#0f3d5e;color:#fff"><th style="padding:6px;text-align:left">ID</th><th style="padding:6px;text-align:left">Employee</th><th style="padding:6px;text-align:left">Type</th><th style="padding:6px;text-align:left">Dates</th><th style="padding:6px">Days</th></tr>';
  pend.forEach(a => {
    h += '<tr><td style="padding:6px;border:1px solid #e3e8ee">' + esc_(a['Application ID']) + '</td><td style="padding:6px;border:1px solid #e3e8ee">' + esc_(a['Employee Name']) +
      '</td><td style="padding:6px;border:1px solid #e3e8ee">' + esc_(LEAVE_NAMES[a['Leave Type']]) + '</td><td style="padding:6px;border:1px solid #e3e8ee">' +
      dmy_(a['From Date']) + ' - ' + dmy_(a['To Date']) + '</td><td style="padding:6px;border:1px solid #e3e8ee;text-align:center">' + esc_(a['Duration']) + '</td></tr>';
  });
  h += '</table>';
  const body = mailHtml_(pend.length + ' leave application(s) awaiting your decision', [], 'These reminders stop for an application once it is approved or rejected.', true)
    .replace('</h3>', '</h3>' + h);
  const r = sendMail_(adminEmails_(), 'Reminder: ' + pend.length + ' pending leave application(s)', body);
  if (r.ok && !force) props.setProperty('LAST_REMINDER', todayS);
  log_({ role: 'SYSTEM' }, 'DAILY_REMINDER', 'NOTIFICATION', '', '', '', pend.length + ' pending', r.ok ? 'SUCCESS' : 'FAILURE');
  return { sent: r.ok, count: pend.length, reason: r.ok ? '' : r.error };
}

/* ================= balances / summaries ================= */
function monthTable_(rows, type, y) {
  const scoped = monthScoped_(type);
  const arr = [];
  for (let m = 0; m < 12; m++) arr.push({ credit: 0, used: 0, lapsed: 0, adjust: 0, net: 0 });
  rows.forEach(r => {
    if (r['Leave Type'] !== type || Number(r['Leave Year']) !== y) return;
    const m = Number(r['Month']); if (m < 1 || m > 12) return;
    const c = Number(r['Credit']) || 0, d = Number(r['Debit']) || 0, t = r['Transaction Type'], o = arr[m - 1];
    if (t === 'CREDIT') o.credit += c;
    else if (t === 'USE') o.used += d;
    else if (t === 'REVERSAL') o.used -= c;
    else if (t === 'LAPSE' || t === 'EXPIRY') o.lapsed += d;
    else o.adjust += c - d;
    o.net += c - d;
  });
  let run = 0;
  return arr.map((o, i) => {
    const opening = scoped ? 0 : run;
    const closing = r2_(scoped ? o.net : run + o.net);
    run = r2_(run + o.net);
    return { month: MONTHS[i], opening: r2_(opening), credit: r2_(o.credit), used: r2_(o.used), lapsed: r2_(o.lapsed), adjust: r2_(o.adjust), closing: closing };
  });
}
function balNow_(idx, empId, type, y, m) {
  return monthScoped_(type) ? idx.bal(empId, type, y, m) : idx.bal(empId, type, y, null);
}
function summaryFor_(rows, empId, y) {
  const mine = rows.filter(r => String(r['Employee ID']) === String(empId));
  const idx = ledIndex_(mine), t = today_();
  const m = y === t.getFullYear() ? t.getMonth() + 1 : 12;
  const out = {};
  ['CL', 'SL'].forEach(type => {
    const tb = monthTable_(mine, type, y);
    const sum = k => r2_(tb.reduce((s, o) => s + o[k], 0));
    out[type] = { credited: sum('credit'), used: sum('used'), lapsed: sum('lapsed'), adjust: sum('adjust'), balance: balNow_(idx, empId, type, y, m) };
  });
  let other = 0;
  mine.forEach(r => {
    if (r['Leave Type'] !== 'OTHER' || Number(r['Leave Year']) !== y) return;
    if (r['Transaction Type'] === 'USE') other += Number(r['Debit']) || 0;
    if (r['Transaction Type'] === 'REVERSAL') other -= Number(r['Credit']) || 0;
  });
  out.OTHER = { used: r2_(other) };
  return out;
}
function refreshEmpBalances_() {
  const sh = sh_('EMP'), last = sh.getLastRow();
  if (last < 2) return;
  const idx = ledIndex_(readAll_('LED')), t = today_(), y = t.getFullYear(), m = t.getMonth() + 1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  const vals = ids.map(r => r[0] === '' ? ['', ''] : [balNow_(idx, r[0], 'CL', y, m), balNow_(idx, r[0], 'SL', y, m)]);
  sh.getRange(2, COLS.EMP.indexOf('CL Balance') + 1, vals.length, 2).setValues(vals);
}

/* ================= maintenance: monthly credit, lapse, year-end expiry ================= */
/** Caller must hold the script lock. Idempotent: safe to run any number of times. */
function ledgerMaintenance_(who) {
  const rows = readAll_('LED'), idx = ledIndex_(rows), emps = readAll_('EMP'), out = [];
  const t = today_(), cy = t.getFullYear(), cm = t.getMonth() + 1;
  let lapsed = 0, expired = 0, credited = 0;
  [cy - 1, cy].forEach(y => ['CL', 'SL'].forEach(type => {
    if (monthScoped_(type)) {
      for (let m = 1; m <= 12; m++) {
        if (new Date(y, m, 0) >= t) break;                      // month not finished yet
        emps.forEach(e => {
          if (allowedLeaves_(e).indexOf(type) < 0) return;
          const b = idx.bal(e['Employee ID'], type, y, m);
          if (b > 0.0001) {
            ledPost_(idx, out, who, { emp: e['Employee ID'], year: y, month: m, type: type, tx: 'LAPSE', debit: b, remarks: 'Unused ' + type + ' lapsed at end of ' + MONTHS[m - 1] + ' ' + y });
            lapsed += b;
          }
        });
      }
    } else if (y < cy) {
      emps.forEach(e => {
        if (allowedLeaves_(e).indexOf(type) < 0) return;
        const b = idx.bal(e['Employee ID'], type, y, null);
        if (b > 0.0001) {
          ledPost_(idx, out, who, { emp: e['Employee ID'], year: y, month: 12, type: type, tx: 'EXPIRY', debit: b, remarks: 'Unused ' + type + ' expired at year end ' + y });
          expired += b;
        }
      });
    }
  }));
  emps.forEach(e => {
    if (String(e['Status']) !== 'Active') return;
    const jd = e['Joining Date'];
    if (jd instanceof Date && (jd.getFullYear() > cy || (jd.getFullYear() === cy && jd.getMonth() + 1 > cm))) return;
    ['CL', 'SL'].forEach(type => {
      const id = e['Employee ID'];
      if (allowedLeaves_(e).indexOf(type) < 0) return;
      if (idx.hasCredit(id, type, cy, cm)) return;
      const amt = Math.min(SN_(type + '_MONTHLY_CREDIT'), SN_(type + '_ANNUAL_MAX') - idx.yearCredits(id, type, cy));
      if (amt <= 0) return;
      ledPost_(idx, out, who, { emp: id, year: cy, month: cm, type: type, tx: 'CREDIT', credit: amt, remarks: 'Monthly ' + type + ' credit ' + MONTHS[cm - 1] + ' ' + cy });
      credited += amt;
    });
  });
  appendMany_('LED', out);
  refreshEmpBalances_();
  return { entries: out.length, credited: credited, lapsed: lapsed, expired: expired };
}
function runMaintenance_(who) {
  return withLock_(() => {
    const r = ledgerMaintenance_(who);
    log_({ email: who, role: 'SYSTEM' }, 'MAINTENANCE_DONE', 'SYSTEM', '', '', r, 'Credit/lapse/expiry run', 'SUCCESS');
    return r;
  });
}

/* ================= EMPLOYEE API ================= */
function empHome_(ctx) {
  const emp = ctx.emp, y = today_().getFullYear();
  const rows = readAll_('LED').filter(r => String(r['Employee ID']) === String(emp['Employee ID']));
  const mine = readAll_('APP').filter(a => String(a['Employee ID']) === String(emp['Employee ID']));
  const apps = mine.filter(a => a['From Date'] instanceof Date && a['From Date'].getFullYear() === y);
  const cnt = s => apps.filter(a => a['Status'] === s).length;
  const tcnt = t => ({
    approved: apps.filter(a => a['Leave Type'] === t && a['Status'] === 'APPROVED').length,
    pending: apps.filter(a => a['Leave Type'] === t && a['Status'] === 'PENDING').length
  });
  const since = Date.now() - 14 * 86400000;
  const notices = mine.filter(a => a['Status'] === 'CANCELLED' && a['Reviewed By'] && a['Reviewed At'] instanceof Date && a['Reviewed At'].getTime() >= since).map(appOut_);
  const penalties = readAll_('UNA').filter(u => String(u['Employee ID']) === String(emp['Employee ID'])).reverse().map(u => ({
    id: u['Incident ID'], from: dmy_(u['From Date']), to: dmy_(u['To Date']), duration: u['Duration'], occ: u['Occurrence Number'],
    salary: u['Salary Deduction'], penalty: u['Additional Penalty'], remarks: u['Admin Remarks']
  }));

  return plain_({
    employee: empOut_(emp), year: y, summary: summaryFor_(rows, emp['Employee ID'], y),
    tables: { CL: monthTable_(rows, 'CL', y), SL: monthTable_(rows, 'SL', y) },
    counts: { pending: cnt('PENDING'), approved: cnt('APPROVED'), rejected: cnt('REJECTED') },
    typeCounts: { CL: tcnt('CL'), SL: tcnt('SL'), OTHER: tcnt('OTHER') },
    clMonthScoped: monthScoped_('CL'), slMonthScoped: monthScoped_('SL'), notices: notices, penalties: penalties
  });
}
function empApplications_(ctx) {
  const list = readAll_('APP').filter(a => String(a['Employee ID']) === String(ctx.emp['Employee ID']))
    .sort((a, b) => b['Submission Timestamp'] - a['Submission Timestamp']).map(appOut_);
  return plain_(list);
}
function empHolidays_(ctx) {
  const y = today_().getFullYear();
  const list = readAll_('HOL').filter(h => h['Status'] === 'Active' && h['Holiday Date'] instanceof Date && h['Holiday Date'].getFullYear() === y)
    .sort((a, b) => a['Holiday Date'] - b['Holiday Date'])
    .map(h => ({ date: dmy_(h['Holiday Date']), name: h['Holiday Name'], notes: h['Notes'] }));
  return plain_({ year: y, allowance: SN_('PUBLIC_HOLIDAY_ALLOWANCE'), list: list, treatment: S_('PUBLIC_HOLIDAY_TREATMENT') });
}
function empPreview_(ctx, p) {
  const q = Object.assign({}, p);
  q.reason = String(q.reason || '').trim() || 'preview';
  const info = {};
  try {
    validateLeave_(ctx.emp, q, { info: info });
    return plain_({ valid: true, duration: info.duration, medRequired: info.medRequired, balance: info.balance || [], noticeHours: info.noticeHours });
  } catch (e) {
    if (e instanceof UserError) return plain_({ valid: false, message: e.message, duration: info.duration || 0, medRequired: !!info.medRequired });
    throw e;
  }
}
function empSubmit_(ctx, p) {
  const emp = ctx.emp;
  if (!throttle_('SUBMIT_' + emp['Employee ID'], 10, 600)) fail_('Too many submissions. Please wait a few minutes.', 'LOCK');
  if (!p.declaration) fail_('Please accept the declaration to submit your application.');
  const reqId = String(p.requestId || '').slice(0, 60);
  if (reqId.length < 8) fail_('Invalid request. Please refresh the page and try again.');
  let res = null;
  withLock_(() => {
    const dup = readAll_('APP').filter(a => String(a['Request Key']) === reqId)[0];
    if (dup) { res = { id: dup['Application ID'], duplicate: true }; return; }
    const v = validateLeave_(emp, p, {});
    if (v.medRequired && !p.file) fail_('A medical certificate (PDF/JPG/PNG, max ' + SN_('MAX_UPLOAD_MB') + ' MB) is required for Sick Leave longer than ' + SN_('MEDICAL_PROOF_THRESHOLD_DAYS') + ' days.');
    const yr = v.from.getFullYear();
    const appId = 'LV-' + yr + '-' + pad_(nextSeq_('APP' + yr), 4);   // number is taken only after all checks pass
    let doc = { id: '', url: '' };
    if (p.file) doc = saveMedical_(p.file, emp, appId);
    const now = new Date();
    const obj = {
      'Application ID': appId, 'Submission Timestamp': now, 'Employee ID': emp['Employee ID'], 'Employee Name': emp['Employee Name'],
      'Employee Email': emp['Email'], 'Leave Type': v.type, 'Duration Type': v.single ? 'SINGLE' : 'MULTI', 'From Date': v.from, 'To Date': v.to,
      'Duration': v.duration, 'Reason': v.reason, 'Medical Document ID': doc.id, 'Medical Document URL': doc.url, 'Status': 'PENDING',
      'Created At': now, 'Updated At': now, 'Entry Source': 'EMPLOYEE', 'Request Key': reqId, 'Admin Notified': 'N', 'Employee Notified': ''
    };
    const row = appendObj_('APP', obj);
    log_({ email: emp['Email'] || emp['Phone'], role: 'EMPLOYEE' }, 'LEAVE_SUBMITTED', 'LEAVE', appId, '', { type: v.type, from: iso_(v.from), to: iso_(v.to), days: v.duration }, 'Submitted', 'SUCCESS');
    res = { id: appId, row: row, obj: obj };
  });
  if (!res.duplicate) notifyAdminNew_(res.obj, res.row);
  return { id: res.id, duplicate: !!res.duplicate, message: res.duplicate ? 'This application was already submitted.' : 'Your application ' + res.id + ' has been submitted to Admin.' };
}
function empCancel_(ctx, p) {
  withLock_(() => {
    const a = getApp_(p.id);
    if (!a || String(a['Employee ID']) !== String(ctx.emp['Employee ID'])) fail_('Application not found.');
    if (a['Status'] !== 'PENDING') fail_('Only pending applications can be cancelled. Please contact Admin.');
    updateObj_('APP', a._row, { 'Status': 'CANCELLED', 'Admin Remarks': 'Cancelled by employee', 'Updated At': new Date() });
    log_({ email: ctx.email, role: 'EMPLOYEE' }, 'LEAVE_CANCELLED_BY_EMPLOYEE', 'LEAVE', a['Application ID'], 'PENDING', 'CANCELLED', '', 'SUCCESS');
  });
  return { message: 'Application cancelled.' };
}

function empAckPolicy_(ctx) {
  log_({ email: ctx.email, role: 'EMPLOYEE' }, 'LEAVE_POLICY_ACKNOWLEDGED', 'SECURITY', ctx.id, '', '', 'Employee confirmed reading the leave policy', 'SUCCESS');
  return { done: true };
}

function empMyLeaves_(ctx) { return { allowed: allowedLeaves_(ctx.emp) }; }

function cleanupUnassignedLedger() {
  assertOwnerRun_();
  return withLock_(() => cleanupLedgerCore_(Session.getEffectiveUser().getEmail()));
}

/** Caller must hold the script lock. */
function cleanupLedgerCore_(who) {
  const sh = sh_('LED'), n = COLS.LED.length, last = sh.getLastRow();
  if (last < 2) return 'Ledger is empty.';
  const vals = sh.getRange(2, 1, last - 1, n).getValues();
  const iE = COLS.LED.indexOf('Employee ID'), iT = COLS.LED.indexOf('Leave Type'), iX = COLS.LED.indexOf('Transaction Type');
  const allowed = {};
  readAll_('EMP').forEach(e => { allowed[String(e['Employee ID'])] = allowedLeaves_(e); });
  const real = {};
  vals.forEach(r => { if (['USE', 'REVERSAL', 'ADJUST'].indexOf(r[iX]) > -1) real[r[iE] + '|' + r[iT]] = 1; });
  const keep = vals.filter(r => {
    const al = allowed[String(r[iE])];
    if (!al) return true;
    if (['CREDIT', 'LAPSE', 'EXPIRY'].indexOf(r[iX]) < 0) return true;
    if (al.indexOf(r[iT]) > -1) return true;
    return !!real[r[iE] + '|' + r[iT]];
  });
  const removed = vals.length - keep.length;
  if (!removed) return 'Nothing to clean.';
  sh.getRange(2, 1, vals.length, n).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, n).setValues(keep);
  refreshEmpBalances_();
  log_({ email: who, role: 'OWNER' }, 'LEDGER_CLEANUP', 'LEDGER', '', '', { removed: removed }, 'Removed credits/lapses for unassigned leave types', 'SUCCESS');
  return 'Removed ' + removed + ' ledger rows.';
}
