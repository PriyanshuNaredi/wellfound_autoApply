# Wellfound Auto Apply

A Playwright-based automation runner for applying to software engineering roles on [Wellfound](https://wellfound.com).

This is a significantly modified fork of the original project, focused on a more reliable Wellfound-only workflow for entry-level software engineering applications.

> **Use responsibly.** Automation may violate Wellfound's terms, trigger anti-bot systems, or result in account restrictions. Use dry-run mode first and review application behavior.

## Features

- Wellfound-only runner through `auto-apply-runner.js`
- Entry-level filtering for Software Engineer, SDE, Backend, Frontend, Full Stack, AI/ML, Python, Application, Platform, and Web roles
- Blocks clearly senior roles such as Senior, Staff, Principal, Lead, Manager, Director, Architect, and Intern
- Rejects explicit experience requirements above the configured target
- Location-agnostic job discovery while respecting Wellfound's own application eligibility checks
- Two-stage Wellfound application flow
- React-controlled field filling
- Native and custom radio-control handling
- Built-in application-question answer bank
- Optional Gemini assistance for unmatched application questions
- Manual skip: press `s` + Enter while a problematic job is active
- Confirmation-based application counting
- CSV logging of successful submissions
- Daily application cap
- Persistent Chrome profile for the Wellfound session

## Files

```text
auto-apply-runner.js
wellfound-auto-apply.js
config.js
gemini-coverletter.js
package.json
package-lock.json
.env.example
.gitignore
README.md
```

Runtime/private files should not be committed:

```text
.env
node_modules/
.wellfound-chrome-profile/
applications.csv
apply-state-wellfound.json
blocked-step-*.png
backup-*
```

## Requirements

- Node.js 20+
- Google Chrome
- Wellfound account
- Gemini API key only if Gemini-assisted answers are desired

## Install

```powershell
git clone https://github.com/<your-username>/wellfound_autoApply.git
cd wellfound_autoApply
npm install
Copy-Item .env.example .env
```

Edit `.env` with your own data.

## Configuration

Example:

```env
NAME=Your Name
EMAIL=you@example.com
PHONE=+1 555 555 5555
LOCATION=City, State, Country

CURRENT_ROLE=Software Engineer
COMPANY=Your Company
EDUCATION=MS Computer Science, Your University
YEARS_EXPERIENCE=2+ years

SKILLS=Python, TypeScript, JavaScript, React, Next.js, FastAPI, Flask, Node.js
HIGHLIGHTS=Achievement one||Achievement two||Achievement three

NOTICE_PERIOD=Immediately
CURRENT_CTC=0
EXPECTED_CTC=150000
DOB=
GENDER=Prefer not to say

WORK_AUTH=Authorized to work in the United States under F-1 OPT.

GITHUB_URL=https://github.com/yourusername
LINKEDIN_URL=https://www.linkedin.com/in/yourusername/
PORTFOLIO_URL=https://yourportfolio.com/

GEMINI_KEY=
```

Never commit `.env`.

## Login

```powershell
node auto-apply-runner.js wellfound login
```

Log in manually, then close Chrome. The session is saved in:

```text
.wellfound-chrome-profile/
```

## Dry run

Always test first:

```powershell
node auto-apply-runner.js wellfound
```

Dry-run mode fills the application but does not submit it.

## Live mode

```powershell
node auto-apply-runner.js wellfound --live
```

An application is counted only after the runner receives Wellfound's submission confirmation.

## Manual skip

When a job is wrong, stuck, or requires manual review:

```text
s
Enter
```

The current job is skipped and is not counted as submitted.

## Filtering

Allowed title families include:

```text
Software Engineer
Software Developer
Software Development Engineer
SDE
Backend Engineer
Backend Developer
Full Stack Engineer
Frontend Engineer
Python Engineer
Machine Learning Engineer
ML Engineer
AI Engineer
Application Engineer
Platform Engineer
Web Engineer
```

The blocklist includes:

```text
Senior
Staff
Principal
Lead
Manager
Director
Architect
Intern
iOS
Android
.NET
Ruby
PHP
```

Explicit experience requirements such as `4+ years`, `5+ years`, `10+ years`, and senior/staff/principal-level requirements are rejected.

## Gemini

Gemini is optional. The current Wellfound script can use Gemini for application questions that are not matched by the built-in answer bank.

Set:

```env
GEMINI_KEY=your-key
```

Keep the key in `.env`, never in committed source.

## Logging

Successful applications are appended to:

```text
applications.csv
```

The CSV includes the date, site, role, company, salary, skills, job link, and a short job-description field.

Treat this file as private because it can contain personal/application information.

## Troubleshooting

### 0 matching jobs

Review `TITLE_KEYWORDS`, `TITLE_BLOCKLIST`, and `EXPERIENCE_BLOCKLIST` in `wellfound-auto-apply.js`.

### Application panel does not appear

Run dry mode first. Wellfound changes its frontend frequently. Use `s` + Enter to skip a problematic job.

### Location/timezone blocked

The script should skip the application rather than count it as submitted.

### Chrome appears stuck

Use:

```text
s
Enter
```

Then check the console. Only a Wellfound confirmation should increment the submitted count.

## Development checks

Run:

```powershell
npm run check
```

or:

```powershell
node --check auto-apply-runner.js
node --check wellfound-auto-apply.js
node --check config.js
```

## Keeping the fork connected to the original repository

```bash
git remote add upstream https://github.com/ankitbaghel01/wellfound_autoApply.git
git fetch upstream
git merge upstream/main
```

Push your changes to your fork:

```bash
git push origin main
```

## Acknowledgments

Original repository:

https://github.com/ankitbaghel01/wellfound_autoApply

This fork contains substantial changes to filtering, the browser runner, Wellfound application handling, question answering, logging, and manual controls.
