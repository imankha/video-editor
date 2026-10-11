import fs from 'fs';
import { chromium, BASE, login, OUT, SIZES, mkCtx, shot, waitHome, tab, mkLogger, overflow, smallTargets } from './lib.mjs';
const b = await chromium.launch();
const res = [], logs = [];
let n = 0;
for (const [w,h] of SIZES) {
  const ctx = await mkCtx(b,w,h); await login(ctx);
  const p = await ctx.newPage(); let tag = `blank ${w}x${h} home`; mkLogger(p, ()=>tag, logs);
  await p.goto(BASE); await waitHome(p);
  for (const t of ['Games','Clips','Finished']) {
    tag = `blank ${w}x${h} ${t}`;
    if (t!=='Games') { await tab(p,t); }
    const ov = await overflow(p); const st = (w<800||h<500) ? await smallTargets(p) : [];
    res.push({w,h,screen:'blank-'+t, ov, small: st});
    await shot(p, `rr-00-blank-${t.toLowerCase()}-${w}x${h}`);
  }
  await ctx.close();
}
fs.writeFileSync(OUT+'/scripts/blank-sweep.json', JSON.stringify({res,logs},null,1));
console.log(JSON.stringify(res.map(r=>({s:r.screen,w:r.w,doc:r.ov.docOverflow,sc:r.ov.scrollers,wide:r.ov.wideCount, small:r.small.length})))); console.log(logs.length);
await b.close();
