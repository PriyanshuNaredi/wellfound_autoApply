/**
 * Utility: read or change the Wellfound profile location ("Where are you based?").
 *   node set-location.js              -> print current value
 *   node set-location.js "Syracuse"   -> change it (clear-button recipe + reload verify)
 * Uses the verified mechanism: click the ✕ on the display-only combobox, type in
 * the fresh input, select via keyboard Enter (plain option clicks do NOT save).
 */
const path = require('path');
let chromium;
try {
  const { addExtra } = require('playwright-extra');
  chromium = addExtra(require('playwright-core').chromium);
  chromium.use(require('puppeteer-extra-plugin-stealth')());
} catch (e) { ({ chromium } = require('playwright-core')); }

const TARGET = process.argv[2];
const log = console.log;

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, '.wellfound-chrome-profile'), {
    channel: 'chrome', headless: false, viewport: { width: 1400, height: 1000 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  const readLocationValue = () => page.evaluate(() => {
    const titles = [...document.querySelectorAll('div')].filter((d) =>
      /^where are you based\??$/i.test((d.textContent || '').replace(/\s+/g, ' ').trim()) && d.children.length === 0);
    for (const t of titles) {
      let node = t;
      for (let i = 0; i < 10 && node; i++) {
        const cb = node.querySelector ? node.querySelector('[role="combobox"]') : null;
        if (cb) {
          const leaf = [...cb.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent.trim().length > 1);
          return ((leaf ? leaf.textContent : cb.textContent) || '').replace(/\s+/g, ' ').trim();
        }
        if (node.querySelector && node.querySelector('input')) return '(edit mode)';
        node = node.parentElement;
      }
    }
    return '';
  });

  try {
    await page.goto('https://wellfound.com/profile/edit', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(7000);

    const current = await readLocationValue();
    log(`current location: "${current}"`);
    if (!TARGET) { await ctx.close(); return; }

    // open the editable input by clicking the ✕ clear button
    const cleared = await page.evaluate(() => {
      const titles = [...document.querySelectorAll('div')].filter((d) =>
        /^where are you based\??$/i.test((d.textContent || '').replace(/\s+/g, ' ').trim()) && d.children.length === 0);
      for (const t of titles) {
        let node = t;
        for (let i = 0; i < 10 && node; i++) {
          const cb = node.querySelector ? node.querySelector('[role="combobox"]') : null;
          if (cb) {
            const btn = cb.querySelector('[class*="close" i]');
            if (!btn) return 'no-clear-button';
            btn.scrollIntoView({ block: 'center' });
            btn.click();
            return true;
          }
          node = node.parentElement;
        }
      }
      return 'combobox-not-found';
    });
    if (cleared !== true) { log('ERROR: ' + cleared); process.exit(1); }
    await page.waitForTimeout(2000);

    const input = page.locator('input[placeholder*="e.g." i], input[id^="downshift-"][id$="-input"]').first();
    if (!(await input.count())) { log('ERROR: editable input did not appear'); process.exit(1); }
    await input.click();
    await input.press('Control+a');
    await input.press('Delete');
    await input.pressSequentially(TARGET, { delay: 80 });
    await page.waitForTimeout(3500);

    const opts = page.locator('[role="option"]');
    const count = await opts.count();
    const texts = [];
    for (let i = 0; i < Math.min(count, 10); i++) texts.push(((await opts.nth(i).textContent()) || '').replace(/\s+/g, ' ').trim());
    log('options: ' + JSON.stringify(texts));
    if (!count) { log('ERROR: no autocomplete options'); process.exit(1); }
    const wanted = TARGET.split(',')[0];
    let pick = texts.findIndex((t) => new RegExp(`^${wanted}`, 'i').test(t));
    if (pick === -1) pick = texts.findIndex((t) => new RegExp(wanted, 'i').test(t));
    if (pick === -1) pick = 0;
    log(`picking option ${pick}: "${texts[pick]}"`);

    for (let k = 0; k <= pick; k++) await input.press('ArrowDown');
    await input.press('Enter');
    await page.waitForTimeout(4000);

    // mouse fallback if Enter did not commit (input still present)
    if (await input.count()) {
      const box = await opts.nth(pick).boundingBox({ timeout: 4000 }).catch(() => null);
      if (box) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(4000); }
    }

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(7000);
    const persisted = await readLocationValue();
    log(`persisted location: "${persisted}"`);
    log(new RegExp(wanted, 'i').test(persisted) ? 'OK' : 'FAILED');
  } finally {
    await ctx.close();
  }
})().catch((e) => { console.error('FATAL:', e.message.split('\n')[0]); process.exit(1); });