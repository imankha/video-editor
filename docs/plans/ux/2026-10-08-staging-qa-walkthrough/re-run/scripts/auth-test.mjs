import { chromium, BASE, login, OUT } from './lib.mjs';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: {width:1440,height:900} });
console.log(await login(ctx));
const p = await ctx.newPage();
await p.goto(BASE); await p.waitForTimeout(6000);
await p.screenshot({path: OUT+'/scripts/auth-test.jpg', type:'jpeg', quality:60});
console.log(await p.evaluate(()=>document.body.innerText.slice(0,500)));
await b.close();
