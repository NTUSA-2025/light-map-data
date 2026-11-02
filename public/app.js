"use strict";

const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";
const DB_NAME = "esp32-lux-logger";
const STORE_NAME = "readings";
const RECENT_LIMIT = 10;

const el = (id) => document.getElementById(id);
const connectButton = el("connectButton");
const locationButton = el("locationButton");
const startButton = el("startButton");
const stopButton = el("stopButton");
const exportButton = el("exportButton");
const intervalSelect = el("intervalSelect");

let device = null;
let characteristic = null;
let latestLux = null;
let latestPosition = null;
let locationWatchId = null;
let recordTimer = null;
let sessionId = null;
let saving = false;

function message(text, error = false) {
  el("message").textContent = text;
  el("message").classList.toggle("error", error);
}

function updateControls() {
  const connected = Boolean(device?.gatt?.connected && characteristic);
  const recording = recordTimer !== null;
  startButton.disabled = !connected || latestLux === null || latestPosition === null || recording;
  stopButton.disabled = !recording;
  intervalSelect.disabled = recording;
  connectButton.disabled = connected;
  locationButton.disabled = locationWatchId !== null;
  el("connectLabel").textContent = connected ? "已連接 ESP32_LUX" : "連接 ESP32_LUX";
  el("locationLabel").textContent = locationWatchId === null ? "啟用定位" : latestPosition === null ? "定位中…" : "定位已啟用";
  el("bleStatus").textContent = connected ? "已連線" : "尚未連線";
  el("recordStatus").textContent = recording ? "記錄中" : "未開始";
  let recordHint = "已準備好採集照度與位置。";
  if (recording) recordHint = "正在採集，請保持頁面開啟。";
  else if (!connected) recordHint = "連接照度計並啟用定位後即可開始。";
  else if (latestPosition === null) recordHint = "啟用手機定位後即可開始。";
  else if (latestLux === null) recordHint = "等待照度計傳來數值。";
  el("recordHint").textContent = recordHint;
  el("bleStatus").classList.toggle("is-active", connected);
  el("recordStatus").classList.toggle("is-active", recording);
  el("locationStatus").classList.toggle("is-active", latestPosition !== null);
  document.querySelector(".hero").classList.toggle("is-connected", connected);
}

function stopRecording(reason = "已停止記錄。") {
  if (recordTimer !== null) {
    clearInterval(recordTimer);
    recordTimer = null;
    message(reason);
  }
  updateControls();
}

function onDisconnect() {
  stopRecording("ESP32 已斷線，記錄已停止。請重新連接。");
  characteristic = null;
  latestLux = null;
  el("luxValue").textContent = "—";
  updateControls();
}

function onLuxChanged(event) {
  const bytes = event.target.value;
  const value = Number.parseFloat(new TextDecoder().decode(bytes));
  if (!Number.isFinite(value) || value < 0) {
    message("收到無法辨識的照度資料。", true);
    return;
  }
  latestLux = value;
  const formatted = value.toFixed(2);
  el("luxValue").textContent = formatted;
  el("luxValue").classList.toggle("compact", formatted.length > 6);
  updateControls();
}

async function connect() {
  if (!navigator.bluetooth) {
    message("這個瀏覽器不能使用 Web Bluetooth。請在 Android Chrome 的 HTTPS 網頁開啟。", true);
    return;
  }
  let selected = null;
  try {
    connectButton.disabled = true;
    message("請選擇 ESP32_LUX…");
    selected = await navigator.bluetooth.requestDevice({
      filters: [{ name: "ESP32_LUX" }],
      optionalServices: [SERVICE_UUID],
    });
    selected.addEventListener("gattserverdisconnected", onDisconnect);
    const server = await selected.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const found = await service.getCharacteristic(CHARACTERISTIC_UUID);
    found.addEventListener("characteristicvaluechanged", onLuxChanged);
    await found.startNotifications();
    device = selected;
    characteristic = found;
    message("ESP32 已連接，等待照度資料。");
  } catch (error) {
    if (selected?.gatt?.connected) selected.gatt.disconnect();
    message(`連線未完成：${error.message}`, true);
  } finally {
    updateControls();
  }
}

