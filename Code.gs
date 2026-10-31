/**
 * ATTAHAR WEB-PORTAL - LEAVE MANAGEMENT WEB APP  (v1.0)
 * FILE 1: Code.gs
 * Entry points, constants, settings, sheet helpers, logging, API gateway, setup, triggers.
 *
 * SECURITY MODEL (important)
 *  - The browser can call ONLY: doGet, apiPublic, apiEmployee, apiAdmin.
 *  - Every other helper ends with "_" and cannot be called from the browser.
 *  - apiEmployee / apiAdmin verify a server-side session token on EVERY call.
 *  - Setup / menu functions refuse to run unless the spreadsheet owner runs them.
 *  - Admins can use ANY email domain. Nothing here restricts the domain.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const OWNER_EMAIL_ = 'valobvb30@gmail.com';
const PORTAL_NAME_ = 'Attahar Web-Portal';

const SH = {
  EMP: 'EMPLOYEE MASTER',
  APP: 'LEAVE APPLICATIONS',
  LED: 'LEAVE LEDGER',
  BON: 'DIWALI BONUS',
  UNA: 'UNAUTHORIZED LEAVE',
  HOL: 'PUBLIC HOLIDAYS',
  ADM: 'ADMINS',
  SET: 'SETTINGS',
  LOG: 'SYSTEM LOG'
};
const SHEET_ORDER = ['EMP', 'APP', 'LED', 'BON', 'UNA', 'HOL', 'ADM', 'SET', 'LOG'];

const COLS = {
  EMP: ['Employee ID', 'Employee Name', 'Email', 'Phone', 'Department', 'Designation', 'Joining Date', 'Status',
    'CL Balance', 'SL Balance', 'Created At', 'Updated At', 'Allowed Leaves',
    'Deleted At', 'Deleted By', 'Prev Status', 'Source Sync'],
  ADM: ['Admin ID', 'Admin Name', 'Email', 'Phone', 'Role', 'Status', 'Created At', 'Updated At'],
  APP: ['Application ID', 'Submission Timestamp', 'Employee ID', 'Employee Name', 'Employee Email', 'Leave Type',
    'Duration Type', 'From Date', 'To Date', 'Duration', 'Reason', 'Medical Document ID', 'Medical Document URL',
    'Status', 'Admin Remarks', 'Reviewed By', 'Reviewed At', 'Notice Override', 'Override Reason', 'Created At',
    'Updated At', 'Entry Source', 'Request Key', 'Admin Notified', 'Employee Notified'],
  LED: ['Transaction ID', 'Employee ID', 'Leave Year', 'Month', 'Leave Type', 'Transaction Type', 'Credit', 'Debit',
    'Opening Balance', 'Closing Balance', 'Related Application ID', 'Remarks', 'Created At', 'Created By'],
  BON: ['Bonus Year', 'Employee ID', 'Employee Name', 'CL Lapsed Before Cutoff', 'Eligible CL Count', 'Cutoff Date',
    'Payment Date', 'Bonus Amount', 'Status', 'Remarks', 'Updated By', 'Updated At'],
  UNA: ['Incident ID', 'Employee ID', 'Employee Name', 'Incident Date', 'From Date', 'To Date', 'Duration',
    'Occurrence Number', 'Salary Deduction', 'Additional Penalty', 'Admin Remarks', 'Action Taken', 'Recorded By',
    'Created At', 'Updated At'],
  HOL: ['Holiday Date', 'Holiday Name', 'Year', 'Status', 'Notes'],
  SET: ['Group', 'Key', 'Value', 'Description'],
  LOG: ['Log ID', 'Timestamp', 'User Email', 'User Role', 'Action', 'Module', 'Record ID', 'Old Value', 'New Value',
    'Remarks', 'Result']
};

const DATE_COLS = {
  EMP: ['Joining Date'], APP: ['From Date', 'To Date'], BON: ['Cutoff Date', 'Payment Date'],
  UNA: ['Incident Date', 'From Date', 'To Date'], HOL: ['Holiday Date']
};
const DATETIME_COLS = {
  EMP: ['Created At', 'Updated At', 'Deleted At'], ADM: ['Created At', 'Updated At'],
  APP: ['Submission Timestamp', 'Reviewed At', 'Created At', 'Updated At'], LED: ['Created At'],
  BON: ['Updated At'], UNA: ['Created At', 'Updated At'], LOG: ['Timestamp']
};
const TEXT_COLS = { EMP: ['Phone'], ADM: ['Phone'], SET: ['Value'] };

/* ------------------------------------------------------------------ */
/*  ERRORS / GLOBAL CACHES                                             */
/* ------------------------------------------------------------------ */
class UserError extends Error {
  constructor(msg, code) { super(msg); this.name = 'UserError'; this.code = code || 'ERR'; }
}
function fail_(msg, code) { throw new UserError(msg, code); }

