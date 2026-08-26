/**
 * Final end-to-end test of the location-fix mechanism (clear-button recipe):
 *   1. Read the current location value.
 *   2. Click the ✕ clear button on the display-only combobox -> editable input.
 *   3. Type the target, wait for LocationTagAutocompleteField options.
 *   4. Select the best-matching option (keyboard Enter, mouse fallback).
 *   5. Reload and verify the value persisted server-side.
 * Sets Syracuse (the user's intended default). If the value is already Syracuse,
 * it round-trips through New York first to prove the mechanism, then back.
 */
const path = require('path');
let chromium;
try {
  const { addExtra } = require('playwright-extra');
  chromium = addExtra(require('playwright-core').chromium);
  chromium.use(require('puppeteer-extra-plugin-stealth')());
} catch (e) { ({ chromium } = require('playwright-core')); }

const FINAL_TARGET = 'Syracuse';
const ROUND_TRIP = 'New York';
const log = (...a) => console.log(...a);
const results = [];
const check = (name, pass, detail) => { results.push({ name, pass, detail }); log(`${pass ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, '.wellfound-chrome-profile'), {
    channel: 'chrome', headless: false, viewport: { width: 1400, height: 1000 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  const gqlOps = [];
  page.on('request', (req) => {
    if (!req.url().includes('/graphql') || req.method() !== 'POST') return;
    try {
      const body = JSON.parse(req.postData() || '{}');
      const q = (body.query || '').replace(/\s+/g, ' ');
      const isMut = /^\s*mutation/i.test(q) || /save|update/i.test(body.operationName || '');
      gqlOps.push({ op: body.operationName || '(anon)', mutation: isMut, vars: JSON.stringify(body.variables || {}).slice(0, 500) });
      if (isMut) log(`  >> MUTATION: ${body.operationName || '(anon)'} ${JSON.stringify(body.variables || {}).slice(0, 300)}`);
    } catch (e) {}
  });

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

  // Change the location using the clear-button recipe. Returns a status string.
  const updateLocation = async (target) => {
    // 1. ensure the editable input is present: click the ✕ clear button first
    const hasInput = await page.evaluate(() => {
      const titles = [...document.querySelectorAll('div')].filter((d) =>
        /^where are you based\??$/i.test((d.textContent || '').replace(/\s+/g, ' ').trim()) && d.children.length === 0);
      for (const t of titles) {
        let node = t;
        for (let i = 0; i < 10 && node; i++) {
          if (node.querySelector && node.querySelector('input')) return true;
          if (node.querySelector && node.querySelector('[role="combobox"]')) break;
          node = node.parentElement;
        }
      }
      return false;
    });

    if (!hasInput) {
      const cleared = await page.evaluate(() => {
        const titles = [...document.querySelectorAll('div')].filter((d) =>
          /^where are you based\??$/i.test((d.textContent || '').replace(/\s+/g, ' ').trim()) && d.children.length === 0);
        for (const t of titles) {
          let node = t;
          for (let i = 0; i < 10 && node; i++) {
            const cb = node.querySelector ? node.querySelector('[role="combobox"]') : null;
            if (cb) {
              const btn = cb.querySelector('[class*="close" i]');
              if (btn) {
                btn.scrollIntoView({ block: 'center' });
                btn.click();
                return true;
              }
              return false;
            }
            node = node.parentElement;
          }
        }
        return false;
      });
      if (!cleared) return 'clear button not found / not clicked';
      await page.waitForTimeout(2000);
    }

    // 2. type into the fresh input (placeholder "e.g. San Francisco")
    const input = page.locator('input[placeholder*="e.g." i], input[id^="downshift-"][id$="-input"]').first();
    if (!(await input.count())) return 'editable input did not appear after clear';
    await input.click();
    await input.press('Control+a');
    await input.press('Delete');
    await input.pressSequentially(target, { delay: 80 });
    await page.waitForTimeout(3500);

    // 3. collect visible options
    const opts = page.locator('[role="option"]');
    const count = await opts.count();
    const texts = [];
    for (let i = 0; i < Math.min(count, 10); i++) texts.push(((await opts.nth(i).textContent()) || '').replace(/\s+/g, ' ').trim());
    log(`  options (${count}): ${JSON.stringify(texts)}`);
    if (!count) return 'no autocomplete options';

    const wanted = target.split(',')[0];
    let pick = texts.findIndex((t) => new RegExp(`^${wanted}`, 'i').test(t));
    if (pick === -1) pick = texts.findIndex((t) => new RegExp(wanted, 'i').test(t));
    if (pick === -1) pick = 0;
    log(`  picking option ${pick}: "${texts[pick]}"`);

    // 4. keyboard select (Downshift), mouse fallback
    gqlOps.length = 0;
    for (let k = 0; k <= pick; k++) await input.press('ArrowDown');
    await input.press('Enter');
    await page.waitForTimeout(4000);
    let muts = gqlOps.filter((o) => o.mutation);
    if (!muts.length) {
      const box = await opts.nth(pick).boundingBox({ timeout: 4000 }).catch(() => null);
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(4000);
        muts = gqlOps.filter((o) => o.mutation);
      }
    }
    return muts.length ? 'ok | saved via ' + muts.map((m) => m.op).join(',') : 'option chosen but no save mutation seen';
  };

  try {
    await page.goto('https://wellfound.com/profile/edit', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(7000);

    const original = await readLocationValue();
    log(`Current profile location: "${original}"`);

    // Round trip first if already Syracuse, so the mechanism is actually proven.
    const needsRoundTrip = new RegExp(FINAL_TARGET, 'i').test(original);
    if (needsRoundTrip) {
      const r0 = await updateLocation(ROUND_TRIP);
      check(`round-trip change to ${ROUND_TRIP}`, r0.startsWith('ok'), r0);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(7000);
      const mid = await readLocationValue();
      check(`${ROUND_TRIP} persisted after reload`, new RegExp(ROUND_TRIP.split(',')[0], 'i').test(mid), `value="${mid}"`);
    }

    const r1 = await updateLocation(FINAL_TARGET);
    check(`set final location ${FINAL_TARGET}`, r1.startsWith('ok'), r1);

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(7000);
    const final = await readLocationValue();
    log(`Final value after reload: "${final}"`);
    check(`final location persisted as ${FINAL_TARGET}`, new RegExp(FINAL_TARGET, 'i').test(final), `value="${final}"`);
  } finally {
    await ctx.close();
  }

  const failed = results.filter((r) => !r.pass).length;
  log(`\n${results.length - failed}/${results.length} checks passed${failed ? ' — ' + failed + ' FAILED' : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e.message.split('\n')[0]); process.exit(1); });