function enableLocation() {
  if (!navigator.geolocation) {
    message("這個瀏覽器無法取得定位。", true);
    return;
  }
  if (locationWatchId !== null) return;
  el("locationStatus").textContent = "定位中…";
  locationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      latestPosition = position;
      el("locationStatus").textContent = "已取得";
      el("coordinates").textContent = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)} · 誤差約 ${Math.round(position.coords.accuracy)} 公尺`;
      updateControls();
    },
    (error) => {
      latestPosition = null;
      navigator.geolocation.clearWatch(locationWatchId);
      locationWatchId = null;
      el("locationStatus").textContent = "無法定位";
      el("coordinates").textContent = "無法取得目前位置，請重新啟用定位。";
      message(`定位失敗：${error.message}`, true);
      updateControls();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
  );
  updateControls();
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveRow(row) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).add(row);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function getRows() {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function refreshArchive() {
  const db = await openDatabase();
  try {
    const { count, rows } = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const countRequest = store.count();
      const cursorRequest = store.openCursor(null, "prev");
      const recentRows = [];
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor && recentRows.length < RECENT_LIMIT) {
          recentRows.push(cursor.value);
          if (recentRows.length < RECENT_LIMIT) cursor.continue();
        }
      };
      tx.oncomplete = () => resolve({ count: countRequest.result, rows: recentRows });
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    el("rowCount").textContent = count.toString();
    exportButton.disabled = count === 0;
    const list = el("recentRows");
    if (rows.length === 0) {
      const empty = document.createElement("li");
      empty.className = "recent-empty";
      empty.textContent = "尚無紀錄";
      list.replaceChildren(empty);
    } else {
      list.replaceChildren(...rows.map((row) => {
        const item = document.createElement("li");
        const heading = document.createElement("div");
        heading.className = "recent-row-head";
        const time = document.createElement("time");
        time.dateTime = row.recorded_at;
        time.textContent = formatTaipeiTime(row.recorded_at).replace("T", " ").slice(0, 19);
        const lux = document.createElement("strong");
        lux.textContent = `${Number(row.lux).toFixed(2)} lux`;
        const location = document.createElement("span");
        location.className = "recent-location";
        location.textContent = `${Number(row.latitude).toFixed(6)}, ${Number(row.longitude).toFixed(6)} · 誤差約 ${Math.round(row.accuracy_m)} 公尺`;
        heading.append(time, lux);
        item.append(heading, location);
        return item;
      }));
    }
  } finally {
    db.close();
  }
}

async function recordOnce() {
  if (saving || recordTimer === null) return;
  if (!device?.gatt?.connected || latestLux === null) {
    stopRecording("沒有照度資料，記錄已停止。");
    return;
  }
  if (latestPosition === null || Date.now() - latestPosition.timestamp > 30000) {
    message("等待新的手機定位，這次沒有記錄。", true);
    return;
  }
  saving = true;
  try {
    await saveRow({
      session_id: sessionId,
      recorded_at: new Date().toISOString(),
      latitude: latestPosition.coords.latitude,
      longitude: latestPosition.coords.longitude,
      accuracy_m: latestPosition.coords.accuracy,
      lux: latestLux,
    });
    await refreshArchive();
    message("已儲存最新一筆紀錄。");
  } catch (error) {
    stopRecording(`儲存失敗：${error.message}`);
  } finally {
    saving = false;
  }
}

function startRecording() {
  if (recordTimer !== null || !device?.gatt?.connected || latestLux === null || latestPosition === null) return;
  sessionId = new Date().toISOString();
  recordTimer = setInterval(recordOnce, Number(intervalSelect.value) * 1000);
  updateControls();
  message("開始記錄；請保持手機頁面開啟。");
  void recordOnce();
}

function formatTaipeiTime(isoTime) {
  const date = new Date(isoTime);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}

async function exportCsv() {
  try {
    const rows = await getRows();
    if (rows.length === 0) return;
    const header = "session_id,recorded_at,recorded_at_taipei,latitude,longitude,accuracy_m,lux";
    const lines = rows.map((row) => [row.session_id, row.recorded_at, formatTaipeiTime(row.recorded_at), row.latitude, row.longitude, row.accuracy_m, row.lux].join(","));
    const blob = new Blob(["\uFEFF", header, "\r\n", lines.join("\r\n"), "\r\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `esp32-lux-${formatTaipeiTime(new Date().toISOString()).slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    message(`已匯出 ${rows.length} 筆 CSV。`);
  } catch (error) {
    message(`匯出失敗：${error.message}`, true);
  }
}

connectButton.addEventListener("click", connect);
locationButton.addEventListener("click", enableLocation);
startButton.addEventListener("click", startRecording);
stopButton.addEventListener("click", () => stopRecording());
exportButton.addEventListener("click", exportCsv);
updateControls();
refreshArchive().catch((error) => message(`無法開啟手機資料庫：${error.message}`, true));