let _SS = null;
let _SETTINGS = null;

/* ------------------------------------------------------------------ */
/*  SETTINGS  (edited from the Admin Portal > Settings page)           */
/*  [group, key, default, type, description]                           */
/* ------------------------------------------------------------------ */
function defaultSettings_() {
  const yr = String(new Date().getFullYear());
  return [
    ['General', 'COMPANY_NAME', PORTAL_NAME_, 'text', 'Name shown in the app and in emails.'],
    ['General', 'SYSTEM_ACTIVE', 'TRUE', 'bool', 'Set FALSE to temporarily close the Employee Portal (Admin still works).'],
    ['General', 'TIMEZONE', 'Asia/Kolkata', 'readonly', 'Fixed. Also set the Apps Script project time zone to Asia/Kolkata.'],
    ['General', 'DATE_FORMAT', 'DD/MM/YYYY', 'readonly', 'Fixed display format.'],
    ['General', 'LEAVE_YEAR', 'Calendar Year (January to December)', 'readonly', 'Fixed leave year.'],
    ['General', 'WEB_APP_URL', '', 'text', 'Web app link used inside emails. Leave blank to auto-detect.'],

    ['Admin Access', 'ADMIN_SESSION_MINUTES', '30', 'number', 'Admin session expires after this many idle minutes.'],
    ['Admin Access', 'EMPLOYEE_SESSION_MINUTES', '60', 'number', 'Employee session expires after this many idle minutes.'],
    ['Admin Access', 'MAX_LOGIN_ATTEMPTS', '5', 'number', 'Wrong attempts allowed before a temporary lock.'],
    ['Admin Access', 'LOCKOUT_MINUTES', '15', 'number', 'Lock duration after too many wrong attempts.'],
    ['Admin Access', 'OTP_VALID_MINUTES', '10', 'number', 'Security code (OTP) validity in minutes.'],
    ['Admin Access', 'OTP_MAX_ATTEMPTS', '5', 'number', 'Wrong security-code entries allowed before the code is cancelled.'],
    ['Admin Access', 'PASSWORD_MIN_LENGTH', '8', 'number', 'Minimum Admin password length (must include letters and numbers).'],
    ['Admin Access', 'EMPLOYEE_LOGIN_MODE', 'IDENTIFIER', 'select:IDENTIFIER|EMAIL_OTP',
      'IDENTIFIER = email or phone only. EMAIL_OTP = also verify with a code emailed to the employee (more secure).'],

    ['Leave Policy', 'CL_MONTHLY_CREDIT', '1', 'number', 'Casual Leave credited each month.'],
    ['Leave Policy', 'SL_MONTHLY_CREDIT', '1', 'number', 'Sick Leave credited each month.'],
    ['Leave Policy', 'CL_ANNUAL_MAX', '12', 'number', 'Maximum Casual Leave credit per year.'],
    ['Leave Policy', 'SL_ANNUAL_MAX', '12', 'number', 'Maximum Sick Leave credit per year.'],
    ['Leave Policy', 'CL_CARRY_FORWARD', 'FALSE', 'bool', 'FALSE = unused CL lapses at month end (policy). TRUE = carries within the year.'],
    ['Leave Policy', 'SL_CARRY_FORWARD', 'TRUE', 'bool', 'TRUE = unused SL carries within the calendar year (policy). SL always expires at year end.'],
    ['Leave Policy', 'MEDICAL_PROOF_THRESHOLD_DAYS', '2', 'number', 'Sick Leave longer than this many days needs a medical certificate.'],
    ['Leave Policy', 'MAX_UPLOAD_MB', '10', 'number', 'Maximum medical document size in MB.'],
    ['Leave Policy', 'DURATION_MODE', 'CALENDAR', 'select:CALENDAR|WORKING', 'CALENDAR = every date counts. WORKING = skip weekly-off days (and holidays if enabled below).'],
    ['Leave Policy', 'WEEKLY_OFF_DAYS', '0', 'text', 'Used only in WORKING mode. Day numbers, comma separated (0=Sunday ... 6=Saturday).'],
    ['Leave Policy', 'EXCLUDE_HOLIDAYS_FROM_DURATION', 'FALSE', 'bool', 'Used only in WORKING mode. TRUE = active public holidays do not count as leave days.'],
    ['Leave Policy', 'OTHER_LEAVE_TREATMENT', 'Unpaid', 'select:Paid|Unpaid', 'How Other Leave is treated for salary (information for payroll).'],
    ['Leave Policy', 'ADMIN_NEGATIVE_OVERRIDE', 'TRUE', 'bool', 'Allow Admin to approve/enter leave beyond balance, with a mandatory reason.'],
    ['Leave Policy', 'MAX_BACKDATE_DAYS', '7', 'number', 'Employees cannot apply for dates older than this many days (Sick Leave).'],
    ['Leave Policy', 'LEAVE_START_TIME', '09:00', 'time', 'Time the leave day starts (used for the notice-period calculation). HH:mm.'],
    ['Leave Policy', 'PUBLIC_HOLIDAY_ALLOWANCE', '8', 'number', 'Public holidays allowed per year.'],
    ['Leave Policy', 'PUBLIC_HOLIDAY_TREATMENT', 'Kept separate. Not deducted from CL or SL.', 'text', 'Company policy note for public holidays (information only).'],

    ['Notice Rules', 'CL_NOTICE_HOURS', '24', 'number', 'Casual Leave minimum advance notice (hours).'],
    ['Notice Rules', 'OTHER_NOTICE_HOURS', '24', 'number', 'Other Leave minimum advance notice (hours).'],
    ['Notice Rules', 'SL_NOTICE_HOURS', '0', 'number', 'Sick Leave advance notice (0 = exempt).'],
    ['Notice Rules', 'SHORT_NOTICE_BLOCK', 'TRUE', 'bool', 'TRUE = employees cannot submit inside the notice period (they must contact Admin).'],
    ['Notice Rules', 'ADMIN_NOTICE_OVERRIDE', 'TRUE', 'bool', 'TRUE = Admin may manually enter leave inside the notice period (reason mandatory).'],
    ['Notice Rules', 'ADDITIONAL_NOTICE_ENABLED', 'FALSE', 'bool', 'Company form wording (1-2 days for short leave, 1 week for long leave). OFF until the company finalises it. When ON, the stricter rule wins over the 24-hour rule.'],
    ['Notice Rules', 'ADDITIONAL_NOTICE_APPLIES_TO', 'CL,OTHER', 'text', 'Leave types for the additional rule (CL, SL, OTHER).'],
    ['Notice Rules', 'SHORT_LEAVE_NOTICE_DAYS', '2', 'number', 'Additional rule: notice days for shorter leave.'],
    ['Notice Rules', 'LONG_LEAVE_NOTICE_DAYS', '7', 'number', 'Additional rule: notice days for longer leave.'],
    ['Notice Rules', 'LONG_LEAVE_MIN_DAYS', '3', 'number', 'Additional rule: leave of this many days or more counts as "longer".'],

    ['Diwali Bonus', 'BONUS_YEAR', yr, 'number', 'Bonus year being processed.'],
    ['Diwali Bonus', 'BONUS_CUTOFF_DATE', '', 'date', 'Only CL that lapsed on or before this date counts. Set after the Diwali date is known.'],
    ['Diwali Bonus', 'BONUS_PAYMENT_DATE', '', 'date', 'Expected payment date.'],
    ['Diwali Bonus', 'BONUS_ACTIVE_RULE', 'R-MANUAL', 'hidden', 'Rule in use (managed from the Bonus rules list).'],
    ['Diwali Bonus', 'BONUS_RULES', '[{"id":"R-MANUAL","name":"Manual","type":"MANUAL","value":0}]', 'hidden', 'Bonus rules (managed from the Bonus rules list).'],
    ['Diwali Bonus', 'BONUS_ADMIN_VIEW', 'FALSE', 'bool', 'Yes = normal Admins can see Diwali Bonus details. No = only the Owner can. Only the Owner can change this.'],

    ['Employees', 'EMP_BIN_DAYS', '30', 'number', 'Days a deleted employee stays in the Bin before permanent removal. Owner only.'],

    ['Notifications', 'ADMIN_NOTIFICATION_EMAIL', OWNER_EMAIL_, 'emails', 'Admin email(s) for alerts. Separate several with commas.'],
    ['Notifications', 'NOTIFY_ADMIN_INSTANT', 'TRUE', 'bool', 'Email Admin immediately for each new application.'],
    ['Notifications', 'DAILY_REMINDER_ENABLED', 'TRUE', 'bool', 'Send a daily list of pending applications.'],
    ['Notifications', 'DAILY_REMINDER_HOUR', '9', 'number', 'Reminder hour (0-23, India time).'],
    ['Notifications', 'NOTIFY_EMPLOYEE_DECISION', 'TRUE', 'bool', 'Email the employee when an application is approved/rejected/cancelled.'],

    ['Penalty', 'PEN1_DAYS', '1', 'number', '1st unauthorized leave: days of salary deducted.'],
    ['Penalty', 'PEN1_AMOUNT', '800', 'number', '1st unauthorized leave: additional penalty (Rs).'],
    ['Penalty', 'PEN2_DAYS', '1', 'number', '2nd occurrence: days of salary deducted.'],
    ['Penalty', 'PEN2_AMOUNT', '1000', 'number', '2nd occurrence: additional penalty (Rs).'],
    ['Penalty', 'PEN3_DAYS', '1', 'number', '3rd occurrence: days of salary deducted.'],
    ['Penalty', 'PEN3_AMOUNT', '1500', 'number', '3rd occurrence: additional penalty (Rs).'],
    ['Penalty', 'PEN_CONSEC_THRESHOLD', '3', 'number', 'More than this many consecutive unauthorized days needs Admin review.'],
    ['Penalty', 'PEN_POLICY_TEXT', 'More than 3 consecutive unauthorized days: Admin review, possible termination under company policy.', 'text', 'Policy text shown to Admin. The system never deducts salary or terminates automatically.']
  ];
}

