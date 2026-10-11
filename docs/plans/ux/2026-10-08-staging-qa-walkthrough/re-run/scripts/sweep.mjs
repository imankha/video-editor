import fs from 'fs';
import { chromium, BASE, login, OUT, SIZES, mkCtx, shot, waitHome, tab, mkLogger, overflow, smallTargets } from './lib.mjs';
const only = process.argv[2] ? process.argv[2].split(',') : null;
const b = await chromium.launch();
const results = [];
const checks = (page) => page.evaluate(() => {
  const vw = innerWidth, vh = innerHeight;
  const trunc = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (el.children.length === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth + 1 && (cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis')) trunc.push(el.textContent.trim().slice(0, 40));
  }
  const cta = [...document.querySelectorAll('[data-testid=primary-cta],[data-testid=annotate-mark-play-button],#home-upload-game,[data-testid=home-upload-game]')].map(e => {
    const r = e.getBoundingClientRect(); const cx = Math.min(Math.max(r.x + r.width / 2, 0), vw - 1), cy = Math.min(Math.max(r.y + r.height / 2, 0), vh - 1);
    const top = document.elementFromPoint(cx, cy);
    return { id: e.getAttribute('data-testid') || e.id, y: Math.round(r.y), h: Math.round(r.height), inView: r.top >= 0 && r.bottom <= vh, covered: !!top && !e.contains(top) };
  });
  const status = [...document.querySelectorAll('[role=status]')].map(e => { const h = e.closest('[data-testid=floating-coach-host]'); return (h ? getComputedStyle(h).visibility : 'inline'); });
  return { trunc: trunc.slice(0, 6), cta, coach: status };
});
for (const [w, h] of SIZES) {
  if (only && !only.includes(w + 'x' + h)) continue;
  const ctx = await mkCtx(b, w, h); await login(ctx);
  const page = await ctx.newPage(); let tag = ''; const logs = []; mkLogger(page, () => tag, logs);
  const touch = w < 800 || h < 500;
  const rec = async (screen) => {
    tag = `${w}x${h} ${screen}`;
    await page.waitForTimeout(1200);
    const name = `sweep-${screen}-${w}x${h}`;
    await shot(page, name);
    const r = { w, h, screen, ov: await overflow(page).catch(e => ({ err: String(e) })), ck: await checks(page).catch(e => ({ err: String(e) })), small: touch ? await smallTargets(page).catch(() => []) : [] };
    results.push(r); console.log(w, h, screen, 'doc', r.ov.docOverflow, 'sc', (r.ov.scrollers || []).length, 'wide', r.ov.wideCount, 'ck', JSON.stringify(r.ck).slice(0, 220));
  };
  try {
    await page.goto(BASE); await waitHome(page); tag = `${w}x${h} home`;
    await rec('home-games');
    await tab(page, 'Clips'); await rec('clips');
    await tab(page, 'Finished'); await rec('finished');
    await tab(page, 'Clips');
    await page.locator('[data-testid=project-card]').first().click({ timeout: 8000 }).catch(async () => { await page.locator('[data-testid=project-card]').first().tap().catch(() => { }); });
    await page.waitForTimeout(7000);
    const modeNow = await page.evaluate(() => ['mode-annotate', 'mode-framing', 'mode-overlay'].map(id => { const e = document.getElementById(id) || document.querySelector(`[data-testid=${id}]`); return e ? id + ':' + (e.className.includes('cyan') || e.getAttribute('aria-pressed') || e.getAttribute('aria-selected')) : null; }));
    console.log('modes', JSON.stringify(modeNow));
    await page.locator('[data-testid=mode-framing]').click({ timeout: 6000 }).catch(() => { }); await page.waitForTimeout(5000); await rec('focus');
    await page.locator('[data-testid=mode-overlay]').click({ timeout: 6000 }).catch(() => { }); await page.waitForTimeout(6000); await rec('overlay');
    await page.locator('[data-testid=mode-annotate]').click({ timeout: 6000 }).catch(() => { }); await page.waitForTimeout(6000); await rec('annotate');
  } catch (e) { console.log('ERR', w, h, String(e).slice(0, 200)); }
  results.push({ w, h, screen: 'LOGS', logs: logs.filter(l => !/SLOW FETCH|telemetry|heartbeat|ERR_ABORTED/.test(l.text) || /http/.test(l.type)).slice(0, 30) });
  await ctx.close();
  fs.writeFileSync(OUT + '/scripts/sweep-' + (only ? only.join('_') : 'all') + '.json', JSON.stringify(results, null, 1));
}
await b.close();
