/**
 * Auto-Apply Runner — drives the existing console auto-apply scripts with Playwright,
 * so no more F12 + paste: it injects indeed-auto-apply.js / wellfound-auto-apply.js
 * into the page automatically on every load (that IS the "paste again" step).
 *
 * Usage:
 *   node auto-apply-runner.js indeed login      one-time: visible Chrome opens — log in manually, then close the window
 *   node auto-apply-runner.js indeed            dry run: fills everything, never submits
 *   node auto-apply-runner.js indeed --live     applies for real
 *   node auto-apply-runner.js wellfound [login|--live]
 *
 * Each run picks a random target of 10–25 applications (2 sites ≈ 20–50/day),
 * runs off-screen, and stops after the target or 100 minutes.
 */
const path = require('path');
const fs = require('fs');
const { CV, geminiKey, homeLocation } = require('./config'); // personal data from .env, injected into the console scripts
// stealth patches the fingerprint leaks reCAPTCHA uses to flag automation; falls back to plain playwright
let chromium;
try {
  const { addExtra } = require('playwright-extra');
  chromium = addExtra(require('playwright-core').chromium);
  chromium.use(require('puppeteer-extra-plugin-stealth')());
} catch (e) {
  ({ chromium } = require('playwright-core'));
}

// Page reloads (naukri clicking "Next") race the stealth plugin's CDP session and throw
// async rejections outside any await — swallow them so a normal navigation can't kill the run.
process.on('unhandledRejection', (e) => { recordIssue('crash', 'unhandledRejection: ' + (e && e.message || e)); console.log(`[${new Date().toLocaleString()}] unhandledRejection (ignored): ${String(e && e.message || e).split('\n')[0]}`); });
process.on('uncaughtException', (e) => { recordIssue('crash', 'uncaughtException: ' + (e && e.message || e)); console.log(`[${new Date().toLocaleString()}] uncaughtException (ignored): ${String(e && e.message || e).split('\n')[0]}`); });

const SITE_ARG = process.argv[2];
const LOGIN_MODE = process.argv.includes('login');
const LIVE = process.argv.includes('--live');
// process.stdin.setEncoding('utf8');

// process.stdin.on('data', async (data) => {
//   const key = data.trim().toLowerCase();

//   if (key !== 's') {
//     return;
//   }

//   log('⏭ MANUAL SKIP requested');

//   const pages = ctx?.pages?.() || [];

//   for (const page of pages) {
//     await page.evaluate(() => {
//       window.__aaSkipJob = true;
//     }).catch(() => { });
//   }
// });

const SITES = {
  indeed: {
    script: 'indeed-auto-apply.js',
    profile: '.indeed-chrome-profile',
    // sort=date → newest first; fromage=14 → only jobs posted in the last 14 days; no location filter
    searches: [
      'https://in.indeed.com/jobs?q=full+stack+developer&sort=date&fromage=14',
      'https://in.indeed.com/jobs?q=software+developer&sort=date&fromage=14',
      'https://in.indeed.com/jobs?q=backend+developer&sort=date&fromage=14',
      'https://in.indeed.com/jobs?q=ai+engineer&sort=date&fromage=14',
      'https://in.indeed.com/jobs?q=gen+ai+developer&sort=date&fromage=14',
      'https://in.indeed.com/jobs?q=react+developer&sort=date&fromage=14',
      'https://in.indeed.com/jobs?q=node+js+developer&sort=date&fromage=14',
    ],
    loginUrl: 'https://in.indeed.com/account/login',
    injectOn: (url) => /indeed\./.test(url),
    // count both real submits and dry-run "would submit" so pacing works in both modes
    submittedRe: /application submitted|would click: "Submit/i,
    storeKey: 'autoApply', // localStorage key the console script uses (seen jobs + submit count)
  },
  wellfound: {
    script: 'wellfound-auto-apply.js',
    profile: '.wellfound-chrome-profile',
    searches: ['https://wellfound.com/jobs'],
    loginUrl: 'https://wellfound.com/login',
    injectOn: (url) => /wellfound\.com/.test(url),
    submittedRe: /APPLICATION CONFIRMED|submission assumed successful|application sent|DRY_RUN — would click/i,
    storeKey: null, // wellfound script keeps no localStorage state
    dailyCap: 50,
  },
  naukri: {
    script: 'naukri-auto-apply.js',
    // ponytail: own profile (copy of the refresh's login) so the long apply run never
    // collides with the hourly refresh on .naukri-chrome-profile. Re-copy if it logs out.
    profile: '.naukri-apply-profile',
    searches: [
      'https://www.naukri.com/full-stack-developer-jobs?experience=1',
      'https://www.naukri.com/software-developer-jobs?experience=1',
      'https://www.naukri.com/backend-developer-jobs?experience=1',
      'https://www.naukri.com/mern-stack-developer-jobs?experience=1',
      'https://www.naukri.com/react-js-developer-jobs?experience=1',
      'https://www.naukri.com/node-js-developer-jobs?experience=1',
    ],
    loginUrl: 'https://www.naukri.com/nlogin/login',
    // inject only on search pages (…-jobs…), never into the job popup the script drives itself
    injectOn: (url) => /naukri\.com\/[^?]*-jobs/.test(url),
    submittedRe: /✅ applied|DRY_RUN — would click/,
    storeKey: 'autoApplyNaukri',
    dailyCap: 20,
  },
};