function settingsMap_() {
  if (_SETTINGS) return _SETTINGS;
  try {
    const hit = CacheService.getScriptCache().get('SETTINGS_MAP');
    if (hit) { _SETTINGS = JSON.parse(hit); return _SETTINGS; }
  } catch (e) { /* ignore */ }
  const m = {};
  defaultSettings_().forEach(d => { m[d[1]] = d[2]; });
  const sh = ss_().getSheetByName(SH.SET);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(r => {
      if (r[1] !== '') m[String(r[1])] = String(r[2]);
    });
  }
  _SETTINGS = m;
  try { CacheService.getScriptCache().put('SETTINGS_MAP', JSON.stringify(m), 300); } catch (e) { /* ignore */ }
  return m;
}

function resetSettingsCache_() {
  _SETTINGS = null;
  try { CacheService.getScriptCache().remove('SETTINGS_MAP'); } catch (e) { /* ignore */ }
}

function S_(k) { const m = settingsMap_(); return m[k] === undefined ? '' : String(m[k]); }
function SN_(k) {
  const n = parseFloat(S_(k));
  if (!isNaN(n)) return n;
  const d = defaultSettings_().filter(x => x[1] === k)[0];
  return d ? (parseFloat(d[2]) || 0) : 0;
}
function SB_(k) { return String(S_(k)).trim().toLowerCase() === 'true'; }


