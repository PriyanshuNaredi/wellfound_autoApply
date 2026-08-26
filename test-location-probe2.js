/**
 * Probe #2: the location combobox stayed closed in probe #1. Hypotheses:
 *   a) an overlay modal (opt-in prompt) is stealing the clicks
 *   b) Downshift opens on mousedown, not click
 *   c) the inner value div owns the handler, not the combobox root
 * This probe dismisses overlays, then tries real mousedown / inner-target clicks,
 * reporting aria-expanded + input presence each step. Nothing is saved.
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

    // ---- 0. survey overlays ----
    const overlays = await page.evaluate(() => {
      const cands = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="Modal" i], [class*="overlay" i]')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 100 && r.height > 100 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
        });
      return cands.map((el) => ({
        tag: el.tagName, role: el.getAttribute('role'), cls: (el.className || '').toString().slice(0, 80),
        text: (el.textContent || '').replace(/\s+/g, ' ').slice(0, 150),
        z: getComputedStyle(el).zIndex,
      }));
    });
    log('VISIBLE OVERLAYS:', JSON.stringify(overlays, null, 2));

    // dismiss: Escape, then any close/cancel button inside the top overlay
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    const dismissed = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[role="dialog"] button, [aria-modal="true"] button, [class*="modal" i] button')]
        .filter((b) => b.offsetParent !== null && /close|cancel|dismiss|no thanks|not now|later|×|✕/i.test(b.textContent + ' ' + (b.getAttribute('aria-label') || '')));
      if (btns.length) { btns[0].click(); return btns[0].textContent.trim(); }
      return null;
    });
    log(`overlay dismiss clicked: ${dismissed || '(no close button found)'}`);
    await page.waitForTimeout(1500);

    // ---- anchor the location section ----
    const num = await page.evaluate(() => {
      const titles = [...document.querySelectorAll('div')].filter((d) =>
        /^where are you based\??$/i.test((d.textContent || '').replace(/\s+/g, ' ').trim()) && d.children.length === 0);
      for (const t of titles) {
        let node = t;
        for (let i = 0; i < 10 && node; i++) {
          const cb = node.querySelector ? node.querySelector('[role="combobox"]') : null;
          if (cb) {
            node.setAttribute('data-aa-loc', '1');
            const m = (cb.getAttribute('aria-labelledby') || '').match(/downshift-(\d+)/);
            return m ? m[1] : '';
          }
          node = node.parentElement;
        }
      }
      return null;
    });
    if (!num) { log('FATAL: combobox not found'); process.exit(1); }
    log(`location combobox downshift id: ${num}`);

    const state = (label) => page.evaluate((n) => {
      const cb = document.querySelector('[data-aa-loc="1"] [role="combobox"]');
      const menu = document.getElementById(`downshift-${n}-menu`);
      const s = {
        expanded: cb.getAttribute('aria-expanded'),
        inputInCb: !!cb.querySelector('input'),
        menuPresent: !!menu,
        menuVisible: menu ? getComputedStyle(menu).display !== 'none' : false,
        menuOptions: menu ? [...menu.querySelectorAll('[role="option"], li, div')].slice(0, 8).map((c) => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean) : [],
        bodyListboxes: [...document.querySelectorAll('[role="listbox"]')].map((l) => (l.id || '') + ':' + [...l.children].slice(0, 6).map((c) => c.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)).join('|')),
      };
      return s;
    }, num).then((s) => { log(`${label}:`, JSON.stringify(s)); return s; });

    await state('baseline');

    // ---- attempt 1: raw mousedown on the combobox root ----
    await page.evaluate(() => {
      const cb = document.querySelector('[data-aa-loc="1"] [role="combobox"]');
      cb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      cb.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      cb.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    });
    await page.waitForTimeout(1500);
    let s = await state('1) synthetic mousedown on combobox root');
    if (s.expanded === 'true' || s.inputInCb) { log('>> opened via synthetic mousedown'); }

    // ---- attempt 2: Playwright click on the inner value div ----
    if (s.expanded !== 'true' && !s.inputInCb) {
      await page.locator('[data-aa-loc="1"] .styles_wide__VdZg9, [data-aa-loc="1"] [class*="wide" i]').first().click({ force: true }).catch(() => { });
      await page.waitForTimeout(1500);
      s = await state('2) click inner value div (force)');
    }

    // ---- attempt 3: real mouse events at the combobox center ----
    if (s.expanded !== 'true' && !s.inputInCb) {
      const box = await page.locator('[data-aa-loc="1"] [role="combobox"]').first().boundingBox();
      if (box) {
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        const top = await page.evaluate(([px, py]) => {
          const el = document.elementFromPoint(px, py);
          let chain = []; let n = el;
          for (let i = 0; i < 6 && n; i++) { chain.push(n.tagName + (n.className ? '.' + String(n.className).slice(0, 30) : '')); n = n.parentElement; }
          return chain.join(' > ');
        }, [x, y]);
        log(`3) elementFromPoint chain: ${top}`);
        await page.mouse.click(x, y);
        await page.waitForTimeout(1500);
        s = await state('3) page.mouse.click at combobox center');
      }
    }

    // ---- attempt 4: focus then type a character ----
    if (s.expanded !== 'true' && !s.inputInCb) {
      await page.locator('[data-aa-loc="1"] [role="combobox"]').first().click();
      await page.keyboard.type('n', { delay: 200 });
      await page.waitForTimeout(1500);
      s = await state('4) click + type one char');
    }

    // ---- attempt 5: navigate to /profile/edit/overview instead ----
    if (s.expanded !== 'true' && !s.inputInCb) {
      await page.goto('https://wellfound.com/profile/edit/overview', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(7000);
      const overview = await page.evaluate(() => {
        const titles = [...document.querySelectorAll('div')].filter((d) =>
          /where are you based|location/i.test((d.textContent || '').trim()) && d.children.length === 0 && d.textContent.trim().length < 40);
        const inputs = [...document.querySelectorAll('input')].filter((i) => i.offsetParent !== null)
          .map((i) => ({ ph: i.placeholder, id: i.id.slice(0, 50), name: i.name }));
        return { titles: titles.map((t) => t.textContent.trim()).slice(0, 6), inputs };
      });
      log('5) /profile/edit/overview survey:', JSON.stringify(overview, null, 2));
    }

    // screenshot the location area for visual confirmation
    const cbBox = await page.locator('[role="combobox"][aria-labelledby$="-label"]').first().boundingBox().catch(() => null);
    if (cbBox) {
      await page.screenshot({ path: 'explore-out/loc-probe2.png', clip: { x: Math.max(0, cbBox.x - 50), y: Math.max(0, cbBox.y - 80), width: cbBox.width + 100, height: 300 } });
      log('screenshot saved: explore-out/loc-probe2.png');
    }

    log('probe2 done');
  } finally {
    await ctx.close();
  }
})().catch((e) => { console.error('FATAL:', e.message.split('\n')[0]); process.exit(1); });