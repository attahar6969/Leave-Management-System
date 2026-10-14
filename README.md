# Leave Management System

A mobile-friendly Leave Management System built with **Google Apps Script, JavaScript, HTML, CSS, and Google Sheets**. The application digitizes employee leave applications, approval workflows, leave balance accounting, policy enforcement, employee administration, and HR reporting through a centralized web portal.

The system is designed to reduce manual paperwork and repetitive administrative tasks using configurable leave policies, automated email notifications, scheduled leave-balance maintenance, and centralized records.

## Overview

The application provides two separate experiences:

- **Employee Portal:** Employees can sign in, view leave balances, submit leave requests, track application status, review public holidays, and cancel pending applications.
- **Admin Portal:** Authorized administrators can review and process leave requests, manage employees, maintain leave balances, configure policies, track unauthorized leave, calculate Diwali Bonus eligibility, and monitor system activity.

Google Apps Script provides the backend, Google Sheets stores the operational records, Google Drive stores medical documents, and time-driven triggers handle scheduled background tasks.

## Features

### 1. Employee Portal

- Mobile-friendly login interface.
- Employee identification using registered email address or mobile number.
- Optional email OTP verification mode.
- Personal dashboard showing Casual Leave and Sick Leave balances.
- Summary of pending, approved, and rejected applications.
- Single-day and multi-day leave applications.
- Leave duration preview and policy validation before submission.
- Mandatory leave reason and declaration confirmation.
- Medical certificate upload for qualifying Sick Leave applications.
- Application history with status and Admin remarks.
- Cancellation of pending applications.
- Public holiday calendar and configured holiday policy information.

Employee records must be registered and active in the Employee Master before employees can access the portal.

### 2. Admin Dashboard

The Admin Dashboard provides a centralized overview of leave operations, including:

- Active employee count.
- Total leave applications.
- Pending, approved, rejected, and cancelled application counts.
- Casual Leave and Sick Leave usage summaries.
- Employees currently on approved leave.
- Monthly leave distribution.
- Employee-wise approved leave summaries.
- Recent applications and pending requests.
- Unauthorized leave incident counts.
- Diwali Bonus eligibility summaries when the cutoff date is configured.

Dashboard filters support relevant reporting by year, employee, leave type, status, and date range.

### 3. Leave Application and Approval Workflow

The application follows a controlled approval process:

1. An employee signs in and selects a leave type and date range.
2. The system validates the request against configured policies.
3. The employee reviews the calculated duration and relevant balance information.
4. The employee submits the application, which receives a unique Application ID.
5. The application is saved with a `PENDING` status.
6. The configured Admin email recipients are notified of the new application.
7. An administrator reviews the request and approves or rejects it.
8. Approval deducts the applicable leave balance through a ledger transaction.
9. Rejection requires Admin remarks.
10. The employee can receive an email containing the decision and Admin remarks.

Employees can cancel their own pending applications. Approved leave is cancelled through the Admin workflow, which records a ledger reversal rather than simply deleting the original transaction.

### 4. Leave Policy Validation

The backend validates leave requests before accepting them. Supported checks include:

- Valid leave type and date range.
- Single-day and multi-day duration calculations.
- Maximum supported leave-period validation.
- Prevention of applications spanning two calendar years.
- Mandatory reason validation.
- Overlapping pending or approved leave detection.
- Leave balance availability.
- Advance notice requirements.
- Past-date restrictions for employee applications.
- Required medical documentation for qualifying Sick Leave.
- Duplicate submission protection.
- Optional administrative overrides with mandatory justification.

The same central validation logic is used by the employee application flow and the relevant Admin workflows, with additional permissions for authorized administrative overrides.

### 5. Leave Balance and Ledger Accounting

The application uses a **transaction-based Leave Ledger** as the source of truth for leave balances.

Instead of relying only on manually edited balance cells, it records individual transactions.

| Transaction type | Purpose |
|---|---|
| `CREDIT` | Adds the monthly leave entitlement |
| `USE` | Deducts leave after approval |
| `LAPSE` | Records unused leave that expires at month-end under the applicable policy |
| `EXPIRY` | Records leave that expires at year-end |
| `REVERSAL` | Restores leave when previously approved leave is cancelled |
| `ADJUST` | Records authorized manual balance corrections |

Features include:

