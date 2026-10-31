/** Bin.gs - employee delete (Bin), restore and permanent purge. Owner only. */

function needOwner_(ctx) { if (ctx.adminRole !== 'OWNER') fail_('Only the Owner admin can do this.'); }
function binDays_() { return Math.max(SN_('EMP_BIN_DAYS') || 30, 1); }

function adminDeleteEmployee_(ctx, p) {
  needOwner_(ctx);
  let id = '';
  withLock_(() => {
    const emp = getEmpById_(p.id);
    if (!emp) fail_('Employee not found. It may already be deleted.');
    if (emp['Status'] === 'Deleted') fail_('This employee is already in the Bin.');
    id = String(emp['Employee ID']);
    const now = new Date();
    updateObj_('EMP', emp._row, { 'Prev Status': emp['Status'], 'Status': 'Deleted', 'Deleted At': now, 'Deleted By': ctx.email, 'Updated At': now });
    log_(ctx, 'EMPLOYEE_MOVED_TO_BIN', 'EMPLOYEE', id, empOut_(emp), { deletedAt: dt_(now), retentionDays: binDays_() }, 'Kept for restore', 'SUCCESS');
  });
  return { message: 'Employee ' + id + ' moved to the Bin. It can be restored for ' + binDays_() + ' days.' };
}

function adminBinList_(ctx) {
  needOwner_(ctx);
  const days = binDays_(), now = Date.now(), appCount = {};
  readAll_('APP').forEach(a => { const k = String(a['Employee ID']); appCount[k] = (appCount[k] || 0) + 1; });
  return plain_({ days: days, list: readAll_('EMP').filter(e => e['Status'] === 'Deleted').map(e => {
    const at = e['Deleted At'];
    const end = at instanceof Date ? at.getTime() + days * 86400000 : null;
    return {
      id: e['Employee ID'], name: e['Employee Name'], at: dt_(at), by: e['Deleted By'],
      left: end === null ? null : Math.max(0, Math.ceil((end - now) / 86400000)),
      expired: end !== null && end <= now,
      apps: appCount[String(e['Employee ID'])] || 0
    };
  }) });
}

function adminBinRestore_(ctx, p) {
  needOwner_(ctx);
  let id = '';
  withLock_(() => {
    const emp = getEmpById_(p.id);
    if (!emp || emp['Status'] !== 'Deleted') fail_('This employee is not in the Bin.');
    const at = emp['Deleted At'];
    if (!(at instanceof Date)) fail_('The deletion time is missing, so this record cannot be restored safely.');
    if (Date.now() > at.getTime() + binDays_() * 86400000) fail_('The ' + binDays_() + '-day retention period is over. This record will be purged.');
    id = String(emp['Employee ID']);
    updateObj_('EMP', emp._row, { 'Status': emp['Prev Status'] || 'Active', 'Deleted At': '', 'Deleted By': '', 'Prev Status': '', 'Updated At': new Date() });
    log_(ctx, 'EMPLOYEE_RESTORED_FROM_BIN', 'EMPLOYEE', id, 'Deleted', emp['Prev Status'] || 'Active', 'Same ID and records', 'SUCCESS');
    ledgerMaintenance_(ctx.email);
  });
  return { message: 'Employee ' + id + ' restored with the same ID and all records.' };
}

function purgeEmployeeData_(emp) {
  const id = String(emp['Employee ID']); let docs = 0;
  readAll_('APP').forEach(a => {
    if (String(a['Employee ID']) !== id || !a['Medical Document ID']) return;
    try { DriveApp.getFileById(a['Medical Document ID']).setTrashed(true); docs++; } catch (e) { /* already gone */ }
  });
  return { applications: purgeRows_('APP', 'Employee ID', id), ledger: purgeRows_('LED', 'Employee ID', id),
    bonus: purgeRows_('BON', 'Employee ID', id), unauthorized: purgeRows_('UNA', 'Employee ID', id), documents: docs };
}

/** Permanently removes ONE employee. Caller must hold the script lock. */
function purgeOne_(ctx, f, why) {
  const counts = purgeEmployeeData_(f);
  const props = PropertiesService.getScriptProperties();
  const m = /^EMP-(\d+)$/.exec(String(f['Employee ID']));   // never reuse an ID
  if (m) props.setProperty('MAXID_EMP', String(Math.max(parseInt(props.getProperty('MAXID_EMP') || '0', 10) || 0, parseInt(m[1], 10))));
  sh_('EMP').deleteRow(f._row);
  log_(ctx, 'EMPLOYEE_PURGED_FROM_BIN', 'EMPLOYEE', String(f['Employee ID']), empOut_(f), counts, why, 'SUCCESS');
  return counts;
}

/** Daily trigger: removes employees whose Bin time is over. */
function binPurge_(who) {
  return withLock_(() => {
    const cutoff = Date.now() - binDays_() * 86400000;
    const due = readAll_('EMP').filter(e => e['Status'] === 'Deleted' && e['Deleted At'] instanceof Date && e['Deleted At'].getTime() <= cutoff)
      .sort((a, b) => b._row - a._row);
    let n = 0;
    due.forEach(e => {
      const f = getEmpById_(e['Employee ID']);
      if (!f || f['Status'] !== 'Deleted' || !(f['Deleted At'] instanceof Date) || f['Deleted At'].getTime() > cutoff || f._row !== e._row) return;
      purgeOne_({ email: who, role: 'SYSTEM' }, f, 'Retention period over');
      n++;
    });
    return n;
  });
}
function adminBinPurgeNow_(ctx) {
  needOwner_(ctx);
  const n = binPurge_(ctx.email);
  return { message: n ? n + ' expired employee(s) permanently removed.' : 'Nothing has passed the retention period yet.' };
}

/** NEW: permanently deletes one employee that is in the Bin (used for Delete selected / Delete all). */
function adminBinPurgeOne_(ctx, p) {
  needOwner_(ctx);
  let id = '', counts = null;
  withLock_(() => {
    const f = getEmpById_(p.id);
    if (!f || f['Status'] !== 'Deleted') fail_('This employee is not in the Bin.');
    id = String(f['Employee ID']);
    counts = purgeOne_(ctx, f, 'Permanently deleted from Bin by Owner');
  });
  return { message: 'Employee ' + id + ' permanently deleted.', counts: counts };
}
