const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || ROOT;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB = path.join(DATA_DIR, 'echo-data.json');
const PORT = Number(process.env.PORT || 4173);
const defaultCommunities=[{icon:'🔴',name:'Pokémon Threads'},{icon:'🟩',name:'Minecraft'},{icon:'🕹️',name:'Gaming Threads'}];
let state = { posts: [], avatars: {}, profiles: {}, communities: defaultCommunities };
try { const saved = JSON.parse(fs.readFileSync(DB, 'utf8')); if (Array.isArray(saved)) state.posts = saved; else if (saved && typeof saved === 'object') state = { ...state, ...saved }; } catch {}
state.posts=Array.isArray(state.posts)?state.posts:[];
state.avatars=state.avatars&&typeof state.avatars==='object'&&!Array.isArray(state.avatars)?state.avatars:{};
state.communities=Array.isArray(state.communities)?state.communities:defaultCommunities;
state.profiles=state.profiles&&typeof state.profiles==='object'&&!Array.isArray(state.profiles)?state.profiles:{};
const clients = new Set();
function save(){ fs.writeFileSync(DB, JSON.stringify(state, null, 2)); }
function send(res, code, obj){ res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(obj)); }
function broadcast(){ const packet = `event: state\ndata: ${JSON.stringify(state)}\n\n`; for(const res of clients) res.write(packet); }
function body(req){ return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>35*1024*1024)req.destroy()});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}});req.on('error',reject)}) }
function imageDataOk(url){return typeof url==="string" && /^data:(image|video)\/[a-z0-9.+-]+;base64,/i.test(url)}
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});return res.end()}
  try{
    if(u.pathname==='/api/state'&&req.method==='GET')return send(res,200,state);
    if(u.pathname==='/api/events'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*'});res.write(`data: ${JSON.stringify(state)}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));return}
    if(u.pathname==='/api/bootstrap'&&req.method==='POST'){const b=await body(req);if(state.posts.length===0&&Array.isArray(b.posts)){state.posts=b.posts;save();broadcast()}return send(res,200,state)}
    if(u.pathname==='/api/posts'&&req.method==='POST'){const b=await body(req);if(!b.text?.trim()&&!b.media?.length)return send(res,400,{error:'請輸入貼文內容或附加媒體'});const post={id:crypto.randomUUID(),author:String(b.author||'訪客').slice(0,40),handle:String(b.handle||'@guest').slice(0,40),userId:String(b.userId||''),avatar:state.avatars[b.userId]||b.avatar||'',time:new Date().toISOString(),text:String(b.text||''),media:Array.isArray(b.media)?b.media.filter(m=>m&&((m.url&&!m.url.startsWith('data:'))||imageDataOk(m.url))).slice(0,8):[]};state.posts.unshift(post);save();broadcast();return send(res,201,post)}
    const socialMatch=u.pathname.match(/^\/api\/posts\/([^/]+)\/(like|comments|repost|bookmark)$/);
    if(socialMatch&&req.method==='POST'){
      const b=await body(req);const post=state.posts.find(p=>p.id===socialMatch[1]);
      if(!post)return send(res,404,{error:'找不到貼文'});
      if(socialMatch[2]==='like'||socialMatch[2]==='repost'||socialMatch[2]==='bookmark'){
        if(!b.userId)return send(res,400,{error:'需要使用者識別碼'});
        const kind=socialMatch[2];const listKey=kind==='like'?'likes':kind==='repost'?'repostedBy':'bookmarkedBy';
        post[listKey]=Array.isArray(post[listKey])?post[listKey]:[];
        const i=post[listKey].indexOf(String(b.userId));const delta=i<0?1:-1;
        if(i<0)post[listKey].push(String(b.userId));else post[listKey].splice(i,1);
        if(kind!=='bookmark'){const countKey=kind==='like'?'likesCount':'repostsCount';post[countKey]=Math.max(0,Number(post[countKey]??(post[listKey].length-delta))+delta)}
        save();broadcast();return send(res,200,{active:i<0,count:kind==='like'?post.likesCount:kind==='repost'?post.repostsCount:post.bookmarkedBy.length});
      }
      const text=String(b.text||'').trim();if(!text)return send(res,400,{error:'留言不能空白'});
      post.comments=Array.isArray(post.comments)?post.comments:[];
      const comment={id:crypto.randomUUID(),userId:String(b.userId||''),author:String(b.author||'訪客').slice(0,40),handle:String(b.handle||'@guest').slice(0,40),text:text.slice(0,2000),time:new Date().toISOString()};
      post.comments.push(comment);save();broadcast();return send(res,201,comment);
    }    const postMatch=u.pathname.match(/^\/api\/posts\/([^/]+)$/);
    if(postMatch&&req.method==='PUT'){const b=await body(req);const post=state.posts.find(p=>p.id===postMatch[1]);if(!post)return send(res,404,{error:'找不到貼文'});post.text=String(b.text??post.text);if(Array.isArray(b.media))post.media=b.media.filter(m=>m&&((m.url&&!m.url.startsWith('data:'))||imageDataOk(m.url))).slice(0,8);if(b.likesCount!==undefined)post.likesCount=Math.max(0,Math.floor(Number(b.likesCount)||0));if(b.repostsCount!==undefined)post.repostsCount=Math.max(0,Math.floor(Number(b.repostsCount)||0));post.editedAt=new Date().toISOString();save();broadcast();return send(res,200,post)}
    if(u.pathname==='/api/profile'&&req.method==='PUT'){const b=await body(req);const id=String(b.userId||'');const author=String(b.author||'').trim().slice(0,40);let handle=String(b.handle||'').trim().replace(/^@/,'').replace(/[^a-zA-Z0-9._]/g,'').slice(0,30);if(!id||!author||handle.length<2)return send(res,400,{error:'請輸入顯示名稱與至少 2 個字元的帳號'});handle='@'+handle;state.profiles[id]={author,handle};for(const p of state.posts){if(p.userId===id){p.author=author;p.handle=handle}for(const c of p.comments||[])if(c.userId===id){c.author=author;c.handle=handle}}save();broadcast();return send(res,200,{userId:id,author,handle})}    if(u.pathname==='/api/communities'&&req.method==='PUT'){const b=await body(req);if(!Array.isArray(b.communities))return send(res,400,{error:'社群資料格式不正確'});state.communities=b.communities.filter(c=>c&&String(c.name||'').trim()).slice(0,12).map(c=>({icon:String(c.icon||'✦').slice(0,8),name:String(c.name).trim().slice(0,48)}));save();broadcast();return send(res,200,{communities:state.communities})}
    if(u.pathname==='/api/avatar'&&req.method==='PUT'){const b=await body(req);if(!b.userId||!imageDataOk(b.avatar))return send(res,400,{error:'頭貼資料不正確'});state.avatars[String(b.userId)]=b.avatar;for(const p of state.posts)if(p.userId===b.userId)p.avatar=b.avatar;save();broadcast();return send(res,200,{ok:true})}
    if(u.pathname==='/api/health')return send(res,200,{ok:true,storage:'local',posts:state.posts.length,pid:process.pid});
    if(req.method==='GET'&&(u.pathname==='/'||u.pathname==='/echo-social.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return fs.createReadStream(path.join(ROOT,'echo-social.html')).pipe(res)}
    res.writeHead(404);res.end('Not found');
  }catch(e){console.error(e);send(res,500,{error:'伺服器錯誤'})}
});
server.listen(PORT,'0.0.0.0',()=>{console.log(`\nThreads prototype is running:`);console.log(`  This computer: http://localhost:${PORT}`);for(const nets of Object.values(os.networkInterfaces()))for(const n of nets||[])if(n.family==='IPv4'&&!n.internal)console.log(`  Same Wi-Fi:    http://${n.address}:${PORT}`);console.log('\nKeep this window running while others test. Press Ctrl+C to stop.\n')});













