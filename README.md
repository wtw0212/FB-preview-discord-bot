# Discord Facebook Preview Bot

讓 Discord 頻道裡的 Facebook 連結變得更漂亮！這支 bot 會在偵測到訊息中有 Facebook 連結時，主動抓取該頁面的 Open Graph 資訊（標題、描述、縮圖），並送出一個自訂的 embed 取代原本醜醜的預覽。

## 功能特色

- 🔍 自動掃描訊息中的 Facebook / fb.watch 連結
- 📄 擷取標題、描述、縮圖與來源名稱，並用 Facebook 配色的 embed 呈現
- 🧠 支援自訂 User-Agent、一次回覆多個連結（預設 1 個，最多 5 個）
- 🛡️ 只在機器人擁有傳訊與嵌入權限的頻道裡回覆，避免洗頻或錯誤
- ⚙️ 簡單 `.env` 設定，3 個指令就能啟動

## 需求

- Node.js **18 或以上版本**（使用原生 `fetch` / `AbortController`）
- 一個啟用 **MESSAGE CONTENT INTENT** 的 Discord Bot Token
- Bot 在伺服器中的頻道需要擁有 `Send Messages` 與 `Embed Links` 權限

## 快速開始

```bash
# 1. 安裝依賴
npm install

# 2. 建立設定檔
cp .env.example .env
# 編輯 .env，填入 DISCORD_TOKEN（必填）

# 3. 啟動 bot
npm start
```

### `.env` 設定說明

| 變數 | 必填 | 說明 |
| --- | --- | --- |
| `DISCORD_TOKEN` | ✅ | 從 Discord Developer Portal 產生的 Bot Token |
| `FACEBOOK_USER_AGENT` | ⛔ | 覆寫預設的抓取 User-Agent，偶爾可用來避開封鎖 |
| `MAX_FACEBOOK_EMBEDS` | ⛔ | 單一訊息最多回覆幾個 Facebook 連結，1~5 之間，預設 1 |

## 部署步驟

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications)，建立應用程式並新增 Bot。
2. 在 **Bot** 頁籤啟用 `MESSAGE CONTENT INTENT`。
3. 用 OAuth2 -> URL Generator 產生邀請連結（Scopes: `bot`；權限至少勾選 `Send Messages`、`Embed Links`）。
4. 將環境變數設定好後執行 `npm start`，或使用 PM2 / Docker 等方式常駐。

## 運作方式

1. 監聽 `messageCreate` 事件，利用正規表達式找出 Facebook 相關的網址。
2. 針對每個網址以可自訂的 User-Agent 進行抓取，解析網頁中的 Open Graph 資訊。
3. 將整理後的資料輸出成帶有標題、描述與縮圖的 `EmbedBuilder`，回傳到原頻道。
4. 若抓取失敗（超時或無法讀取），會在伺服器端紀錄錯誤但不會打擾使用者。

## 常見問題

- **Bot 沒有反應？**
  - 確認已在 Discord Developer Portal 打開 Message Content Intent。
  - 確認 bot 在頻道內擁有 `Send Messages` 與 `Embed Links` 權限。
  - 查看執行中的終端機輸出是否有錯誤訊息。
- **Facebook 頁面抓不到縮圖？**
  - 有些內容需要登入才能存取，bot 只能讀取公開資料。
  - 可以嘗試自訂 `FACEBOOK_USER_AGENT`，模擬不同瀏覽器／裝置。
- **想一次處理多個連結**
  - 將 `.env` 中的 `MAX_FACEBOOK_EMBEDS` 調高即可（最多 5）。

歡迎依照自己的需求再擴充，例如：快取、指令觸發、或加入更多的社群平台預覽！
