/**
 * READ-ONLY: locate the "New Business Development" skill chip, dump its HTML +
 * the structure of its remove (X) control, and capture the headers Wellfound
 * sends on a real /graphql request (to learn what a raw fetch is missing).
 */
const path = require('path');
let chromium;
try {
  const { addExtra } = require('playwright-extra');
  chromium = addExtra(require('playwright-core').chromium);
  chromium.use(require('puppeteer-extra-plugin-stealth')());
} catch (e) {
  ({ chromium } = require('playwright-core'));
}

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, '.wellfound-chrome-profile'), {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1400, height: 1200 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  // Capture a real graphql request's headers.
  let realHeaders = null;
  page.on('request', (req) => {
    if (/\/graphql/.test(req.url()) && req.method() === 'POST' && !realHeaders) {
      realHeaders = req.headers();
    }
  });

  await page.goto('https://wellfound.com/profile/edit', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(4000);

  const chipInfo = await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    // Find the tightest element whose own text is exactly the skill name.
    const all = [...document.querySelectorAll('*')].filter(el => {
      return el.children.length === 0 && norm(el.textContent) === 'New Business Development';
    });
    if (!all.length) return { found: false };
    const leaf = all[0];
    // Walk up to find the chip container that also holds a remove control.
    let chip = leaf, removeEl = null;
    for (let k = 0; k < 6 && chip; k++) {
      removeEl = chip.querySelector('[class*="close" i], [aria-label*="remove" i], [role="button"] svg, button');
      if (removeEl) break;
      chip = chip.parentElement;
    }
    return {
      found: true,
      leafTag: leaf.tagName,
      leafClass: leaf.className.slice(0, 80),
      chipHTML: chip ? chip.outerHTML.slice(0, 1200) : 'none',
      removeFound: !!removeEl,
      removeTag: removeEl ? removeEl.tagName : null,
      removeClass: removeEl ? (removeEl.className.baseVal !== undefined ? removeEl.className.baseVal : removeEl.className).slice(0, 80) : null,
    };
  });
  console.log('===== SKILL CHIP =====');
  console.log(JSON.stringify(chipInfo, null, 2));

  console.log('\n===== REAL GRAPHQL REQUEST HEADERS =====');
  console.log(realHeaders ? JSON.stringify(realHeaders, null, 2) : 'no graphql POST captured');

  await ctx.close();
  console.log('\nDone (read-only).');
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
