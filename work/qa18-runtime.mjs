export async function setup() {
 const nm=await import('node:module');
 const fs=await import('node:fs/promises');
 const pw=nm.createRequire('C:/Users/imank/AppData/Local/npm-cache/_npx/86170c4cd1c5da32/node_modules/playwright/package.json')('playwright');
 const root='C:/Users/imank/projects/video-editor/qa/qa-pass-2026-11-18';
 const browser=await pw.chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const ctx=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});ctx.setDefaultTimeout(6000);
 const errors=[],requests=[];
 const track=p=>{p.on('pageerror',e=>errors.push({kind:'pageerror',message:String(e),time:Date.now()}));p.on('console',m=>{if(m.type()==='error'||m.text().includes('[Build]'))errors.push({kind:m.type(),message:m.text(),time:Date.now()});});p.on('response',async r=>{try{const x={method:r.request().method(),url:r.url(),status:r.status(),time:Date.now()};if(r.status()>=400){x.body=(await r.text().catch(()=>'' )).slice(0,500);x.requestId=r.request().headers()['x-request-id']||r.headers()['x-request-id'];}requests.push(x);}catch{}});};
 const page=await ctx.newPage();track(page);
 await page.goto('https://staging.reelballers.com/home',{waitUntil:'domcontentloaded'});
 await page.getByRole('textbox',{name:'Email address'}).waitFor({timeout:15000});
 const login=await page.evaluate(async()=>{const r=await fetch('https://api-staging.reelballers.com/api/auth/dev-login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-Test-Mode':'true'},body:JSON.stringify({email:'e2e@test.local'})});return r.status});
 if(login!==200)throw new Error('Staging login returned '+login);
 await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'e2e@test.local',exact:true}).waitFor({timeout:15000});
 await ctx.storageState({path:'C:/Users/imank/projects/video-editor/.playwright-mcp/qa18-auth.json'});
 const log=async(label,p=page)=>{await fs.appendFile(root+'/REPORT.md','\n### '+new Date().toISOString()+' '+label+'\n\nURL: '+p.url()+'\n\n'+(await p.locator('body').innerText()).slice(0,2600)+'\n');await fs.writeFile(root+'/network.json',JSON.stringify(requests,null,2));await fs.writeFile(root+'/console.json',JSON.stringify(errors,null,2));};
 return {pw,fs,root,browser,ctx,page,errors,requests,track,log};
}