- Employee-wise leave balance calculations.
- Monthly and annual leave summaries.
- Opening and closing balance tracking in ledger transactions.
- Credit, usage, lapse, expiry, and adjustment reporting.
- Leave balance adjustments with a mandatory reason.
- Optional Admin approval beyond the available balance when the override policy permits it.
- Ledger-based balance refresh for the Employee Master.
- Transaction references linking leave usage to its original application.

This approach preserves transaction history and makes balance changes easier to audit.

### 6. Configurable Leave Rules

The application includes settings for:

- Monthly Casual Leave and Sick Leave credits.
- Annual maximum credits for each leave type.
- Casual Leave carry-forward behavior.
- Sick Leave carry-forward behavior within the calendar year.
- Medical certificate requirements.
- Maximum medical-document upload size.
- Calendar-day or working-day duration calculation.
- Weekly-off days and optional public holiday exclusions.
- Advance notice periods for different leave types.
- Optional additional notice requirements for shorter and longer leave.
- Past-date restrictions for employee Sick Leave applications.
- Administrative notice-period overrides.
- Administrative negative-balance overrides.
- Treatment of Other Leave for payroll information.
- Public holiday allowance and policy notes.

Many rules can be changed through the Admin Portal's Settings page without editing the application code.

### 7. Medical Document Management

- Supports PDF, JPG, JPEG, and PNG medical documents.
- Checks file type and basic file-content consistency.
- Enforces a configurable upload limit, capped at 10 MB by the current settings validation.
- Stores uploaded documents in a dedicated Google Drive folder.
- Stores the Drive file reference against the leave application.
- Allows authorized Admin workflows to retrieve attached medical documents.
- Records document-viewing activity in the system log.

The default Sick Leave medical-proof threshold is more than two days. If the certificate is missing, the application or approval process requires the applicable override and a reason where permitted.

### 8. Automated Email Notifications

The application supports email notifications through Google Apps Script.

**Immediate Admin notification**
- Sends an email when an employee submits a new leave application, if enabled.
- Includes the application ID, employee details, leave type, dates, duration, and reason.
- Provides a link to the Leave Portal when the URL is available.
- Records notification status for the application.

**Employee decision notification**
- Notifies the employee when a request is approved or rejected, if enabled.
- Includes the decision, dates, duration, and Admin remarks.
- Avoids sending a duplicate notification for the same recorded decision.

**Daily pending-application reminder**
- Sends a summary of pending applications to configured Admin recipients.
- Can run automatically at the configured daily reminder hour.
- Can also be triggered manually from the Admin Settings page.
- Avoids repeating a successful scheduled reminder more than once on the same date.

**Security emails**
- Sends OTPs for Admin password recovery.
- Sends confirmation emails after an Admin password reset or change.

Email delivery depends on valid recipient addresses, Apps Script authorization, service quotas, and successful execution.

### 9. Automated Leave Maintenance

A daily time-driven trigger runs leave-ledger maintenance. It handles:

- Monthly Casual Leave and Sick Leave crediting.
- Annual maximum credit limits.
- Month-end lapse of leave configured as month-scoped.
- Year-end expiry of unused year-scoped leave.
- Employee balance refresh.
- Maintenance execution logging.

The maintenance process is designed to be idempotent: running it again should not create a second monthly credit for the same employee, leave type, year, and month when the corresponding credit already exists.

The setup process creates the daily maintenance trigger and, when enabled, the daily pending-reminder trigger. Administrators can also run maintenance manually from the portal or spreadsheet menu.

### 10. Diwali Bonus Management

The application includes a dedicated Diwali Bonus module linked to unused Casual Leave.

- Uses an Admin-configured bonus year and Diwali cutoff date.
- Calculates the Casual Leave that actually lapsed on or before the cutoff.
- Excludes used Casual Leave from eligibility.
- Excludes Casual Leave that had not yet lapsed by the cutoff.
- Supports manual bonus amount entry.
- Supports an optional per-eligible-leave calculation mode.
- Tracks bonus amount, payment date, processing status, and remarks.
- Supports `Pending`, `Processed`, and `Paid` statuses.
- Protects processed and paid records from being overwritten by eligibility recalculation.

The bonus calculation identifies eligible leave; it does not itself make a payment or guarantee a particular bonus amount. The company must configure and approve its actual bonus formula.

### 11. Employee Management

Authorized administrators can:

- Add employees.
- Edit employee details.
- Update registered email and mobile number.
- Maintain department and designation.
- Record joining dates.
- Activate or deactivate employee accounts.
- Review leave balances in the employee list.

