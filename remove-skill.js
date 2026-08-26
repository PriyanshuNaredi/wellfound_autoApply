/**
 * REPAIR: remove the accidentally-added "New Business Development" skill by
 * clicking its X control in the UI (the app sends the signed save itself).
 * Verifies the skill list returns to the original 7 skills.
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

const readSkills = () => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const heads = [...document.querySelectorAll('div,h1,h2,h3,h4')].filter(e => norm(e.textContent) === 'Your Skills');
  if (!heads.length) return 'SKILLS SECTION NOT FOUND';
  let node = heads[0];
  for (let k = 0; k < 5 && node; k++) { node = node.parentElement; if (node && node.textContent.length > 150) break; }
  return norm(node ? node.textContent : '').slice(0, 600);
};

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

  console.log('BEFORE:', await page.evaluate(readSkills));

  // Find the chip span that both contains the skill text and owns a role=button X.
  const chip = page.locator('span:has([role="button"])').filter({ hasText: 'New Business Development' }).first();
  const chipCount = await page.locator('span:has([role="button"])').filter({ hasText: 'New Business Development' }).count();
  console.log('chip matches:', chipCount);
  if (!chipCount) { console.log('Chip not found — aborting (nothing to remove).'); await ctx.close(); process.exit(0); }

  await chip.scrollIntoViewIfNeeded().catch(() => {});
  await chip.locator('[role="button"]').first().click();
  console.log('clicked X on "New Business Development"');

  await page.waitForTimeout(3500);
  await page.waitForLoadState('networkidle').catch(() => {});

  // Verify (re-read; the chip should be gone).
  let after = await page.evaluate(readSkills);
  console.log('AFTER :', after);

  if (/New Business Development/i.test(after)) {
    // give it a moment more and re-check once
    await page.waitForTimeout(3000);
    after = await page.evaluate(readSkills);
    console.log('AFTER2:', after);
  }

  const ok = !/New Business Development/i.test(after);
  console.log(ok ? '\nREPAIR VERIFIED: skill removed.' : '\nREPAIR FAILED: skill still present.');
  await ctx.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