/* ------------------------------------------------------------------ */
/*  SHEET HELPERS                                                      */
/* ------------------------------------------------------------------ */
function ss_() {
  if (_SS) return _SS;
  const id = PropertiesService.getScriptProperties().getProperty('SS_ID');
  _SS = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!_SS) throw new Error('Spreadsheet not linked. Run setupSystem() from the spreadsheet.');
  return _SS;
}
function sh_(key) {
  const s = ss_().getSheetByName(SH[key]);
  if (!s) throw new Error('Sheet missing: ' + SH[key] + '. Run setupSystem().');
  return s;
}
function readAll_(key) {
  const sh = sh_(key), n = COLS[key].length, last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, n).getValues();
  const out = [];
  vals.forEach((v, i) => {
    if (v.every(x => x === '')) return;
    const o = { _row: i + 2 };
    COLS[key].forEach((c, j) => { o[c] = v[j]; });
    out.push(o);
  });
  return out;
}
function objToArr_(key, o) {
  return COLS[key].map(c => (o[c] === undefined || o[c] === null) ? '' : o[c]);
}
function ensureRows_(sh, lastNeeded) {
  const max = sh.getMaxRows();
  if (lastNeeded > max) sh.insertRowsAfter(max, lastNeeded - max + 200);
}
function appendObj_(key, o) {
  const sh = sh_(key);
  const row = sh.getLastRow() + 1;
  ensureRows_(sh, row);
  sh.getRange(row, 1, 1, COLS[key].length).setValues([objToArr_(key, o)]);
  return row;
}
function appendMany_(key, objs) {
  if (!objs.length) return;
  const sh = sh_(key);
  const row = sh.getLastRow() + 1;
  ensureRows_(sh, row + objs.length - 1);
  sh.getRange(row, 1, objs.length, COLS[key].length).setValues(objs.map(o => objToArr_(key, o)));
}
function updateObj_(key, row, changes) {
  const sh = sh_(key), n = COLS[key].length;
  const cur = sh.getRange(row, 1, 1, n).getValues()[0];
  COLS[key].forEach((c, j) => {
    if (Object.prototype.hasOwnProperty.call(changes, c)) cur[j] = (changes[c] === null || changes[c] === undefined) ? '' : changes[c];
  });
  sh.getRange(row, 1, 1, n).setValues([cur]);
}

