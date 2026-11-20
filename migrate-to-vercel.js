const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { put } = require('@vercel/blob');
const file = process.argv[2] || path.join(__dirname, '..', 'echo-data.json');
const env = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'BLOB_READ_WRITE_TOKEN'];
if (env.some(name => !process.env[name])) throw new Error(`請設定環境變數：${env.join(', ')}`);
async function migrateUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) return value;
  const match = value.match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (!match) return value;
  const contentType = match[1], ext = contentType.split('/')[1].replace(/[^a-z0-9]/gi, '') || 'bin';
  return (await put(`echo-social/${crypto.randomUUID()}.${ext}`, Buffer.from(match[2], 'base64'), { access: 'public', contentType, addRandomSuffix: false })).url;
}
(async () => {
  if (!fs.existsSync(file)) throw new Error(`找不到資料檔：${file}`);
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.avatars = state.avatars || {};
  for (const id of Object.keys(state.avatars)) state.avatars[id] = await migrateUrl(state.avatars[id]);
  for (const post of state.posts || []) {
    post.avatar = await migrateUrl(post.avatar);
    for (const media of post.media || []) media.url = await migrateUrl(media.url);
  }
  const response = await fetch(process.env.UPSTASH_REDIS_REST_URL, { method: 'POST', headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(['SET', 'echo-social-state-v1', JSON.stringify(state)]) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || 'Upstash 寫入失敗');
  console.log(`已匯入 ${state.posts?.length || 0} 則貼文與使用者資料。`);
})().catch(error => { console.error(error); process.exitCode = 1; });
