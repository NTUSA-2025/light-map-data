# ESP32 亮度紀錄器（手機網頁）

這是不用後端的靜態網頁。Android Chrome 讀取 ESP32 的 BLE Lux 通知，搭配手機定位，將資料存在手機瀏覽器的 IndexedDB；「匯出全部 CSV」會下載目前瀏覽器中所有紀錄。

## 使用

1. ESP32 上傳本機專案中的 `esp32_lux_ble.ino` 並接上 VEML7700；手機用 nRF Connect 確認 Lux 會變動後，先在 nRF Connect 中斷線。
2. 將此資料夾的 `index.html`、`style.css`、`app.js` 放到同一個 HTTPS 靜態網站目錄，例如 GitHub Pages。Android Chrome 開啟該 HTTPS 網址。筆電的 `localhost` 不是手機的 `localhost`；用手機訪問筆電的普通 HTTP 區網位址，也不符合 Web Bluetooth／定位所需的安全環境。
3. 按「連接 ESP32_LUX」，選擇 ESP32；再按「啟用定位」並允許權限。
4. 選記錄間隔，按「開始記錄」。每筆包含 UTC ISO 8601 時間、座標、定位誤差（公尺）、Lux 和一次記錄的 session ID。
5. 按「停止」，再按「匯出全部 CSV」。手機 Chrome 通常將檔案放在下載資料夾。

記錄會跨頁面重新開啟保留，但清除瀏覽器網站資料會移除它們。頁面必須保持開啟；Android 對背景網頁有限制，鎖屏長時間記錄需要日後做原生 App。若 GPS 定位超過 30 秒沒有更新，頁面會暫停寫入，避免把舊座標當成即時位置。

## 建議託管：GitHub Pages

這個專案只需要三個網頁檔；GitHub Pages 可以直接提供 HTTPS 網址，不需要後端。最簡單的部署方式：

1. 在 GitHub 建立一個**公開** repository，例如 `esp32-lux-logger`。
2. 將 `lux_logger` 裡的 `index.html`、`style.css`、`app.js` 上傳到 repository 的**根目錄**（不要多包一層 `lux_logger`）。
3. 到 repository 的 **Settings → Pages → Build and deployment**，選 **Deploy from a branch**，Branch 選 `main`、資料夾選 `/(root)`，按 **Save**。
4. 等 GitHub 顯示網站網址後，在 Android Chrome 開啟 `https://你的帳號.github.io/esp32-lux-logger/`。先讓 nRF Connect 與 ESP32 斷線，再用網頁連接。

GitHub 免費帳號使用 Pages 時，repository 必須公開，因此只上傳網頁程式，不要上傳自己匯出的 CSV 或定位紀錄。CSV 留在手機瀏覽器，匯出時才下載到手機。

開發時可在電腦上執行 `python -m http.server 8000`，用 `http://localhost:8000/lux_logger/` 開頁面檢查外觀；實際 BLE／定位請以 Android Chrome 的 HTTPS 網址測試。