Only active, registered employees can use the employee portal.

### 12. Manual Leave Entry and Corrections

Administrators can enter leave on behalf of an employee and update existing leave records through dedicated workflows.

The application supports:

- Manual leave entry by an administrator.
- Corrections to leave records with a mandatory justification.
- Revalidation against leave policies.
- Leave balance recalculation.
- Ledger transactions and reversals where required.
- Audit records for supported administrative changes.

These features allow Admin to handle exceptional cases without asking an employee to submit a new request for every correction.

### 13. Unauthorized Leave Register

The system provides a separate register for recording unauthorized leave incidents.

- Records the employee and incident date.
- Tracks the date range and duration.
- Maintains the occurrence number.
- Suggests salary-deduction days and an additional penalty based on configured policy.
- Records Admin remarks and action taken.
- Supports corrections with a mandatory reason.
- Maintains an audit trail of incident changes.

The configured policy can suggest different penalties for the first, second, and third recorded occurrences. **The system records and suggests these actions; it does not automatically deduct salary, impose a penalty, or terminate an employee.** Final decisions remain with the authorized administrator and company policy.

### 14. Public Holiday Management

Administrators can:

- Add public holidays.
- Update holiday names and notes.
- Activate or deactivate holidays.
- Review holidays by year.
- View the configured annual public holiday allowance.

Holiday exclusion from leave duration is configurable. In working-day mode, active holidays are excluded only when the corresponding exclusion setting is enabled.

### 15. Administrator Management

The application distinguishes between `OWNER` and `ADMIN` roles.

The Owner can:

- Add administrators.
- Edit administrator details.
- Activate or deactivate administrator accounts.
- Assign Owner or Admin roles.
- Manage Admin Access settings.
- Use owner-level recovery to clear an administrator's stored credentials and invalidate their sessions.

The application prevents an Owner from deactivating their own account through the normal Admin-management workflow and enforces that at least one active Owner remains.

### 16. System Settings

The Admin Portal provides a centralized Settings page for configurable values, grouped into areas such as:

- General.
- Admin Access.
- Leave Policy.
- Notice Rules.
- Diwali Bonus.
- Notifications.
- Penalty policy.

Examples include the company name, system active status, login session durations, login-attempt limits, OTP validity, leave credits, notice periods, reminder settings, bonus cutoff date, and bonus calculation mode.

Settings are validated before saving. Changes are logged, and changing the daily reminder configuration refreshes the relevant scheduled trigger.

### 17. Authentication and Security Controls

The code implements several server-side controls:

- Separate Employee and Admin authentication flows.
- Server-side session tokens validated on protected API calls.
- Configurable session duration.
- Password hashing using a unique random salt, a secret pepper stored in Script Properties, and repeated HMAC-SHA256 operations.
- No plaintext Admin password storage.
- Admin password reset through an email security code.
- Optional email OTP verification for employees.
- Login throttling and temporary lockouts after repeated failures.
- OTP expiration and attempt limits.
- Session invalidation following Admin password changes.
- Validation and authorization in the backend instead of relying only on the browser interface.
- A script lock around important operations to reduce concurrent-write conflicts.
- Sheet protection configured during setup.

**Employee login security note:** The default employee login mode is `IDENTIFIER`, which checks the registered email address or mobile number but does not prove that the person controls that address or number. The optional `EMAIL_OTP` mode adds verification through the registered email address.

The password implementation uses a custom repeated HMAC-SHA256 construction rather than a standard password-hashing library such as bcrypt or PBKDF2. It should not be represented as a formal security certification.

### 18. System Audit Log

The System Log records supported actions and operational events, including:

- Successful and failed logins.
- Password recovery and password changes.
- Leave application submissions and decisions.
- Leave ledger changes.
- Employee and administrator updates.
- Settings changes.
- Diwali Bonus operations.
- Unauthorized leave records and corrections.
- Notification and scheduled maintenance failures.

Administrators can search log entries by text and module. The portal displays the latest 300 matching entries, and the application exposes no ordinary Admin interface for editing or deleting these log records.

### 19. Responsive User Interface

The `Index.html` interface provides:

- Separate Employee and Admin navigation.
- Responsive dashboards, forms, tables, and status badges.
- Mobile navigation and touch-friendly controls.
- Loading indicators and success/error messages.
- Confirmation dialogs for important actions.
- Searchable and filterable administrative records.
- A consistent layout for desktop and mobile screens.

