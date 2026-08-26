/**
 * Corrected capture: drive the LOCATION combobox ("Where are you based?") specifically,
 * log every GraphQL op, and ABORT mutations so the profile is never changed.
 * Goal: capture the location autocomplete query + the save mutation (name/operationId/vars).
 */
const path = require('path');
const fs = require('fs');
let chromium;
try {
  const { addExtra } = require('playwright-extra');
  chromium = addExtra(require('playwright-core').chromium);
  chromium.use(require('puppeteer-extra-plugin-stealth')());
} catch (e) { ({ chromium } = require('playwright-core')); }

const OUT = path.join(__dirname, 'explore-out');
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, '.wellfound-chrome-profile'), {
    channel: 'chrome', headless: false, viewport: { width: 1400, height: 1000 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  const gql = [];
  const state = { block: false }; // flipped right before option click -> abort everything after
  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() || '';
    let opName = '', query = '', isMutation = false;
    try { const p = JSON.parse(body); opName = p.operationName || ''; query = (p.query || '').replace(/\s+/g, ' '); isMutation = /^\s*mutation/i.test(query) || /save|update|create|delete|mutation/i.test(opName); } catch (e) {}
    gql.push(`[${state.block ? 'BLOCKED' : (isMutation ? 'MUTATION' : 'query')}] ${opName}\nBODY: ${body.slice(0, 1500)}\n==========`);
    log(`  gql ${state.block ? 'BLOCKED' : (isMutation ? 'MUTATION' : 'query')}: ${opName}`);
    if (state.block || isMutation) { log(`    -> ABORTED (profile protection)`); return route.abort(); }
    return route.continue();
  });

  await page.goto('https://wellfound.com/profile/edit', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);

  // Locate the LOCATION combobox via its label text (ids are dynamic per load).
  const findLocCombo = () => page.evaluateHandle(() => {
    const titles = [...document.querySelectorAll('div')].filter(d =>
      /^where are you based\??$/i.test((d.textContent || '').replace(/\s+/g, ' ').trim()) && d.children.length === 0);
    for (const t of titles) {
      let node = t;
      for (let i = 0; i < 8 && node; i++) {
        const cb = node.querySelector ? node.querySelector('[role="combobox"]') : null;
        if (cb) return cb;
        node = node.parentElement;
      }
    }
    return null;
  });

  const comboHandle = await findLocCombo();
  const combo = comboHandle.asElement();
  if (!combo) { log('!! location combobox not found'); await ctx.close(); return; }
  log('location combobox found. text =', await combo.evaluate(el => el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)));

  await combo.click().catch(e => log('click failed', e.message.split('\n')[0]));
  await page.waitForTimeout(1200);

  // After click, find the now-visible input inside the combobox.
  const inputInfo = await combo.evaluate(el => {
    const inp = el.querySelector('input');
    return { hasInput: !!inp, expanded: el.getAttribute('aria-expanded'), ph: inp ? inp.placeholder : null, id: inp ? inp.id : null };
  });
  log('after click:', JSON.stringify(inputInfo));

  const input = await combo.$('input');
  if (!input) { log('!! no input appeared'); await ctx.close(); return; }
  await input.fill('New York').catch(e => log('fill failed', e.message.split('\n')[0]));
  await page.waitForTimeout(2500);

  const opts = await page.evaluate(() => ({
    options: [...document.querySelectorAll('[role="option"], [role="listbox"] li, [role="listbox"] [class*="option" i]')].slice(0, 12)
      .map(o => ({ role: o.getAttribute('role'), text: (o.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) })),
    listboxHTML: (document.querySelector('[role="listbox"]') || {}).outerHTML?.slice(0, 1000) || 'none',
  }));
  log('\nAUTOCOMPLETE after typing "New York":\n' + JSON.stringify(opts, null, 2));

  // Select the first real option (stages change; save mutation will be aborted for safety).
  const firstOpt = page.locator('[role="option"]').first();
  if (await firstOpt.count()) {
    state.block = true; // from here on, abort every GraphQL write so the profile can't change
    await firstOpt.click().catch(e => log('option click failed', e.message.split('\n')[0]));
    await page.waitForTimeout(2500);
    log('clicked first option (all saves blocked)');
  } else { log('!! no option appeared'); }

  // In case a save button appears after selection, describe it (do not click).
  const saveInfo = await page.evaluate(() => [...document.querySelectorAll('button,[type="submit"],a[role="button"]')]
    .filter(b => /save|update|submit|done/i.test(b.textContent || '') && b.offsetParent !== null)
    .map(b => ({ tag: b.tagName, text: b.textContent.trim().slice(0, 40), type: b.getAttribute('type') })));
  log('\nSAVE controls visible after selection (not clicked):', JSON.stringify(saveInfo));

  fs.writeFileSync(path.join(OUT, 'location-save2.txt'), gql.join('\n\n'));
  log('\nCaptured ' + gql.length + ' GraphQL ops -> explore-out/location-save2.txt');
  await page.waitForTimeout(1000);
  await ctx.close();
  log('Done (profile unchanged).');
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
