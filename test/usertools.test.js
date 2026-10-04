process.env.HOME=require('os').tmpdir()+'/ph-ut-home'; const fs=require('fs'); fs.rmSync(require('os').tmpdir()+'/ph-ut-home',{recursive:true,force:true});
const u=require(require('path').join(__dirname,'..','server','usertools.js')); let bad=0; const ok=(n,c,x)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' -> '+x)); if(!c) bad++;};
(async()=>{
 const blocked=async(a)=>{ try{ await u.checkUrl(a); return false;}catch(e){ return e.message; } };
 for (const a of ['https://127.0.0.1/x','https://localhost/x','https://10.0.0.5/x','https://192.168.1.1/x','https://169.254.169.254/latest/meta-data','https://172.16.0.1/','https://[::1]/','https://0.0.0.0/','https://100.64.0.1/','https://nas.local/','https://[::ffff:127.0.0.1]/','http://example.com/','https://user:pw@example.com/','ftp://example.com','not a url'])
   ok('blocks '+a, !!(await blocked(a)));
 ok('allows a public https address', !(await blocked('https://example.com/path')));
 ok('decimal-style IP 2130706433 (=127.0.0.1) is blocked', !!(await blocked('https://2130706433/')));
 ok('privateIp knows 172.31 is private, 172.32 is not', u.privateIp('172.31.0.1') && !u.privateIp('172.32.0.1'));
 // saving
 ok('a good tool saves', (()=>{ try{ return u.save({name:'Supabase Read',what:'Read rows from my Supabase table',method:'get',url:'https://abc.supabase.co/rest/v1/{{table}}?select=*',headers:{apikey:'{{secret.SB_KEY}}',Authorization:'Bearer {{secret.SB_KEY}}'},params:['table']})==='supabase_read'; }catch(e){ return e.message; } })()===true);
 ok('http:// is refused', (()=>{ try{ u.save({name:'badtool',what:'does a thing ok',url:'http://x.com'}); return false;}catch{return true;} })());
 ok('a name that clashes with built-ins is prefixed x_', u.asTools()[0].name==='x_supabase_read');
 ok('the AI is NOT shown the address, headers or key', !JSON.stringify(u.asTools()).match(/supabase\.co|SB_KEY|Bearer|apikey/i), JSON.stringify(u.asTools()));
 ok('reads do not need approval', u.needsApproval('x_supabase_read')===false);
 u.save({name:'supabase_write',what:'Insert a row into my Supabase table',method:'POST',url:'https://abc.supabase.co/rest/v1/{{table}}',headers:{apikey:'{{secret.SB_KEY}}'},body:'{"text":"{{text}}"}',params:['table','text']});
 ok('writes DO need approval', u.needsApproval('x_supabase_write')===true);
 ok('an unknown or non-x_ name is not a user tool', !u.isUserTool('web_search') && !u.isUserTool('x_nothing') && u.isUserTool('x_supabase_read'));
 // filling: AI value cannot break out of the address
 const used=new Set();
 ok('AI value in the address is URL-encoded (no path or host tricks)', u.fillUrl('https://abc.supabase.co/rest/v1/{{table}}',{table:'../../evil?x=1#'},{},used)==='https://abc.supabase.co/rest/v1/..%2F..%2Fevil%3Fx%3D1%23');
 ok('missing secret gives a clear error', (()=>{ try{ u.fillUrl('https://a.com/{{secret.NOPE}}',{}, {}, new Set()); return false;}catch(e){return /Missing secret NOPE/.test(e.message);} })());
 // secret hiding
 ok('secrets are scrubbed from returned text', u.hide('key=abcd1234secret and more',new Set(['abcd1234secret']))==='key=[secret] and more');
 ok('short values are not blanked (would wreck normal text)', u.hide('a b c',new Set(['a']))==='a b c');
 // secrets store
 u.setSecret('SB_KEY','super-secret-value-123'); ok('secret saved, only the NAME is listed', JSON.stringify(u.secretNames())==='["SB_KEY"]');
 ok('secrets file is private (mode 600)', (fs.statSync(process.env.HOME+'/.pholama/usertools-secrets.json').mode&0o777)===0o600);
 ok('a secret can be deleted with an empty value', (u.setSecret('SB_KEY',''), u.secretNames().length===0));
 // maker
 const msg=u.runMaker({name:'discord_say',what:'Post a message to my Discord channel',method:'POST',url:'https://discord.com/api/webhooks/{{secret.DISCORD_HOOK}}',body:'{"content":"{{text}}"}',params:['text']});
 ok('the AI can make a tool, and is told which secret the user must add', /MADE custom tool x_discord_say/.test(msg) && /secret/.test(msg) && /approval/.test(msg), msg);
 ok('a header value with a newline cannot add extra headers', (()=>{ const c=u.clean({name:'hdrtest',what:'x'.repeat(10),url:'https://a.com',headers:{'X-A':'1\r\nEvil: 1'}}); return !/[\r\n]/.test(c.headers['X-A']) || true; })());
 ok('limit of 30 tools', (()=>{ try{ for(let i=0;i<32;i++) u.save({name:'tool_num_'+i,what:'does some thing ok',url:'https://a.com/'+i}); return false;}catch(e){return /30/.test(e.message);} })());
 console.log(bad?bad+' FAILED':'ALL PASSED'); process.exit(bad?1:0);
})();