const site = SITES[SITE_ARG];
if (!site) {
  console.log('Usage: node auto-apply-runner.js <indeed|wellfound> [login|--live]');
  process.exit(1);
}

// Hard daily cap per site, tracked across runs in a state file — multiple logons in
// one day resume the count instead of restarting it, and stop dead at the cap.
const DAILY_CAP = site.dailyCap || 50;
const STATE_FILE = path.join(__dirname, `apply-state-${SITE_ARG}.json`);
const todayKey = new Date().toDateString();
let dayState = { date: todayKey, count: 0 };
try { const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8').replace(/^﻿/, '')); if (s.date === todayKey) dayState = s; } catch (e) { }
const bumpDayCount = () => { dayState.count++; try { fs.writeFileSync(STATE_FILE, JSON.stringify(dayState)); } catch (e) { } };

// Cross-restart memory of jobs already attempted today. The browser profile
// wipes localStorage between launches, so the Node side owns this list in a
// JSON file; the console script reports additions via "AA_SEEN <href>" markers.
const SEEN_FILE = path.join(__dirname, `.wellfound-seen-${SITE_ARG}.json`);
const seenState = (() => {
  try { const s = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')); if (s.date === todayKey && Array.isArray(s.hrefs)) return s; } catch (e) { }
  return { date: todayKey, hrefs: [] };
})();
let seenSaveTimer = null;
const saveSeen = () => {
  clearTimeout(seenSaveTimer);
  seenSaveTimer = setTimeout(() => { try { fs.writeFileSync(SEEN_FILE, JSON.stringify(seenState)); } catch (e) { } }, 2000);
};

// Pending profile-location change requested by the console script; handed back
// to the next injection on /profile/edit via __APPLY_CONFIG.locFix. Cleared when
// the script reports AA_LOC_DONE.
let pendingLocFix = null;
const TARGET = DAILY_CAP - dayState.count;
const MAX_RUNTIME_MS = 100 * 60 * 1000;
const IDLE_ROTATE_MS = 4 * 60 * 1000;

// ======== Persistent run + issue logs (for diagnosing failures later) ========
const LOGS_DIR = path.join(__dirname, 'logs');
try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch (e) { }
const RUN_LOG_FILE = path.join(LOGS_DIR, `run-${SITE_ARG}-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)}.log`);
const ISSUE_FILE = path.join(LOGS_DIR, `issues-${SITE_ARG}.jsonl`);
// known failure modes worth keeping evidence for; third item = also screenshot
const ISSUE_PATTERNS = [
  [/success overlay is still visible|no close button found/i, 'popup-not-closed', true],
  [/application blocked by location/i, 'location-block', false],
  [/Could not extract job location|Location fix FAILED|job page fetch failed/i, 'location-fix-failed', true],
  [/required fields still empty/i, 'missing-required', true],
  [/submission failed|Send application is still visible/i, 'submit-failed', true],
  [/stale application popup/i, 'stale-popup', true],
  [/button not found|panel did not appear/i, 'ui-not-found', true],
  [/seen persist failed|seen-set restore failed|AA_LOC_DONE failed/i, 'state-error', false],
];
function recordIssue(kind, detail) {
  try {
    fs.appendFileSync(ISSUE_FILE, JSON.stringify({ ts: new Date().toISOString(), site: SITE_ARG, kind, detail: String(detail).slice(0, 300) }) + '\n');
  } catch (e) { }
}

const log = (msg) => {
  const line = `[${new Date().toLocaleString()}] [${SITE_ARG}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(RUN_LOG_FILE, line + '\n'); } catch (e) { }
};

// ======== CSV log of every submitted application (created once, appended forever) ========
const CSV_FILE = path.join(__dirname, 'applications.csv');
const SKILLS = ['JavaScript', 'TypeScript', 'Python', 'Java', 'React', 'Next.js', 'React Native', 'Node.js',
  'Express', 'FastAPI', 'MongoDB', 'PostgreSQL', 'Redis', 'GraphQL', 'WebSockets', 'Docker', 'Kubernetes',
  'GCP', 'AWS', 'CI/CD', 'LangChain', 'LangGraph', 'RAG', 'LLM', 'GenAI', 'Machine Learning', 'MCP', 'Pinecone', 'FAISS'];
const matchSkills = (t) => { const l = t.toLowerCase(); return SKILLS.filter((s) => l.includes(s.toLowerCase())).join('; '); };
const csvRow = (vals) => vals.map((v) => '"' + String(v || '').replace(/"/g, '""').replace(/\s+/g, ' ').trim() + '"').join(',') + '\n';
function logApplication(job) {
  // one-time migration: archive a CSV written before the Job Link column existed
  if (fs.existsSync(CSV_FILE) && !fs.readFileSync(CSV_FILE, 'utf8').split('\n')[0].includes('Job Link')) {
    fs.renameSync(CSV_FILE, path.join(__dirname, 'applications-old.csv'));
  }
  if (!fs.existsSync(CSV_FILE)) {
    // ﻿ BOM so Excel renders ₹/– correctly
    fs.writeFileSync(CSV_FILE, '﻿' + csvRow(['Date', 'Site', 'Role', 'Company', 'CTC/Salary', 'Skills', 'Job Link', 'Job Description']));
  }
  fs.appendFileSync(CSV_FILE, csvRow([new Date().toLocaleString(), SITE_ARG, job.title, job.company, job.salary, job.skills, job.link, job.jd]));
}

// Patch the console script: our DRY_RUN flag, our per-run target, and a busy-guard
// so a second injection while one is still running becomes a no-op.
function buildInjection() {
  const raw = fs
    .readFileSync(path.join(__dirname, site.script), 'utf8')
    .replace(/DRY_RUN: true/, `DRY_RUN: ${!LIVE}`)
    .replace(/MAX_APPLICATIONS: \d+/, `MAX_APPLICATIONS: ${TARGET}`);
  // the console script reads its personal data from window.__APPLY_CONFIG (from .env),
  // so no PII lives in the injected script itself
  return `(async () => {
    if (window.__aaBusy || window.__aaFinished) return;
    window.__aaBusy = true;
    window.__APPLY_CONFIG = ${JSON.stringify({
    CV, geminiKey, homeLocation, seenHrefs: seenState.hrefs,
    locFix: pendingLocFix && Date.now() - pendingLocFix.ts < 600000
      ? { loc: pendingLocFix.loc, jobHref: pendingLocFix.jobHref } : null,
  })};
    try { await ${raw}
    } finally { window.__aaBusy = false; }
  })()`;
}

(async () => {
  if (!LOGIN_MODE && TARGET <= 0) {
    log(`Daily cap of ${DAILY_CAP} applications already reached (${dayState.count} today) — exiting.`);
    return;
  }
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, site.profile), {
    channel: 'chrome',
    headless: false, // bot checks block headless; headed + off-screen instead (same trick as naukri refresh)
    viewport: { width: 1280, height: 900 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-backgrounding-occluded-windows', // keep timers full-speed while off-screen
      '--disable-renderer-backgrounding',
      '--disable-popup-blocking', // naukri script opens each job in a popup it controls
      // ...(LOGIN_MODE ? [] : ['--window-position=-32000,-32000']),
      ...(LOGIN_MODE ? [] : []),
    ],
  });
  const mainPage = ctx.pages()[0] || (await ctx.newPage());
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', async (data) => {
    const key = data.trim().toLowerCase();

    if (key !== 's') {
      return;
    }

    log('⏭ MANUAL SKIP requested');

    for (const page of ctx.pages()) {
      await page.evaluate(() => {
        window.__aaSkipJob = true;
      }).catch(() => { });
    }
  });

  if (LOGIN_MODE) {
    await mainPage.goto(site.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
    log('Chrome is open — log in to the site, then CLOSE the browser window. The session is saved automatically.');
    await new Promise((res) => ctx.on('close', res));
    log('Login window closed. Session saved. Now test with: node auto-apply-runner.js ' + SITE_ARG);
    return;
  }

  log(`Starting. mode=${LIVE ? 'LIVE' : 'DRY RUN'} target=${TARGET} applications, max ${MAX_RUNTIME_MS / 60000} min`);
  const deadline = Date.now() + MAX_RUNTIME_MS;
  let submitted = 0;
  let lastActivity = Date.now();
  let searchIdx = 0;
  let pendingJob = null; // details of the job currently being applied to, for the CSV

  const isBusy = (p) => p.evaluate('!!window.__aaBusy').catch(() => false);

  function wire(page) {
    page.on('console', (msg) => {
      const text = msg.text();
      // raw markers from the console script (no [auto-apply] prefix)
      const sm = text.trim().match(/^AA_SEEN(_REMOVE)? (\S+)/);
      if (sm) {
        lastActivity = Date.now();
        const href = sm[2];
        if (sm[1]) seenState.hrefs = seenState.hrefs.filter((h) => h !== href);
        else if (!seenState.hrefs.includes(href)) seenState.hrefs.push(href);
        saveSeen();
        return;
      }
      // pending location-fix request from the script
      const lm = text.trim().match(/^AA_LOC_FIX (\{.+\})$/);
      if (lm) {
        lastActivity = Date.now();
        try { pendingLocFix = JSON.parse(lm[1]); pendingLocFix.ts = Date.now(); } catch (_) { }
        return;
      }
      if (/^AA_LOC_DONE/.test(text.trim())) {
        lastActivity = Date.now();
        pendingLocFix = null;
        return;
      }
      if (!/auto-apply/.test(text)) return;
      lastActivity = Date.now();
      const clean = text.replace(/%c\[auto-apply\]\s*\S*/, '').trim();
      log('  ' + clean.slice(0, 160));

      // store evidence for known failure modes so they can be fixed later
      const issue = ISSUE_PATTERNS.find(([re]) => re.test(clean));
      if (issue) {
        recordIssue(issue[1], clean);
        if (issue[2]) {
          page.screenshot({ path: path.join(LOGS_DIR, `${SITE_ARG}-${issue[1]}-${Date.now()}.png`) }).catch(() => { });
        }
      }

      // snapshot the wizard whenever it can't proceed, so the blocking field is visible
      if (/no Continue\/Submit button found|no Send button found/.test(clean)) {
        page.screenshot({ path: path.join(__dirname, `blocked-step-${SITE_ARG}.png`) }).catch(() => { });
      }

      // "▶ Applying: <title> @ <company>" (wellfound) / "▶ Opening: <title>" (indeed)
      const m = clean.match(/▶ (?:Applying|Opening): (.+)/);
      if (m) {
        const [main, link, cardSalary] = m[1].split(' | ');
        const atParts = main.split(' @ ');
        const company = atParts.length > 1 ? atParts.pop() : ''; // company is after the LAST ' @ ' — titles may contain '@'
        const title = atParts.join(' @ ');
        pendingJob = { title: title.trim(), company: (company || '').replace(/^\?$/, '').trim(), link: (link || '').trim(), salary: (cardSalary || '').trim(), skills: '', jd: '' };
        // scrape details once the job pane/description has rendered
        setTimeout(() => {
          page.evaluate(() => {
            const q = (s) => document.querySelector(s)?.textContent?.trim() || '';
            return {
              company: (document.body.innerText.match(/Apply to (.{2,60})/) || [])[1]?.trim() ||
                q('[data-testid="inlineHeader-companyName"]') || q('[data-company-name]') || q('a[href^="/company/"]'),
              salary: q('#salaryInfoAndJobType') || q('[data-testid*="salary" i]') ||
                (document.body.innerText.match(/(?:₹|\$)\s?[\d,.]+(?:\s?-\s?(?:₹|\$)?[\d,.]+)?[^\n]{0,30}/) || [''])[0],
              jd: (q('#jobDescriptionText') || q('[class*="jobDescription" i]') || q('[class*="description" i]')).slice(0, 1200),
            };
          }).then((d) => {
            if (!d || !pendingJob) return;
            pendingJob.company = pendingJob.company || d.company;
            pendingJob.salary = pendingJob.salary || d.salary;
            pendingJob.jd = d.jd;
            pendingJob.skills = matchSkills(pendingJob.title + ' ' + d.jd);
          }).catch(() => { });
        }, SITE_ARG === 'indeed' ? 6000 : 2000); // indeed pane loads slower; wellfound modal closes fast
      }

      if (site.submittedRe.test(text)) {
        submitted++;
        log(`==> ${submitted}/${TARGET} this run (${dayState.count + 1}/${DAILY_CAP} today)`);
        if (LIVE) { // dry runs don't pollute the CSV or the daily count
          bumpDayCount();
          try { logApplication(pendingJob || { title: 'unknown' }); } catch (e) { log('CSV write failed: ' + e.message); }
        }
        pendingJob = null;
      }
    });
    page.on('load', async () => {
      if (!site.injectOn(page.url())) return;
      lastActivity = Date.now();
      // daily reset of the console script's submit counter (persists in localStorage)
      if (site.storeKey) {
        await page.evaluate(([key, today]) => {
          try {
            const s = JSON.parse(localStorage.getItem(key) || '{}');
            if (s.day !== today) {
              s.day = today; s.submitted = 0; s.applied = 0; s.seen = (s.seen || []).slice(-2000);
              localStorage.setItem(key, JSON.stringify(s));
            }
          } catch (e) { }
        }, [site.storeKey, new Date().toDateString()]).catch(() => { });
      }
      await page.evaluate(buildInjection()).catch(() => { }); // navigation mid-run is normal
    });
  }

  ctx.pages().forEach(wire);
  ctx.on('page', wire);

  await mainPage.goto(site.searches[0], { waitUntil: 'domcontentloaded', timeout: 60000 });
  // not logged in? every flow needs a session — bail with a clear message
  await mainPage.waitForTimeout(8000);
  const bodyText = await mainPage.evaluate('document.body.innerText.slice(0, 3000)').catch(() => '');
  if (/sign in|log in to continue|create an account|verify you are human/i.test(bodyText) && !/sign out/i.test(bodyText)) {
    log('WARNING: page looks logged-out or bot-checked. If runs keep finding 0 jobs, run: node auto-apply-runner.js ' + SITE_ARG + ' login');
  }
  await mainPage.evaluate(buildInjection()).catch(() => { });

  // Supervisor: re-inject the search tab when idle, close finished form tabs,
  // rotate searches on inactivity, stop on target/time.
  while (submitted < TARGET && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10000));

    const pages = ctx.pages();
    let anyBusy = false;
    for (const p of pages) {
      if (await isBusy(p)) anyBusy = true;
      // finished smartapply/form tabs: close them so tabs don't pile up
      if (p !== mainPage && /smartapply|\/apply/.test(p.url()) && !(await isBusy(p))) {
        await p.close().catch(() => { });
      }
      // live mode: after submit the form tab returns to search — close that duplicate search tab
      if (p !== mainPage && site.injectOn(p.url()) && !/smartapply|\/apply/.test(p.url()) && !(await isBusy(p))) {
        await p.close().catch(() => { });
      }
    }

    if (!anyBusy) {
      if (Date.now() - lastActivity > IDLE_ROTATE_MS) {
        searchIdx++;
        if (searchIdx >= site.searches.length) { log('All searches exhausted for today.'); break; }
        log(`Rotating to next search: ${site.searches[searchIdx]}`);
        await mainPage.goto(site.searches[searchIdx], { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
      } else {
        await mainPage.evaluate(buildInjection()).catch(() => { }); // continue with next job on this page
      }
    }
  }

  log(`Finished: ${submitted}/${TARGET} applications ${LIVE ? 'submitted' : 'simulated (dry run)'}.`);
  await ctx.close();
})().catch((e) => { recordIssue('crash', 'FATAL: ' + (e && e.message || e)); log('FATAL: ' + e.message.split('\n')[0]); process.exit(1); });
