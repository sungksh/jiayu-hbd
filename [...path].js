const { handleUpload } = require('@vercel/blob/client');
const crypto = require('node:crypto');

const KEY = 'echo-social-state-v1';
const initial = { posts: [], avatars: {}, profiles: {}, communities: [
  { icon: '🔴', name: 'Pokémon Threads' }, { icon: '🟩', name: 'Minecraft' }, { icon: '🕹️', name: 'Gaming Threads' }
] };

async function redis(command) {
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) throw new Error('尚未設定 Upstash Redis，請依 DEPLOY.md 加入環境變數');
  if (!Array.isArray(command) || !command.length) throw new Error('Upstash 命令格式必須是非空 JSON 陣列');
  const response = await fetch(base, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  let result;
  try { result = await response.json(); }
  catch { throw new Error(`Upstash 回傳了非 JSON 回應（HTTP ${response.status}）`); }
  if (!response.ok || result.error) throw new Error(result.error || '資料庫連線失敗');
  if (!Object.prototype.hasOwnProperty.call(result, 'result')) throw new Error('Upstash 回應缺少 result 欄位');
  return result.result;
}

function emptyState() { return structuredClone(initial); }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function parseStoredValue(value) {
  let current = value;
  for (let i = 0; i < 3 && typeof current === 'string'; i++) {
    try { current = JSON.parse(current); }
    catch { console.warn('Ignoring malformed JSON stored in Upstash state key'); return null; }
  }
  return current;
}
function normalizeState(value) {
  value = parseStoredValue(value);
  if (isRecord(value) && isRecord(value.state)) value = value.state;
  if (Array.isArray(value)) value = { posts: value };
  if (!isRecord(value)) return emptyState();

  const posts = Array.isArray(value.posts) ? value.posts.filter(isRecord).map(post => ({
    ...post,
    media: Array.isArray(post.media) ? post.media.filter(isRecord) : [],
    comments: Array.isArray(post.comments) ? post.comments.filter(isRecord) : [],
    likes: Array.isArray(post.likes) ? post.likes : [],
    repostedBy: Array.isArray(post.repostedBy) ? post.repostedBy : [],
    bookmarkedBy: Array.isArray(post.bookmarkedBy) ? post.bookmarkedBy : []
  })) : [];
  return {
    ...emptyState(), ...value, posts,
    avatars: isRecord(value.avatars) ? value.avatars : {},
    profiles: isRecord(value.profiles) ? value.profiles : {},
    communities: Array.isArray(value.communities) ? value.communities : initial.communities
  };
}

async function readState() {
  let value;
  try { value = await redis(['GET', KEY]); }
  catch (error) {
    if (!/wrongtype/i.test(error.message || '')) throw error;
    value = await redis(['JSON.GET', KEY]);
  }
  return normalizeState(value);
}
async function writeState(state) { await redis(['SET', KEY, JSON.stringify(normalizeState(state))]); }
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error('請求資料過大'); chunks.push(chunk); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString('utf8')) : {};
}
function send(res, status, data) { res.status(status).json(data); }
function idFromPath(pathname) { return decodeURIComponent(pathname.split('/')[3] || ''); }