/* ------------------------------------------------------------------ */
/*  DATE / ID / LOCK HELPERS                                           */
/* ------------------------------------------------------------------ */
function tz_() { return S_('TIMEZONE') || 'Asia/Kolkata'; }
function iso_(d) { return d instanceof Date ? Utilities.formatDate(d, tz_(), 'yyyy-MM-dd') : ''; }
function dmy_(d) { return d instanceof Date ? Utilities.formatDate(d, tz_(), 'dd/MM/yyyy') : ''; }
function dt_(d) { return d instanceof Date ? Utilities.formatDate(d, tz_(), 'dd/MM/yyyy HH:mm') : ''; }
function parseYmd_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return null;
  return d;
}
function today_() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function addDays_(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function r2_(n) { return Math.round(n * 100) / 100; }
function pad_(n, w) { let s = String(n); while (s.length < w) s = '0' + s; return s; }
function esc_(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function uid_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), tz_(), 'yyyyMMddHHmmss') + '-' +
    Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
}
function nextSeq_(name) {
  const p = PropertiesService.getScriptProperties();
  const k = 'SEQ_' + name;
  const n = (parseInt(p.getProperty(k) || '0', 10) || 0) + 1;
  p.setProperty(k, String(n));
  return n;
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function normPhone_(s) { return String(s || '').replace(/\D/g, '').slice(-10); }
function normEmail_(s) { return String(s || '').trim().toLowerCase(); }
function isEmail_(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim()); }

/* ------------------------------------------------------------------ */
/*  SYSTEM LOG  (append-only through server code)                      */
/* ------------------------------------------------------------------ */
function log_(ctx, action, module, recordId, oldV, newV, remarks, result) {
  try {
    const c = ctx || {};
    const cut = v => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return s.length > 1500 ? s.slice(0, 1500) + '...' : s;
    };
    appendObj_('LOG', {
      'Log ID': uid_('LOG'), 'Timestamp': new Date(), 'User Email': c.email || '', 'User Role': c.role || 'SYSTEM',
      'Action': action, 'Module': module, 'Record ID': recordId || '', 'Old Value': cut(oldV), 'New Value': cut(newV),
      'Remarks': cut(remarks), 'Result': result || 'SUCCESS'
    });
  } catch (e) {
    console.error('Log write failed: ' + e);
  }
}

/* ------------------------------------------------------------------ */
/*  WEB APP ENTRY                                                      */
/* ------------------------------------------------------------------ */
function doGet() {
  let company = PORTAL_NAME_;
  try { company = S_('COMPANY_NAME') || company; } catch (e) { /* not set up yet */ }
  const t = HtmlService.createTemplateFromFile('Index');
  t.company = company;
  return t.evaluate()
    .setTitle(company)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/* ------------------------------------------------------------------ */
/*  API GATEWAY - the only server functions the browser may use        */
/* ------------------------------------------------------------------ */
function apiPublic(action, payload) {
  return runApi_(publicApi_(), action, payload, () => ({ email: '', role: 'ANONYMOUS' }));
}
function apiEmployee(action, token, payload) {
  return runApi_(employeeApi_(), action, payload, () => employeeCtx_(token));
}
function apiAdmin(action, token, payload) {
  return runApi_(adminApi_(), action, payload, () => adminCtx_(token));
}

function runApi_(map, action, payload, authFn) {
  try {
    const fn = Object.prototype.hasOwnProperty.call(map, String(action)) ? map[String(action)] : null;
    if (!fn) fail_('Unknown request.', 'BAD');
    const ctx = authFn();
    const p = (payload && typeof payload === 'object') ? payload : {};
    return { ok: true, data: fn(ctx, p) };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message, code: e.code };
    log_({ role: 'SYSTEM' }, 'UNEXPECTED_ERROR', 'SYSTEM', String(action), '', '', String(e && e.stack ? e.stack : e), 'ERROR');
    return { ok: false, error: 'Something went wrong. Please try again, or contact Admin if it continues.', code: 'SYS' };
  }
}

function publicApi_() {
  return {
    getPublicInfo: () => ({
      company: S_('COMPANY_NAME'), employeeOtp: S_('EMPLOYEE_LOGIN_MODE') === 'EMAIL_OTP', active: SB_('SYSTEM_ACTIVE')
    }),
    employeeLogin: employeeLogin_,
    employeeVerifyOtp: employeeVerifyOtp_,
    adminLogin: adminLogin_,
    adminForgotStart: adminForgotStart_,
    adminForgotComplete: adminForgotComplete_
  };
}

