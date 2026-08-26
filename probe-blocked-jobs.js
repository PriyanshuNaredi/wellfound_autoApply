/**
 * Probe (read-only): why does fetchJobLocation return '' for the two blocked jobs?
 * 1. Print localStorage __aaSeenJobs (did persistSeen actually save?).
 * 2. Fetch each blocked job page in-page, report the response size, and dump
 *    every text fragment around "location/remote/hires/office" after stripping tags.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try {
  const { addExtra } = require('playwright-extra');
  chromium = addExtra(require('playwright-core').chromium);
  chromium.use(require('puppeteer-extra-plugin-stealth')());
} catch (e) { ({ chromium } = require('playwright-core')); }

const JOBS = [
  'https://wellfound.com/jobs/4324422-software-engineer-applied-ai',
  'https://wellfound.com/jobs/3641017-founding-software-engineer',
];
const OUT = path.join(__dirname, 'explore-out');
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, '.wellfound-chrome-profile'), {
    channel: 'chrome', headless: false, viewport: { width: 1400, height: 1000 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  try {
    await page.goto('https://wellfound.com/jobs', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);

    const seen = await page.evaluate(() => localStorage.getItem('__aaSeenJobs'));
    log('===== localStorage __aaSeenJobs =====\n' + (seen || '(empty / not set)'));

    for (const url of JOBS) {
      const info = await page.evaluate(async (u) => {
        try {
          const r = await fetch(u, { credentials: 'include' });
          const raw = await r.text();
          const text = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
          const hits = [];
          const re = /(job location|hires remotely|remote|in office|in-office|onsite|location|timezone)[^.]{0,160}/gi;
          let m;
          while ((m = re.exec(text)) && hits.length < 25) hits.push(m[0].trim());
          return { status: r.status, size: raw.length, isChallenge: /datadome|captcha|verify you are human/i.test(raw), textLen: text.length, hits, sample: text.slice(0, 300) };
        } catch (e) { return { error: String(e) }; }
      }, url);
      log('\n===== ' + url + ' =====\n' + JSON.stringify(info, null, 2));
    }

    // Also: what does the LIVE overlay show when a blocked job is open?
    // Open the first job via its link so the SPA overlay renders, then dump body text around location.
    await page.evaluate(() => {
      const a = document.querySelector('a[href*="/jobs/4324422"]');
      if (a) a.click();
    });
    await page.waitForTimeout(5000);
    const overlay = await page.evaluate(() => {
      const text = (document.body.innerText || '').replace(/\s+/g, ' ');
      const hits = [];
      const re = /(job location|hires remotely|remote|in office|onsite|not accepting applications)[^.]{0,160}/gi;
      let m;
      while ((m = re.exec(text)) && hits.length < 25) hits.push(m[0].trim());
      return { url: location.href, hits };
    });
    log('\n===== LIVE OVERLAY after clicking Sobek AI card =====\n' + JSON.stringify(overlay, null, 2));

    fs.writeFileSync(path.join(OUT, 'probe-blocked.txt'), 'seen=' + (seen || '(empty)') + '\n');
  } finally {
    await ctx.close();
  }
  log('done');
})().catch((e) => { console.error('FATAL:', e.message.split('\n')[0]); process.exit(1); });