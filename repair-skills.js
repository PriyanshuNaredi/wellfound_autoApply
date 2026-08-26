/**
 * REPAIR: remove the skill tag 25339 ("New Business Development") that the
 * exploration script accidentally added. Replays the same persisted GraphQL
 * operation (ProfileSaveSkills) with the original 7 skill tags, then verifies.
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

const ORIGINAL_SKILL_TAGS = ["14775", "15609", "17000", "17966", "88522", "139914", "918359"]; // without 25339

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, '.wellfound-chrome-profile'), {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1400, height: 1000 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  await page.goto('https://wellfound.com/profile/edit', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(4000);

  // 1) Replay ProfileSaveSkills with the original tag list (retry across navigations).
  let res = null;
  for (let attempt = 0; attempt < 4 && !res; attempt++) {
    try {
      res = await page.evaluate(async (tags) => {
        const r = await fetch('https://wellfound.com/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            operationName: 'ProfileSaveSkills',
            variables: { input: { skillTags: tags, userId: '21599793' } },
            extensions: { operationId: 'tfe/77e6ef40d61e30d1a307c5ad7a11c2a6504c97a5ff407c84c3b813553a97b96a' },
          }),
        });
        return { status: r.status, body: (await r.text()).slice(0, 800) };
      }, ORIGINAL_SKILL_TAGS);
    } catch (e) {
      console.log(`attempt ${attempt + 1} failed: ${e.message.split('\n')[0]}`);
      await page.waitForTimeout(2500);
    }
  }
  console.log('SAVE RESPONSE:', JSON.stringify(res, null, 2));

  // 2) Verify: reload and dump the skills area text (retry across navigations).
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(5000);
  let skillsText = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      skillsText = await page.evaluate(() => {
        const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const heads = [...document.querySelectorAll('div,h1,h2,h3,h4')].filter(e => norm(e.textContent) === 'Your Skills');
        if (!heads.length) return 'SKILLS SECTION NOT FOUND';
        let node = heads[0];
        for (let k = 0; k < 4 && node; k++) { node = node.parentElement; if (node && node.textContent.length > 120) break; }
        return norm(node ? node.textContent : '').slice(0, 600);
      });
      if (skillsText && skillsText !== 'SKILLS SECTION NOT FOUND') break;
    } catch (e) {
      console.log(`verify attempt ${attempt + 1} failed: ${e.message.split('\n')[0]}`);
    }
    await page.waitForTimeout(2500);
  }
  console.log('\nSKILLS AFTER REPAIR:', skillsText);

  const ok = !/New Business Development/i.test(skillsText);
  console.log(ok ? '\nREPAIR VERIFIED: accidental skill removed.' : '\nREPAIR FAILED: skill still present!');

  await ctx.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
