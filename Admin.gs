/**
 * Admin.gs
 * Admin API (every function here is reachable only through apiAdmin, which checks the session on every call).
 * Dashboard, applications, approval, manual leave, employees, balances, unauthorized leave, Diwali bonus, holidays,
 * settings, admins, system log.
 */

function nextId_(prefix, key, col) {
  let max = parseInt(PropertiesService.getScriptProperties().getProperty('MAXID_' + prefix) || '0', 10) || 0;
  readAll_(key).forEach(r => { const m = new RegExp('^' + prefix + '-(\\d+)$').exec(String(r[col])); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return prefix + '-' + pad_(max + 1, 3);
}
function filterApps_(apps, p) {
  const y = p.year ? Number(p.year) : null, q = p.q ? String(p.q).toLowerCase() : '';
  return apps.filter(a => {
    if (y && !(a['From Date'] instanceof Date && a['From Date'].getFullYear() === y)) return false;
    if (p.employeeId && String(a['Employee ID']) !== String(p.employeeId)) return false;
    if (p.leaveType && a['Leave Type'] !== p.leaveType) return false;
    if (p.status && a['Status'] !== p.status) return false;
    if (p.fromDate && iso_(a['To Date']) < p.fromDate) return false;
    if (p.toDate && iso_(a['From Date']) > p.toDate) return false;
    if (q && (a['Application ID'] + ' ' + a['Employee Name'] + ' ' + a['Employee ID'] + ' ' + a['Reason']).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort((a, b) => b['Submission Timestamp'] - a['Submission Timestamp']);
}

/* ================= DASHBOARD ================= */
function adminDashboard_(ctx, p) {
  const y = p.year ? Number(p.year) : today_().getFullYear();
  const allApps = readAll_('APP');
  const apps = filterApps_(allApps, Object.assign({}, p, { year: y }));
  const led = readAll_('LED'), emps = readAll_('EMP');
  const cnt = s => apps.filter(a => a['Status'] === s).length;
  const status = { PENDING: cnt('PENDING'), APPROVED: cnt('APPROVED'), REJECTED: cnt('REJECTED'), CANCELLED: cnt('CANCELLED') };
  const monthly = MONTHS.map(m => ({ m: m, CL: 0, SL: 0, OTHER: 0 }));
  const typeDist = { CL: 0, SL: 0, OTHER: 0 }, perEmp = {};
  apps.filter(a => a['Status'] === 'APPROVED').forEach(a => {
    const g = daysByMonth_(leaveDays_(a['From Date'], a['To Date']));
    Object.keys(g).forEach(k => {
      const pr = k.split('-').map(Number);
      if (pr[0] === y) monthly[pr[1] - 1][a['Leave Type']] += g[k];
      typeDist[a['Leave Type']] += g[k];
      const id = a['Employee ID'];
      if (!perEmp[id]) perEmp[id] = { id: id, name: a['Employee Name'], CL: 0, SL: 0, OTHER: 0, total: 0 };
      perEmp[id][a['Leave Type']] += g[k]; perEmp[id].total += g[k];
    });
  });
  let clUsed = 0, slUsed = 0;
  ['CL', 'SL'].forEach(type => monthTable_(led, type, y).forEach(r => { if (type === 'CL') clUsed += r.used; else slUsed += r.used; }));
  // monthTable_ above mixes employees on purpose: it sums the whole company
  const t = today_(), tIso = iso_(t);
  const onLeave = allApps.filter(a => a['Status'] === 'APPROVED' && iso_(a['From Date']) <= tIso && tIso <= iso_(a['To Date']))
    .map(a => ({ id: a['Employee ID'], name: a['Employee Name'], type: a['Leave Type'] }));
  let diwali = null;
  const cutoff = parseYmd_(S_('BONUS_CUTOFF_DATE'));
  if (cutoff) { const m = lapsedBeforeCutoff_(led, SN_('BONUS_YEAR'), cutoff); diwali = r2_(Object.keys(m).reduce((s, k) => s + m[k], 0)); }
  // ---- employee cards: used / CL lapsed (till Diwali cutoff) / balances ----
  const cardStatus = p.status || 'APPROVED';
  const dFrom = p.fromDate || '', dTo = p.toDate || '';
  const usedBy = {};
  apps.filter(a => a['Status'] === cardStatus).forEach(a => {
    if (!(a['From Date'] instanceof Date) || !(a['To Date'] instanceof Date)) return;
    const n = leaveDays_(a['From Date'], a['To Date'])
      .filter(d => (!dFrom || iso_(d) >= dFrom) && (!dTo || iso_(d) <= dTo)).length;
    const id = String(a['Employee ID']);
    if (!usedBy[id]) usedBy[id] = { CL: 0, SL: 0, OTHER: 0 };
    usedBy[id][a['Leave Type']] += n;
  });
  const lapsedMap = cutoff ? lapsedBeforeCutoff_(led, y, cutoff) : null;
  const ledIdx = ledIndex_(led);
  const balMonth = y === t.getFullYear() ? t.getMonth() + 1 : 12;
  const empCards = emps.filter(e => {
    if (e['Status'] === 'Deleted') return false;
    const id = String(e['Employee ID']);
    if (p.employeeId && id !== String(p.employeeId)) return false;
    return e['Status'] === 'Active' || !!usedBy[id];
  }).map(e => {
    const id = String(e['Employee ID']), u = usedBy[id] || { CL: 0, SL: 0, OTHER: 0 };
    return {
      id: id, name: String(e['Employee Name']), allowed: allowedLeaves_(e),
      clUsed: u.CL, slUsed: u.SL, otherUsed: u.OTHER,
      clLapsed: lapsedMap ? (lapsedMap[id] || 0) : null,
      clBalance: balNow_(ledIdx, id, 'CL', y, balMonth),
      slRemaining: balNow_(ledIdx, id, 'SL', y, balMonth)
    };
  }).sort((a, b) => (b.clUsed + b.slUsed + b.otherUsed) - (a.clUsed + a.slUsed + a.otherUsed) || a.name.localeCompare(b.name));
  const years = {}; years[t.getFullYear()] = 1; years[t.getFullYear() + 1] = 1;
  allApps.forEach(a => { if (a['From Date'] instanceof Date) years[a['From Date'].getFullYear()] = 1; });
  return plain_({
    year: y, years: Object.keys(years).map(Number).sort(),
    cards: {
      employees: emps.filter(e => e['Status'] === 'Active').length, applications: apps.length, pending: status.PENDING, approved: status.APPROVED,
      rejected: status.REJECTED, clUsed: r2_(clUsed), slUsed: r2_(slUsed), onLeave: onLeave.length, diwaliCl: diwali,
      unauthorized: readAll_('UNA').filter(u => u['Incident Date'] instanceof Date && u['Incident Date'].getFullYear() === y).length
    },
    status: status, monthly: monthly, typeDist: typeDist, empCards: empCards, cutoffSet: !!cutoff,
    empSummary: Object.keys(perEmp).map(k => perEmp[k]).sort((a, b) => b.total - a.total),
    recent: apps.slice(0, 8).map(appOut_), pending: allApps.filter(a => a['Status'] === 'PENDING').sort((a, b) => a['Submission Timestamp'] - b['Submission Timestamp']).map(appOut_),
    onLeaveList: onLeave
  });
}

/* ================= APPLICATIONS ================= */
function adminListApplications_(ctx, p) {
  return plain_(filterApps_(readAll_('APP'), p).slice(0, 600).map(appOut_));
}
function adminGetApplication_(ctx, p) {
  const a = getApp_(p.id);
  if (!a) fail_('Application not found.');
  const led = readAll_('LED');
  const idx = ledIndex_(led);
  let balance = null;
  if (a['From Date'] instanceof Date && a['To Date'] instanceof Date) {
    balance = checkBalance_(a['Employee ID'], a['Leave Type'], leaveDays_(a['From Date'], a['To Date']), idx, a['Application ID'], true);
  }
  const y = a['From Date'] instanceof Date ? a['From Date'].getFullYear() : today_().getFullYear();
  return plain_({
    app: appOut_(a), balance: balance, summary: summaryFor_(led, a['Employee ID'], y),
    medRequired: a['Leave Type'] === 'SL' && Number(a['Duration']) > SN_('MEDICAL_PROOF_THRESHOLD_DAYS'),
    ledger: led.filter(r => String(r['Related Application ID']) === String(a['Application ID'])).map(ledOut_)
  });
}
function adminGetDocument_(ctx, p) {
  const a = getApp_(p.id);
  if (!a || !a['Medical Document ID']) fail_('No document is attached to this application.');
  let f;
  try { f = DriveApp.getFileById(a['Medical Document ID']); } catch (e) { fail_('The document could not be opened from Drive.'); }
  const blob = f.getBlob();
  log_(ctx, 'MEDICAL_DOC_VIEWED', 'LEAVE', a['Application ID'], '', '', '', 'SUCCESS');
  return { name: f.getName(), mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}
function ledOut_(r) {
  return {
    id: r['Transaction ID'], emp: r['Employee ID'], year: r['Leave Year'], month: MONTHS[Number(r['Month']) - 1] || r['Month'], type: r['Leave Type'],
    tx: r['Transaction Type'], credit: r['Credit'], debit: r['Debit'], opening: r['Opening Balance'], closing: r['Closing Balance'],
    app: r['Related Application ID'], remarks: r['Remarks'], at: dt_(r['Created At']), by: r['Created By']
  };
}

function adminApprove_(ctx, p) {
  let app = null;
  withLock_(() => {
    const a = getApp_(p.id);
    if (!a) fail_('Application not found.');
    if (a['Status'] !== 'PENDING') fail_('This application is already ' + a['Status'] + '. No action was taken.');
    const type = a['Leave Type'];
    const days = leaveDays_(a['From Date'], a['To Date']);
    if (!days.length) fail_('This application has no countable leave days. Please reject it or correct it first.');
    const reason = String(p.overrideReason || '').trim();
    const medMissing = type === 'SL' && days.length > SN_('MEDICAL_PROOF_THRESHOLD_DAYS') && !a['Medical Document ID'];
    if (medMissing && !(p.override && reason.length >= 3)) fail_('The medical certificate is missing for this Sick Leave. To approve anyway, tick the override box and enter a reason.', 'OVERRIDE');
    const rows = readAll_('LED'), idx = ledIndex_(rows), out = [];
    const chk = checkBalance_(a['Employee ID'], type, days, idx, a['Application ID'], true);
    if (!chk.ok && !(p.override && SB_('ADMIN_NEGATIVE_OVERRIDE') && reason.length >= 3))
      fail_(chk.message + ' To approve anyway, tick the override box and enter a reason.', 'OVERRIDE');
    postUse_(idx, out, ctx.email, a['Employee ID'], type, days, a['Application ID'], 'Approved leave ' + iso_(a['From Date']) + ' to ' + iso_(a['To Date']));
    appendMany_('LED', out);
    const now = new Date();
    updateObj_('APP', a._row, {
      'Status': 'APPROVED', 'Duration': days.length, 'Admin Remarks': String(p.remarks || '').trim(), 'Reviewed By': ctx.email, 'Reviewed At': now,
      'Override Reason': (!chk.ok || medMissing) ? reason : a['Override Reason'], 'Updated At': now
    });
    refreshEmpBalances_();
    log_(ctx, 'LEAVE_APPROVED', 'LEAVE', a['Application ID'], 'PENDING', 'APPROVED', (!chk.ok || medMissing) ? 'Override: ' + reason : String(p.remarks || ''), 'SUCCESS');
    app = getApp_(a['Application ID']);
  });
  notifyEmployee_(app, 'APPROVED');
  return { message: 'Application ' + p.id + ' approved.' };
}
function adminReject_(ctx, p) {
  const remarks = String(p.remarks || '').trim();
  if (remarks.length < 3) fail_('Please enter the reason for rejection in Remarks.');
  let app = null;
  withLock_(() => {
    const a = getApp_(p.id);
    if (!a) fail_('Application not found.');
    if (a['Status'] !== 'PENDING') fail_('This application is already ' + a['Status'] + '. No action was taken.');
    const now = new Date();
    updateObj_('APP', a._row, { 'Status': 'REJECTED', 'Admin Remarks': remarks, 'Reviewed By': ctx.email, 'Reviewed At': now, 'Updated At': now });
    log_(ctx, 'LEAVE_REJECTED', 'LEAVE', a['Application ID'], 'PENDING', 'REJECTED', remarks, 'SUCCESS');
    app = getApp_(a['Application ID']);
  });
  notifyEmployee_(app, 'REJECTED');
  return { message: 'Application ' + p.id + ' rejected.' };
}
function adminCancelApproved_(ctx, p) {
  const reason = String(p.reason || '').trim();
  if (reason.length < 3) fail_('Please enter the reason for cancelling this approved leave.');
  let app = null;
  withLock_(() => {
    const a = getApp_(p.id);
    if (!a) fail_('Application not found.');
    if (a['Status'] !== 'APPROVED') fail_('Only approved applications can be cancelled here.');
    const rows = readAll_('LED'), idx = ledIndex_(rows), out = [];
    postReversal_(idx, out, ctx.email, rows, a['Application ID'], 'Reversal: approved leave cancelled - ' + reason);
    appendMany_('LED', out);
    updateObj_('APP', a._row, { 'Status': 'CANCELLED', 'Admin Remarks': 'Cancelled by Admin: ' + reason, 'Reviewed By': ctx.email, 'Reviewed At': new Date(), 'Updated At': new Date() });
    refreshEmpBalances_();
    log_(ctx, 'APPROVED_LEAVE_CANCELLED', 'LEAVE', a['Application ID'], 'APPROVED', 'CANCELLED', reason + ' | reversal entries: ' + out.length, 'SUCCESS');
    app = getApp_(a['Application ID']);
  });
  notifyEmployee_(app, 'CANCELLED');
  return { message: 'Leave cancelled and the balance restored through reversal entries.' };
}

function adminOpts_(p) {
  return { admin: true, noticeOverride: !!p.noticeOverride, negOverride: !!p.negOverride, overrideReason: p.overrideReason };
}
function adminManualLeave_(ctx, p) {
  const remarks = String(p.remarks || '').trim();
  if (remarks.length < 3) fail_('Admin remarks are mandatory for a manual leave entry.');
  let app = null;
  withLock_(() => {
    const emp = getEmpById_(p.employeeId);
    if (!emp) fail_('Please select an employee.');
    const rows = readAll_('LED'), idx = ledIndex_(rows), out = [];
    const v = validateLeave_(emp, p, Object.assign(adminOpts_(p), { idx: idx }));
    const yr = v.from.getFullYear(), appId = 'LV-' + yr + '-' + pad_(nextSeq_('APP' + yr), 4), now = new Date();
    postUse_(idx, out, ctx.email, emp['Employee ID'], v.type, v.days, appId, 'Manual entry by Admin');
    appendMany_('LED', out);
    const usedOverride = v.noticeBreach || v.negUsed;
    appendObj_('APP', {
      'Application ID': appId, 'Submission Timestamp': now, 'Employee ID': emp['Employee ID'], 'Employee Name': emp['Employee Name'], 'Employee Email': emp['Email'],
      'Leave Type': v.type, 'Duration Type': v.single ? 'SINGLE' : 'MULTI', 'From Date': v.from, 'To Date': v.to, 'Duration': v.duration, 'Reason': v.reason,
      'Status': 'APPROVED', 'Admin Remarks': remarks, 'Reviewed By': ctx.email, 'Reviewed At': now, 'Notice Override': v.noticeBreach ? 'YES' : '',
      'Override Reason': usedOverride ? String(p.overrideReason || '').trim() : '', 'Created At': now, 'Updated At': now, 'Entry Source': 'ADMIN',
      'Request Key': uid_('ADM'), 'Admin Notified': 'N/A', 'Employee Notified': ''
    });
    refreshEmpBalances_();
    log_(ctx, 'MANUAL_LEAVE_ADDED', 'LEAVE', appId, '', { emp: emp['Employee ID'], type: v.type, from: iso_(v.from), to: iso_(v.to), days: v.duration },
      remarks + (usedOverride ? ' | Override: ' + p.overrideReason : ''), 'SUCCESS');
    app = getApp_(appId);
  });
  notifyEmployee_(app, 'APPROVED');
  return { message: 'Leave recorded as ' + app['Application ID'] + '.', id: app['Application ID'] };
}
function adminUpdateLeave_(ctx, p) {
  const just = String(p.justification || '').trim();
  if (just.length < 3) fail_('A justification is mandatory when changing a leave record.');
  withLock_(() => {
    const a = getApp_(p.id);
    if (!a) fail_('Application not found.');
    if (['PENDING', 'APPROVED'].indexOf(a['Status']) < 0) fail_('Only pending or approved applications can be edited.');
    const emp = getEmpById_(a['Employee ID']);
    const oldV = { type: a['Leave Type'], from: iso_(a['From Date']), to: iso_(a['To Date']), days: a['Duration'], reason: a['Reason'] };
    const rows = readAll_('LED'), idx = ledIndex_(rows), out = [];
    if (a['Status'] === 'APPROVED') postReversal_(idx, out, ctx.email, rows, a['Application ID'], 'Reversal before correction - ' + just);
    const q = {
      leaveType: p.leaveType || a['Leave Type'], durationType: p.durationType || a['Duration Type'], fromDate: p.fromDate || iso_(a['From Date']),
      toDate: p.toDate || iso_(a['To Date']), reason: p.reason !== undefined ? p.reason : a['Reason']
    };
    const v = validateLeave_(emp, q, Object.assign(adminOpts_(p), { idx: idx, excludeId: a['Application ID'] }));
    if (a['Status'] === 'APPROVED') postUse_(idx, out, ctx.email, emp['Employee ID'], v.type, v.days, a['Application ID'], 'Corrected leave - ' + just);
    appendMany_('LED', out);
    updateObj_('APP', a._row, {
      'Leave Type': v.type, 'Duration Type': v.single ? 'SINGLE' : 'MULTI', 'From Date': v.from, 'To Date': v.to, 'Duration': v.duration, 'Reason': v.reason,
      'Admin Remarks': (a['Admin Remarks'] ? a['Admin Remarks'] + ' | ' : '') + 'Edited: ' + just, 'Notice Override': v.noticeBreach ? 'YES' : a['Notice Override'],
      'Override Reason': (v.noticeBreach || v.negUsed) ? String(p.overrideReason || '').trim() : a['Override Reason'], 'Updated At': new Date()
    });
    refreshEmpBalances_();
    log_(ctx, 'LEAVE_RECORD_UPDATED', 'LEAVE', a['Application ID'], oldV, { type: v.type, from: iso_(v.from), to: iso_(v.to), days: v.duration, reason: v.reason }, just, 'SUCCESS');
  });
  return { message: 'Leave record updated. Old and new values were logged.' };
}

/* ================= EMPLOYEES ================= */
function adminListEmployees_(ctx) {
  return plain_(readAll_('EMP').filter(e => e['Status'] !== 'Deleted').map(empOut_));
}
function adminSaveEmployee_(ctx, p) {
  let result = null;
  withLock_(() => {
    const name = String(p.name || '').trim(), email = normEmail_(p.email), phone = normPhone_(p.phone);
    if (name.length < 2) fail_('Employee name is required.');
    if (!email && !phone) fail_('Enter an email or a 10-digit mobile number (needed for employee login).');
    if (email && !isEmail_(email)) fail_('Please enter a valid email address.');
    if (String(p.phone || '').trim() && phone.length !== 10) fail_('Mobile number must be 10 digits.');
    const status = p.status === 'Inactive' ? 'Inactive' : 'Active';
    const emps = readAll_('EMP'), cur = p.id ? emps.filter(e => String(e['Employee ID']) === String(p.id))[0] : null;
    if (p.id && !cur) fail_('Employee not found.');
    emps.forEach(e => {
      if (cur && e._row === cur._row) return;
      if (email && normEmail_(e['Email']) === email) fail_('Another employee already uses this email (' + e['Employee ID'] + ').');
      if (phone && normPhone_(e['Phone']) === phone) fail_('Another employee already uses this mobile number (' + e['Employee ID'] + ').');
    });
    const jd = String(p.joiningDate || '').trim() ? parseYmd_(p.joiningDate) : '';
    if (jd === null) fail_('Joining date is not valid.');
    if (!cur && !jd) fail_('Joining date is required for a new employee.');
    const now = new Date();
    let allowedStr = null;
    if (p.allowed !== undefined) {
      const al = (Array.isArray(p.allowed) ? p.allowed : String(p.allowed).split(','))
        .map(x => String(x).trim().toUpperCase()).filter(x => ['CL', 'SL', 'OTHER'].indexOf(x) > -1);
      allowedStr = al.length ? al.join(',') : 'NONE';
    }
    const data = { 'Employee Name': name, 'Email': email, 'Phone': phone, 'Department': String(p.department || '').trim(),
      'Designation': String(p.designation || '').trim(), 'Joining Date': jd, 'Status': status, 'Updated At': now };
    if (allowedStr !== null) data['Allowed Leaves'] = allowedStr;
    if (cur) {
      const oldV = empOut_(cur);
      updateObj_('EMP', cur._row, data);
      log_(ctx, 'EMPLOYEE_UPDATED', 'EMPLOYEE', cur['Employee ID'], oldV, data, '', 'SUCCESS');
      result = { id: cur['Employee ID'], message: 'Employee updated.' };
    } else {
      const id = nextId_('EMP', 'EMP', 'Employee ID');
      appendObj_('EMP', Object.assign({ 'Employee ID': id, 'CL Balance': 0, 'SL Balance': 0, 'Created At': now, 'Source Sync': 'LMS' }, data));
      log_(ctx, 'EMPLOYEE_ADDED', 'EMPLOYEE', id, '', data, '', 'SUCCESS');
      result = { id: id, message: 'Employee ' + id + ' added.' };
    }
  });
  withLock_(() => { cleanupLedgerCore_(ctx.email); ledgerMaintenance_(ctx.email); });
  return result;
}

/* ================= BALANCES / LEDGER ================= */
function adminBalanceSummary_(ctx, p) {
  const y = p.year ? Number(p.year) : today_().getFullYear();
  const led = readAll_('LED');
  return plain_({ year: y, rows: readAll_('EMP').filter(e => e['Status'] !== 'Deleted').map(e => ({ id: e['Employee ID'], name: e['Employee Name'], status: e['Status'], s: summaryFor_(led, e['Employee ID'], y) })) });
}
function adminLedger_(ctx, p) {
  if (!p.employeeId) fail_('Please select an employee.');
  const y = p.year ? Number(p.year) : today_().getFullYear();
  const mine = readAll_('LED').filter(r => String(r['Employee ID']) === String(p.employeeId));
  return plain_({
    year: y, tables: { CL: monthTable_(mine, 'CL', y), SL: monthTable_(mine, 'SL', y) }, summary: summaryFor_(mine, p.employeeId, y),
    rows: mine.filter(r => Number(r['Leave Year']) === y && (!p.type || r['Leave Type'] === p.type)).reverse().slice(0, 400).map(ledOut_)
  });
}
function adminAdjustBalance_(ctx, p) {
  const reason = String(p.reason || '').trim();
  if (reason.length < 3) fail_('A reason is mandatory for a balance adjustment.');
  const type = String(p.type || '').toUpperCase();
  if (['CL', 'SL'].indexOf(type) < 0) fail_('Select CL or SL.');
  const amt = parseFloat(p.amount);
  if (isNaN(amt) || amt === 0 || Math.abs(amt) > 366) fail_('Enter a valid adjustment amount (positive adds, negative deducts).');
  const y = Number(p.year) || today_().getFullYear(), m = Math.min(12, Math.max(1, Number(p.month) || (today_().getMonth() + 1)));
  withLock_(() => {
    const emp = getEmpById_(p.employeeId);
    if (!emp) fail_('Employee not found.');
    const rows = readAll_('LED'), idx = ledIndex_(rows), out = [];
    const before = balNow_(idx, emp['Employee ID'], type, y, m);
    if (before + amt < -0.0001 && !(p.override && SB_('ADMIN_NEGATIVE_OVERRIDE'))) fail_('This would make the balance negative (' + r2_(before + amt) + '). Tick the override box to allow it.', 'OVERRIDE');
    ledPost_(idx, out, ctx.email, { emp: emp['Employee ID'], year: y, month: m, type: type, tx: 'ADJUST', credit: amt > 0 ? amt : 0, debit: amt < 0 ? -amt : 0, remarks: 'Admin adjustment: ' + reason });
    appendMany_('LED', out);
    refreshEmpBalances_();
    log_(ctx, 'BALANCE_ADJUSTED', 'LEDGER', emp['Employee ID'], { type: type, balance: before }, { type: type, balance: r2_(before + amt), change: amt, year: y, month: m }, reason, 'SUCCESS');
  });
  return { message: 'Balance adjusted. A ledger entry was recorded.' };
}

/* ================= UNAUTHORIZED LEAVE ================= */
function adminListUnauthorized_(ctx, p) {
  const list = readAll_('UNA').map(u => ({
    id: u['Incident ID'], empId: u['Employee ID'], name: u['Employee Name'], incident: iso_(u['Incident Date']), from: iso_(u['From Date']), to: iso_(u['To Date']),
    duration: u['Duration'], occ: u['Occurrence Number'], salary: u['Salary Deduction'], penalty: u['Additional Penalty'], remarks: u['Admin Remarks'],
    action: u['Action Taken'], by: u['Recorded By'], at: dt_(u['Created At'])
  })).reverse();
  const counts = {};
  list.forEach(u => { counts[u.empId] = (counts[u.empId] || 0) + 1; });
  return plain_({ list: list, counts: counts, policy: S_('PEN_POLICY_TEXT') });
}
function adminSuggestPenalty_(ctx, p) {
  const emp = getEmpById_(p.employeeId);
  if (!emp) fail_('Please select an employee.');
  const occ = readAll_('UNA').filter(u => String(u['Employee ID']) === String(emp['Employee ID']) && String(u['Incident ID']) !== String(p.excludeId || '')).length + 1;
  const n = Math.min(occ, 3);
  const f = parseYmd_(p.fromDate), t = parseYmd_(p.toDate || p.fromDate);
  const dur = (f && t && t >= f) ? Math.round((t - f) / 86400000) + 1 : 1;
  const review = dur > SN_('PEN_CONSEC_THRESHOLD');
  return {
    occurrence: occ, salaryDays: SN_('PEN' + n + '_DAYS'), penalty: SN_('PEN' + n + '_AMOUNT'), duration: dur, review: review,
    note: (occ > 3 ? 'This is beyond the 3rd occurrence - Admin review recommended. ' : '') +
      (review ? 'More than ' + SN_('PEN_CONSEC_THRESHOLD') + ' consecutive days - Admin review / possible termination under company policy. ' : '') +
      'These are suggestions only; nothing is deducted automatically.'
  };
}
function adminSaveUnauthorized_(ctx, p) {
  let msg = '';
  withLock_(() => {
    const emp = getEmpById_(p.employeeId);
    if (!emp) fail_('Please select an employee.');
    const inc = parseYmd_(p.incidentDate), f = parseYmd_(p.fromDate || p.incidentDate), t = parseYmd_(p.toDate || p.fromDate || p.incidentDate);
    if (!inc || !f || !t || t < f) fail_('Please enter valid incident dates.');
    const remarks = String(p.remarks || '').trim();
    if (remarks.length < 3) fail_('Admin remarks are mandatory.');
    const sal = parseFloat(p.salaryDays), pen = parseFloat(p.penalty);
    if (isNaN(sal) || sal < 0 || isNaN(pen) || pen < 0) fail_('Salary deduction (days) and additional penalty must be zero or more.');
    const dur = Math.round((t - f) / 86400000) + 1, now = new Date();
    const list = readAll_('UNA'), cur = p.id ? list.filter(u => String(u['Incident ID']) === String(p.id))[0] : null;
    if (p.id && !cur) fail_('Incident not found.');
    const data = { 'Employee ID': emp['Employee ID'], 'Employee Name': emp['Employee Name'], 'Incident Date': inc, 'From Date': f, 'To Date': t, 'Duration': dur,
      'Salary Deduction': sal, 'Additional Penalty': pen, 'Admin Remarks': remarks, 'Action Taken': String(p.action || '').trim(), 'Updated At': now };
    if (cur) {
      const why = String(p.correctionReason || '').trim();
      if (why.length < 3) fail_('Please give the reason for this correction.');
      const old = { from: iso_(cur['From Date']), to: iso_(cur['To Date']), salary: cur['Salary Deduction'], penalty: cur['Additional Penalty'], remarks: cur['Admin Remarks'], action: cur['Action Taken'] };
      updateObj_('UNA', cur._row, data);
      log_(ctx, 'UNAUTHORIZED_LEAVE_CORRECTED', 'UNAUTHORIZED', cur['Incident ID'], old, data, why, 'SUCCESS');
      msg = 'Incident corrected. Old and new values were logged.';
    } else {
      const occ = list.filter(u => String(u['Employee ID']) === String(emp['Employee ID'])).length + 1;
      const id = 'UL-' + Utilities.formatDate(now, tz_(), 'yyyyMMdd') + '-' + pad_(nextSeq_('UNA'), 3);
      appendObj_('UNA', Object.assign({ 'Incident ID': id, 'Occurrence Number': occ, 'Recorded By': ctx.email, 'Created At': now }, data));
      log_(ctx, 'UNAUTHORIZED_LEAVE_RECORDED', 'UNAUTHORIZED', id, '', data, remarks, 'SUCCESS');
      msg = 'Incident ' + id + ' recorded (occurrence ' + occ + '). No salary action is taken automatically.';
    }
  });
  return { message: msg };
}

/* ================= DIWALI BONUS ================= */
function bonusAllowed_(ctx) {
  return ctx.adminRole === 'OWNER' || SB_('BONUS_ADMIN_VIEW');
}
/** CL that actually lapsed (month-end) on or before the cutoff, per employee. Used CL is never counted. */
function lapsedBeforeCutoff_(ledRows, year, cutoff) {
  const m = {};
  ledRows.forEach(r => {
    if (r['Leave Type'] !== 'CL' || (r['Transaction Type'] !== 'LAPSE' && r['Transaction Type'] !== 'EXPIRY')) return;
    if (Number(r['Leave Year']) !== Number(year)) return;
    if (new Date(Number(r['Leave Year']), Number(r['Month']), 0) > cutoff) return;   // month-end after cutoff: excluded
    const id = String(r['Employee ID']);
    m[id] = r2_((m[id] || 0) + (Number(r['Debit']) || 0));
  });
  return m;
}
function bonusOut_(b) {
  return { year: b['Bonus Year'], empId: b['Employee ID'], name: b['Employee Name'], lapsed: b['CL Lapsed Before Cutoff'], eligible: b['Eligible CL Count'],
    cutoff: iso_(b['Cutoff Date']), payDate: iso_(b['Payment Date']), amount: b['Bonus Amount'], status: b['Status'], remarks: b['Remarks'], by: b['Updated By'], at: dt_(b['Updated At']) };
}

function adminBonusSave_(ctx, p) {
  if (!bonusAllowed_(ctx)) fail_('Diwali Bonus details are restricted to the Owner admin.');
  withLock_(() => {
    const y = Number(p.year);
    const b = readAll_('BON').filter(r => Number(r['Bonus Year']) === y && String(r['Employee ID']) === String(p.employeeId))[0];
    if (!b) fail_('Bonus record not found. Calculate eligibility first.');
    if (['Pending', 'Processed', 'Paid'].indexOf(p.status) < 0) fail_('Invalid status.');
    const pd = String(p.paymentDate || '').trim() ? parseYmd_(p.paymentDate) : '';
    if (pd === null) fail_('Payment date is not valid.');
    const amt = String(p.amount).trim() === '' ? '' : parseFloat(p.amount);
    if (amt !== '' && (isNaN(amt) || amt < 0)) fail_('Bonus amount must be zero or more.');
    if (p.status === 'Paid' && (pd === '' || amt === '')) fail_('Enter the payment date and the final amount before marking as Paid.');
    const old = bonusOut_(b);
    updateObj_('BON', b._row, { 'Payment Date': pd, 'Bonus Amount': amt, 'Status': p.status, 'Remarks': String(p.remarks || '').trim(), 'Updated By': ctx.email, 'Updated At': new Date() });
    log_(ctx, 'BONUS_UPDATED', 'BONUS', y + '/' + p.employeeId, old, { status: p.status, amount: amt, payDate: p.paymentDate }, String(p.remarks || ''), 'SUCCESS');
  });
  return { message: 'Bonus record updated.' };
}

/* ================= HOLIDAYS ================= */
function adminListHolidays_(ctx, p) {
  const y = Number(p.year) || today_().getFullYear();
  const list = readAll_('HOL').filter(h => h['Holiday Date'] instanceof Date && h['Holiday Date'].getFullYear() === y)
    .sort((a, b) => a['Holiday Date'] - b['Holiday Date'])
    .map(h => ({ date: iso_(h['Holiday Date']), dateD: dmy_(h['Holiday Date']), name: h['Holiday Name'], status: h['Status'], notes: h['Notes'] }));
  return plain_({ year: y, allowance: SN_('PUBLIC_HOLIDAY_ALLOWANCE'), active: list.filter(h => h.status === 'Active').length, treatment: S_('PUBLIC_HOLIDAY_TREATMENT'), list: list });
}
function adminSaveHoliday_(ctx, p) {
  let warn = '';
  withLock_(() => {
    const d = parseYmd_(p.date);
    if (!d) fail_('Please select the holiday date.');
    const name = String(p.name || '').trim();
    if (name.length < 2) fail_('Holiday name is required.');
    const status = p.status === 'Inactive' ? 'Inactive' : 'Active';
    const data = { 'Holiday Date': d, 'Holiday Name': name, 'Year': d.getFullYear(), 'Status': status, 'Notes': String(p.notes || '').trim() };
    const cur = readAll_('HOL').filter(h => h['Holiday Date'] instanceof Date && iso_(h['Holiday Date']) === iso_(d))[0];
    if (cur) { updateObj_('HOL', cur._row, data); log_(ctx, 'HOLIDAY_UPDATED', 'HOLIDAY', iso_(d), cur['Holiday Name'], data, '', 'SUCCESS'); }
    else { appendObj_('HOL', data); log_(ctx, 'HOLIDAY_ADDED', 'HOLIDAY', iso_(d), '', data, '', 'SUCCESS'); }
    _HOL = null;
    const act = readAll_('HOL').filter(h => h['Status'] === 'Active' && h['Holiday Date'] instanceof Date && h['Holiday Date'].getFullYear() === d.getFullYear()).length;
    if (act > SN_('PUBLIC_HOLIDAY_ALLOWANCE')) warn = ' Note: active holidays (' + act + ') exceed the yearly allowance (' + SN_('PUBLIC_HOLIDAY_ALLOWANCE') + ').';
  });
  return { message: 'Holiday saved.' + warn };
}

/* ================= SETTINGS (edited from the portal) ================= */
const OWNER_ONLY_GROUPS_ = ['Admin Access', 'Employees'];
function adminGetSettings_(ctx) {
  const cur = settingsMap_();
  return plain_({
    canEditAccess: ctx.adminRole === 'OWNER',
    items: defaultSettings_().filter(d => d[3] !== 'hidden').map(d => ({ group: d[0], key: d[1], value: cur[d[1]] === undefined ? d[2] : cur[d[1]], type: d[3], desc: d[4], locked: (OWNER_ONLY_GROUPS_.indexOf(d[0]) > -1 || d[1] === 'BONUS_ADMIN_VIEW') && ctx.adminRole !== 'OWNER' }))
  });
}
function normSetting_(d, raw) {
  const type = d[3], key = d[1];
  let v = String(raw === null || raw === undefined ? '' : raw).trim();
  if (type === 'number') {
    if (v === '' || isNaN(Number(v)) || Number(v) < 0) fail_('"' + key + '" must be a number (zero or more).');
    if (/SESSION_MINUTES$/.test(key) && (Number(v) < 1 || Number(v) > 360)) fail_('Session minutes must be between 1 and 360.');
    if (key === 'DAILY_REMINDER_HOUR' && (Number(v) > 23 || Number(v) % 1 !== 0)) fail_('Reminder hour must be a whole number 0-23.');
    if (key === 'PASSWORD_MIN_LENGTH' && Number(v) < 6) fail_('Minimum password length cannot be below 6.');
    if (key === 'MAX_UPLOAD_MB' && Number(v) > 10) fail_('Maximum upload size cannot exceed 10 MB.');
    if (key === 'OTP_VALID_MINUTES' && (Number(v) < 1 || Number(v) > 60)) fail_('Code validity must be 1-60 minutes.');
    return String(Number(v));
  }
  if (type === 'bool') { v = v.toUpperCase(); if (v !== 'TRUE' && v !== 'FALSE') fail_('"' + key + '" must be Yes/No.'); return v; }
  if (type.indexOf('select:') === 0) { if (type.slice(7).split('|').indexOf(v) < 0) fail_('Invalid choice for "' + key + '".'); return v; }
  if (type === 'date') { if (v !== '' && !parseYmd_(v)) fail_('"' + key + '" must be a valid date.'); return v; }
  if (type === 'time') { if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(v)) fail_('Time must be HH:mm (24-hour).'); return v.length === 4 ? '0' + v : v; }
  if (type === 'emails') {
    const l = v.split(/[,;]/).map(trim_).filter(x => x);
    if (!l.length || !l.every(isEmail_)) fail_('Enter one or more valid email addresses separated by commas.');
    return l.join(', ');
  }
  if (key === 'WEEKLY_OFF_DAYS' && !/^\s*([0-6]\s*(,\s*[0-6]\s*)*)?$/.test(v)) fail_('Weekly off days: numbers 0-6 separated by commas.');
  if (key === 'ADDITIONAL_NOTICE_APPLIES_TO' && !/^\s*(CL|SL|OTHER)(\s*,\s*(CL|SL|OTHER))*\s*$/i.test(v)) fail_('Use CL, SL, OTHER separated by commas.');
  if (v.length > 500) fail_('"' + key + '" is too long.');
  return v;
}
function adminSaveSettings_(ctx, p) {
  const ch = (p && p.changes) || {};
  const defs = {}; defaultSettings_().forEach(d => { defs[d[1]] = d; });
  const keys = Object.keys(ch);
  if (!keys.length) fail_('Nothing to save.');
  const clean = {};
  keys.forEach(k => {
    const d = defs[k];
    if (!d) fail_('Unknown setting.');
    if (d[3] === 'readonly' || d[3] === 'hidden') fail_('"' + k + '" cannot be changed.');
    if (OWNER_ONLY_GROUPS_.indexOf(d[0]) > -1 && ctx.adminRole !== 'OWNER') fail_('Only the Owner admin can change this setting.');
    if (k === 'BONUS_ADMIN_VIEW' && ctx.adminRole !== 'OWNER') fail_('Only the Owner admin can change this setting.');
    clean[k] = normSetting_(d, ch[k]);
  });
  let changed = [];
  withLock_(() => {
    const sh = sh_('SET'), rows = readAll_('SET'), cur = settingsMap_();
    Object.keys(clean).forEach(k => {
      const old = cur[k] === undefined ? '' : String(cur[k]);
      if (old === clean[k]) return;
      const row = rows.filter(r => r['Key'] === k)[0];
      if (row) sh.getRange(row._row, 3).setValue(clean[k]);
      else appendObj_('SET', { 'Group': defs[k][0], 'Key': k, 'Value': clean[k], 'Description': defs[k][4] });
      changed.push(k);
      log_(ctx, 'SETTING_CHANGED', 'SETTINGS', k, old, clean[k], '', 'SUCCESS');
    });
    resetSettingsCache_();
  });
  if (changed.indexOf('DAILY_REMINDER_ENABLED') > -1 || changed.indexOf('DAILY_REMINDER_HOUR') > -1) createTriggers_();
  return { message: changed.length ? changed.length + ' setting(s) saved.' : 'No changes were made.', changed: changed };
}

/* ================= ADMIN USERS (any email domain is allowed) ================= */
function adminListAdmins_(ctx) {
  return plain_({ canEdit: ctx.adminRole === 'OWNER', list: readAll_('ADM').map(a => ({ id: a['Admin ID'], name: a['Admin Name'], email: a['Email'], phone: String(a['Phone'] || ''), role: a['Role'], status: a['Status'], hasPassword: !!getCred_(a['Admin ID']) })) });
}
function adminSaveAdmin_(ctx, p) {
  if (ctx.adminRole !== 'OWNER') fail_('Only the Owner admin can manage administrators.');
  let msg = '';
  withLock_(() => {
    const name = String(p.name || '').trim(), email = normEmail_(p.email), phone = normPhone_(p.phone);
    if (name.length < 2) fail_('Admin name is required.');
    if (!isEmail_(email)) fail_('A valid email is required (the security code is sent here).');
    if (String(p.phone || '').trim() && phone.length !== 10) fail_('Mobile number must be 10 digits.');
    const role = p.role === 'OWNER' ? 'OWNER' : 'ADMIN', status = p.status === 'Inactive' ? 'Inactive' : 'Active';
    const list = readAll_('ADM'), cur = p.id ? list.filter(a => String(a['Admin ID']) === String(p.id))[0] : null;
    if (p.id && !cur) fail_('Admin not found.');
    list.forEach(a => {
      if (cur && a._row === cur._row) return;
      if (normEmail_(a['Email']) === email) fail_('Another admin already uses this email.');
      if (phone && normPhone_(a['Phone']) === phone) fail_('Another admin already uses this mobile number.');
    });
    if (cur) {
      if (String(cur['Admin ID']) === String(ctx.id) && status === 'Inactive') fail_('You cannot deactivate your own account.');
      const owners = list.filter(a => a['Role'] === 'OWNER' && a['Status'] === 'Active' && String(a['Admin ID']) !== String(cur['Admin ID'])).length;
      if ((role !== 'OWNER' || status !== 'Active') && cur['Role'] === 'OWNER' && cur['Status'] === 'Active' && owners < 1) fail_('At least one active Owner admin must remain.');
      const old = { name: cur['Admin Name'], email: cur['Email'], phone: cur['Phone'], role: cur['Role'], status: cur['Status'] };
      updateObj_('ADM', cur._row, { 'Admin Name': name, 'Email': email, 'Phone': phone, 'Role': role, 'Status': status, 'Updated At': new Date() });
      if (old.email !== email || normPhone_(old.phone) !== phone || old.role !== role || old.status !== status) bumpSessionVersion_(cur['Admin ID']);
      log_(ctx, 'ADMIN_UPDATED', 'ADMIN', cur['Admin ID'], old, { name: name, email: email, phone: phone, role: role, status: status }, '', 'SUCCESS');
      msg = 'Administrator updated.';
    } else {
      const id = nextId_('ADM', 'ADM', 'Admin ID'), now = new Date();
      appendObj_('ADM', { 'Admin ID': id, 'Admin Name': name, 'Email': email, 'Phone': phone, 'Role': role, 'Status': status, 'Created At': now, 'Updated At': now });
      log_(ctx, 'ADMIN_ADDED', 'ADMIN', id, '', { name: name, email: email, role: role }, '', 'SUCCESS');
      msg = 'Administrator ' + id + ' added. Ask them to use "Forgot password?" on the login page to set their first password.';
    }
  });
  return { message: msg };
}

/* ================= LOG / UTILITIES ================= */
function adminListLog_(ctx, p) {
  const q = String(p.q || '').toLowerCase(), mod = String(p.module || '');
  const rows = readAll_('LOG').filter(r => (!mod || r['Module'] === mod) &&
    (!q || (r['User Email'] + ' ' + r['Action'] + ' ' + r['Record ID'] + ' ' + r['Remarks']).toLowerCase().indexOf(q) > -1)).reverse().slice(0, 300);
  return plain_(rows.map(r => ({ id: r['Log ID'], at: dt_(r['Timestamp']), user: r['User Email'], role: r['User Role'], action: r['Action'], module: r['Module'], rec: r['Record ID'],
    oldV: r['Old Value'], newV: r['New Value'], remarks: r['Remarks'], result: r['Result'] })));
}
function adminRunMaintenance_(ctx) {
  const r = runMaintenance_(ctx.email);
  return { message: 'Done. Credited ' + r.credited + ', lapsed CL/SL ' + r.lapsed + ', year-end expired ' + r.expired + ' (' + r.entries + ' ledger entries).' };
}
function adminSendReminderNow_(ctx) {
  const r = sendDailyPendingReminder_(true);
  return { message: r.sent ? 'Reminder sent for ' + r.count + ' pending application(s).' : 'Not sent: ' + r.reason };
}

/* ================= DELETE HELPERS (Owner only) ================= */
function purgeRows_(key, col, value) {
  const sh = sh_(key), n = COLS[key].length, last = sh.getLastRow();
  if (last < 2) return 0;
  const idx = COLS[key].indexOf(col);
  const vals = sh.getRange(2, 1, last - 1, n).getValues();
  const keep = vals.filter(r => String(r[idx]) !== String(value));
  const removed = vals.length - keep.length;
  if (!removed) return 0;
  sh.getRange(2, 1, vals.length, n).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, n).setValues(keep);
  return removed;
}

function resetEmployeeIdCounter() {
  assertOwnerRun_();
  if (readAll_('EMP').length > 0) throw new Error('Employees still exist. Delete them first.');
  PropertiesService.getScriptProperties().deleteProperty('MAXID_EMP');
}
function adminDeleteAdmin_(ctx, p) {
  needOwner_(ctx);
  let msg = '';
  withLock_(() => {
    const list = readAll_('ADM');
    const a = list.filter(x => String(x['Admin ID']) === String(p.id))[0];
    if (!a) fail_('Administrator not found.');
    const id = String(a['Admin ID']);
    if (id === String(ctx.id)) fail_('You cannot delete your own account.');
    if (a['Role'] === 'OWNER' && a['Status'] === 'Active') {
      const others = list.filter(x => x['Role'] === 'OWNER' && x['Status'] === 'Active' && String(x['Admin ID']) !== id).length;
      if (others < 1) fail_('At least one active Owner admin must remain.');
    }
    // keep the ID number from being reused, so old log entries never point to a new person
    const props = PropertiesService.getScriptProperties();
    const m = /^ADM-(\d+)$/.exec(id);
    if (m) props.setProperty('MAXID_ADM', String(Math.max(parseInt(props.getProperty('MAXID_ADM') || '0', 10) || 0, parseInt(m[1], 10))));
    bumpSessionVersion_(id);   // ends any open session
    clearCred_(id);            // removes the password
    sh_('ADM').deleteRow(a._row);
    log_(ctx, 'ADMIN_DELETED', 'ADMIN', id, { name: a['Admin Name'], email: a['Email'], role: a['Role'], status: a['Status'] }, '', 'Administrator permanently deleted', 'SUCCESS');
    msg = 'Administrator ' + id + ' deleted.';
  });
  return { message: msg };
}
