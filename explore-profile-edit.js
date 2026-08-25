/**
 * Focused exploration of the Wellfound profile location editor at /profile/edit.
 * Captures the DOM structure of the location field and any API endpoint used to save it.
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

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, '.wellfound-chrome-profile'), {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1400, height: 1000 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  const apiLog = [];
  page.on('request', (req) => {
    const u = req.url();
    const m = req.method();
    if ((m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') &&
        !/analytics|google|linkedin|facebook|trustarc|sentry|segment|amplitude|datadome|recaptcha/i.test(u)) {
      apiLog.push(`${m} ${u} :: ${(req.postData() || '').slice(0, 400)}`);
    }
  });

  await page.goto('https://wellfound.com/profile/edit', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(OUT, 'profile-edit.png'), fullPage: true }).catch(() => {});
  fs.writeFileSync(path.join(OUT, 'profile-edit.html'), await page.content());
  console.log('URL:', page.url(), '| TITLE:', await page.title());

  // Describe every form control + its label/section, focused on location.
  const controls = await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const out = [];
    document.querySelectorAll('input, select, textarea, [role="combobox"], [contenteditable="true"], button, a').forEach((el) => {
      const label = norm(
        el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name ||
        (el.id ? (document.querySelector(`label[for="${el.id}"]`)?.textContent || '') : '') ||
        (el.closest('label')?.textContent || '')
      );
      const section = norm(el.closest('section, [class*="section"], form, div')?.querySelector('h1,h2,h3,h4')?.textContent || '');
      const text = norm(el.textContent);
      const hay = (label + ' ' + section + ' ' + text).toLowerCase();
      if (/location|city|country|region|where|relocat|remote|timezone|save|update|edit/i.test(hay)) {
        out.push({
          tag: el.tagName,
          type: el.getAttribute('type') || '',
          role: el.getAttribute('role') || '',
          name: el.name || '',
          id: el.id || '',
          dataTest: el.getAttribute('data-test') || el.getAttribute('data-testid') || '',
          label: label.slice(0, 80),
          section: section.slice(0, 60),
          text: text.slice(0, 80),
          href: el.getAttribute('href') || '',
        });
      }
    });
    return out;
  });
  console.log('\n===== LOCATION-RELATED CONTROLS on /profile/edit =====');
  console.log(JSON.stringify(controls, null, 2));

  fs.writeFileSync(path.join(OUT, 'profile-edit-api.txt'), apiLog.join('\n\n'));
  console.log('\nWrite-requests captured:', apiLog.length);

  await page.waitForTimeout(1500);
  await ctx.close();
  console.log('Done.');
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
