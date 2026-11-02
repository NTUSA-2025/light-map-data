"use strict";

window.LuxCoverageMap = (() => {
  const CAMPUS_CENTER = [25.0168654, 121.53955895];
  const CAMPUS_BOUNDS = [[25.0115824, 121.5329385], [25.0221484, 121.5461794]];
  const UNCOVERED_STYLE = { color: "#e7e8e5", weight: 0.7, opacity: 0.7, fillColor: "#152023", fillOpacity: 0.12 };
  const COVERED_STYLE = { color: "#9ce7d8", weight: 1.1, opacity: 1, fillColor: "#9ce7d8", fillOpacity: 0.62 };

  let leafletPromise = null;
  let map = null;
  let cells = [];
  let covered = new Set();
  let pendingRows = [];
  let currentPosition = null;
  let positionMarker = null;
  let accuracyCircle = null;
  let loading = false;
  let ready = false;
  let openPromise = null;

  function loadLeaflet() {
    if (leafletPromise) return leafletPromise;
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    stylesheet.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
    stylesheet.crossOrigin = "anonymous";
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.integrity = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
    script.crossOrigin = "anonymous";
    const appendAndWait = (node) => new Promise((resolve, reject) => {
      node.onload = resolve;
      node.onerror = () => reject(new Error("無法載入 Leaflet，請確認網路連線。"));
      document.head.append(node);
    });
    leafletPromise = Promise.all([appendAndWait(stylesheet), appendAndWait(script)])
      .then(() => {
        if (!window.L) throw new Error("地圖套件無法使用。");
        return window.L;
      })
      .catch((error) => {
        stylesheet.remove();
        script.remove();
        leafletPromise = null;
        throw error;
      });
    return leafletPromise;
  }

  async function loadGeoJSON(name) {
    const response = await fetch(`data/${name}`);
    if (!response.ok) throw new Error(`無法載入 ${name}（${response.status}）。`);
    return response.json();
  }

  function prepareCells(features) {
    return features.map((feature) => {
      const ring = feature.geometry.coordinates[0];
      const lngs = ring.map((point) => point[0]);
      const lats = ring.map((point) => point[1]);
      return {
        id: Number(feature.properties.id),
        ring,
        minLng: Math.min(...lngs),
        maxLng: Math.max(...lngs),
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        layer: null,
      };
    });
  }

  function pointInRing(ring, lng, lat) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const cross = (lng - xi) * (yj - yi) - (lat - yi) * (xj - xi);
      if (Math.abs(cross) < 1e-12 && lng >= Math.min(xi, xj) && lng <= Math.max(xi, xj) && lat >= Math.min(yi, yj) && lat <= Math.max(yi, yj)) return true;
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function cellFor(latitude, longitude) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return cells.find((cell) =>
      lng >= cell.minLng && lng <= cell.maxLng && lat >= cell.minLat && lat <= cell.maxLat && pointInRing(cell.ring, lng, lat)
    ) || null;
  }

  function updateCount() {
    document.getElementById("coverageCount").textContent = `已覆蓋 ${covered.size} / ${cells.length} 格`;
  }

  function markReading(row, update = true) {
    const cell = cellFor(row.latitude, row.longitude);
    if (!cell || covered.has(cell.id)) return;
    covered.add(cell.id);
    cell.layer.setStyle(COVERED_STYLE);
    cell.layer.setPopupContent(`道路格 #${cell.id} · 已覆蓋`);
    if (update) updateCount();
  }

  function buildMap(L, campus, roads, roadCells) {
    map = L.map("coverageMap", {
      zoomControl: false,
      minZoom: 14,
      maxBounds: L.latLngBounds(CAMPUS_BOUNDS),
      maxBoundsViscosity: 0.85,
    }).setView(CAMPUS_CENTER, 15);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    cells = prepareCells(roadCells.features);
    const cellById = new Map(cells.map((cell) => [cell.id, cell]));
    L.geoJSON(roadCells, {
      style: UNCOVERED_STYLE,
      onEachFeature: (feature, layer) => {
        const cell = cellById.get(Number(feature.properties.id));
        cell.layer = layer;
        layer.bindPopup(`道路格 #${cell.id} · 尚未覆蓋`);
      },
    }).addTo(map);
    L.geoJSON(roads, { style: { color: "#f0997b", weight: 1.4, opacity: 0.8 } }).addTo(map);
    const campusLayer = L.geoJSON(campus, { style: { color: "#e7e8e5", weight: 1.05, opacity: 0.9 } }).addTo(map);
    map.fitBounds(campusLayer.getBounds(), { padding: [16, 16], maxZoom: 16 });
    updateCount();
  }

  function setPosition(position) {
    currentPosition = position;
    if (!ready) return;
    const status = document.getElementById("mapStatus");
    if (!position) {
      if (positionMarker) map.removeLayer(positionMarker);
      if (accuracyCircle) map.removeLayer(accuracyCircle);
      positionMarker = null;
      accuracyCircle = null;
      status.textContent = "啟用定位後可查看目前位置。";
      return;
    }
    const L = window.L;
    const coords = position.coords;
    const latLng = [coords.latitude, coords.longitude];
    if (!accuracyCircle) accuracyCircle = L.circle(latLng, { radius: coords.accuracy, color: "#f0997b", weight: 1, fillColor: "#f0997b", fillOpacity: 0.1 }).addTo(map);
    else accuracyCircle.setLatLng(latLng).setRadius(coords.accuracy);
    if (!positionMarker) positionMarker = L.circleMarker(latLng, { radius: 6, color: "#fff", weight: 2, fillColor: "#f0997b", fillOpacity: 1 }).addTo(map);
    else positionMarker.setLatLng(latLng);
    const cell = cellFor(coords.latitude, coords.longitude);
    status.textContent = cell ? `目前位置在道路格 #${cell.id}。` : "目前位置不在主要道路格內，照度紀錄仍會儲存。";
  }

  async function open(loadRows, position) {
    currentPosition = position;
    if (ready) {
      requestAnimationFrame(() => map.invalidateSize());
      setPosition(currentPosition);
      return;
    }
    if (loading) return openPromise;
    loading = true;
    openPromise = (async () => {
      try {
        const [L, campus, roads, roadCells] = await Promise.all([
          loadLeaflet(),
          loadGeoJSON("ntu_area.geojson"),
          loadGeoJSON("ntu_road.geojson"),
          loadGeoJSON("hex_hit_with_safe.geojson"),
        ]);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        buildMap(L, campus, roads, roadCells);
        const rows = await loadRows();
        rows.forEach((row) => markReading(row, false));
        pendingRows.forEach((row) => markReading(row, false));
        pendingRows = [];
        ready = true;
        updateCount();
        setPosition(currentPosition);
        requestAnimationFrame(() => map.invalidateSize());
      } catch (error) {
        if (map) map.remove();
        map = null;
        cells = [];
        covered = new Set();
        pendingRows = [];
        throw error;
      } finally {
        loading = false;
        openPromise = null;
      }
    })();
    return openPromise;
  }

  function record(row) {
    if (loading) pendingRows.push(row);
    else if (ready) markReading(row);
  }

  function clear() {
    pendingRows = [];
    if (!ready) return;
    for (const cell of cells) {
      if (!covered.has(cell.id)) continue;
      cell.layer.setStyle(UNCOVERED_STYLE);
      cell.layer.setPopupContent(`道路格 #${cell.id} · 尚未覆蓋`);
    }
    covered.clear();
    updateCount();
  }

  function recenter() {
    if (ready && currentPosition) map.panTo([currentPosition.coords.latitude, currentPosition.coords.longitude]);
  }

  return { open, record, clear, setPosition, recenter, isReady: () => ready };
})();