function employeeApi_() {
  return {
    home: empHome_, applications: empApplications_, holidays: empHolidays_, preview: empPreview_,
    submit: empSubmit_, cancel: empCancel_, logout: sessionLogout_, ackPolicy: empAckPolicy_, myLeaves: empMyLeaves_
  };
}

function adminApi_() {
  return {
    logout: sessionLogout_, changePassword: adminChangePassword_, me: adminMe_,
    dashboard: adminDashboard_, listApplications: adminListApplications_, getApplication: adminGetApplication_,
    getDocument: adminGetDocument_, approve: adminApprove_, reject: adminReject_, cancelApproved: adminCancelApproved_,
    manualLeave: adminManualLeave_, updateLeave: adminUpdateLeave_,
    listEmployees: adminListEmployees_, saveEmployee: adminSaveEmployee_, deleteEmployee: adminDeleteEmployee_,
    binList: adminBinList_, binRestore: adminBinRestore_, binPurgeNow: adminBinPurgeNow_, binPurgeOne: adminBinPurgeOne_,
    balanceSummary: adminBalanceSummary_, ledger: adminLedger_, adjustBalance: adminAdjustBalance_,
    listUnauthorized: adminListUnauthorized_, suggestPenalty: adminSuggestPenalty_, saveUnauthorized: adminSaveUnauthorized_,
    bonusList: adminBonusList_, bonusCompute: adminBonusCompute_, bonusSave: adminBonusSave_,
    bonusRules: adminBonusRules_, bonusRuleSave: adminBonusRuleSave_, bonusRuleUse: adminBonusRuleUse_, bonusRuleDelete: adminBonusRuleDelete_,
    listHolidays: adminListHolidays_, saveHoliday: adminSaveHoliday_,
    getSettings: adminGetSettings_, saveSettings: adminSaveSettings_,
    listAdmins: adminListAdmins_, saveAdmin: adminSaveAdmin_, deleteAdmin: adminDeleteAdmin_,
    listLog: adminListLog_, runMaintenance: adminRunMaintenance_, sendReminderNow: adminSendReminderNow_
  };
}

function clientConfig_() {
  return {
    company: S_('COMPANY_NAME'),
    clNotice: SN_('CL_NOTICE_HOURS'), otherNotice: SN_('OTHER_NOTICE_HOURS'), slNotice: SN_('SL_NOTICE_HOURS'),
    medThreshold: SN_('MEDICAL_PROOF_THRESHOLD_DAYS'), maxUploadMb: SN_('MAX_UPLOAD_MB'),
    durationMode: S_('DURATION_MODE'), otherTreatment: S_('OTHER_LEAVE_TREATMENT'),
    weeklyOffText: weeklyOffText_(),
    penaltyPolicy: S_('PEN_POLICY_TEXT'), holidayAllowance: SN_('PUBLIC_HOLIDAY_ALLOWANCE'),
    holidayTreatment: S_('PUBLIC_HOLIDAY_TREATMENT')
  };
}

/* ------------------------------------------------------------------ */
/*  SETUP  (owner runs ONCE from the Apps Script editor or sheet menu) */
/* ------------------------------------------------------------------ */
function assertOwnerRun_() {
  let a = '', e = '';
  try { a = Session.getActiveUser().getEmail(); e = Session.getEffectiveUser().getEmail(); } catch (x) { /* ignore */ }
  if (!a || !e || a.toLowerCase() !== e.toLowerCase()) throw new Error('Only the spreadsheet owner can run this function.');
}

const APP_VERSION_ = 'Attahar Web-Portal Leave Management v1.0';

function setupSystem() {
  assertOwnerRun_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());
  _SS = ss;
  ss.setSpreadsheetTimeZone('Asia/Kolkata');
  initializeSheets_(ss);
  seedSettings_();
  seedPrimaryAdmin_();
  docFolderId_();
  pepper_();
  createTriggers_();
  protectSheets_();
  log_({ email: Session.getEffectiveUser().getEmail(), role: 'OWNER' }, 'SETUP_COMPLETED', 'SYSTEM', '', '', APP_VERSION_, 'Setup run');
  let msg = 'Setup complete. Next: deploy as a Web App (Execute as: Me, Who has access: Anyone) and ask the Owner to use "Forgot password" on the login page to create the first password.';
  if (Session.getScriptTimeZone() !== 'Asia/Kolkata') {
    msg += '\n\nWARNING: Project time zone is "' + Session.getScriptTimeZone() + '". Set it to Asia/Kolkata (Project Settings) so dates are exact.';
  }
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
  return msg;
}

