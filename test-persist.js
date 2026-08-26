/**
 * Sanity probe: does localStorage survive a full browser relaunch in this profile?
 * Launch 1: write __aaPersistTest = <ts>, read back. Close.
 * Launch 2: read __aaPersistTest. Report whether it survived.
 */
const path = require('path');
let chromium;
try {
  const { addExtra } = require('playwright-extra');
  chromium = addExtra(require('playwright-core').chromium);
  chromium.use(require('puppeteer-extra-plugin-stealth')());
} catch (e) { ({ chromium } = require('playwright-core')); }

const KEY = '__aaPersistTest';
const log = (...a) => console.log(...a);

(async () => {
  const opts = {
    channel: 'chrome', headless: false, viewport: { width: 1200, height: 800 },
    args: ['--disable-blink-features=AutomationControlled'],
  };
  const profile = path.join(__dirname, '.wellfound-chrome-profile');

  // ---- launch 1: write ----
  const ctx1 = await chromium.launchPersistentContext(profile, opts);
  const p1 = ctx1.pages()[0] || (await ctx1.newPage());
  await p1.goto('https://wellfound.com/jobs', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p1.waitForTimeout(4000);
  const ts = String(Date.now());
  const w = await p1.evaluate(([k, v]) => { try { localStorage.setItem(k, v); return localStorage.getItem(k); } catch (e) { return 'ERR:' + e.message; } }, [KEY, ts]);
  log('launch1 wrote:', w, '(expected', ts + ')');
  await ctx1.close();
  await new Promise((r) => setTimeout(r, 2000));

  // ---- launch 2: read ----
  const ctx2 = await chromium.launchPersistentContext(profile, opts);
  const p2 = ctx2.pages()[0] || (await ctx2.newPage());
  await p2.goto('https://wellfound.com/jobs', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p2.waitForTimeout(4000);
  const r = await p2.evaluate((k) => localStorage.getItem(k), KEY);
  log('launch2 read:', r);
  log(r === ts ? 'PERSISTENCE WORKS' : 'PERSISTENCE BROKEN — localStorage does not survive relaunch');
  // cleanup
  await p2.evaluate((k) => localStorage.removeItem(k), KEY);
  const seenRaw = await p2.evaluate((k) => localStorage.getItem(k), '__aaSeenJobs');
  log('current __aaSeenJobs:', seenRaw || '(empty)');
  await ctx2.close();
})().catch((e) => { console.error('FATAL:', e.message.split('\n')[0]); process.exit(1); });