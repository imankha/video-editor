// Persistent interactive driver: usage node driver.mjs W H name ; runs code from <name>.cmd.js, writes <name>.out
import fs from 'fs';
import { chromium, BASE, API, login, OUT, mkCtx, shot, waitHome, tab, mkLogger, overflow, smallTargets } from './lib.mjs';
const [W,H,name] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const b = await chromium.launch();
const ctx = await mkCtx(b,W,H); await login(ctx);
const page = await ctx.newPage();
const logs = []; let TAG = 'init'; mkLogger(page, ()=>TAG, logs);
const dir = new URL('.', import.meta.url).pathname.replace(/^\//,'');
const cmd = dir + name + '.cmd.js', out = dir + name + '.out';
const AF = Object.getPrototypeOf(async function(){}).constructor;
const env = { page, ctx, shot, waitHome, tab, overflow, smallTargets, BASE, API, OUT, logs, setTag: t=>{TAG=t;}, fs,
  txt: async()=> (await page.evaluate(()=>document.body.innerText)).replace(/\n+/g,' | ').slice(0,1500),
  btns: async()=> await page.evaluate(()=>[...document.querySelectorAll('button,[role=button],a[href],[role=tab],input,select,textarea')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}).map(e=>{const r=e.getBoundingClientRect();return `${e.tagName}${e.getAttribute('data-testid')?'#'+e.getAttribute('data-testid'):''} "${(e.getAttribute('aria-label')||e.innerText||e.placeholder||'').trim().replace(/\n/g,' ').slice(0,40)}" ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`})),
  guide: async()=> await page.evaluate(()=>[...document.querySelectorAll('[role=status]')].map(e=>{const r=e.getBoundingClientRect();return `${e.innerText.replace(/\n/g,' ')} @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`})),
};
fs.writeFileSync(out, 'READY');
let last = '';
setInterval(async () => {
  if (!fs.existsSync(cmd)) return;
  const code = fs.readFileSync(cmd,'utf8'); if (!code || code === last) return; last = code;
  fs.writeFileSync(out, 'RUNNING');
  let res;
  try { const r = await new AF(...Object.keys(env), code)(...Object.values(env)); res = typeof r === 'string' ? r : JSON.stringify(r,null,1); }
  catch(e) { res = 'ERROR ' + e.stack.slice(0,800); }
  fs.writeFileSync(out, 'DONE\n' + res);
}, 500);