function initializeSheets_(ss) {
  SHEET_ORDER.forEach((k, i) => {
    let sh = ss.getSheetByName(SH[k]);
    if (!sh) sh = ss.insertSheet(SH[k], i);
    const n = COLS[k].length;
    sh.getRange(1, 1, 1, n).setValues([COLS[k]])
      .setBackground('#0f3d5e').setFontColor('#ffffff').setFontWeight('bold').setWrap(true).setVerticalAlignment('middle');
    sh.setFrozenRows(1);
    sh.setRowHeight(1, 34);
    const rows = Math.max(sh.getMaxRows() - 1, 1);
    (DATE_COLS[k] || []).forEach(c => sh.getRange(2, COLS[k].indexOf(c) + 1, rows, 1).setNumberFormat('dd/mm/yyyy'));
    (DATETIME_COLS[k] || []).forEach(c => sh.getRange(2, COLS[k].indexOf(c) + 1, rows, 1).setNumberFormat('dd/mm/yyyy hh:mm'));
    (TEXT_COLS[k] || []).forEach(c => sh.getRange(2, COLS[k].indexOf(c) + 1, rows, 1).setNumberFormat('@'));
    sh.setColumnWidths(1, n, 135);
  });
  const def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);

  const listRule = vals => SpreadsheetApp.newDataValidation().requireValueInList(vals, true).setAllowInvalid(false).build();
  const setList = (key, col, vals) => sh_(key).getRange(2, COLS[key].indexOf(col) + 1, Math.max(sh_(key).getMaxRows() - 1, 1), 1).setDataValidation(listRule(vals));
  setList('EMP', 'Status', ['Active', 'Inactive', 'Deleted']);
  setList('APP', 'Status', ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
  setList('APP', 'Leave Type', ['CL', 'SL', 'OTHER']);
  setList('BON', 'Status', ['Pending', 'Processed', 'Paid']);
  setList('HOL', 'Status', ['Active', 'Inactive']);
  setList('ADM', 'Status', ['Active', 'Inactive']);
  setList('ADM', 'Role', ['OWNER', 'ADMIN']);
  sh_('SET').setColumnWidth(3, 260);
  sh_('SET').setColumnWidth(4, 520);
  sh_('LOG').setColumnWidth(8, 260);
  sh_('LOG').setColumnWidth(9, 260);
  sh_('LOG').setColumnWidth(10, 320);
}

function seedSettings_() {
  const sh = sh_('SET');
  const have = {};
  if (sh.getLastRow() > 1) sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues().forEach(r => { have[String(r[0])] = 1; });
  const add = defaultSettings_().filter(d => !have[d[1]]).map(d => ({ 'Group': d[0], 'Key': d[1], 'Value': d[2], 'Description': d[4] }));
  appendMany_('SET', add);
  resetSettingsCache_();
}

function seedPrimaryAdmin_() {
  const email = OWNER_EMAIL_;
  if (readAll_('ADM').some(a => normEmail_(a['Email']) === email)) return;
  const now = new Date();
  appendObj_('ADM', {
    'Admin ID': 'ADM-' + pad_(nextSeq_('ADM'), 3), 'Admin Name': 'Owner', 'Email': email, 'Phone': '',
    'Role': 'OWNER', 'Status': 'Active', 'Created At': now, 'Updated At': now
  });
}

function docFolderId_() {
  const p = PropertiesService.getScriptProperties();
  let id = p.getProperty('DOC_FOLDER_ID');
  if (id) { try { DriveApp.getFolderById(id); return id; } catch (e) { /* recreate */ } }
  const it = DriveApp.getFoldersByName('Attahar Leave Documents');
  const f = it.hasNext() ? it.next() : DriveApp.createFolder('Attahar Leave Documents');
  id = f.getId();
  p.setProperty('DOC_FOLDER_ID', id);
  return id;
}

function protectSheets_() {
  const ss = ss_();
  const me = Session.getEffectiveUser();
  Object.keys(SH).forEach(k => {
    const sh = ss.getSheetByName(SH[k]);
    if (!sh) return;
    sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove());
    const p = sh.protect().setDescription('System managed. Use the Leave Management web app.');
    p.addEditor(me);
    p.removeEditors(p.getEditors().filter(u => u.getEmail() !== me.getEmail()));
    if (p.canDomainEdit()) p.setDomainEdit(false);
  });
}

function createTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t => {
    const f = t.getHandlerFunction();
    if (f === 'triggerDailyMaintenance' || f === 'triggerDailyReminder') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('triggerDailyMaintenance').timeBased().everyDays(1).atHour(1).nearMinute(10).create();
  if (SB_('DAILY_REMINDER_ENABLED')) {
    let h = Math.round(SN_('DAILY_REMINDER_HOUR'));
    if (h < 0 || h > 23) h = 9;
    ScriptApp.newTrigger('triggerDailyReminder').timeBased().everyDays(1).atHour(h).nearMinute(0).create();
  }
}

/* ------------------------------------------------------------------ */
/*  TRIGGER ENTRY POINTS (idempotent, safe to run more than once)      */
/* ------------------------------------------------------------------ */
function triggerDailyMaintenance() {
  try { runMaintenance_('SYSTEM'); }
  catch (e) { log_({ role: 'SYSTEM' }, 'MAINTENANCE_FAILED', 'SYSTEM', '', '', '', String(e), 'ERROR'); }
  try { binPurge_('SYSTEM'); }
  catch (e) { log_({ role: 'SYSTEM' }, 'BIN_PURGE_FAILED', 'SYSTEM', '', '', '', String(e), 'ERROR'); }
}
function triggerDailyReminder() {
  try { sendDailyPendingReminder_(false); }
  catch (e) { log_({ role: 'SYSTEM' }, 'REMINDER_FAILED', 'SYSTEM', '', '', '', String(e), 'ERROR'); }
}

/* ------------------------------------------------------------------ */
/*  SPREADSHEET MENU (owner only)                                      */
/* ------------------------------------------------------------------ */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Leave Management')
      .addItem('1. Initial setup (run once)', 'setupSystem')
      .addItem('Show web app link', 'menuShowUrl')
      .addSeparator()
      .addItem('Run daily maintenance now', 'menuRunMaintenance')
      .addItem('Re-create triggers', 'menuCreateTriggers')
      .addItem('Re-apply sheet protection', 'menuProtect')
      .addSeparator()
      .addItem('Owner recovery: reset an Admin password', 'menuOwnerReset')
      .addToUi();
  } catch (e) { /* ignore */ }
}
function menuShowUrl() {
  assertOwnerRun_();
  let url = '';
  try { url = S_('WEB_APP_URL') || ScriptApp.getService().getUrl() || ''; } catch (e) { /* ignore */ }
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial;padding:8px"><p>Open the web app, sign in as Admin, then use <b>Settings</b> in the left menu to change all settings.</p>' +
    (url ? '<p><a href="' + esc_(url) + '" target="_blank">' + esc_(url) + '</a></p>' : '<p>Deploy the web app first (Deploy > New deployment > Web app).</p>') + '</div>')
    .setWidth(520).setHeight(180);
  SpreadsheetApp.getUi().showModalDialog(html, 'Leave Management web app');
}
function menuRunMaintenance() { assertOwnerRun_(); runMaintenance_('OWNER'); SpreadsheetApp.getUi().alert('Maintenance completed.'); }
function menuCreateTriggers() { assertOwnerRun_(); createTriggers_(); SpreadsheetApp.getUi().alert('Triggers re-created.'); }
function menuProtect() { assertOwnerRun_(); protectSheets_(); SpreadsheetApp.getUi().alert('Sheets protected.'); }
function menuOwnerReset() {
  assertOwnerRun_();
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Owner recovery', 'Enter the Admin email or phone whose password must be reset.\n(If their registered email changed, edit it in the ADMINS sheet first.)', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const admin = findAdminByIdent_(r.getResponseText());
  if (!admin) { ui.alert('No Admin found for that email/phone.'); return; }
  clearCred_(admin['Admin ID']);
  bumpSessionVersion_(admin['Admin ID']);
  log_({ email: Session.getEffectiveUser().getEmail(), role: 'OWNER' }, 'OWNER_RESET_ADMIN_CREDENTIALS', 'SECURITY', admin['Admin ID'], '', '', 'Password cleared by owner', 'SUCCESS');
  ui.alert('Password cleared and all sessions ended. The Admin must now use "Forgot password" on the login page to set a new password (code goes to ' + admin['Email'] + ').');
}
function weeklyOffText_() {
  if (S_('DURATION_MODE') !== 'WORKING') return '';
  const N = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const d = String(S_('WEEKLY_OFF_DAYS')).split(',').map(x => x.trim()).filter(x => x !== '').map(Number).filter(n => n >= 0 && n <= 6);
  return d.length ? d.map(n => N[n]).join(' and ') : '';
}
