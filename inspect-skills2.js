/**
 * READ-ONLY: dump every combobox on /profile/edit with its label + full text,
 * and the raw text of the "Your Skills" area, to see the current skill list.
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

  await page.goto('https://wellfound.com/profile/edit', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);

  const data = await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const comboboxes = [...document.querySelectorAll('div[role="combobox"]')].map((cb, i) => {
      const lid = cb.getAttribute('aria-labelledby') || '';
      return {
        i,
        label: lid ? norm(document.getElementById(lid)?.textContent || '') : '',
        text: norm(cb.textContent).slice(0, 300),
        chips: [...cb.querySelectorAll('[class*="close__"]')].length,
      };
    });
    // Find the "Your Skills" heading and grab the following block's text.
    let skillsText = '';
    const heads = [...document.querySelectorAll('div,h1,h2,h3,h4')].filter(e => norm(e.textContent) === 'Your Skills');
    if (heads.length) {
      let node = heads[0];
      for (let k = 0; k < 4 && node; k++) { node = node.parentElement; if (node && node.textContent.length > 120) break; }
      skillsText = norm(node ? node.textContent : '').slice(0, 600);
    }
    return { comboboxes, skillsText };
  });

  console.log('===== COMBOBOXES =====');
  console.log(JSON.stringify(data.comboboxes, null, 2));
  console.log('\n===== YOUR SKILLS AREA TEXT =====');
  console.log(data.skillsText);

  await ctx.close();
  console.log('\nDone (read-only).');
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
