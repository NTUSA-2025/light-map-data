# 台大夜間亮度地圖：照度資料採集工具

本工具為 `../ntu-light-map` 採集實測亮度資料。Android Chrome 讀取 ESP32 的 BLE Lux 通知，搭配手機定位，將資料存在手機瀏覽器的 IndexedDB；「匯出全部 CSV」會下載目前瀏覽器中所有紀錄，供後續資料整理與地圖專案使用。資料不會自動上傳到地圖專案。

## 使用

1. ESP32 需接上 VEML7700，並燒錄會以 BLE 發送 Lux 數值的韌體；手機用 nRF Connect 確認 Lux 會變動後，先在 nRF Connect 中斷線。
2. 在 Android Chrome 開啟部署後的 Cloudflare Workers HTTPS 網址。筆電的 `localhost` 不是手機的 `localhost`；用手機訪問筆電的普通 HTTP 區網位址，也不符合 Web Bluetooth／定位所需的安全環境。
3. 按「連接 ESP32_LUX」，選擇 ESP32；再按「啟用定位」並允許權限。
4. 預設每 1 秒記錄一次，也可選擇其他間隔。按「開始記錄」後，每筆包含 UTC ISO 8601 時間、座標、定位誤差（公尺）、Lux 和一次記錄的 session ID。匯出的 CSV 另有 `recorded_at_taipei` 欄（台北時間，+08:00），舊紀錄也會在匯出時轉換。
5. 「最近採集紀錄」會直接顯示最近 10 筆的台北時間、Lux、座標與定位誤差；重新開啟頁面仍可查看。按「停止」，再按「匯出全部 CSV」下載所有紀錄。手機 Chrome 通常將檔案放在下載資料夾。停止記錄後可按「刪除全部紀錄」，確認後會永久清除本機紀錄。

記錄會跨頁面重新開啟保留，但清除瀏覽器網站資料會移除它們。頁面必須保持開啟；Android 對背景網頁有限制，鎖屏長時間記錄需要日後做原生 App。若 GPS 定位超過 30 秒沒有更新，頁面會暫停寫入，避免把舊座標當成即時位置。

## 部署到 Cloudflare Workers

網站檔案放在 `public/`，`wrangler.jsonc` 使用 [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) 發布，無需伺服器程式或 Cloudflare 資料庫。先安裝 Node.js，再在專案根目錄執行：

```sh
npm ci
npx wrangler login    # 首次部署時登入
npm run deploy
```

部署完成後，Wrangler 會顯示 `https://light-map-data.<你的子網域>.workers.dev/`。在手機上開啟該網址，先讓 nRF Connect 與 ESP32 斷線，再用網頁連接。

紀錄儲存在瀏覽器的 IndexedDB，會依網站來源分開。若先前使用 GitHub Pages 或其他網址，請先在舊網址匯出 CSV；新 Workers 網址不會自動取得舊紀錄。CSV 不會上傳至 Cloudflare。

開發時可執行 `python3 -m http.server 8000 --directory public`，用 `http://localhost:8000/` 檢查外觀；實際 BLE／定位請以 Android Chrome 的 HTTPS 網址測試。
