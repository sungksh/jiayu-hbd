# 部署到 Vercel（保留既有功能與內容）

頁面本身和原有互動均保留：發文、改文、媒體、頭貼、留言、按讚、轉發、收藏、使用者名稱、社群編輯、搜尋與動態分類。部署版將原本長連線改為每 2.5 秒讀取雲端狀態；貼文資料存在 Upstash Redis，圖片和影片存在 Vercel Blob。`echo-server.js` 仍保留，供本機執行。

## 需要的雲端服務

1. 將 `outputs` 資料夾內容推到 GitHub repository（建議設為 private）。不要加入 `echo-data.json`、網址或 PID；`.gitignore` 已排除資料和隧道檔。
2. 在 Vercel 匯入 repository。此專案已加入 `vercel.json`，根網址會提供原有 Threads 風格頁面，`/api/*` 由 Vercel Function 處理。
3. 在 Vercel Storage 或 Marketplace 建立 Upstash Redis，並建立 Vercel Blob store。
4. 在 Vercel 專案 **Settings → Environment Variables** 設定：

   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `BLOB_READ_WRITE_TOKEN`（建立 Blob store 時提供）

5. 重新部署。成功後開啟 `https://<專案名稱>.vercel.app/api/health`，應看到 `{"ok":true}`。

## 搬移現有貼文和媒體

先在 Vercel 建好 Redis 與 Blob，取得上述三個環境變數。於本機 `outputs` 資料夾安裝依賴，並在 PowerShell 設定環境變數後執行遷移：

```powershell
npm install
$env:UPSTASH_REDIS_REST_URL = "你的 Upstash REST URL"
$env:UPSTASH_REDIS_REST_TOKEN = "你的 Upstash REST Token"
$env:BLOB_READ_WRITE_TOKEN = "你的 Vercel Blob Token"
npm run migrate:vercel
```

遷移會將 `echo-data.json` 的示範與既有貼文寫入 Redis，並把其中的 base64 頭貼／媒體轉存到 Blob。若資料檔在其他位置，可將路徑當成參數：`npm run migrate:vercel -- "C:\資料\echo-data.json"`。請不要把金鑰提交到 Git。

## 備註

- Vercel 每個使用者瀏覽器仍以本機 ID 識別，與原站一致；目前沒有登入驗證。
- 所有使用者共用同一份社群資料。多位使用者同時在毫秒內修改同一份資料時，最後一次儲存可能覆蓋前一次；若之後要承受高併發，需要把資料模型拆成資料庫記錄。
- 部署與持續可用取決於 Vercel、Upstash 和 Blob 帳號方案及用量；本程式不再依賴你家電腦或區域網路。