The interface is designed to let administrators manage routine leave operations without needing to edit spreadsheet cells directly.

## How Automation Works

| Automation | Trigger | Result |
|---|---|---|
| Leave maintenance | Daily time-driven trigger, scheduled around 1 AM India time | Credits monthly entitlements, processes applicable lapse/expiry entries, and refreshes balances |
| Pending leave reminder | Daily time-driven trigger at the configured hour | Emails Admin a summary of pending applications when reminders are enabled |
| New application alert | Runs after a successful employee submission | Emails configured Admin recipients immediately |
| Employee decision email | Runs after an approval or rejection | Notifies the employee when enabled |
| Password recovery | Initiated by an Admin | Sends a time-limited security code to the registered email address |
| Manual maintenance | Admin portal or spreadsheet menu | Runs the same maintenance process on demand |

Time-driven triggers are scheduled by Google and may not run at the exact minute. Email sending and other services remain subject to Google quotas and successful authorization.

## Typical Workflow

### Initial setup

1. Open the Google spreadsheet linked to the Apps Script project.
2. Run `setupSystem()` as the spreadsheet owner.
3. Allow the script to initialize sheets, seed settings, create the primary Admin record, prepare the document folder, protect sheets, and create scheduled triggers.
4. Deploy the project as a Google Apps Script web app.
5. Open the deployed portal and use the Admin password-recovery workflow to establish the initial password for the seeded Admin account.
6. Configure employees, company policies, reminder recipients, and other settings.
7. Test employee login, leave submission, approval, email notifications, and scheduled maintenance before operational use.

### Routine employee workflow

1. Sign in with the registered identifier, or complete email OTP verification if enabled.
2. Review the dashboard and leave balances.
3. Apply for leave and review the calculated duration and validation messages.
4. Upload medical documentation when required.
5. Submit the application and retain the Application ID.
6. Track the application in **My Applications**.
7. Review the Admin's decision and remarks.

### Routine Admin workflow

1. Sign in to the Admin Portal.
2. Review pending applications on the dashboard.
3. Open an application and review its details, balance, and medical document when applicable.
4. Approve or reject the request with the required information.
5. Manage employee records and exceptions.
6. Review balances, the leave ledger, public holidays, and unauthorized leave incidents.
7. Configure settings and review system logs when necessary.

## Technology Stack

| Technology | Purpose |
|---|---|
| Google Apps Script | Backend, APIs, policy logic, scheduled triggers, and integration services |
| JavaScript | Application logic and browser interactions |
| HTML and CSS | Responsive web interface |
| Google Sheets | Application data, settings, ledger, and audit records |
| Google Drive | Medical document storage |
| Google Apps Script `MailApp` | Email notifications and security codes |
| Google Apps Script `CacheService` | Server-side sessions, OTP state, and temporary rate-limiting data |
| Google Apps Script `PropertiesService` | Application configuration, sequence values, and credential-related secrets |

## Project Structure

| File | Responsibility |
|---|---|
| `Code.gs` | Application entry point, APIs, setup, settings, triggers, sheet helpers, and system logs |
| `Auth.gs` | Authentication, password handling, OTP, sessions, rate limiting, and password recovery |
| `Leave.gs` | Leave validation, ledger accounting, balance maintenance, document uploads, notifications, and employee workflows |
| `Admin.gs` | Admin dashboard, approvals, employees, balance corrections, unauthorized leave, bonus, holidays, settings, and Admin management |
| `Index.html` | Employee and Admin user interface, responsive layout, forms, navigation, and browser-side API calls |
| `appsscript.json` | Apps Script project manifest, runtime, time zone, deployment options, and required permissions |

## Google Sheets Data Structure

The application initializes the following sheets:

| Sheet | Purpose |
|---|---|
| `EMPLOYEE MASTER` | Employee information and displayed leave balances |
| `LEAVE APPLICATIONS` | Applications, statuses, review information, and notification flags |
| `LEAVE LEDGER` | Leave credits, usage, lapse, expiry, reversals, and adjustments |
| `DIWALI BONUS` | Eligible leave, bonus amount, payment date, and processing status |
| `UNAUTHORIZED LEAVE` | Incident history, suggested penalties, and Admin actions |
| `PUBLIC HOLIDAYS` | Holiday dates, names, statuses, and notes |
| `ADMINS` | Administrator identities, roles, and account status |
| `SETTINGS` | Configurable company and leave-policy values |
| `SYSTEM LOG` | Security, application, administrative, and automation events |

