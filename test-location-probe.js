/**
 * Diagnostic probe (read-mostly):
 *   1. Clean up any junk skill an earlier mis-scoped test may have saved
 *      ("New Business Development").
 *   2. Figure out how the LOCATION combobox on /profile/edit opens:
 *      try display-click, keyboard focus+ArrowDown/Space/Enter, and the
 *      ?field=LOCATION deep link. Verify the opened listbox belongs to the
 *      same downshift id before interacting (prevents hitting the skills box).
 * No location value is changed by this probe.
 */
const path = require('path');
let chromium;
try {
  const { addExtra } = require('playwright-extra');
  chromium = addExtra(require('playwright-core').chromium);
  chromium.use(require('puppeteer-extra-plugin-stealth')());
} catch (e) { ({ chromium } = require('playwright-core')); }

const log = (...a) => console.log(...a);

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, '.wellfound-chrome-profile'), {
    channel: 'chrome', headless: false, viewport: { width: 1400, height: 1000 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  try {
    await page.goto('https://wellfound.com/profile/edit', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(7000);

    // ---------- 1. skills cleanup ----------
    const junk = 'New Business Development';
    const skillsInfo = await page.evaluate((junkName) => {
      const sec = [...document.querySelectorAll('div')].find((d) => /^your skills$/i.test((d.textContent || '').trim()) && d.children.length === 0);
      if (!sec) return { found: false, reason: 'no skills section', chips: [] };
      let node = sec;
      for (let i = 0; i < 8 && node; i++) { if (node.querySelectorAll && node.querySelectorAll('button').length > 2) break; node = node.parentElement; }
      const chips = [...(node ? node.querySelectorAll('[class*="chip" i], [class*="tag" i], li') : [])]
        .map((c) => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 40);
      const hasJunk = chips.some((c) => c.toLowerCase().includes(junkName.toLowerCase()));
      return { found: true, hasJunk, chips };
    }, junk);
    log('SKILLS:', JSON.stringify(skillsInfo, null, 2));

    if (skillsInfo.hasJunk) {
      // find the chip containing the junk name and click its remove control
      const removed = await page.evaluate((junkName) => {
        const els = [...document.querySelectorAll('span, div, li')].filter((e) =>
          e.children.length <= 4 && new RegExp(junkName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(e.textContent || '') &&
          (e.textContent || '').trim().length < junkName.length + 30);
        for (const el of els.reverse()) {
          const btn = el.querySelector('button, [role="button"], svg') || el.closest('[class*="chip" i], [class*="tag" i]')?.querySelector('button, [role="button"]');
          if (btn) { btn.click(); return true; }
          el.click(); return true;
        }
        return false;
      }, junk);
      log(`junk-skill removal attempt: ${removed ? 'clicked' : 'no element found'}`);
      await page.waitForTimeout(3000);
      const recheck = await page.evaluate((junkName) =>
        new RegExp(junkName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(document.body.innerText || ''), junk);
      log(`junk skill still present after removal: ${recheck}`);
    } else {
      log('no junk skill present — nothing to clean up');
    }

    // ---------- 2. locate the location combobox ----------
    const anchor = await page.evaluate(() => {
      const titles = [...document.querySelectorAll('div')].filter((d) =>
        /^where are you based\??$/i.test((d.textContent || '').replace(/\s+/g, ' ').trim()) && d.children.length === 0);
      for (const t of titles) {
        let node = t;
        for (let i = 0; i < 10 && node; i++) {
          const cb = node.querySelector ? node.querySelector('[role="combobox"]') : null;
          if (cb) {
            node.setAttribute('data-aa-loc', '1');
            const labelledBy = cb.getAttribute('aria-labelledby') || '';
            const num = (labelledBy.match(/downshift-(\d+)/) || [])[1] || '';
            return { labelledBy, num, html: cb.outerHTML.slice(0, 1200) };
          }
          node = node.parentElement;
        }
      }
      return null;
    });
    if (!anchor) { log('FATAL: location combobox not found'); process.exit(1); }
    log(`LOCATION COMBOBOX: aria-labelledby=${anchor.labelledBy} num=${anchor.num}\n${anchor.html}`);

    const state = () => page.evaluate((num) => {
      const cb = document.querySelector('[data-aa-loc="1"] [role="combobox"]');
      const menu = num ? document.getElementById(`downshift-${num}-menu`) : null;
      return {
        expanded: cb ? cb.getAttribute('aria-expanded') : null,
        inputInCb: cb ? !!cb.querySelector('input') : false,
        inputPh: cb && cb.querySelector('input') ? cb.querySelector('input').placeholder : null,
        menuPresent: !!menu,
        menuOptions: menu ? [...menu.children].slice(0, 8).map((c) => c.textContent.replace(/\s+/g, ' ').trim()) : [],
      };
    }, anchor.num);

    // Strategy A: click the display text area
    await page.locator('[data-aa-loc="1"] [role="combobox"]').first().click();
    await page.waitForTimeout(1500);
    log('A) after display-click:', JSON.stringify(await state()));

    // Strategy B: keyboard on the focused combobox
    const cb = page.locator('[data-aa-loc="1"] [role="combobox"]').first();
    await cb.click(); // focus
    for (const key of ['ArrowDown', ' ', 'Enter']) {
      let s = await state();
      if (s.expanded === 'true' || s.inputInCb) break;
      await page.keyboard.press(key);
      await page.waitForTimeout(1200);
      log(`B) after keyboard "${key}":`, JSON.stringify(await state()));
    }

    // close whatever opened (Escape) so nothing gets selected
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    await page.mouse.click(10, 10);
    await page.waitForTimeout(800);

    // Strategy C: deep link to the field
    await page.goto('https://wellfound.com/profile/edit?field=LOCATION', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(7000);
    const deepState = await page.evaluate(() => {
      const titles = [...document.querySelectorAll('div')].filter((d) =>
        /^where are you based\??$/i.test((d.textContent || '').replace(/\s+/g, ' ').trim()) && d.children.length === 0);
      for (const t of titles) {
        let node = t;
        for (let i = 0; i < 10 && node; i++) {
          if (node.querySelector && node.querySelector('input')) {
            const inp = node.querySelector('input');
            return { inputFound: true, placeholder: inp.placeholder, html: node.outerHTML.slice(0, 2000) };
          }
          if (node.querySelector && node.querySelector('[role="combobox"]')) {
            const cb = node.querySelector('[role="combobox"]');
            return { inputFound: !!cb.querySelector('input'), expanded: cb.getAttribute('aria-expanded'), html: cb.outerHTML.slice(0, 2000) };
          }
          node = node.parentElement;
        }
      }
      return { inputFound: false };
    });
    log('C) ?field=LOCATION deep link:', JSON.stringify(deepState, null, 2));

    log('probe done');
  } finally {
    await ctx.close();
  }
})().catch((e) => { console.error('FATAL:', e.message.split('\n')[0]); process.exit(1); });