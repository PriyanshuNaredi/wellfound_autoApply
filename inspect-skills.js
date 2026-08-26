/**
 * READ-ONLY: list every selected "chip" (location + skills) on /profile/edit
 * and describe each chip's remove (X) button. Does NOT click or save anything.
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

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, '.wellfound-chrome-profile'), {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1400, height: 1000 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  await page.goto('https://wellfound.com/profile/edit', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);

  const chips = await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const out = [];
    // A "chip" = element whose text is a selected value and that contains a remove (X) control.
    // The location/skill typeaheads render chips with a close button (role=button holding an svg X).
    document.querySelectorAll('div[role="combobox"] [role="button"], div[role="combobox"] svg').forEach(() => {});
    // Walk every combobox and list its selected chips.
    document.querySelectorAll('div[role="combobox"]').forEach((cb, i) => {
      const label = cb.getAttribute('aria-labelledby') || '';
      const labelText = label ? norm(document.getElementById(label)?.textContent || '') : '';
      // chips are the flex-row items containing a value div + a close div
      const chipEls = cb.querySelectorAll('[class*="component__"] [class*="flex-row"]');
      chipEls.forEach((chip) => {
        const valueEl = chip.querySelector('[class*="wide__"], [class*="flex-col"]');
        const closeEl = chip.querySelector('[class*="close__"]');
        const txt = norm(valueEl ? valueEl.textContent : chip.textContent);
        if (txt) out.push({ combobox: i, label: labelText.slice(0, 40), value: txt.slice(0, 60), hasClose: !!closeEl });
      });
    });
    return out;
  });

  console.log('===== SELECTED CHIPS (read-only) =====');
  console.log(JSON.stringify(chips, null, 2));

  // Also grab the section headings to map combobox -> field name.
  const sections = await page.evaluate(() => {
    return [...document.querySelectorAll('[class*="title__"]')].map(t => (t.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 30);
  });
  console.log('\n===== FIELD TITLES =====');
  console.log(JSON.stringify(sections, null, 2));

  await ctx.close();
  console.log('\nDone (read-only, nothing changed).');
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
