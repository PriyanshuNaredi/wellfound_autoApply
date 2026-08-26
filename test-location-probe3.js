/**
 * Probe #3: the location combobox ignores all open attempts, but it has a
 * clear (✕) button. Hypothesis: clearing the value turns the control into an
 * editable input (Downshift single-select often does). If an input appears,
 * type the target city, select the autocomplete option, and verify the save
 * mutation + persistence. Target is Syracuse (the user's intended default),
 * so a successful run ends in the desired state.
 */
const path = require('path');
let chromium;
try {
  const { addExtra } = require('playwright-extra');
  chromium = addExtra(require('playwright-core').chromium);
  chromium.use(require('puppeteer-extra-plugin-stealth')());
} catch (e) { ({ chromium } = require('playwright-core')); }

const TARGET = 'Syracuse';
const log = (...a) => console.log(...a);

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
      log(`  gql ${isMut ? 'MUTATION' : 'query'}: ${body.operationName || '(anon)'}${isMut ? ' :: ' + JSON.stringify(body.variables || {}).slice(0, 400) : ''}`);
    } catch (e) {}
  });

  try {
    await page.goto('https://wellfound.com/profile/edit', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(7000);

    // anchor section + downshift id
    const anchor = await page.evaluate(() => {
      const titles = [...document.querySelectorAll('div')].filter((d) =>
        /^where are you based\??$/i.test((d.textContent || '').replace(/\s+/g, ' ').trim()) && d.children.length === 0);
      for (const t of titles) {
        let node = t;
        for (let i = 0; i < 10 && node; i++) {
          const cb = node.querySelector ? node.querySelector('[role="combobox"]') : null;
          if (cb) {
            node.setAttribute('data-aa-loc', '1');
            const m = (cb.getAttribute('aria-labelledby') || '').match(/downshift-(\d+)/);
            return { num: m ? m[1] : '', value: (cb.textContent || '').replace(/\s+/g, ' ').trim() };
          }
          node = node.parentElement;
        }
      }
      return null;
    });
    if (!anchor) { log('FATAL: location combobox not found'); process.exit(1); }
    log(`current value: "${anchor.value}" | downshift id: ${anchor.num}`);

    const state = (label) => page.evaluate((n) => {
      const cb = document.querySelector('[data-aa-loc="1"] [role="combobox"]');
      const menu = document.getElementById(`downshift-${n}-menu`);
      const s = {
        cbText: cb ? cb.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) : '',
        expanded: cb.getAttribute('aria-expanded'),
        inputInCb: !!cb.querySelector('input'),
        bodyInputs: [...document.querySelectorAll('input')].filter((i) => i.offsetParent !== null && !/search/i.test(i.placeholder + i.id))
          .map((i) => ({ ph: i.placeholder, id: i.id.slice(0, 60) })).slice(0, 6),
        menuOptions: menu ? [...menu.children].slice(0, 8).map((c) => c.textContent.replace(/\s+/g, ' ').trim()) : [],
      };
      return s;
    }, anchor.num).then((s) => { log(`${label}:`, JSON.stringify(s)); return s; });

    await state('before clear');

    // click the clear (✕) button inside the location section — pointer events + click
    const cleared = await page.evaluate(() => {
      const btn = document.querySelector('[data-aa-loc="1"] [class*="close" i], [data-aa-loc="1"] [role="button"]');
      if (!btn) return false;
      btn.scrollIntoView({ block: 'center' });
      for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        btn.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
      }
      return true;
    });
    log(`clear button clicked: ${cleared}`);
    await page.waitForTimeout(2500);
    let s = await state('after clear');

    // After clearing, Downshift single-select usually shows an empty input.
    const input = page.locator('[data-aa-loc="1"] input, input[id*="location" i]').first();
    if (!s.inputInCb && !(await input.count())) {
      // maybe the whole control disappeared; re-check the section
      log('no input after clear — dumping section HTML:');
      log(await page.evaluate(() => (document.querySelector('[data-aa-loc="1"]') || { outerHTML: '(gone)' }).outerHTML.slice(0, 1500)));
      process.exit(1);
    }

    // type the target city
    const inp = s.inputInCb ? page.locator('[data-aa-loc="1"] input').first() : input;
    await inp.click();
    await inp.pressSequentially(TARGET, { delay: 80 });
    await page.waitForTimeout(3500);
    s = await state('after typing target');

    // pick the right option from the LOCATION listbox only (downshift-N-menu)
    const menuOptions = s.menuOptions;
    if (!menuOptions.length) { log('no options appeared — nothing to select'); process.exit(1); }
    const wantedIdx = menuOptions.findIndex((t) => new RegExp(TARGET, 'i').test(t));
    const pickIdx = wantedIdx >= 0 ? wantedIdx : 0;
    log(`selecting option ${pickIdx}: "${menuOptions[pickIdx]}"`);

    gqlOps.length = 0;
    // keyboard select: ArrowDown to the index, Enter
    for (let k = 0; k <= pickIdx; k++) await inp.press('ArrowDown');
    await inp.press('Enter');
    await page.waitForTimeout(3500);

    const mutations = gqlOps.filter((o) => o.mutation);
    log(`mutations after Enter: ${mutations.map((m) => m.op).join(', ') || '(none)'}`);
    if (!mutations.length) {
      // mouse fallback on the menu's actual option element
      const optEl = page.locator(`#downshift-${anchor.num}-menu [role="option"], #downshift-${anchor.num}-menu li, #downshift-${anchor.num}-menu div`).nth(pickIdx);
      const box = await optEl.boundingBox({ timeout: 4000 }).catch(() => null);
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(3500);
        log(`mutations after mouse click: ${gqlOps.filter((o) => o.mutation).map((m) => m.op).join(', ') || '(none)'}`);
      }
    }

    // verify persistence
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(7000);
    const final = await page.evaluate(() => {
      const titles = [...document.querySelectorAll('div')].filter((d) =>
        /^where are you based\??$/i.test((d.textContent || '').replace(/\s+/g, ' ').trim()) && d.children.length === 0);
      for (const t of titles) {
        let node = t;
        for (let i = 0; i < 10 && node; i++) {
          const cb = node.querySelector ? node.querySelector('[role="combobox"]') : null;
          if (cb) return cb.textContent.replace(/\s+/g, ' ').trim();
          node = node.parentElement;
        }
      }
      return '';
    });
    log(`FINAL persisted value: "${final}"`);
    log(new RegExp(TARGET, 'i').test(final) ? 'SUCCESS: location is now Syracuse' : 'FAILED: location not persisted');
  } finally {
    await ctx.close();
  }
})().catch((e) => { console.error('FATAL:', e.message.split('\n')[0]); process.exit(1); });