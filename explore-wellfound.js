/**
 * One-off exploration: drive the logged-in Wellfound Chrome profile to discover
 * where the profile location is edited and how (UI fields / API endpoints).
 * Writes screenshots + HTML dumps into ./explore-out/ for inspection.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try {
  const { addExtra } = require('playwright-extra');
  chromium = addExtra(require('playwright-core').chromium);
  chromium.use(require('puppeteer-extra-plugin-stealth')());
} catch (e) {
  ({ chromium } = require('playwright-core'));
}

const OUT = path.join(__dirname, 'explore-out');
fs.mkdirSync(OUT, { recursive: true });
const shot = (name) => path.join(OUT, name + '.png');
const dump = (name, html) => fs.writeFileSync(path.join(OUT, name + '.html'), html);

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, '.wellfound-chrome-profile'), {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1400, height: 950 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  // Capture any API calls that look like profile/settings updates so we can find the endpoint.
  const apiLog = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/api|graphql|profile|settings|user|location/i.test(u) && !/\.(png|jpg|jpeg|gif|svg|webp|css|js|woff2?)(\?|$)/i.test(u)) {
      apiLog.push(`${req.method()} ${u}`);
    }
  });

  const step = async (name, url) => {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(4000);
      await page.screenshot({ path: shot(name), fullPage: true }).catch(() => {});
      dump(name, await page.content());
      console.log(`\n===== ${name} :: ${page.url()} =====`);
      console.log('TITLE:', await page.title());
    } catch (e) {
      console.log(`!! ${name} failed: ${e.message.split('\n')[0]}`);
    }
  };

  await step('01-jobs', 'https://wellfound.com/jobs');

  // Probe likely settings/profile URLs.
  await step('02-settings', 'https://wellfound.com/settings');
  await step('03-profile', 'https://wellfound.com/profile');
  await step('04-account', 'https://wellfound.com/account');
  await step('05-candidate-profile', 'https://wellfound.com/candidate/profile');

  // Search every rendered page for location-related controls.
  await page.goto('https://wellfound.com/jobs', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3000);

  // Find links/buttons in the user menu area.
  const navInfo = await page.evaluate(() => {
    const out = { links: [], locationHits: [] };
    document.querySelectorAll('a[href], button').forEach((el) => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const h = el.getAttribute('href') || '';
      if (/setting|profile|account|preference/i.test(t + ' ' + h)) out.links.push(`${el.tagName} "${t.slice(0, 60)}" -> ${h}`);
    });
    // any element mentioning location
    document.querySelectorAll('input, select, [role="combobox"], [contenteditable]').forEach((el) => {
      const label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || '') + '';
      if (/location|city|country|where/i.test(label)) out.locationHits.push(`${el.tagName} name=${el.name} aria=${el.getAttribute('aria-label')} ph=${el.getAttribute('placeholder')}`);
    });
    return out;
  });
  console.log('\n===== NAV / LOCATION SCAN on /jobs =====');
  console.log(JSON.stringify(navInfo, null, 2));

  fs.writeFileSync(path.join(OUT, 'api-log.txt'), apiLog.join('\n'));
  console.log('\nAPI calls captured:', apiLog.length);

  await page.waitForTimeout(2000);
  await ctx.close();
  console.log('\nDone. Outputs in', OUT);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