Google Sheets serves as the backend data store. The web interface communicates with the server-side APIs rather than directly editing sheet cells.

## Configuration and Leave Policy Defaults

The initial settings include:

- Time zone: `Asia/Kolkata`.
- Date display: `DD/MM/YYYY`.
- Leave year: January through December.
- Monthly Casual Leave credit: 1 day, subject to the annual maximum.
- Monthly Sick Leave credit: 1 day, subject to the annual maximum.
- Annual maximum for CL and SL: 12 days each.
- Casual Leave carry-forward: disabled by default.
- Sick Leave carry-forward: enabled within the calendar year by default; unused year-scoped Sick Leave expires at year-end.
- Medical certificate threshold: Sick Leave longer than 2 days.
- Default leave-duration mode: calendar days.
- Default advance notice: 24 hours for Casual Leave and Other Leave; Sick Leave is exempt by default.
- Short-notice employee applications: blocked by default.
- Daily pending-application reminders: enabled by default.
- Daily reminder hour: 9 AM India time.
- Admin password minimum length: 8 characters by default, with letters and numbers required.
- Employee login: registered email or mobile identifier by default; email OTP is optional.

These are initial defaults from the code, not immutable company rules. Verify and configure them for the intended organization before production use.

## Installation and Deployment

### Prerequisites

- A Google account with access to Google Apps Script.
- A Google spreadsheet for application data.
- Google Drive access for medical document storage.
- Permission to authorize the required Apps Script services.
- The project files listed above.

### Deployment steps

1. Create or open the Apps Script project.
2. Add the backend files and `Index.html` with their correct names.
3. Verify the manifest and required OAuth scopes.
4. Open the linked spreadsheet and run `setupSystem()` once as its owner.
5. Confirm that the nine required sheets and settings have been created.
6. Deploy using **Deploy → New deployment → Web app**.
7. Configure the execution identity and access restrictions according to your organization's requirements.
8. Open the deployed `/exec` URL.
9. Establish the initial Admin password through the provided recovery workflow.
10. Configure the employee list and leave-policy settings.
11. Test the main workflows and inspect Apps Script execution logs before sharing the portal.

Do not run the setup procedure casually on a live deployment without first reviewing its effects. Keep a backup of important data before making structural changes.

## Troubleshooting

| Issue | What to check |
|---|---|
| Employee cannot sign in | Employee registration, active status, exact email/mobile, login mode, and session validity |
| Admin cannot sign in | Registered Admin details, active status, password setup, temporary lockout, and reset-email delivery |
| OTP is not received | Registered email address, email service permissions, spam folder, quotas, and OTP expiry |
| Leave request is blocked | Balance, overlapping dates, notice period, date range, reason, and medical-document requirements |
| Leave balance appears incorrect | `LEAVE LEDGER` transactions, monthly credit, lapse/expiry records, reversals, and maintenance execution |
| Admin reminder is missing | Reminder settings, Admin email recipients, scheduled trigger, and Apps Script execution logs |
| Medical document cannot be opened | Stored Drive file reference and effective Drive permissions |
| Web app fails to load data | Deployment URL, spreadsheet linking, permissions, server execution logs, and API errors |

## Important Operational Notes

- The application uses Google Sheets as its operational data store; this is not a standalone database service.
- Scheduled tasks depend on installed Apps Script triggers and successful execution.
- Cache-based sessions and OTP records may expire or be evicted; a user may need to sign in again.
- Email delivery is not guaranteed and should be monitored through execution logs.
- The unauthorized-leave module records incidents and suggestions; it does not execute payroll deductions or disciplinary decisions automatically.
- Diwali Bonus eligibility is calculated from qualifying lapsed Casual Leave; payment requires an authorized administrative process.
- The security and access behavior of the deployed web app must be tested before using real employee information.
- The project has been reviewed from source code; deployment, security testing, and end-to-end runtime verification should be completed before describing it as production-ready.

## Intended Use

The system is designed for small and medium-sized organizations that want a centralized, configurable process for employee leave applications, HR approvals, leave accounting, employee administration, holiday management, notifications, and policy tracking.

## License

Add a `LICENSE` file if you intend to distribute the project under a specific open-source license. Until a license is selected, do not assume that others have permission to reuse or redistribute the code.

---

**Built with Google Apps Script, JavaScript, HTML, CSS, Google Sheets, and Google Drive.**
