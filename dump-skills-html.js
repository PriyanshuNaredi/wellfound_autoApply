/**
 * READ-ONLY: dump the HTML of the "Your Skills" container and broadly locate any
 * element containing "New Business Development" to learn the chip/remove structure.
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

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, '.wellfound-chrome-profile'), {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1400, height: 1400 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  await page.goto('https://wellfound.com/profile/edit', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(4000);

  const data = await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    // Broad search for the skill text.
    const matches = [...document.querySelectorAll('*')].filter(el => norm(el.textContent).includes('New Business Development'));
    // Tightest match = smallest subtree.
    let tightest = null;
    for (const el of matches) {
      if (!tightest || el.querySelectorAll('*').length < tightest.querySelectorAll('*').length) tightest = el;
    }
    // Skills container: walk up from "Your Skills" heading.
    const heads = [...document.querySelectorAll('div,h1,h2,h3,h4')].filter(e => norm(e.textContent) === 'Your Skills');
    let container = heads[0];
    for (let k = 0; k < 5 && container; k++) { container = container.parentElement; if (container && container.textContent.length > 150) break; }
    return {
      matchCount: matches.length,
      tightestTag: tightest ? tightest.tagName : null,
      tightestClass: tightest ? String(tightest.className).slice(0, 100) : null,
      tightestHTML: tightest ? tightest.outerHTML.slice(0, 900) : 'none',
      containerHTML: container ? container.outerHTML.slice(0, 4000) : 'none',
    };
  });

  console.log('===== TIGHTEST "New Business Development" MATCH =====');
  console.log('tag:', data.tightestTag, '| class:', data.tightestClass, '| total matches:', data.matchCount);
  console.log(data.tightestHTML);
  console.log('\n===== SKILLS CONTAINER HTML (trimmed) =====');
  console.log(data.containerHTML);
  fs.writeFileSync(path.join(OUT, 'skills-container.txt'), data.containerHTML);

  await ctx.close();
  console.log('\nDone (read-only).');
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
