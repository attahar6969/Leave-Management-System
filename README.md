# Attahar Web-Portal: Leave Management

A leave management web app built entirely on Google Apps Script and Google Sheets. Employees apply for leave, admins approve it, and every balance is calculated from an append-only ledger. No server or database is needed.

## Features

**Employees**
- Sign in with the registered email or 10-digit mobile number (optional email code for extra security)
- Apply for Casual Leave (CL), Sick Leave (SL) or Other Leave, for a single day or multiple days
- Live check of duration, notice period and balance before submitting
- Medical certificate upload (PDF, JPG, PNG) for longer sick leave
- Month-by-month CL and SL balance cards, application history, public holidays
- Leave policy popup that must be accepted at every sign-in
- View their own unauthorized leave and penalty record

**Admins**
- Dashboard with status counts, charts, pending applications and a live "On leave today" ticker
- Approve, reject, edit or cancel applications; cancelling reverses the balance through ledger entries
- Manual leave entry with notice and balance overrides (reason mandatory)
- Employee directory with per-employee leave types, Bin and restore (Owner only)
- Balances and ledger, with manual balance adjustments and printing
- Unauthorized leave register with policy-based penalty suggestions
- Diwali bonus eligibility and payment tracking with configurable bonus rules
- Public holidays, administrators, system log and all company rules in Settings

## Roles

| Role | Can do |
|------|--------|
| Employee | Apply, cancel pending leave, view own balances and records |
| Admin | Everything above for admins, except the Owner-only items below |
| Owner | Also: delete and restore employees, manage administrators, Admin Access and Employees settings, Diwali bonus rules (and bonus visibility if restricted) |

## Leave rules (all configurable in Settings)

- CL: 1 day credited per month, up to 12 a year. Unused CL lapses at month end.
- SL: 1 day credited per month, up to 12 a year. Unused SL carries forward and expires at year end.
- Other Leave: no balance limit, treated as paid or unpaid for payroll information.
- Notice: 24 hours for CL and Other Leave by default. Optional stricter rule (2 days for short leave, 7 days for 3 or more days), off by default.
- Sick leave longer than 2 days needs a medical certificate.
- Leave cannot span two calendar years.
- Duration mode: CALENDAR (every date counts) or WORKING (skips weekly off days, and holidays if enabled).
- Weekly off: set Duration Mode to WORKING, then Weekly Off Days to day numbers (0 = Sunday ... 6 = Saturday), for example `0` or `6,0`.
- Unauthorized leave penalties (1st, 2nd, 3rd occurrence) are recorded for information. The system never deducts salary automatically.

## Files

| File | Purpose |
|------|---------|
| `Code.gs` | Entry points, settings, sheet helpers, logging, API gateway, setup, triggers, spreadsheet menu |
| `Auth.gs` | Password hashing, sessions, rate limiting, security codes, login, forgot and change password |
| `Leave.gs` | Leave validation, ledger and balances, emails, employee API, monthly maintenance |
| `Admin.gs` | Admin API: dashboard, applications, employees, balances, unauthorized leave, holidays, settings, administrators, log |
| `Bin.gs` | Employee delete, restore and permanent purge (Owner only) |
| `BonusRules.gs` | Diwali bonus rules and calculation |
| `Logo.gs` | Optional logo for the login page (base64 data URI) |
| `Index.html` | The whole front end: login, employee portal, admin portal |

`Migrate.gs` is not part of a fresh install. Delete it if present.

## Google Sheets created by setup

EMPLOYEE MASTER, LEAVE APPLICATIONS, LEAVE LEDGER, DIWALI BONUS, UNAUTHORIZED LEAVE, PUBLIC HOLIDAYS, ADMINS, SETTINGS, SYSTEM LOG. All sheets are protected. Change data through the web app, not by editing cells.

## Setup

1. Create a new Google Sheet, then open **Extensions > Apps Script**.
2. Add each `.gs` file and `Index.html` with the exact names above, and paste the code.
3. In `Code.gs`, set `OWNER_EMAIL_` to the owner's email address.
4. In **Project Settings**, set the time zone to `Asia/Kolkata`.
5. Select `setupSystem` in the toolbar and click **Run**. Approve the permissions. This creates the sheets, settings, owner admin, document folder, triggers and sheet protection.
6. Click **Deploy > New deployment > Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Copy the `/exec` link.
7. Open the link, choose the Admin tab, click **Forgot password? / First-time sign in**, enter the owner email, and set the first password using the emailed code.
8. In **Settings**, review the company rules. Add employees in **Employees**.

## Updating

After any code change, save and redeploy: **Deploy > Manage deployments > Edit > Version: New version > Deploy**. The `/exec` link keeps serving the last deployed version until you do.

## Automatic jobs

Two time-based triggers are created by setup:
- `triggerDailyMaintenance` (about 1 AM): monthly credit, month-end CL lapse, year-end SL expiry, Bin purge of expired employees
- `triggerDailyReminder` (default 9 AM): emails the admin a list of pending applications

Admins can run maintenance on demand from **Settings > Run daily maintenance now**. If triggers go missing, use the sheet menu **Leave Management > Re-create triggers**.

## Security model

- The browser can call only `doGet`, `apiPublic`, `apiEmployee` and `apiAdmin`. Every other function name ends with `_` and is not callable from the browser.
- Every employee and admin call checks a server-side session token.
- Admin passwords use a random salt, a secret pepper in Script Properties, and 1200 rounds of HMAC-SHA256. Plain passwords are never stored or logged.
- Sessions live in CacheService with sliding expiry. Changing a password ends all sessions.
- Login attempts are rate limited and temporarily locked after repeated failures.
- Admin password reset sends a 6-digit code to the registered email.
- Medical certificates are stored in a private Drive folder and checked for real file type and size.
- Every important action is written to the SYSTEM LOG. Leave records are never deleted; corrections use reversal entries.

## Ledger model

All balances come from the LEAVE LEDGER. Transaction types: CREDIT, USE, REVERSAL, LAPSE, EXPIRY, ADJUST.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `X_ is not defined` | A file is missing from the project, or the project was not redeployed after adding it |
| "Sorry, unable to open the file" on the `/exec` link | Wrong Google account, old link, or no deployment. Copy the link from Manage deployments |
| No security code email | Check Spam, then SYSTEM LOG for `ADMIN_RESET_CODE_SENT` or `EMAIL_FAILED`. Re-authorize the script if Google asks |
| Delete and Bin buttons missing | Only the Owner sees them. Sign in with the Owner account |
| CL lapse not showing after an adjustment | Run **Settings > Run daily maintenance now** |
| Dashboard CL Lapsed shows "Set cutoff" | Set **Settings > Diwali Bonus > Bonus Cutoff Date** |
| Weekly off not applied | Set Duration Mode to WORKING and save Weekly Off Days |

## Notes

- Do not edit the protected sheets by hand.
- Do not share the `/exec` link publicly if the data is real. Anyone with the link can reach the login page.
- If you show demo credentials on the login page for a pitch, remove them before real use.