module.exports = async (req, res) => {
  res.setHeader('X-Social-API-Version', 'upstash-array-v3');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const url = new URL(req.url, 'https://vercel.invalid');
  const pathname = url.pathname;
  try {
    if (pathname === '/api/upload-token' && req.method === 'POST') {
      const jsonResponse = await handleUpload({ request: req, body: await body(req), onBeforeGenerateToken: async (_pathname, clientPayload) => ({
        allowedContentTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'],
        maximumSizeInBytes: 12 * 1024 * 1024,
        tokenPayload: clientPayload || ''
      }) });
      return res.status(200).json(jsonResponse);
    }
    if (pathname === '/api/health' && req.method === 'GET') {
      const redisStatus = await redis(['PING']);
      if (redisStatus !== 'PONG') throw new Error('Upstash Redis PING 未成功');
      return send(res, 200, {
        ok: true,
        storage: 'upstash-redis',
        mediaStorage: process.env.BLOB_READ_WRITE_TOKEN ? 'vercel-blob' : 'unconfigured',
        redis: 'connected',
        apiVersion: 'upstash-array-v3'
      });
    }
    let state = await readState();
    if (pathname === '/api/state' && req.method === 'GET') return send(res, 200, state);
    if (pathname === '/api/bootstrap' && req.method === 'POST') {
      const b = await body(req);
      if (!state.posts.length && Array.isArray(b.posts)) { state.posts = b.posts; await writeState(state); }
      return send(res, 200, state);
    }
    if (pathname === '/api/posts' && req.method === 'POST') {
      const b = await body(req);
      if (!b.text?.trim() && !b.media?.length) return send(res, 400, { error: '請輸入貼文內容或附加媒體' });
      const post = { id: crypto.randomUUID(), author: String(b.author || '訪客').slice(0, 40), handle: String(b.handle || '@guest').slice(0, 40), userId: String(b.userId || ''), avatar: state.avatars[b.userId] || b.avatar || '', time: new Date().toISOString(), text: String(b.text || ''), media: Array.isArray(b.media) ? b.media.slice(0, 8) : [] };
      state.posts.unshift(post); await writeState(state); return send(res, 201, post);
    }
    const social = pathname.match(/^\/api\/posts\/([^/]+)\/(like|comments|repost|bookmark)$/);
    if (social && req.method === 'POST') {
      const b = await body(req), post = state.posts.find(p => p.id === decodeURIComponent(social[1]));
      if (!post) return send(res, 404, { error: '找不到貼文' });
      if (['like', 'repost', 'bookmark'].includes(social[2])) {
        if (!b.userId) return send(res, 400, { error: '需要使用者識別碼' });
        const kind = social[2], key = kind === 'like' ? 'likes' : kind === 'repost' ? 'repostedBy' : 'bookmarkedBy';
        post[key] = Array.isArray(post[key]) ? post[key] : []; const index = post[key].indexOf(String(b.userId));
        if (index < 0) post[key].push(String(b.userId)); else post[key].splice(index, 1);
        if (kind !== 'bookmark') { const count = kind === 'like' ? 'likesCount' : 'repostsCount'; post[count] = Math.max(0, Number(post[count] ?? (post[key].length - (index < 0 ? 1 : -1))) + (index < 0 ? 1 : -1)); }
        await writeState(state); return send(res, 200, { active: index < 0, count: kind === 'like' ? post.likesCount : kind === 'repost' ? post.repostsCount : post.bookmarkedBy.length });
      }
      const text = String(b.text || '').trim(); if (!text) return send(res, 400, { error: '留言不能空白' });
      post.comments = Array.isArray(post.comments) ? post.comments : [];
      const comment = { id: crypto.randomUUID(), userId: String(b.userId || ''), author: String(b.author || '訪客').slice(0, 40), handle: String(b.handle || '@guest').slice(0, 40), text: text.slice(0, 2000), time: new Date().toISOString() };
      post.comments.push(comment); await writeState(state); return send(res, 201, comment);
    }
    const postRoute = pathname.match(/^\/api\/posts\/([^/]+)$/);
    if (postRoute && req.method === 'PUT') {
      const b = await body(req), post = state.posts.find(p => p.id === decodeURIComponent(postRoute[1]));
      if (!post) return send(res, 404, { error: '找不到貼文' });
      post.text = String(b.text ?? post.text); if (Array.isArray(b.media)) post.media = b.media.slice(0, 8);
      if (b.likesCount !== undefined) post.likesCount = Math.max(0, Math.floor(Number(b.likesCount) || 0));
      if (b.repostsCount !== undefined) post.repostsCount = Math.max(0, Math.floor(Number(b.repostsCount) || 0));
      post.editedAt = new Date().toISOString(); await writeState(state); return send(res, 200, post);
    }
    if (pathname === '/api/profile' && req.method === 'PUT') {
      const b = await body(req), id = String(b.userId || ''), author = String(b.author || '').trim().slice(0, 40);
      let handle = String(b.handle || '').trim().replace(/^@/, '').replace(/[^a-zA-Z0-9._]/g, '').slice(0, 30);
      if (!id || !author || handle.length < 2) return send(res, 400, { error: '請輸入顯示名稱與至少 2 個字元的帳號' });
      handle = '@' + handle; state.profiles[id] = { author, handle };
      for (const p of state.posts) { if (p.userId === id) { p.author = author; p.handle = handle; } for (const c of p.comments || []) if (c.userId === id) { c.author = author; c.handle = handle; } }
      await writeState(state); return send(res, 200, { userId: id, author, handle });
    }
    if (pathname === '/api/communities' && req.method === 'PUT') {
      const b = await body(req); if (!Array.isArray(b.communities)) return send(res, 400, { error: '社群資料格式不正確' });
      state.communities = b.communities.filter(c => c && String(c.name || '').trim()).slice(0, 12).map(c => ({ icon: String(c.icon || '✦').slice(0, 8), name: String(c.name).trim().slice(0, 48) }));
      await writeState(state); return send(res, 200, { communities: state.communities });
    }
    if (pathname === '/api/avatar' && req.method === 'PUT') {
      const b = await body(req); if (!b.userId || typeof b.avatar !== 'string' || !b.avatar.startsWith('https://')) return send(res, 400, { error: '頭貼資料不正確' });
      state.avatars[String(b.userId)] = b.avatar; for (const p of state.posts) if (p.userId === b.userId) p.avatar = b.avatar;
      await writeState(state); return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: '找不到 API' });
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: error.message || '伺服器錯誤' });
  }
};
module.exports.config = { api: { bodyParser: false } };
