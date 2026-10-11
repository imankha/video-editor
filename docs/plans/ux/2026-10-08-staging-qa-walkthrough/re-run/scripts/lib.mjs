import { createRequire } from 'module';
const require = createRequire('C:/Users/imank/projects/video-editor/src/frontend/package.json');
export const { chromium } = require('playwright');
import fs from 'fs';
export const BASE = 'https://reel-ballers-staging.pages.dev';
export const API = 'https://reel-ballers-api-staging.fly.dev/api';
export const OUT = 'C:/Users/imank/projects/video-editor/docs/plans/ux/2026-10-08-staging-qa-walkthrough/re-run';
export const STATE = OUT + '/scripts/state.json';
export async function login(context) {
  for (let i = 0; i < 6; i++) {
    const r = await context.request.post(API + '/auth/test-login', { headers: { 'X-Test-Mode': 'true' } });
    if (r.ok()) return await r.json();
    console.log('login try', i, r.status());
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('login failed');
}
export function mkLogger(page, tag, sink) {
  page.on('console', m => { if (['error','warning'].includes(m.type())) sink.push({tag: tag(), type: m.type(), text: m.text().slice(0,300)}); });
  page.on('pageerror', e => sink.push({tag: tag(), type: 'pageerror', text: String(e).slice(0,300)}));
  page.on('response', r => { if (r.status() >= 400) sink.push({tag: tag(), type: 'http'+r.status(), text: r.request().method()+' '+r.url().slice(0,200)}); });
  page.on('requestfailed', r => sink.push({tag: tag(), type: 'reqfailed', text: r.url().slice(0,160)+' '+(r.failure()?.errorText)}));
}
export async function overflow(page) {
  return await page.evaluate(() => {
    const vw = window.innerWidth;
    const d = document.documentElement;
    const wide = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display==='none') continue;
        wide.push((el.getAttribute('data-testid')||el.tagName+'.'+String(el.className).slice(0,30))+` [${Math.round(r.left)},${Math.round(r.right)}]`);
      }
    }
    const scrollers = [];
    for (const el of document.querySelectorAll('*')) {
      const ox = getComputedStyle(el).overflowX;
      if ((ox==='auto'||ox==='scroll') && el.clientHeight >= innerHeight*0.5 && el.scrollWidth - el.clientWidth > 1) scrollers.push(`${el.tagName}.${String(el.className).slice(0,30)} +${el.scrollWidth-el.clientWidth}`);
    }
    return { vw, docOverflow: d.scrollWidth > d.clientWidth, scrollers, wide: wide.slice(0,8), wideCount: wide.length };
  });
}
export async function smallTargets(page) {
  return await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button,a[href],[role=button],input,select,[role=tab]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom < 0 || r.top > innerHeight) continue;
      if (r.width < 44 || r.height < 44) out.push(`${(el.getAttribute('aria-label')||el.textContent||el.tagName).trim().slice(0,25)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
}
export const SIZES = [[320,568],[360,740],[375,667],[390,844],[768,1024],[1024,768],[1440,900],[844,390],[1920,1080]];
export function mkCtx(b, w, h) {
  const touch = w < 800 || h < 500;
  return b.newContext({ viewport:{width:w,height:h}, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
}
export async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 70 });
}
export async function waitHome(page) {
  await page.waitForFunction(() => document.body.innerText.includes('Upload game') && !document.body.innerText.includes('Loading data'), null, { timeout: 90000 }).catch(()=>{});
  await page.waitForTimeout(2500);
}
export async function tab(page, t) {
  const el = page.locator(`button:has-text("${t}")`).first();
  await el.click({timeout:5000}).catch(async e=>{ console.log('tab click fail', t, String(e).slice(0,80)); await el.click({force:true}).catch(()=>{}); });
  await page.waitForTimeout(1500);
}
