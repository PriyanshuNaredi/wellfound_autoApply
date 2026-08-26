/**
 * Capture the Wellfound location-save mechanism by driving the /profile/edit
 * combobox, WITHOUT permanently changing the profile:
 *   - logs every GraphQL operation (text only)
 *   - ABORTS any mutation that looks like a profile/location update so nothing persists
 * Goal: learn the exact mutation name + variables + the combobox interaction steps.
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
const log = (...a) => console.log(...a);

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, '.wellfound-chrome-profile'), {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1400, height: 1000 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  const gql = [];
  await page.route('**/graphql', async (route) => {
    const req = route.request();
    const body = req.postData() || '';
    let opName = '', query = '';
    try { const p = JSON.parse(body); opName = p.operationName || ''; query = (p.query || '').replace(/\s+/g, ' '); } catch (e) {}
    const isMutation = /^\s*mutation/i.test(query);
    gql.push(`[${isMutation ? 'MUTATION' : 'query'}] ${opName}\nVARS: ${body.slice(0, 1200)}\nQUERY: ${query.slice(0, 900)}\n==========`);
    log(`  gql ${isMutation ? 'MUTATION' : 'query'}: ${opName}`);
    // Protect the profile: abort EVERY mutation during exploration so nothing persists.
    if (isMutation) {
      log(`    -> ABORTED (profile protection): ${opName || '(unnamed)'}`);
      return route.abort();
    }
    return route.continue();
  });

  await page.goto('https://wellfound.com/profile/edit', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);

  // 1) Describe the location combobox before interaction.
  const before = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('div')].filter(d => /Where are you based/i.test(d.textContent || '') && d.children.length < 6);
    const cb = document.querySelector('div[role="combobox"]');
    return {
      comboboxHTML: cb ? cb.outerHTML.slice(0, 1500) : 'NOT FOUND',
      inputs: cb ? [...cb.querySelectorAll('input')].map(i => ({ ph: i.placeholder, aria: i.getAttribute('aria-label'), cls: i.className.slice(0, 60) })) : [],
    };
  });
  log('\n===== COMBOBOX BEFORE =====\n' + JSON.stringify(before, null, 2));

  // 2) Click to open.
  const cb = page.locator('div[role="combobox"]').first();
  await cb.click().catch(e => log('click failed:', e.message.split('\n')[0]));
  await page.waitForTimeout(1200);

  const after = await page.evaluate(() => {
    const cb = document.querySelector('div[role="combobox"]');
    const inp = cb ? cb.querySelector('input') : null;
    return {
      expanded: cb ? cb.getAttribute('aria-expanded') : null,
      inputPresent: !!inp,
      inputVisible: inp ? inp.offsetParent !== null : false,
      inputPh: inp ? inp.placeholder : null,
      listbox: [...document.querySelectorAll('[role="listbox"]')].map(l => l.outerHTML.slice(0, 400)),
      comboboxHTML: cb ? cb.outerHTML.slice(0, 1500) : 'NOT FOUND',
    };
  });
  log('\n===== AFTER CLICK =====\n' + JSON.stringify(after, null, 2));

  // 3) Type into the input if present.
  const input = page.locator('div[role="combobox"] input').first();
  if (await input.count()) {
    await input.fill('New York').catch(e => log('fill failed:', e.message.split('\n')[0]));
    await page.waitForTimeout(2500);
    const opts = await page.evaluate(() => ({
      options: [...document.querySelectorAll('[role="option"], [role="listbox"] li, [role="listbox"] div')].slice(0, 12).map(o => ({
        role: o.getAttribute('role'), text: (o.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      })),
      listboxHTML: (document.querySelector('[role="listbox"]') || {}).outerHTML?.slice(0, 1200) || 'none',
    }));
    log('\n===== AUTOCOMPLETE AFTER TYPING "New York" =====\n' + JSON.stringify(opts, null, 2));

    // 4) Select first option (this stages the change but does not save yet).
    const firstOpt = page.locator('[role="option"]').first();
    if (await firstOpt.count()) {
      await firstOpt.click().catch(e => log('option click failed:', e.message.split('\n')[0]));
      await page.waitForTimeout(1500);
      log('\n===== selected first option =====');
    }
  } else {
    log('No input found inside combobox after click.');
  }

  // 5) Look for a Save/submit control and describe it (do NOT click it).
  const saveInfo = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('button, [type="submit"], a[role="button"]')].filter(b => {
      const t = (b.textContent || '').trim();
      return /save|update|submit|done|apply changes/i.test(t) && b.offsetParent !== null;
    });
    return cands.map(b => ({ tag: b.tagName, text: b.textContent.trim().slice(0, 40), type: b.getAttribute('type'), dataTest: b.getAttribute('data-test') }));
  });
  log('\n===== SAVE CONTROLS (not clicked) =====\n' + JSON.stringify(saveInfo, null, 2));

  fs.writeFileSync(path.join(OUT, 'location-save-gql.txt'), gql.join('\n\n'));
  log('\nCaptured ' + gql.length + ' GraphQL ops -> explore-out/location-save-gql.txt');

  await page.waitForTimeout(1500);
  await ctx.close();
  log('Done (profile unchanged — saves were aborted).');
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
