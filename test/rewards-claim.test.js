const fs=require('fs'),os=require('os'),path=require('path');
process.env.HOME=fs.mkdtempSync(path.join(os.tmpdir(),'ph-claim-')); process.env.USERPROFILE=process.env.HOME;
const power=require(path.join(__dirname,'..','server','power.js'));
let bad=0; const ok=(n,c,x)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':'  -> '+JSON.stringify(x)));if(!c)bad++;};
const UID='11111111-2222-3333-4444-555555555555';
const mk=(claimValue,userOk=true,claimOk=true)=>async(url)=>{
  if(url.includes('/auth/v1/user')) return {ok:userOk,json:async()=>userOk?{id:UID}:{}};
  if(url.includes('pholama_claim_rewards')) return {ok:claimOk,json:async()=>claimValue};
  throw new Error('unexpected '+url);
};
(async()=>{
  const before=power.bonusTotal();
  let r=await power.claimRewards('tok',mk(150)); ok('claims what the database says (150)',r.granted===150&&power.bonusTotal()===before+150,r);
  r=await power.claimRewards('tok',mk(0)); ok('nothing waiting adds nothing',r.granted===0&&power.bonusTotal()===before+150,r);
  r=await power.claimRewards('tok',mk(100)); ok('a later claim adds on top',power.bonusTotal()===before+250,power.bonusTotal());
  for(const [n,v] of [['negative',-500],['text','999'],['null',null],['object',{a:1}]]){ const t0=power.bonusTotal(); let e=null; try{ r=await power.claimRewards('tok',mk(v)); }catch(x){e=x.message} ok('junk from the server is never added ('+n+')',power.bonusTotal()===t0&&(e||r.granted===0),[e,r]); }
  const t1=power.bonusTotal(); r=await power.claimRewards('tok',mk(9e12)); ok('an absurd number is capped at 100000',r.granted===100000&&power.bonusTotal()===t1+100000,r);
  let e=null; try{await power.claimRewards('tok',mk(5,false));}catch(x){e=x.message} ok('unknown login adds nothing',/Could not read/.test(e||''),e);
  e=null; try{await power.claimRewards('',mk(5));}catch(x){e=x.message} ok('no token adds nothing',/Log in/.test(e||''),e);
  e=null; const t2=power.bonusTotal(); try{await power.claimRewards('tok',mk(5,true,false));}catch(x){e=x.message} ok('database error adds nothing',power.bonusTotal()===t2&&!!e,e);
  const agent=require(path.join(__dirname,'..','server','agent.js')); ok('the daily allowance counts reward credits',agent.credits().daily>=1000+power.bonusTotal()-1,agent.credits());
  console.log(bad?bad+' FAILED':'ALL PASSED');
})();
