// ==========================================
// 1. GLOBAL ERROR HANDLING & UTILITIES
// ==========================================

function showError(message, type = 'error') {
    const errDiv = document.getElementById('errorOverride');
    const errMsg = document.getElementById('errorMessage');
    
    if (errDiv && errMsg) {
        errMsg.innerHTML = `<strong>${type === 'error' ? 'System Error' : 'Notice'}:</strong> ${message}`;
        errDiv.className = type; 
        errDiv.style.display = 'block';
        if (type === 'warning') { setTimeout(() => { errDiv.style.display = 'none'; }, 5000); }
    }
    console.error(`[${type.toUpperCase()}] ${message}`);
}

function showLoadingScreen(customMessage) {
    const splash = document.getElementById('splash-screen');
    if (splash) {
        const title = document.getElementById('splash-message');
        if (title) title.innerText = customMessage || "Loading...";
        splash.classList.remove('hidden');
        splash.style.display = 'flex';
    }
}

function hideLoadingScreen() {
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.classList.add('hidden');
        setTimeout(() => { splash.style.display = 'none'; }, 1000); 
    }
}

window.addEventListener('offline', () => { showError("Internet connection lost. Map data may not load.", 'error'); });
window.addEventListener('online', () => {
    showError("Internet connection restored. Refreshing data...", 'warning');
    setTimeout(() => { document.getElementById('errorOverride').style.display = 'none'; fetchAndRefreshData(); }, 2000);
});

// ==========================================
// 1B. PDF & SHARE BUTTON FUNCTIONS
// ==========================================

window.downloadPopupPDF = function(button) {
    try {
        const container = button.closest('.popup-container');
        if (!container) throw new Error("Popup content not found.");

        const element = container.cloneNode(true);
        const actionsMenu = element.querySelector('.popup-actions');
        if(actionsMenu) actionsMenu.remove(); 
        const scrollContainer = element.querySelector('.popup-scroll-container');
        if(scrollContainer) { scrollContainer.style.maxHeight = 'none'; scrollContainer.style.overflow = 'visible'; }

        const originalBtnText = button.innerText;
        button.innerText = "Generating..."; button.disabled = true;

        const opt = { margin: 10, filename: 'LIGTAS-Advisory_Report.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };

        html2pdf().from(element).set(opt).save()
            .then(() => { button.innerText = originalBtnText; button.disabled = false; })
            .catch(err => { console.error("PDF Error:", err); showError("Failed to generate PDF.", 'warning'); button.innerText = "Retry PDF"; button.disabled = false; });

    } catch (e) { console.error(e); showError("Could not initiate PDF download."); }
};

window.sharePopupData = function(button) {
    const container = button.closest('.popup-container');
    const headerTitle = container.querySelector('.popup-header').innerText;
    const shareText = `Alert: Check out this LIGTAS-AGAD Warning Advisory regarding "${headerTitle}". View full real-time details here: ${window.location.href}`;

    if (navigator.share) {
        navigator.share({ title: 'LIGTAS-AGAD Advisory', text: shareText, url: window.location.href }).catch(err => console.error("User cancelled share or share failed", err));
    } else {
        navigator.clipboard.writeText(shareText).then(() => { alert("Information copied to clipboard! You can now paste it directly into Facebook, Twitter, or Messenger."); }).catch(err => { showError("Failed to copy to clipboard."); });
    }
};

window.showImage = function(src, alt) {
    if (!src || src.includes('undefined') || src === '') return;
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById("img01");
    const captionText = document.getElementById("caption");
    modalImg.style.display = 'block';
    modalImg.onload = function() { modal.style.display = "block"; captionText.innerHTML = alt || "Image View"; };
    modalImg.onerror = function() { showError("Failed to load image high-resolution view.", 'warning'); modal.style.display = "none"; };
    modalImg.src = src;
}

setTimeout(hideLoadingScreen, 15000); 

// ==========================================
// 2. UI LOGIC & PROPERTY FORMATTING
// ==========================================

let cachedAWSData = []; 
let landslideFeatures = []; 
let globalLayerOpacity = 0.3; // Default Susceptibility Opacity 30%

function updateClock() {
    try {
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-PH', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
        const timeStr = now.toLocaleTimeString('en-PH');
        const timeText = `${dateStr} | ${timeStr}`;
        const elDesktop = document.getElementById('real-time'); const elMobile = document.getElementById('real-time-mobile');
        if(elDesktop) elDesktop.textContent = timeText; if(elMobile) elMobile.textContent = timeText;
    } catch(e) { }
}
setInterval(updateClock, 1000); updateClock(); 

function Homebutton() { window.location.href = 'https://ligtas.uplb.edu.ph/LIGTAS-AGAD_new_portal-main/';  }

function formatPropertyName(key) {
    if (!key) return 'Unknown';
    const k = String(key).toLowerCase().trim();
    if (k === 'rating' || k.includes('suscept')) return 'Rating';
    if (k === 'brgy' || k === 'barangay' || k === 'name_3' || k.includes('adm4')) return 'Barangay';
    if (k.includes('area') || k === 'ha' || k.includes('hectare')) return 'Distance in hectares';
    if (k === 'mun' || k === 'muni' || k.includes('municipali') || k === 'name_2' || k.includes('adm3')) return 'Municipality';
    if (k === 'prov' || k.includes('province') || k === 'name_1' || k.includes('adm2')) return 'Region';
    if (k === 'reg' || k === 'region' || k === 'name_0' || k.includes('adm1')) return 'Region';
    return key.charAt(0).toUpperCase() + key.slice(1);
}

function formatPropertyValue(key, value) {
    if (value === null || value === undefined) return 'N/A';
    const k = String(key).toLowerCase().trim();
    const v = String(value).toLowerCase().trim();
    if (k === 'rating' || k.includes('suscept')) {
        if (v === 'high' || v.includes('high')) return 'High Susceptibility';
        if (v === 'moderate' || v === 'med' || v.includes('mod')) return 'Moderate Susceptibility';
        if (v === 'low' || v.includes('low')) return 'Low Susceptibility';
    }
    return value;
}

function updatePropertiesTable(layerName, properties) {
    const tableBody = document.getElementById('propertiesTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = ''; 

    if (!properties || Object.keys(properties).length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:#666;">No properties available.</td></tr>';
        return;
    }

    try {
        for (const [key, value] of Object.entries(properties)) {
            const kLower = String(key).toLowerCase().trim();
            if (['objectid', 'fid', 'shape_length', 'shape_area', 'id'].includes(kLower)) continue;
            const displayKey = formatPropertyName(key); let displayValue = formatPropertyValue(key, value);
            if (typeof displayValue === 'object' && displayValue !== null) displayValue = JSON.stringify(displayValue);
            const row = document.createElement('tr');
            row.innerHTML = `<td><strong>${layerName}</strong></td><td>${displayKey}</td><td>${displayValue}</td>`;
            tableBody.appendChild(row);
        }
    } catch (e) { console.error("Error updating table", e); }
}

// ==========================================
// 3. MAP INITIALIZATION & DRAWING CONTROLS
// ==========================================

const initialCenter = [12.8797, 121.7740];
const initialZoom = 6;
let map; let baseLayersData = {}; let layerControl; 

try {
    if (typeof L === 'undefined') throw new Error("Leaflet library not found.");
    
    map = L.map('map').setView(initialCenter, initialZoom); 
    
    // --- CREATE CUSTOM PANES ---
    map.createPane('topTiles');
    map.getPane('topTiles').style.zIndex = 450;
    map.getPane('topTiles').style.pointerEvents = 'none';

    map.createPane('maskOverlayPane');
    map.getPane('maskOverlayPane').style.zIndex = 390; 
    map.getPane('maskOverlayPane').style.pointerEvents = 'none';

// Protected pane for LIGTAS Sites so they stay on top
    map.createPane('siteBoundaries');
    map.getPane('siteBoundaries').style.zIndex = 460;
    map.getPane('siteBoundaries').style.pointerEvents = 'none'; // Lets clicks pass through to data below
    // ---------------------------

    // --- BASE LAYERS CONFIGURATION ---
    baseLayersData = {
        "Streets": L.layerGroup([
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }),
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', opacity: 0.5, pane: 'topTiles' })
        ]),
        
        "Satellite": L.layerGroup([
            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri' }),
            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri', opacity: 0.5, pane: 'topTiles' })
        ]),
        
        "Hybrid": L.layerGroup([
            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri' }),
            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri', opacity: 0.5, pane: 'topTiles' }),
            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { attribution: 'Labels &copy; Esri', opacity: 0.5, pane: 'topTiles' }),
            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { attribution: 'Roads &copy; Esri', opacity: 0.5, pane: 'topTiles' })
        ]),

        "Topo": L.layerGroup([
            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri' }),
            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri', opacity: 0.5, pane: 'topTiles' })
        ])
    };
    baseLayersData["Streets"].addTo(map);

    L.control.scale().addTo(map); L.control.locate().addTo(map);
    
    layerControl = L.control.layers(baseLayersData, {}, { collapsed: true, position: 'topright' }).addTo(map);
    
    if (typeof L.Control.Draw !== 'undefined') {
        const drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);
        layerControl.addOverlay(drawnItems, "My Drawings");

        const drawControl = new L.Control.Draw({
            edit: { featureGroup: drawnItems },
            draw: { polygon: true, polyline: true, rectangle: true, circle: true, marker: true, circlemarker: false }
        });
        map.addControl(drawControl);

        map.on(L.Draw.Event.CREATED, function (event) {
            const layer = event.layer;
            const type = event.layerType;

            if (type === 'marker') {
                const latlng = layer.getLatLng();
                const lat = latlng.lat.toFixed(5);
                const lng = latlng.lng.toFixed(5);
                
                const initialPopup = `
                    <div style="text-align:center; font-family:inherit; min-width: 160px;">
                        <strong style="color:var(--primary-color); font-size:1.1rem;">📍 Location Pin</strong>
                        <hr style="margin:5px 0; border:0; border-top:1px solid #ddd;">
                        <strong>Latitude:</strong> ${lat}<br>
                        <strong>Longitude:</strong> ${lng}<br>
                        <strong>Elevation:</strong> <span style="color:#FFA500;">Fetching... ⏳</span>
                    </div>
                `;
                
                layer.bindPopup(initialPopup);
                drawnItems.addLayer(layer);
                layer.openPopup();

                fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`)
                    .then(response => response.json())
                    .then(data => {
                        const elevation = data.results[0].elevation;
                        layer.setPopupContent(`
                            <div style="text-align:center; font-family:inherit; min-width: 160px;">
                                <strong style="color:var(--primary-color); font-size:1.1rem;">📍 Location Pin</strong>
                                <hr style="margin:5px 0; border:0; border-top:1px solid #ddd;">
                                <strong>Latitude:</strong> ${lat}<br>
                                <strong>Longitude:</strong> ${lng}<br>
                                <strong>Elevation:</strong> ${elevation.toFixed(1)} meters
                            </div>
                        `);
                    })
                    .catch(error => {
                        layer.setPopupContent(`
                            <div style="text-align:center; font-family:inherit; min-width: 160px;">
                                <strong style="color:var(--primary-color); font-size:1.1rem;">📍 Location Pin</strong>
                                <hr style="margin:5px 0; border:0; border-top:1px solid #ddd;">
                                <strong>Latitude:</strong> ${lat}<br>
                                <strong>Longitude:</strong> ${lng}<br>
                                <strong>Elevation:</strong> <span style="color:red;">Unavailable</span>
                            </div>
                        `);
                    });
            } else {
                drawnItems.addLayer(layer);
            }
        });
    }

    map.on('locationfound', function(e) {
        hideLoadingScreen(); 
        const latlng = e.latlng;
        const priorityStation = findPriorityStationNearby(latlng, 20); 
        const lsCount = getNearbyLandslideCount(latlng, 5); 
        const userProperties = { "Location Type": "User Current Location", "Latitude": latlng.lat.toFixed(5), "Longitude": latlng.lng.toFixed(5) };
        const reportContent = generateCombinedReport("User Location", userProperties, priorityStation, lsCount);
        
        if (typeof isWatchingAlerts !== 'undefined' && isWatchingAlerts) {
            checkAndTriggerMobileNotification(priorityStation);
        } else {
            L.popup().setLatLng(latlng).setContent(reportContent).openOn(map);
            updatePropertiesTable("User Location", userProperties);
        }
    });
    
    map.on('locationerror', function(e) { hideLoadingScreen(); showError("Could not acquire GPS location. Check permissions.", 'warning'); });
    
    L.Control.ResetView = L.Control.extend({
        onAdd: map => {
            const c = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
            c.style.backgroundColor = 'white'; c.style.width = '30px'; c.style.height = '30px'; c.style.cursor = 'pointer';
            c.innerHTML = '<span style="font-size:20px; line-height:30px; display:block; text-align:center;">🏠</span>'; c.title = "Reset View";
            c.onclick = () => map.setView(initialCenter, initialZoom);
            return c;
        }
    });
    map.addControl(new L.Control.ResetView({ position: 'topleft' }));

    L.Control.GPSButton = L.Control.extend({
        onAdd: map => {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control gps-image-btn');
            const img = L.DomUtil.create('img', '', container);
            img.src = 'https://raw.githubusercontent.com/LIGTAS-AGAD/ligtas-agad-rilews-v-15-mobile-edition/refs/heads/main/ISLAW2.png'; 
            img.title = "Assess My Current Location";
            const closeBtn = L.DomUtil.create('div', 'gps-close-btn', container);
            closeBtn.innerHTML = '×'; closeBtn.title = "Hide GPS Button";

            img.onclick = (e) => {
                L.DomEvent.stopPropagation(e);
                showLoadingScreen("Acquiring GPS Signal..."); 
                map.locate({setView: true, maxZoom: 16, timeout: 10000});
            };

            closeBtn.onclick = (e) => {
                L.DomEvent.stopPropagation(e); 
                container.remove();            
            };
            return container;
        }
    });
    map.addControl(new L.Control.GPSButton({ position: 'topright' }));

} catch (e) { console.error("Map failed to initialize", e); showError("Map failed to load.", 'error'); }

// ==========================================
// 4. GEOJSON LAYERS & STRICT 20KM LOGIC
// ==========================================

let overlays = {};
const layerData = [
    { name: 'LIGTAS-LSDB', desc: 'Recorded Landslides', color: 'orange' }, 
    { name: 'MGB-HIGH', desc: 'HIGH Susceptibility', color: 'red' }, 
    { name: 'MGB-MED', desc: 'MED Susceptibility', color: 'yellow' }, 
    { name: 'MGB-LOW', desc: 'LOW Susceptibility', color: 'green' },
    { name: 'LIGTAS AWS', desc: 'Monitoring Station', color: 'white' },
    { name: 'SARAI AWS', desc: 'Monitoring Station', color: 'white' },
    { name: 'ASTI AWS', desc: 'Monitoring Station', color: 'white' },
    { name: 'PAGASA AWS', desc: 'Monitoring Station', color: 'white' },
    { name: 'Yellow buffer', desc: 'Warning Level 1 (20km)', color: 'yellow' },
    { name: 'Orange buffer', desc: 'Warning Level 2 (20km)', color: 'orange' },
    { name: 'Red buffer', desc: 'Warning Level 3 (20km)', color: 'red' }
];

const layerLogos = [
    'https://raw.githubusercontent.com/Gabzrock/LIGTASAGADEWSV3/refs/heads/main/Landslide-icon.png', 
    'https://raw.githubusercontent.com/Gabzrock/LIGTASAGADEWSV3/refs/heads/main/logo3.png', 
    'https://raw.githubusercontent.com/Gabzrock/LIGTASAGADEWSV3/refs/heads/main/logo3.png', 
    'https://raw.githubusercontent.com/Gabzrock/LIGTASAGADEWSV3/refs/heads/main/logo3.png', 
    'https://ligtas.uplb.edu.ph/wp-content/uploads/2022/04/3-e1659971771933.png', 
    'https://ligtas.uplb.edu.ph/wp-content/uploads/2022/02/SARAI.png', 
    'https://ligtas.uplb.edu.ph/wp-content/uploads/2022/10/DOST-ASTI-Logo-RGB-e1722929759841.png',
    'https://raw.githubusercontent.com/Gabzrock/LIGTASkanaba/refs/heads/main/LOGO2.png', 
    'https://raw.githubusercontent.com/Gabzrock/LIGTASAGADEWSV3/refs/heads/main/layer_layers_icon_193964.png',
    'https://raw.githubusercontent.com/Gabzrock/LIGTASAGADEWSV3/refs/heads/main/layer_layers_icon_193964.png',
    'https://raw.githubusercontent.com/Gabzrock/LIGTASAGADEWSV3/refs/heads/main/layer_layers_icon_193964.png'
];

function findPriorityStationNearby(latlng, maxRadiusKm = 20) {
    if (!cachedAWSData || cachedAWSData.length === 0) return null;
    let priorityStation = null;
    let highestWarningLevel = -1;
    let minDistanceForHighest = Infinity;

    try {
        cachedAWSData.forEach(station => {
            const lat = parseFloat(station.Latitude);
            const lng = parseFloat(station.Longitude);
            if(isNaN(lat) || isNaN(lng)) return;

            const slatlng = L.latLng(lat, lng);
            const distKm = latlng.distanceTo(slatlng) / 1000;

            if (distKm <= maxRadiusKm) {
                const rawLevel = String(station.RainfallLandslidethresholdwarninglevel).trim().toLowerCase();
                let level = parseInt(rawLevel); if (isNaN(level)) level = 0;

                if (level > highestWarningLevel || (level === highestWarningLevel && distKm < minDistanceForHighest)) {
                    highestWarningLevel = level;
                    minDistanceForHighest = distKm;
                    priorityStation = { ...station, distance: distKm.toFixed(2) };
                }
            }
        });
    } catch(e) { console.error("Error finding nearest station:", e); }
    return priorityStation;
}

function getNearbyLandslideCount(latlng, radiusKm = 5) {
    if (!landslideFeatures || landslideFeatures.length === 0) return 0;
    let count = 0;
    landslideFeatures.forEach(feature => {
        if (feature.geometry && feature.geometry.type === 'Point') {
            const coords = feature.geometry.coordinates; const lLatLng = L.latLng(coords[1], coords[0]);
            if (latlng.distanceTo(lLatLng) <= (radiusKm * 1000)) { count++; }
        }
    });
    return count;
}

function generateCombinedReport(layerName, properties, nearestStation, landslideCount) {
    let susContent = '';
    for (const [key, value] of Object.entries(properties)) {
        const kLower = String(key).toLowerCase().trim();
        if (['objectid', 'fid', 'shape_length', 'shape_area', 'id'].includes(kLower)) continue;
        const displayKey = formatPropertyName(key); let displayValue = formatPropertyValue(key, value);
        if (typeof displayValue === 'string' && (displayValue.startsWith('http') || displayValue.startsWith('www'))) {
             displayValue = `<a href="${displayValue}" target="_blank" style="color:var(--primary-color); text-decoration:none; font-weight:bold;">View Link 🔗</a>`;
        }
        susContent += `<tr><th>${displayKey}</th><td>${displayValue}</td></tr>`;
    }

    let stationContent = `
        <tr>
            <td colspan="2" style="text-align:center; padding:15px; color:#c0392b; font-weight:bold;">
                ❌ No AWS nearby (Out of 20km Coverage Zone)
            </td>
        </tr>`;

    if (nearestStation) {
        const wLevel = nearestStation.RainfallLandslidethresholdwarninglevel;
        const color = wLevel == 1 ? 'yellow' : (wLevel == 2 ? 'orange' : (wLevel == 3 ? 'red' : 'green'));
        stationContent = `
            <tr><th>Nearest Station</th><td>${nearestStation.StationName || nearestStation.Station}</td></tr>
            <tr><th>Distance</th><td>${nearestStation.distance} km</td></tr>
            <tr><th>Warning Level</th><td style="background-color:${color}; font-weight:bold;">Level ${wLevel}</td></tr>
            <tr><th>Rainfall Antecedent+Cumulative (7-days)</th><td>${nearestStation.R24H || nearestStation.Rainfall || '0'} mm</td></tr>
            <tr><th>Latitude</th><td>${nearestStation.Latitude || 'N/A'}</td></tr>
            <tr><th>Longitude</th><td>${nearestStation.Longitude || 'N/A'}</td></tr>
            <tr><th>Elevation</th><td>${nearestStation.Elevation ? nearestStation.Elevation + ' m' : 'N/A'}</td></tr>
            <tr><th>Rec. Actions</th><td>${nearestStation.Recommendedactions || 'Monitor'}</td></tr>
        `;
    }

    let lsContent = `<tr><th>Nearby Landslides (5km)</th><td><b>${landslideCount}</b> recorded event(s)</td></tr>`;

    return `
        <div class="popup-container">
            <div class="popup-header">Generated Report</div>
            <div class="popup-scroll-container">
                <div class="popup-section-title">1. Location Details (${layerName})</div>
                <table class="popup-table">${susContent}</table>
                <div class="popup-section-title">2. Weather Status</div>
                <table class="popup-table">${stationContent}</table>
                <div class="popup-section-title">3. Historical Context</div>
                <table class="popup-table">${lsContent}</table>
            </div>
            <div class="popup-credits">Report Generated by <strong>DOST Project LIGTAS-AGAD RIILEWS</strong> (SESAM-UPLB)</div>
            <div class="popup-actions">
                <button class="pdf-btn" onclick="downloadPopupPDF(this)">📥 PDF</button>
                <button class="share-btn" onclick="sharePopupData(this)">📤 Share</button>
            </div>
        </div>
    `;
}

function createGeoJSONLayer(name, description, geojsonUrl, styleOptions = {}, iconUrl = null) {
    const fullName = `${name}: ${description}`;
    return fetch(geojsonUrl)
        .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
        .then(data => {
            if (name === 'LIGTAS-LSDB') landslideFeatures = data.features || [];

const layer = L.geoJSON(data, {
                style: styleOptions,
                pane: styleOptions.pane || 'overlayPane',
                interactive: styleOptions.interactive !== false, // <-- NEW: Disables click capture if false
                pointToLayer: (feature, latlng) => {
                    if (iconUrl) { return L.marker(latlng, { icon: L.icon({ iconUrl: iconUrl, iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12] }) }); } 
                    else { return L.circleMarker(latlng, { color: styleOptions.color || 'blue', fillColor: styleOptions.fillColor || styleOptions.color || 'blue', fillOpacity: styleOptions.fillOpacity || 0.8, radius: styleOptions.radius || 6, weight: styleOptions.weight || 1 }); }
                },
                onEachFeature: (feature, layer) => {
                    // --- NEW: Skip building the popup if the layer isn't interactive ---
                    if (styleOptions.interactive === false) return; 

                    let popupRows = '';
                    if (feature.properties) {
                        for (const [key, value] of Object.entries(feature.properties)) {
                            const kLower = String(key).toLowerCase().trim();
                            if (['objectid', 'fid', 'shape_length', 'shape_area', 'id'].includes(kLower)) continue;
                            const displayKey = formatPropertyName(key); let displayValue = formatPropertyValue(key, value);
                            if (typeof displayValue === 'string' && (displayValue.startsWith('http') || displayValue.startsWith('https') || displayValue.startsWith('www'))) { displayValue = `<a href="${displayValue}" target="_blank" style="color:blue; text-decoration:underline;">View Link</a>`; }
                            popupRows += `<tr><th>${displayKey}</th><td>${displayValue}</td></tr>`;
                        }
                    }
                    const displayTitle = styleOptions.customPopupName || name;
                    
                    const popupContent = `
                        <div class="popup-container">
                            <div class="popup-header">${displayTitle}</div>
                            <div class="popup-scroll-container">
                                <table class="popup-table">${popupRows}</table>
                            </div>
                            <div class="popup-credits">Report Generated by <strong>DOST Project LIGTAS-AGAD RIILEWS</strong> (SESAM-UPLB)</div>
                            <div class="popup-actions">
                                <button class="pdf-btn" onclick="downloadPopupPDF(this)">📥 PDF</button>
                                <button class="share-btn" onclick="sharePopupData(this)">📤 Share</button>
                            </div>
                        </div>
                    `;
                    
                    layer.bindPopup(popupContent);
                    layer.on('click', (e) => { 
                        updatePropertiesTable(displayTitle, feature.properties);
                        if (name.includes('MGB') || name.includes('Susceptibility')) {
                            const priorityStation = findPriorityStationNearby(e.latlng, 20); 
                            const lsCount = getNearbyLandslideCount(e.latlng, 5); 
                            const reportContent = generateCombinedReport(displayTitle, feature.properties, priorityStation, lsCount);
                            L.popup().setLatLng(e.latlng).setContent(reportContent).openOn(map);
                        }
                    });
                }
            });
            
            overlays[fullName] = layer;
            if (layerControl) layerControl.addOverlay(layer, fullName);
            return layer;
        })
        .catch(error => { console.error(`Error loading ${name}:`, error); return null; });
}

const layerPromises = [
createGeoJSONLayer('LIGTAS-LSDB', 'Recorded Landslides', 'https://raw.githubusercontent.com/Gabzrock/LIGTAS-AGAD/refs/heads/main/LandslideDB-web.geojson', { color: 'orange', fillColor: 'orange', fillOpacity: 0.8, radius: 6, weight: 1, className: 'flashing-high', pane: 'markerPane'}, null),
    createGeoJSONLayer('MGB-HIGH', 'Susceptibility', 'https://raw.githubusercontent.com/Gabzrock/LIGTASAGADEWSV3/refs/heads/main/uRIL_AWS_High%20Susceptibility.geojson', { color: 'red', fillOpacity: 0.1, weight: 0.7, className: 'flashing-high', customPopupName: 'High Landslide Risk Area' }),
    createGeoJSONLayer('MGB-MED', 'Susceptibility', 'https://raw.githubusercontent.com/Gabzrock/LIGTASAGADEWSV3/refs/heads/main/uRIL_AWS_Moderate_Susceptibility.geojson', { color: 'yellow', fillOpacity: 0.6 }),
    createGeoJSONLayer('MGB-LOW', 'Susceptibility', 'https://raw.githubusercontent.com/Gabzrock/LIGTASAGADEWSV3/refs/heads/main/uRIL_AWS_Low_Susceptibility.geojson', { color: 'green', fillOpacity: 0.6 }),
createGeoJSONLayer('PH-Boundary', 'Boundary', 'https://raw.githubusercontent.com/faeldon/philippines-json-maps/refs/heads/master/2023/geojson/country/hires/country.0.1.json', { color: 'white', fillOpacity: 0.1, weight: 0.2, interactive: false }),
createGeoJSONLayer('LIGTAS-AGAD sites', 'Boundary', 'https://raw.githubusercontent.com/Gabzrock/LIGTASAGADsites/refs/heads/main/LIGTAS-AGAD_sites2.geojson', { color: 'cyan', fillOpacity: 0.1, weight: 0.2, pane: 'siteBoundaries', interactive: false })
];

// --- BUILD INVERTED MASK FOR FOCUS MODE ---
let invertedMaskLayer = null;
fetch('https://raw.githubusercontent.com/Gabzrock/LIGTASAGADsites/refs/heads/main/LIGTAS-AGAD_sites2.geojson')
    .then(res => res.json())
    .then(data => {
        const worldCoords = [[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]];
        let coordinates = [worldCoords];

        data.features.forEach(feature => {
            if (feature.geometry && feature.geometry.type === 'Polygon') {
                coordinates.push(feature.geometry.coordinates[0]);
            } else if (feature.geometry && feature.geometry.type === 'MultiPolygon') {
                feature.geometry.coordinates.forEach(poly => {
                    coordinates.push(poly[0]);
                });
            }
        });

        invertedMaskLayer = L.geoJSON({
            "type": "Feature",
            "geometry": { "type": "Polygon", "coordinates": coordinates }
        }, {
            style: {
                fillColor: document.body.classList.contains('dark-mode') ? '#121212' : '#ffffff',
                fillOpacity: 0.85,
                color: 'transparent',
                weight: 0
            },
            pane: 'maskOverlayPane',
            interactive: false
        });

        // --- NEW: AUTO-ENABLE MASK ON LOAD ---
        // We wait 1 second to ensure all UI elements and slider listeners are fully loaded, 
        // then we simulate a click on the button to turn Focus Mode on.
        setTimeout(() => {
            const autoToggleBtn = document.getElementById('toggleMaskBtn');
            if (autoToggleBtn && !autoToggleBtn.classList.contains('btn-active')) {
                autoToggleBtn.click();
            }
        }, 1000); 
        // -------------------------------------
    })
    .catch(err => console.error("Error building mask:", err));
// ------------------------------------------
// ==========================================
// 5. SYNCHRONIZED AWS GEOJSON LAYERS
// ==========================================

let synchronizedLayers = []; 

L.Control.SyncPanel = L.Control.extend({
    onAdd: function(map) {
        const div = L.DomUtil.create('div', 'sync-panel leaflet-control');
        div.id = 'aws-sync-panel';
        L.DomEvent.disableClickPropagation(div);
        div.innerHTML = `
            <div class="sync-spinner"></div>
            <div class="sync-text">
                <strong>Landslide Warning Susceptibility Synchronizing </strong>
                <span id="sync-status-text">Please wait while downloading other layers...</span>
            </div>
        `;
        return div;
    }
});

if (map) { new L.Control.SyncPanel({ position: 'topright' }).addTo(map); }

function initSynchronizedAWSLayer(targetAwsName, geojsonUrl, layerDisplayName) {
    return fetch(geojsonUrl)
        .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
        .then(data => {
            const layer = L.geoJSON(data, {
                style: { color: '#808080', weight: 1, opacity: globalLayerOpacity, fillOpacity: globalLayerOpacity }, 
                onEachFeature: (feature, layer) => { layer.bindPopup(`<b>${layerDisplayName}</b><br>Awaiting AWS synchronization...`); }
            }).addTo(map);

            synchronizedLayers.push({ targetAws: targetAwsName, layer: layer, name: layerDisplayName });
            overlays[layerDisplayName] = layer;
            if(layerControl) layerControl.addOverlay(layer, layerDisplayName);
            if (typeof initSidebarControls === 'function') initSidebarControls();
        })
        .catch(err => console.error(`Error loading synced layer ${layerDisplayName}:`, err));
}

const awsSyncPromises = [
    initSynchronizedAWSLayer('LANDGRANT', 'https://raw.githubusercontent.com/Gabzrock/LIGTASkanaba/refs/heads/main/LIGTAS_Landgrant%20AWS_RIL_HL.geojson', 'LIGTAS LANDGRANT AWS'),
    initSynchronizedAWSLayer('NAC', 'https://raw.githubusercontent.com/Gabzrock/LIGTASkanaba/refs/heads/main/LIGTAS_NAC%20AWS_RIL_HL.geojson', 'LIGTAS NAC 2026'),
    initSynchronizedAWSLayer('PGPC', 'https://raw.githubusercontent.com/Gabzrock/LIGTASkanaba/refs/heads/main/LIGTAS_PGPC%20AWS_RIL_HL.geojson', 'VOTE PGPC AWS'),
    initSynchronizedAWSLayer('MANKAYAN', 'https://raw.githubusercontent.com/Gabzrock/LIGTASkanaba/refs/heads/main/LIGTAS_Mankayan%20AWS_RIL_HL.geojson', 'LIGTAS MANKAYAN AWS'),
    initSynchronizedAWSLayer('BUGUIAS', 'https://raw.githubusercontent.com/Gabzrock/LIGTASkanaba/refs/heads/main/LIGTAS_Buguias%20AWS_RIL_HL.geojson', 'LIGTAS BUGUIAS AWS'),
    initSynchronizedAWSLayer('BOKOD', 'https://raw.githubusercontent.com/Gabzrock/LIGTASkanaba/refs/heads/main/LIGTAS_Bokod%20AWS_RIL_HL.geojson', 'LIGTAS BOKOD AWS'),
    initSynchronizedAWSLayer('COROZ', 'https://raw.githubusercontent.com/Gabzrock/LIGTASkanaba/refs/heads/main/LIGTAS_Coroz%20AWS_RIL_HL.geojson', 'LIGTAS COROZ AWS'),
    initSynchronizedAWSLayer('ITOGON', 'https://raw.githubusercontent.com/Gabzrock/LIGTASkanaba/refs/heads/main/LIGTAS_Itogon%20AWS_RIL_HL.geojson', 'LIGTAS ITOGON AWS'),
    initSynchronizedAWSLayer('CATANAUAN', 'https://raw.githubusercontent.com/Gabzrock/LIGTASkanaba/refs/heads/main/LIGTAS_Catanauan%20AWS_RIL_HL.geojson', 'LIGTAS CATANAUAN AWS'),
    initSynchronizedAWSLayer('CATARMAN', 'https://raw.githubusercontent.com/Gabzrock/LIGTASkanaba/refs/heads/main/LIGTAS_Catarman%20AWS_RIL_HL.geojson', 'LIGTAS UEP-CATARMAN AWS'),
    initSynchronizedAWSLayer('Los Banos, Laguna AWS', 'https://raw.githubusercontent.com/LIGTAS-AGAD/LIGTAS/refs/heads/main/UPLB%20Laguna%20AWS_RIL_HL.geojson', 'PAGASA-UP Los Banos, Laguna AWS'),
    initSynchronizedAWSLayer('Polillio-Quezon AWS', 'https://raw.githubusercontent.com/LIGTAS-AGAD/LIGTAS/refs/heads/main/Polilo%20Quezon%20AWS_RIL_HL.geojson', 'PAGASA-Polillio-Quezon AWS'),
    initSynchronizedAWSLayer('Mulanay, Quezon AWS', 'https://raw.githubusercontent.com/LIGTAS-AGAD/LIGTAS/refs/heads/main/Mulanay%20Quezon%20AWS_RIL_HL.geojson', 'PAGASA-Mulanay, Quezon AWS'),
    initSynchronizedAWSLayer('Pili Camarines Sur AWS', 'https://raw.githubusercontent.com/LIGTAS-AGAD/LIGTAS/refs/heads/main/Pili%20Camarines%20Sur%20AWS_RIL_HL.geojson', 'PAGASA-Pili Camarines Sur AWS'),
    initSynchronizedAWSLayer('Legazpi AWS', 'https://raw.githubusercontent.com/LIGTAS-AGAD/LIGTAS/refs/heads/main/Legazpi%20Albay%20AWS_RIL_HL.geojson', 'PAGASA-Legazpi AWS'),
    initSynchronizedAWSLayer('Northern-Samar AWS', 'https://raw.githubusercontent.com/LIGTAS-AGAD/LIGTAS/refs/heads/main/Catarman%20Northern%20Samar%20AWS_RIL_HL.geojson', 'PAGASA-Northern-Samar AWS'),
    initSynchronizedAWSLayer('Ambulong Tanauan Batangas AWS', 'https://raw.githubusercontent.com/LIGTAS-AGAD/LIGTAS/refs/heads/main/Ambulong%20Tanauan%20Batangas%20AWS_RIL_HL.geojson', 'PAGASA-Ambulong Tanauan Batangas AWS'),
    initSynchronizedAWSLayer('Lipa, Batangas AWS', 'https://raw.githubusercontent.com/LIGTAS-AGAD/LIGTAS/refs/heads/main/Lipa%20Batangas%20AWS_RIL_HL.geojson', 'PAGASA-Lipa, Batangas AWS'),
    initSynchronizedAWSLayer('Tayabas-Quezon AWS', 'https://raw.githubusercontent.com/LIGTAS-AGAD/LIGTAS/refs/heads/main/Tayabas%20Quezon%20AWS_RIL_HL.geojson', 'PAGASA-Tayabas-Quezon AWS'),
    initSynchronizedAWSLayer('Tanay, Rizal AWS', 'https://raw.githubusercontent.com/LIGTAS-AGAD/LIGTAS/refs/heads/main/Tanay%20Rizal%20AWS_RIL_HL.geojson', 'PAGASA-Tanay, Rizal AWS'),
    initSynchronizedAWSLayer('Sorsogon, Sorsogon AWS', 'https://raw.githubusercontent.com/LIGTAS-AGAD/LIGTAS/refs/heads/main/Sorsogon%20Sorsogon%20AWS_RIL_HL.geojson', 'PAGASA-Sorsogon, Sorsogon AWS'),
    initSynchronizedAWSLayer('Virac, Catanduanes AWS', 'https://raw.githubusercontent.com/LIGTAS-AGAD/LIGTAS/refs/heads/main/Virac%20Catanduanes%20AWS_RIL_HL.geojson', 'PAGASA-Virac, Catanduanes AWS')
];

Promise.allSettled(awsSyncPromises).then(() => {
    const syncPanel = document.getElementById('aws-sync-panel');
    if (syncPanel) {
        const spinner = syncPanel.querySelector('.sync-spinner');
        const text = syncPanel.querySelector('#sync-status-text');
        if (spinner) spinner.style.display = 'none';
        if (text) text.innerText = 'All stations synced!';
        setTimeout(() => {
            syncPanel.style.opacity = '0';
            setTimeout(() => syncPanel.remove(), 400);
        }, 1500); 
    }
});

function syncAwsLayersWithData() {
    if (!cachedAWSData || cachedAWSData.length === 0) return;
    
    synchronizedLayers.forEach(layerData => {
        const matchingStations = cachedAWSData.filter(s => {
            const sName = String(s.StationName || s.Station || '').toLowerCase();
            return sName.includes(layerData.targetAws.toLowerCase());
        });

        let station = null;
        let warningLevel = 0; 

        if (matchingStations.length > 0) {
            matchingStations.sort((a, b) => {
                const levelA = parseInt(String(a.RainfallLandslidethresholdwarninglevel).trim()) || 0;
                const levelB = parseInt(String(b.RainfallLandslidethresholdwarninglevel).trim()) || 0;
                return levelB - levelA; 
            });
            station = matchingStations[0];
        }

        if (station) {
            const rawLevel = String(station.RainfallLandslidethresholdwarninglevel).trim().toLowerCase();
            warningLevel = parseInt(rawLevel) || 0; 
            let targetColor = '#808080'; 
            
            if (warningLevel === 1) targetColor = 'yellow'; 
            else if (warningLevel === 2) targetColor = 'orange'; 
            else if (warningLevel === 3) targetColor = 'red'; 
            else if (warningLevel === 0 || rawLevel === '0') targetColor = 'transparent'; 
            
            layerData.layer.setStyle({ color: targetColor, fillColor: targetColor, fillOpacity: globalLayerOpacity, weight: 0.6, opacity: globalLayerOpacity });
            layerData.currentLevel = warningLevel;
            
            layerData.layer.eachLayer(featureLayer => {
                let centerLatLng;
                if (featureLayer.getBounds) { centerLatLng = featureLayer.getBounds().getCenter(); } 
                else if (featureLayer.getLatLng) { centerLatLng = featureLayer.getLatLng(); }

                let lsCount = 0;
                let finalStationDisplay = { ...station, distance: "Unknown" };

                if (centerLatLng) {
                    lsCount = getNearbyLandslideCount(centerLatLng, 5); 
                    const priorityNearbyStation = findPriorityStationNearby(centerLatLng, 20);

                    if (priorityNearbyStation) {
                        finalStationDisplay = priorityNearbyStation;
                    } else {
                        const stLat = parseFloat(station.Latitude); const stLng = parseFloat(station.Longitude);
                        if (!isNaN(stLat) && !isNaN(stLng)) {
                            const stationLatLng = L.latLng(stLat, stLng);
                            finalStationDisplay.distance = (centerLatLng.distanceTo(stationLatLng) / 1000).toFixed(2);
                        }
                    }
                }

                const reportContent = generateCombinedReport(layerData.name, featureLayer.feature.properties || {}, finalStationDisplay, lsCount);
                featureLayer.bindPopup(reportContent); 
                featureLayer.off('popupopen').on('popupopen', () => { updatePropertiesTable(layerData.name, featureLayer.feature.properties || {}); });
            });
        } else {
            layerData.currentLevel = 0;
        }
    });

    synchronizedLayers.sort((a, b) => (a.currentLevel || 0) - (b.currentLevel || 0));
    synchronizedLayers.forEach(layerData => {
        if (layerData.layer && typeof layerData.layer.bringToFront === 'function') {
            layerData.layer.bringToFront();
        }
    });
}

// ==========================================
// 6. CONTROLS INITIALIZATION & SLIDERS
// ==========================================

const legendContainer = document.getElementById('legendModalContent');
if (legendContainer) {
    layerData.forEach((data, index) => {
        const logoSrc = layerLogos[index] || '';
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `
            <img src="${logoSrc}" class="legend-logo" alt="icon">
            <div class="legend-swatch" style="background-color: ${data.color};"></div>
            <div class="legend-text"><strong>${data.name}</strong><br><span>${data.desc}</span></div>
        `;
        legendContainer.appendChild(item);
    });
}

const searchControl = new L.Control.Search({ url: 'https://nominatim.openstreetmap.org/search?format=json&q={s}', jsonpParam: 'json_callback', propertyName: 'display_name', propertyLoc: ['lat', 'lon'], marker: L.circleMarker([0, 0], { radius: 30, color: 'red' }), autoCollapse: true, autoType: false, minLength: 2 });
map.addControl(searchControl);

Promise.allSettled(layerPromises).then((results) => {
    hideLoadingScreen(); 
    setTimeout(() => { map.invalidateSize(); }, 500);

    const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value === null));
    if (failed.length > 0) { showError(`${failed.length} layers failed to load. Check network.`, 'warning'); }

    // --- NEW: AUTO-LOAD PH BOUNDARY ON STARTUP ---
    const phBoundaryLayer = overlays['PH-Boundary: Boundary'];
    if (phBoundaryLayer && !map.hasLayer(phBoundaryLayer)) {
        map.addLayer(phBoundaryLayer);
    }
    // ---------------------------------------------

    try { initSidebarControls(); } catch (e) { console.error("Error setting default layers", e); }
});

// --- SUSCEPTIBILITY OPACITY SLIDER LOGIC ---
const opacitySlider = document.getElementById('opacitySlider');
const opacityValue = document.getElementById('opacityValue');
if (opacitySlider && opacityValue) {
    opacitySlider.oninput = function() {
        globalLayerOpacity = this.value / 100;
        opacityValue.innerHTML = this.value + "%";
        synchronizedLayers.forEach(layerData => {
            if (layerData.layer) { layerData.layer.setStyle({ opacity: globalLayerOpacity, fillOpacity: globalLayerOpacity }); }
        });
    };
}

// --- BASE MAP OPACITY SLIDER LOGIC ---
let globalBaseMapOpacity = 0.5; // Default 50%
const baseMapOpacitySlider = document.getElementById('baseMapOpacitySlider');
const baseMapOpacityValue = document.getElementById('baseMapOpacityValue');
if (baseMapOpacitySlider && baseMapOpacityValue) {
    baseMapOpacitySlider.oninput = function() {
        globalBaseMapOpacity = this.value / 100;
        baseMapOpacityValue.innerHTML = this.value + "%";
        
        Object.values(baseLayersData).forEach(layerGroup => {
            if (layerGroup && typeof layerGroup.eachLayer === 'function') {
                layerGroup.eachLayer(subLayer => {
                    if (typeof subLayer.setOpacity === 'function' && subLayer.options.pane === 'topTiles') {
                        subLayer.setOpacity(globalBaseMapOpacity);
                    }
                });
            }
        });
    };
}
// --- BOUNDARY STYLE CONTROLS LOGIC ---
const phBoundaryColor = document.getElementById('phBoundaryColor');
const phBoundaryOpacitySlider = document.getElementById('phBoundaryOpacitySlider');
const phBoundaryOpacityValue = document.getElementById('phBoundaryOpacityValue');

const ligtasSitesColor = document.getElementById('ligtasSitesColor');
const ligtasSitesOpacitySlider = document.getElementById('ligtasSitesOpacitySlider');
const ligtasSitesOpacityValue = document.getElementById('ligtasSitesOpacityValue');

// Helper function to update color and opacity dynamically
function updateBoundaryStyle(layerName, colorInput, opacityInput, opacityText) {
    const layer = overlays[layerName];
    if (layer) {
        const newColor = colorInput.value;
        const newOpacity = opacityInput.value / 100;
        if (opacityText) opacityText.innerHTML = opacityInput.value + "%";
        
        layer.setStyle({
            color: newColor,       // Updates the border line color
            fillColor: newColor,   // Updates the inside fill color
            fillOpacity: newOpacity,
            weight: 0.2            // Keeps the thin boundary line weight
        });
    }
}

// Attach event listeners so it updates in real-time as the user drags/clicks
if (phBoundaryColor && phBoundaryOpacitySlider) {
    phBoundaryColor.addEventListener('input', () => updateBoundaryStyle('PH-Boundary: Boundary', phBoundaryColor, phBoundaryOpacitySlider, phBoundaryOpacityValue));
    phBoundaryOpacitySlider.addEventListener('input', () => updateBoundaryStyle('PH-Boundary: Boundary', phBoundaryColor, phBoundaryOpacitySlider, phBoundaryOpacityValue));
}

if (ligtasSitesColor && ligtasSitesOpacitySlider) {
    ligtasSitesColor.addEventListener('input', () => updateBoundaryStyle('LIGTAS-AGAD sites: Boundary', ligtasSitesColor, ligtasSitesOpacitySlider, ligtasSitesOpacityValue));
    ligtasSitesOpacitySlider.addEventListener('input', () => updateBoundaryStyle('LIGTAS-AGAD sites: Boundary', ligtasSitesColor, ligtasSitesOpacitySlider, ligtasSitesOpacityValue));
}
// -------------------------------------
// ==========================================
// 7. DATA FETCHING & PROCESSING
// ==========================================

const warningLayerGroup = L.layerGroup().addTo(map);
if (layerControl) { layerControl.addOverlay(warningLayerGroup, "20-KM Warning & AWS"); }

const googleSheetCSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSosfBP3StMyRUzwI0tUZPsLjPVH1zePCz8gZbTMOzjOvnonbmNCoy5VT46UxO0qdqb-Wm9EqTpXp8y/pub?gid=470430875&single=true&output=csv';

function getBufferColor(warningLevel) { if (warningLevel === 1) return 'yellow'; if (warningLevel === 2) return 'orange'; if (warningLevel === 3) return 'red'; return null; }
function getStationIcon(stationName) {
    if (stationName && stationName.includes('ASTI')) return layerLogos[6];
    if (stationName && stationName.includes('SARAI')) return layerLogos[5];
    if (stationName && stationName.includes('PAGASA')) return layerLogos[7];
    return layerLogos[4]; 
}

function updateAlertTicker() {
    const tickerEl = document.getElementById('ticker-text');
    const tickerContainer = document.getElementById('alert-ticker');
    if (!tickerEl || !tickerContainer || !cachedAWSData) return;
    
    let warningStations = [];
    const prioritySortedData = [...cachedAWSData].sort((a, b) => {
        const levelA = parseInt(a.RainfallLandslidethresholdwarninglevel) || 0;
        const levelB = parseInt(b.RainfallLandslidethresholdwarninglevel) || 0;
        return levelB - levelA; 
    });

    prioritySortedData.forEach(station => {
        const level = parseInt(station.RainfallLandslidethresholdwarninglevel) || 0;
        if (level >= 1) {
            const name = station.StationName || station.Station || 'Unknown';
            const rawArea = station.Daterange || station.Municipality || station.LocationDetails || '';
            const areaDisplay = (rawArea && rawArea.toLowerCase() !== 'n/a') ? ` (${rawArea})` : '';
            let levelText = ''; let spanClass = '';
            
            if (level === 1) { levelText = 'Level 1 (Yellow)'; spanClass = 'level-1'; }
            else if (level === 2) { levelText = 'Level 2 (Orange)'; spanClass = 'level-2'; }
            else if (level === 3) { levelText = 'Level 3 (Red)'; spanClass = 'level-3'; }
            warningStations.push(`<span class="${spanClass}">${name}${areaDisplay} - ${levelText}</span>`);
        }
    });
    
    if (warningStations.length > 0) {
        tickerEl.innerHTML = `⚠️ POSSIBLE LANDSLIDE WARNING! Active Stations: &nbsp; ${warningStations.join(' &nbsp;•&nbsp; ')} &nbsp; | &nbsp; ⚠️ POSSIBLE LANDSLIDE WARNING! Please monitor local advisories and prepare for possible evacuation. Report the landslide occurrences to LIGTAS reporting page MAGMASID, MAG-ULAT, MAGING LIGTAS, PINAS!`;
        tickerContainer.style.backgroundColor = '#c0392b'; 
    } else {
        tickerEl.innerHTML = "✅ ALL STATIONS NORMAL. No active landslide warnings at this time. Network operational.";
        tickerContainer.style.backgroundColor = '#27ae60'; 
    }
}

function processAWSData(data) {
    if (!data) return;
    try { if (JSON.stringify(data) === JSON.stringify(cachedAWSData)) return; } catch(e) { }

    data.sort((a, b) => {
        let valA = parseInt(String(a.RainfallLandslidethresholdwarninglevel).trim()) || 0;
        let valB = parseInt(String(b.RainfallLandslidethresholdwarninglevel).trim()) || 0;
        return valA - valB; 
    });

    cachedAWSData = data; 
    warningLayerGroup.clearLayers(); 
    syncAwsLayersWithData();

    data.forEach(station => {
        try {
            var lat = parseFloat(station.Latitude); var lng = parseFloat(station.Longitude);
            if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return;

            var rawWarningLevel = String(station.RainfallLandslidethresholdwarninglevel).trim().toLowerCase();
            var warningLevel = parseInt(rawWarningLevel); var color = getBufferColor(warningLevel);
            
            if (rawWarningLevel === 'down') { } 
            else if (rawWarningLevel === 'n/a' || rawWarningLevel === '#value!') {
                var staticCircle = L.circle([lat, lng], { color: 'white', fillColor: 'transparent', fillOpacity: 0, radius: 20000, weight: 2, dashArray: '5, 10', interactive: false });
                warningLayerGroup.addLayer(staticCircle);
            } 
            else if (color) {
                var staticCircle = L.circle([lat, lng], { color: color, fillColor: color, fillOpacity: 0.05, radius: 20000, weight: 2, dashArray: '5, 10', interactive: false });
                warningLayerGroup.addLayer(staticCircle);
                var pulseCircle = L.circle([lat, lng], { color: color, fillColor: color, fillOpacity: 0.3, radius: 20000, weight: 1, className: 'pulse-layer', interactive: false });
                warningLayerGroup.addLayer(pulseCircle);
            }

            var iconUrl = getStationIcon(station.StationName);
            var markerZIndex = (isNaN(warningLevel) ? 0 : warningLevel) * 1000;
            var marker = L.marker([lat, lng], { icon: L.icon({ iconUrl: iconUrl, iconSize: [25, 25], iconAnchor: [12, 12] }), zIndexOffset: markerZIndex });

            var popupContent = `
                <div class="popup-container">
                    <div class="popup-header">${station.StationName || station.Station || 'Unknown Station'}</div>
                    <div class="popup-scroll-container">
                        <table class="popup-table">
                            <tr><th>Status</th><td>${station.Status || 'N/A'}</td></tr>
                            <tr><th>Category / Region</th><td>${station.Site_Category || station['Site Category'] || station.Category || 'Uncategorized'}</td></tr>
                            <tr><th>Location</th><td>${station.LocationDetails || station.Municipality || 'N/A'}</td></tr>
                            <tr><th>Latitude</th><td>${station.Latitude || 'N/A'}</td></tr>
                            <tr><th>Longitude</th><td>${station.Longitude || 'N/A'}</td></tr>
                            <tr><th>Elevation</th><td>${station.Elevation ? station.Elevation + ' m' : 'N/A'}</td></tr>
                            <tr><th>Rainfall Antecedent+Cumulative (7-days)</th><td>${station.Rainfall || station.R24H || '0'} mm</td></tr>
                            <tr><th>Warning Level</th><td>${station.RainfallLandslidethresholdwarninglevel || '0'}</td></tr>
                            <tr><th>Description</th><td>${station.Rainfalldescription || 'N/A'}</td></tr>
                            <tr><th>Scenario</th><td>${station.Possiblescenario || 'N/A'}</td></tr>
                            <tr><th>Actions</th><td>${station.Recommendedactions || 'N/A'}</td></tr>
                            <tr><th>Guide</th><td><img src="${station.Warninglevelguide || ''}" alt="Guide" onclick="showImage(this.src, 'Guide')" onerror="this.style.display='none'"/></td></tr>
                            <tr><th>Image</th><td><img src="${station.Imagelink || ''}" alt="Image" onclick="showImage(this.src, 'Station Image')" onerror="this.style.display='none'"/></td></tr>
                            <tr><th>Area</th><td>${station.Daterange || station.Municipality || 'N/A'}</td></tr>
                        </table>
                    </div>
                    <div class="popup-credits">Data & Station Alert maintained by <strong>DOST Project LIGTAS-AGAD RIILEWS</strong></div>
                    <div class="popup-actions">
                        <button class="pdf-btn" onclick="downloadPopupPDF(this)">📥 PDF</button>
                        <button class="share-btn" onclick="sharePopupData(this)">📤 Share</button>
                    </div>
                </div>`;
            
            marker.bindPopup(popupContent);
            marker.on('click', () => { updatePropertiesTable("AWS Station", station); });
            warningLayerGroup.addLayer(marker);
        } catch (err) { console.error("Error processing station:", station.StationName, err); }
    });
    
    updateAlertTicker();
}

function fetchAndRefreshData() {
    fetch('')
        .then(response => { if (!response.ok) throw new Error("Fetch failed"); return response.json(); })
        .then(data => { processAWSData(data); })
        .catch(error => { 
            if (typeof Papa !== 'undefined') {
                Papa.parse(googleSheetCSV, {
                    download: true, header: true, skipEmptyLines: true,
                    complete: function(results) { processAWSData(results.data); },
                    error: function(err) { showError("Data connection lost. Retrying...", 'warning'); }
                });
            } else { showError("Critical library missing: PapaParse.", 'error'); }
        });
}
fetchAndRefreshData(); setInterval(fetchAndRefreshData, 60000);

// ==========================================
// 8. SIDEBAR & FORECAST LOGIC
// ==========================================

const geojsonUrls = [
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_007-012_Bin5_50-100.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_007-012_Bin6_100-200.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_013-018_Bin5_50-100.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_025-030_Bin5_50-100.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_031-036_Bin5_50-100.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_049-054_Bin5_50-100.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_055-060_Bin5_50-100.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_055-060_Bin6_100-200.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_061-066_Bin5_50-100.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_073-078_Bin5_50-100.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_079-084_Bin5_50-100.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_079-084_Bin6_100-200.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_097-102_Bin5_50-100.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_097-102_Bin6_100-200.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_103-108_Bin5_50-100.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_103-108_Bin6_100-200.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_109-114_Bin5_50-100.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_121-126_Bin5_50-100.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_127-132_Bin5_50-100.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_127-132_Bin6_100-200.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_133-138_Bin5_50-100.geojson',
'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_139-144_Bin5_50-100.geojson'
];
const colors = ['yellow', 'orange', 'red', 'yellow', 'orange', 'red', 'yellow', 'orange', 'red', 'yellow', 'orange', 'red', 'yellow', 'orange', 'red', 'yellow', 'orange', 'red', 'yellow', 'orange', 'red', 'yellow', 'orange', 'red', 'yellow', 'orange', 'red', 'yellow'];
const rasterForecastUrls = [
    'https://raw.githubusercontent.com/Gabzrock/GE_experiments/refs/heads/main/ligtas_postwrf_d01_20230706_0000_f14300_rain_clipped.geojson',
    'https://placehold.co/800x600?text=Rainfall+Raster+Day+2', 'https://placehold.co/800x600?text=Rainfall+Raster+Day+3', 'https://placehold.co/800x600?text=Rainfall+Raster+Day+4', 'https://placehold.co/800x600?text=Rainfall+Raster+Day+5', 'https://placehold.co/800x600?text=Rainfall+Raster+Day+6', 'https://placehold.co/800x600?text=Rainfall+Raster+Day+7', 'https://placehold.co/800x600?text=Rainfall+Raster+Day+8', 'https://placehold.co/800x600?text=Rainfall+Raster+Day+9', 'https://placehold.co/800x600?text=Rainfall+Raster+Day+10'
];

const rasterBounds = [[5, 115], [21, 127]];
let currentRasterLayer = null; let showRaster = false;
let forecastLayers = []; let currentGroupIndex = 0; let animationInterval; let isPlaying = false; let speed = 5000;

const slider = document.getElementById('speedSlider');
const output = document.getElementById('speedValue');
if (slider && output) {
    slider.oninput = function() {
        speed = this.value * 1000; output.innerHTML = this.value + "s";
        if(isPlaying) { clearInterval(animationInterval); startAnimation(); }
    }
}

function updateRaster(index) {
    if (!showRaster) { if (currentRasterLayer) { map.removeLayer(currentRasterLayer); currentRasterLayer = null; } return; }
    if (currentRasterLayer) map.removeLayer(currentRasterLayer);
    const imageUrl = rasterForecastUrls[index % rasterForecastUrls.length];
    currentRasterLayer = L.imageOverlay(imageUrl, rasterBounds, { opacity: 0.6, interactive: true, attribution: 'Rainfall Raster Forecast' });
    currentRasterLayer.on('error', function() { console.warn(`Raster image failed to load: ${imageUrl}`); });
    currentRasterLayer.addTo(map);
}

function showGroup(groupIndex) {
    forecastLayers.forEach(layer => map.removeLayer(layer)); forecastLayers = [];
    const startIndex = groupIndex * 22; const groupUrls = geojsonUrls.slice(startIndex, startIndex + 22);
    const cg = document.getElementById('currentGroup'); if(cg) cg.textContent = `Day: ${groupIndex + 1}`;

    groupUrls.forEach((url, i) => {
        fetch(url).then(res => res.json()).then(data => {
            const layer = L.geoJSON(data, {
                style: { color: colors[i], weight: 2, opacity: 0.7 },
                onEachFeature: (feature, layer) => { layer.on('click', (e) => { L.DomEvent.stopPropagation(e); updatePropertiesTable("PAGASA-WRF (layer " + (groupIndex + 1) + ")", feature.properties); }); }
            }).addTo(map);
            forecastLayers.push(layer);
        }).catch(err => console.log('Forecast data missing'));
    });
    updateRaster(groupIndex);
}

function startAnimation() {
    isPlaying = true;
    const playBtn = document.getElementById('playBtn'); if(playBtn) playBtn.style.background = '#e69500';
    if(forecastLayers.length === 0 && !currentRasterLayer) showGroup(currentGroupIndex);
    animationInterval = setInterval(() => { currentGroupIndex = (currentGroupIndex + 1) % 10; showGroup(currentGroupIndex); }, speed);
}

function stopAnimation() {
    isPlaying = false; clearInterval(animationInterval);
    const playBtn = document.getElementById('playBtn'); if(playBtn) playBtn.style.background = 'var(--primary-color)';
}

const pBtn = document.getElementById('playBtn'); if(pBtn) pBtn.onclick = () => { if (!isPlaying) startAnimation(); };
const psBtn = document.getElementById('pauseBtn'); if(psBtn) psBtn.onclick = stopAnimation;
const sBtn = document.getElementById('stopBtn'); if(sBtn) sBtn.onclick = () => {
    stopAnimation(); forecastLayers.forEach(layer => map.removeLayer(layer)); forecastLayers = [];
    if(currentRasterLayer) { map.removeLayer(currentRasterLayer); currentRasterLayer = null; }
    currentGroupIndex = 0; const cg = document.getElementById('currentGroup'); if(cg) cg.textContent = "Day: 1";
};
const nBtn = document.getElementById('nextBtn'); if(nBtn) nBtn.onclick = () => { stopAnimation(); currentGroupIndex = (currentGroupIndex + 1) % 10; showGroup(currentGroupIndex); };
const prBtn = document.getElementById('prevBtn'); if(prBtn) prBtn.onclick = () => { stopAnimation(); currentGroupIndex = (currentGroupIndex - 1 + 10) % 10; showGroup(currentGroupIndex); };

function initSidebarControls() {
    const container = document.getElementById('layerControls');
    if (!container) return;
    container.innerHTML = ''; 

    function createToggle(id, label, layerObj, onChangeOverride) {
        const div = document.createElement('div'); div.className = 'layer-item';
        const input = document.createElement('input'); input.type = 'checkbox'; input.id = id; input.className = 'layer-toggle-input';
        
        if (layerObj) { input.checked = map.hasLayer(layerObj); }
        input.onchange = (e) => { 
            if (onChangeOverride) { onChangeOverride(e.target.checked); } 
            else if (layerObj) { e.target.checked ? map.addLayer(layerObj) : map.removeLayer(layerObj); }
        };

        const lbl = document.createElement('label'); lbl.htmlFor = id; lbl.innerText = label;
        div.appendChild(input); div.appendChild(lbl); container.appendChild(div);
        return input;
    }

    Object.keys(overlays).forEach((name, idx) => {
        const layer = overlays[name];
        const input = createToggle('toggle_overlay_' + idx, name, layer);
        map.on('layeradd', (e) => { if(e.layer === layer) input.checked = true; });
        map.on('layerremove', (e) => { if(e.layer === layer) input.checked = false; });
    });

    const warnInput = createToggle('toggle_warning', '20-KM Warning & AWS', warningLayerGroup);
    map.on('layeradd', (e) => { if(e.layer === warningLayerGroup) warnInput.checked = true; });
    map.on('layerremove', (e) => { if(e.layer === warningLayerGroup) warnInput.checked = false; });

    createToggle('toggle_raster', 'Show Raster Forecast', null, (checked) => {
        showRaster = checked;
        if (checked) updateRaster(currentGroupIndex); 
        else if (currentRasterLayer) map.removeLayer(currentRasterLayer);
    });
}

// ==========================================
// 9. UI MODAL TOGGLES & MAP CONTROLS
// ==========================================

const controlsModal = document.getElementById('controlsModal');
const propertiesModal = document.getElementById('propertiesModal');
const legendModal = document.getElementById('legendModal');

const openControlsBtn = document.getElementById('openControlsBtn');
const openPropertiesBtn = document.getElementById('openPropertiesBtn');
const openLegendBtn = document.getElementById('openLegendBtn');

const closeControlsBtn = document.getElementById('closeControlsBtn');
const closePropertiesBtn = document.getElementById('closePropertiesBtn');
const closeLegendBtn = document.getElementById('closeLegendBtn');

if(openControlsBtn) openControlsBtn.onclick = () => { controlsModal.style.display = "flex"; };
if(openPropertiesBtn) openPropertiesBtn.onclick = () => { propertiesModal.style.display = "flex"; };
if(openLegendBtn) openLegendBtn.onclick = () => { legendModal.style.display = "flex"; };

if(closeControlsBtn) closeControlsBtn.onclick = () => { controlsModal.style.display = "none"; };
if(closePropertiesBtn) closePropertiesBtn.onclick = () => { propertiesModal.style.display = "none"; };
if(closeLegendBtn) closeLegendBtn.onclick = () => { legendModal.style.display = "none"; };

window.addEventListener('click', (e) => {
    if (e.target === controlsModal) controlsModal.style.display = "none";
    if (e.target === propertiesModal) propertiesModal.style.display = "none";
    if (e.target === legendModal) legendModal.style.display = "none";
});

const toggleBufferBtn = document.getElementById('toggle-buffer');
if(toggleBufferBtn) {
    toggleBufferBtn.addEventListener('click', () => {
        if (map.hasLayer(warningLayerGroup)) { map.removeLayer(warningLayerGroup); toggleBufferBtn.classList.remove('btn-active'); } 
        else { map.addLayer(warningLayerGroup); toggleBufferBtn.classList.add('btn-active'); }
    });
}

const assessLocationBtn = document.getElementById('assessLocationBtn');
if (assessLocationBtn) {
    assessLocationBtn.addEventListener('click', function(e) {
        e.preventDefault();
        if (map) { showLoadingScreen("Acquiring GPS Signal..."); map.locate({setView: true, maxZoom: 16, timeout: 10000}); }
    });
}

const toggleEffectsBtn = document.getElementById('toggleEffectsBtn');
if (toggleEffectsBtn) {
    toggleEffectsBtn.addEventListener('click', () => {
        const body = document.body;
        body.classList.toggle('disable-effects');
        
        if (body.classList.contains('disable-effects')) {
            toggleEffectsBtn.innerText = '✨ Enable Effects';
            toggleEffectsBtn.classList.add('btn-warning');
        } else {
            toggleEffectsBtn.innerText = '✨ Disable Effects';
            toggleEffectsBtn.classList.remove('btn-warning');
        }
    });
}

const loadAllBtn = document.getElementById('loadAllLayersBtn');
if (loadAllBtn) {
    loadAllBtn.addEventListener('click', () => {
        document.querySelectorAll('.layer-toggle-input').forEach(input => {
            if (!input.checked) input.click();
        });
    });
}

const unloadAllBtn = document.getElementById('unloadAllLayersBtn');
if (unloadAllBtn) {
    unloadAllBtn.addEventListener('click', () => {
        document.querySelectorAll('.layer-toggle-input').forEach(input => {
            if (input.checked) input.click();
        });
    });
}

const defaultLayersBtn = document.getElementById('defaultLayersBtn');
if (defaultLayersBtn) {
    defaultLayersBtn.addEventListener('click', () => {
        document.querySelectorAll('.layer-toggle-input').forEach(input => {
            const label = input.nextElementSibling ? input.nextElementSibling.innerText : '';
            const isDefault = label.includes('LIGTAS-AGAD sites') || label.includes('MGB-HIGH');
            if (isDefault && !input.checked) input.click();
            if (!isDefault && input.checked) input.click();
        });
    });
}

// --- MASK MAP TOGGLE LOGIC ---
// --- MASK MAP TOGGLE LOGIC ---
let preMaskSusOpacity = 30; // Memory for Susceptibility slider
let preMaskBaseOpacity = 50; // Memory for Base Map slider

const toggleMaskBtn = document.getElementById('toggleMaskBtn');
if (toggleMaskBtn) {
    toggleMaskBtn.addEventListener('click', () => {
        // Grab the current state and slider elements
        const isCurrentlyMasked = toggleMaskBtn.classList.contains('btn-active');
        const susSlider = document.getElementById('opacitySlider');
        const baseSlider = document.getElementById('baseMapOpacitySlider');

        if (!isCurrentlyMasked) {
            // =========================
            // 1. TURN ON MASK
            // =========================
            toggleMaskBtn.innerText = '👁️ Unmask Map';
            toggleMaskBtn.classList.remove('btn-warning');
            toggleMaskBtn.classList.add('btn-active');
            
            // Add the inverted polygon mask
            if (invertedMaskLayer) {
                const isDark = document.body.classList.contains('dark-mode');
                invertedMaskLayer.setStyle({ fillColor: isDark ? '#121212' : '#ffffff', fillOpacity: 0.85 });
                map.addLayer(invertedMaskLayer);
            }

            // Auto-enable LIGTAS boundaries if they were turned off
            const sitesLayerName = Object.keys(overlays).find(name => name.includes('LIGTAS-AGAD sites'));
            if (sitesLayerName && overlays[sitesLayerName] && !map.hasLayer(overlays[sitesLayerName])) {
                map.addLayer(overlays[sitesLayerName]);
                document.querySelectorAll('.layer-toggle-input').forEach(cb => {
                    if (cb.nextElementSibling && cb.nextElementSibling.innerText.includes('LIGTAS-AGAD sites')) {
                        cb.checked = true;
                    }
                });
            }

            // Automate sliders for Focus Mode
            if (susSlider && baseSlider) {
                // Save the user's current settings before overriding
                preMaskSusOpacity = susSlider.value;
                preMaskBaseOpacity = baseSlider.value;
                
                // Set to 100% and 5% and trigger the visual updates
                susSlider.value = 100;
                susSlider.oninput();
                
                baseSlider.value = 5;
                baseSlider.oninput();
            }

        } else {
            // =========================
            // 2. TURN OFF MASK
            // =========================
            toggleMaskBtn.innerText = '👁️ Mask Map';
            toggleMaskBtn.classList.add('btn-warning');
            toggleMaskBtn.classList.remove('btn-active');
            
            // Remove the inverted polygon mask
            if (invertedMaskLayer) map.removeLayer(invertedMaskLayer);

            // Revert sliders back to defaults / previous state
            if (susSlider && baseSlider) {
                susSlider.value = preMaskSusOpacity;
                susSlider.oninput();
                
                baseSlider.value = preMaskBaseOpacity;
                baseSlider.oninput();
            }
        }
    });
}
// -----------------------------

// ==========================================
// 10. HAMBURGER MENU LOGIC
// ==========================================
const hamburgerBtn = document.getElementById('hamburgerBtn');
const subheaderMenu = document.getElementById('subheader');

if (hamburgerBtn && subheaderMenu) {
    hamburgerBtn.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation(); 
        if (subheaderMenu.classList.contains('show-menu')) { subheaderMenu.classList.remove('show-menu'); } 
        else { subheaderMenu.classList.add('show-menu'); }
    });

    const navButtons = subheaderMenu.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => { btn.addEventListener('click', () => { subheaderMenu.classList.remove('show-menu'); }); });

    document.addEventListener('click', function(e) {
        if (subheaderMenu.classList.contains('show-menu')) {
            if (!subheaderMenu.contains(e.target) && e.target !== hamburgerBtn) { subheaderMenu.classList.remove('show-menu'); }
        }
    });

    if (typeof map !== 'undefined') { map.on('click dragstart zoomstart', function() { subheaderMenu.classList.remove('show-menu'); }); }
}


// ==========================================
// 11. ALL STATIONS RAINFALL GRAPH & ADVISORIES 
// ==========================================

function getStationCategory(station) {
    if (!station) return 'Uncategorized';
    const cat = station.Site_Category || station['Site Category'] || station.Category || station.Region;
    return (cat && String(cat).trim() !== '') ? String(cat).trim() : 'Uncategorized';
}

let rainfallChartInstance = null;
const allStationsGraphModal = document.getElementById('allStationsGraphModal');
const closeAllStationsGraphBtn = document.getElementById('closeAllStationsGraphBtn');
const openAllStationsGraphBtn = document.getElementById('openAllStationsGraphBtn');
const downloadGraphBtn = document.getElementById('downloadGraphBtn');
const graphCategoryFilter = document.getElementById('graphCategoryFilter'); 

const awsAdvisoriesModal = document.getElementById('awsAdvisoriesModal');
const openAwsAdvisoriesBtn = document.getElementById('openAwsAdvisoriesBtn');
const closeAwsAdvisoriesBtn = document.getElementById('closeAwsAdvisoriesBtn');
const downloadAwsAdvisoriesPdfBtn = document.getElementById('downloadAwsAdvisoriesPdfBtn');

if (openAllStationsGraphBtn) {
    openAllStationsGraphBtn.onclick = () => {
        if(allStationsGraphModal) allStationsGraphModal.style.display = "flex";
        populateGraphCategoryDropdown(); 
        renderAllStationsGraph();
    };
}

if (closeAllStationsGraphBtn) {
    closeAllStationsGraphBtn.onclick = () => { if(allStationsGraphModal) allStationsGraphModal.style.display = "none"; };
}

if (graphCategoryFilter) { graphCategoryFilter.addEventListener('change', renderAllStationsGraph); }

function populateGraphCategoryDropdown() {
    if (!graphCategoryFilter || !cachedAWSData) return;
    const currentSelection = graphCategoryFilter.value;
    const categories = new Set();
    
    cachedAWSData.forEach(station => { categories.add(getStationCategory(station)); });

    let optionsHtml = '<option value="All">All Regions</option>';
    Array.from(categories).sort().forEach(cat => { optionsHtml += `<option value="${cat}">${cat}</option>`; });

    graphCategoryFilter.innerHTML = optionsHtml;
    if (Array.from(categories).includes(currentSelection)) { graphCategoryFilter.value = currentSelection; }
}

function renderAllStationsGraph() {
    const canvas = document.getElementById('allStationsChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const countSpan = document.getElementById('awsTotalCount');
    const isDark = document.body.classList.contains('dark-mode');
    const textColor = isDark ? '#e0e0e0' : '#666';
    const gridColor = isDark ? '#444' : 'rgba(0,0,0,0.1)';

    const labels = []; const dataValues = []; const backgroundColors = [];
    const selectedCategory = graphCategoryFilter ? graphCategoryFilter.value : 'All';

    if (cachedAWSData && cachedAWSData.length > 0) {
        let filteredData = cachedAWSData;
        if (selectedCategory !== 'All') {
            filteredData = cachedAWSData.filter(station => getStationCategory(station) === selectedCategory);
        }

        if (countSpan) countSpan.innerText = filteredData.length;

        const sortedData = [...filteredData].sort((a, b) => {
            return parseFloat(b.Rainfall || b.R24H || 0) - parseFloat(a.Rainfall || a.R24H || 0);
        });

        sortedData.forEach(station => {
            const name = station.StationName || station.Station || 'Unknown';
            const rain = parseFloat(station.Rainfall || station.R24H || 0);
            const level = parseInt(station.RainfallLandslidethresholdwarninglevel) || 0;
            
            let color = 'transparent'; 
            if (level === 1) color = 'rgba(255, 215, 0, 0.9)'; 
            if (level === 2) color = 'rgba(255, 140, 0, 0.9)'; 
            if (level === 3) color = 'rgba(231, 76, 60, 0.9)'; 
            
            labels.push(name); dataValues.push(rain); backgroundColors.push(color);
        });
    } else {
        if (countSpan) countSpan.innerText = "0";
        labels.push('No Data Available'); dataValues.push(0);
        backgroundColors.push(isDark ? 'rgba(100, 100, 100, 0.7)' : 'rgba(200, 200, 200, 0.7)');
    }

    const chartContainer = document.getElementById('chartAreaContainer');
    if (chartContainer) {
        const requiredWidth = labels.length * 40;
        chartContainer.style.width = requiredWidth > 600 ? requiredWidth + 'px' : '100%';
    }

    if (rainfallChartInstance) rainfallChartInstance.destroy();

    rainfallChartInstance = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Total Rainfall (mm)', data: dataValues, backgroundColor: backgroundColors, borderColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.4)', borderWidth: 1, borderRadius: 4 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            onClick: (event, activeElements) => {
                if (activeElements.length > 0) {
                    const clickedStationName = labels[activeElements[0].index];
                    const station = cachedAWSData.find(s => (s.StationName || s.Station || 'Unknown') === clickedStationName);
                    if (station && station.Latitude && station.Longitude) {
                        if(allStationsGraphModal) allStationsGraphModal.style.display = "none";
                        map.flyTo([parseFloat(station.Latitude), parseFloat(station.Longitude)], 14, { duration: 1.5 });
                    }
                }
            },
            scales: { y: { title: { display: true, text: 'Rainfall Antecedent+Cumulative (7-days)', color: textColor }, ticks: { color: textColor }, grid: { color: gridColor } }, x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 45, color: textColor } } },
            plugins: { legend: { display: false } }
        }
    });
}

if (downloadGraphBtn) {
    downloadGraphBtn.onclick = () => {
        const canvas = document.getElementById('allStationsChart');
        if (canvas) {
            const tempCanvas = document.createElement('canvas'); tempCanvas.width = canvas.width; tempCanvas.height = canvas.height;
            const ctx = tempCanvas.getContext('2d');
            ctx.fillStyle = document.body.classList.contains('dark-mode') ? '#121212' : '#ffffff';
            ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height); ctx.drawImage(canvas, 0, 0);
            const link = document.createElement('a'); link.download = `LIGTAS_Rainfall_Graph_${graphCategoryFilter ? graphCategoryFilter.value : 'Export'}.png`;
            link.href = tempCanvas.toDataURL('image/png'); link.click();
        }
    };
}

if (openAwsAdvisoriesBtn) {
    openAwsAdvisoriesBtn.onclick = () => {
        if(awsAdvisoriesModal) awsAdvisoriesModal.style.display = "flex";
        renderAwsAdvisoriesTable();
    };
}
if (closeAwsAdvisoriesBtn) { closeAwsAdvisoriesBtn.onclick = () => { if(awsAdvisoriesModal) awsAdvisoriesModal.style.display = "none"; }; }

function renderAwsAdvisoriesTable() {
    const tbody = document.getElementById('awsAdvisoriesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!cachedAWSData || cachedAWSData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">No AWS Data Available at this moment.</td></tr>'; return;
    }

    const groupedData = cachedAWSData.reduce((acc, station) => {
        const cat = getStationCategory(station);
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(station);
        return acc;
    }, {});

    const fragment = document.createDocumentFragment();

    Object.keys(groupedData).sort().forEach(category => {
        const headerTr = document.createElement('tr');
        headerTr.innerHTML = `<td colspan="4" style="background-color: var(--dark-teal); color: #FFD700; font-weight: bold; padding: 8px 12px; text-transform: uppercase;">📍 Region: ${category}</td>`;
        fragment.appendChild(headerTr);

        const sortedGroup = groupedData[category].sort((a, b) => (parseInt(b.RainfallLandslidethresholdwarninglevel) || 0) - (parseInt(a.RainfallLandslidethresholdwarninglevel) || 0));

        sortedGroup.forEach(station => {
            const level = parseInt(station.RainfallLandslidethresholdwarninglevel) || 0;
            let bgColor = 'transparent'; let textColor = 'inherit'; let levelText = 'No Warning';
            if (level === 1) { bgColor = '#f1c40f'; textColor = '#333'; levelText = 'Level 1 (Warning)'; } 
            else if (level === 2) { bgColor = '#e67e22'; textColor = '#fff'; levelText = 'Level 2 (Alert)'; } 
            else if (level === 3) { bgColor = '#e74c3c'; textColor = '#fff'; levelText = 'Level 3 (Evacuate)'; }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${station.StationName || station.Station || 'Unknown'}</strong></td>
                <td>${station.Daterange || station.Municipality || station.LocationDetails || 'N/A'} <br><span style="font-size: 0.75rem; color: #888;">(20km Coverage Zone)</span></td>
                <td>${station.Rainfall || station.R24H || '0'} mm</td>
                <td style="background-color: ${bgColor}; color: ${textColor}; text-align: center; font-weight: bold;">${levelText}</td>
            `;
            fragment.appendChild(tr);
        });
    });
    tbody.appendChild(fragment);
}

if (downloadAwsAdvisoriesPdfBtn) {
    downloadAwsAdvisoriesPdfBtn.onclick = function() {
        const originalBtnText = this.innerText; 
        this.innerText = "Generating Complete PDF Report... ⏳"; 
        this.disabled = true;

        const printContainer = document.createElement('div'); 
        printContainer.style.padding = '20px'; 
        printContainer.style.fontFamily = 'Helvetica, Arial, sans-serif'; 
        printContainer.style.color = '#333';
        
        const timeStr = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        
        let fullHtml = `
            <div style="text-align: center; margin-bottom: 20px; border-bottom: 2px solid #008080; padding-bottom: 10px;">
                <h2 style="color: #008080; margin: 0; font-size: 1.6rem;">LIGTAS-AGAD RILEWS</h2>
                <h3 style="margin: 5px 0 0 0; color: #444; font-size: 1.2rem;">Regional AWS Station Landslide Advisories & Master Report</h3>
                <p style="margin: 5px 0 0 0; font-size: 0.85rem; color: #666;">Report Generated as of: ${timeStr}</p>
            </div>
        `;
        
        const groupedData = (cachedAWSData || []).reduce((acc, station) => {
            const cat = getStationCategory(station);
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(station);
            return acc;
        }, {});

        const regions = Object.keys(groupedData).sort();

        if (regions.length === 0) {
            fullHtml += '<p style="text-align:center; padding:20px; font-weight:bold;">No station data available</p>';
        } else {
            regions.forEach((category, index) => {
                const pageBreakStyle = index > 0 ? 'page-break-before: always; margin-top: 20px;' : '';

                fullHtml += `
                    <div style="${pageBreakStyle}">
                        <h4 style="background-color: #1a3b42; color: #FFD700; padding: 10px; margin: 0 0 10px 0; font-size: 1.1rem; text-transform: uppercase;">
                            📍 REGION: ${category}
                        </h4>
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-bottom: 30px;">
                            <thead>
                                <tr style="background-color: #f4f4f4; color: #1a3b42; text-align: left;">
                                    <th style="padding: 10px 8px; border: 1px solid #ddd; width: 12%;">Station / Status</th>
                                    <th style="padding: 10px 8px; border: 1px solid #ddd; width: 12%;">Covered Area</th>
                                    <th style="padding: 10px 8px; border: 1px solid #ddd; width: 14%;">Coordinates & Elev</th>
                                    <th style="padding: 10px 8px; border: 1px solid #ddd; width: 10%; text-align: center;">Rainfall Antecedent+Cumulative (7-days)</th>
                                    <th style="padding: 10px 8px; border: 1px solid #ddd; width: 12%; text-align: center;">Warning Level</th>
                                    <th style="padding: 10px 8px; border: 1px solid #ddd; width: 22%;">Description & Scenario</th>
                                    <th style="padding: 10px 8px; border: 1px solid #ddd; width: 18%;">Recommended Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                `;

                const sortedGroup = groupedData[category].sort((a, b) => (parseInt(b.RainfallLandslidethresholdwarninglevel) || 0) - (parseInt(a.RainfallLandslidethresholdwarninglevel) || 0));

                sortedGroup.forEach(station => {
                    const level = parseInt(station.RainfallLandslidethresholdwarninglevel) || 0;
                    let bgColor = 'transparent'; let textColor = '#333'; let levelText = 'No Warning';
                    if (level === 1) { bgColor = '#f1c40f'; textColor = '#333'; levelText = 'Level 1 (Warning)'; } 
                    else if (level === 2) { bgColor = '#e67e22'; textColor = '#fff'; levelText = 'Level 2 (Alert)'; } 
                    else if (level === 3) { bgColor = '#e74c3c'; textColor = '#fff'; levelText = 'Level 3 (Evacuate)'; }

                    fullHtml += `
                        <tr style="page-break-inside: avoid;">
                            <td style="padding: 10px 8px; border: 1px solid #ddd; font-weight: bold;">${station.StationName || station.Station || 'Unknown'}<br><span style="font-size:0.75rem; color:#666; font-weight:normal;">(${station.Status || 'Active'})</span></td>
                            <td style="padding: 10px 8px; border: 1px solid #ddd;">${station.Daterange || station.Municipality || station.LocationDetails || 'N/A'}</td>
                            <td style="padding: 10px 8px; border: 1px solid #ddd; font-size: 0.8rem;">Lat: ${station.Latitude || 'N/A'}<br>Lng: ${station.Longitude || 'N/A'}<br>Elev: ${station.Elevation ? station.Elevation + ' m' : 'N/A'}</td>
                            <td style="padding: 10px 8px; border: 1px solid #ddd; text-align: center; font-weight: bold;">${station.Rainfall || station.R24H || '0'} mm</td>
                            <td style="padding: 10px 8px; border: 1px solid #ddd; background-color: ${bgColor}; color: ${textColor}; text-align: center; font-weight: bold;">${levelText}</td>
                            <td style="padding: 10px 8px; border: 1px solid #ddd; font-size: 0.8rem;"><strong>Desc:</strong> ${station.Rainfalldescription || 'Normal'}<br><strong>Scenario:</strong> ${station.Possiblescenario || 'None'}</td>
                            <td style="padding: 10px 8px; border: 1px solid #ddd; font-size: 0.8rem;">${station.Recommendedactions || 'Monitor'}</td>
                        </tr>
                    `;
                });

                fullHtml += `
                            </tbody>
                        </table>
                    </div>
                `;
            });
        }

        fullHtml += `
            <div style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #aaa; text-align: center; font-size: 0.9rem; color: #333; page-break-inside: avoid;">
                <p style="margin: 0; font-weight: bold;">This report is generated by LIGTAS-AGAD RILEWS DOST project Funded, implemented by SESAM</p>
            </div>
        `;
        
        printContainer.innerHTML = fullHtml;

        html2pdf().from(printContainer).set({ 
            margin: [15, 10, 15, 10], filename: 'LIGTAS_Regional_AWS_Advisories_Report.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, pagebreak: { mode: ['css', 'legacy'] }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' } 
        }).save()
            .then(() => { this.innerText = originalBtnText; this.disabled = false; })
            .catch(err => { console.error("PDF Error:", err); showError("Failed to generate report.", 'warning'); this.innerText = "Retry PDF"; this.disabled = false; });
    };
}

window.addEventListener('click', (e) => { 
    if (e.target === awsAdvisoriesModal) awsAdvisoriesModal.style.display = "none"; 
    if (e.target === allStationsGraphModal) allStationsGraphModal.style.display = "none"; 
});

// ==========================================
// 12. AUTOMATIC & MANUAL DARK MODE LOGIC
// ==========================================

const toggleDarkModeBtn = document.getElementById('toggleDarkModeBtn');

function enableDarkMode(isDark) {
    if (isDark) {
        document.body.classList.add('dark-mode');
        if (toggleDarkModeBtn) {
            toggleDarkModeBtn.innerText = '☀️ Light Mode';
            toggleDarkModeBtn.classList.add('btn-warning');
        }
        if (typeof invertedMaskLayer !== 'undefined' && invertedMaskLayer) {
            invertedMaskLayer.setStyle({ fillColor: '#121212' });
        }
    } else {
        document.body.classList.remove('dark-mode');
        if (toggleDarkModeBtn) {
            toggleDarkModeBtn.innerText = '🌙 Dark Mode';
            toggleDarkModeBtn.classList.remove('btn-warning');
        }
        if (typeof invertedMaskLayer !== 'undefined' && invertedMaskLayer) {
            invertedMaskLayer.setStyle({ fillColor: '#ffffff' });
        }
    }
}

function checkAutoDarkMode() {
    const savedPref = localStorage.getItem('ligtas-dark-mode');
    if (savedPref !== null) {
        enableDarkMode(savedPref === 'true');
        return;
    }
    const currentHour = new Date().getHours();
    const isNight = currentHour >= 18 || currentHour < 6;
    enableDarkMode(isNight);
}

if (toggleDarkModeBtn) {
    toggleDarkModeBtn.addEventListener('click', () => {
        const isCurrentlyDark = document.body.classList.contains('dark-mode');
        enableDarkMode(!isCurrentlyDark);
        localStorage.setItem('ligtas-dark-mode', !isCurrentlyDark);
        if (allStationsGraphModal && allStationsGraphModal.style.display === "flex") { renderAllStationsGraph(); }
    });
}
checkAutoDarkMode();

// ==========================================
// 13. SUBHEADER SCROLL ARROWS LOGIC
// ==========================================

const subheaderMenuScroll = document.getElementById('subheader');
const scrollLeftBtn = document.getElementById('scrollLeftBtn');
const scrollRightBtn = document.getElementById('scrollRightBtn');

function updateScrollArrows() {
    if (!subheaderMenuScroll || !scrollLeftBtn || !scrollRightBtn) return;
    
    if (window.innerWidth <= 768) {
        scrollLeftBtn.style.display = 'none';
        scrollRightBtn.style.display = 'none';
        return;
    }

    const maxScrollLeft = subheaderMenuScroll.scrollWidth - subheaderMenuScroll.clientWidth;
    
    if (maxScrollLeft > 0) {
        scrollLeftBtn.style.display = subheaderMenuScroll.scrollLeft > 5 ? 'block' : 'none';
        scrollRightBtn.style.display = subheaderMenuScroll.scrollLeft < (maxScrollLeft - 5) ? 'block' : 'none';
    } else {
        scrollLeftBtn.style.display = 'none';
        scrollRightBtn.style.display = 'none';
    }
}

if (subheaderMenuScroll) {
    subheaderMenuScroll.addEventListener('scroll', updateScrollArrows);
    window.addEventListener('resize', updateScrollArrows);
    setTimeout(updateScrollArrows, 300);
}

if (scrollLeftBtn) {
    scrollLeftBtn.addEventListener('click', () => {
        subheaderMenuScroll.scrollBy({ left: -200, behavior: 'smooth' });
    });
}
if (scrollRightBtn) {
    scrollRightBtn.addEventListener('click', () => {
        subheaderMenuScroll.scrollBy({ left: 200, behavior: 'smooth' });
    });
}

// =========================================================
// 14. AUTOMATED LOCATION-BASED MOBILE NOTIFICATION SYSTEM
// =========================================================
let isWatchingAlerts = false;
let lastNotifiedStation = "";
let lastNotifiedLevel = -1;

const toggleAutoAlertsBtn = document.getElementById('toggleAutoAlertsBtn');

function syncAlertUiPermissionState() {
    if (!toggleAutoAlertsBtn || !("Notification" in window)) return;
    if (Notification.permission === "denied") {
        toggleAutoAlertsBtn.innerText = "⚠️ Alerts Blocked";
    } else if (Notification.permission === "granted" && !isWatchingAlerts) {
        toggleAutoAlertsBtn.innerText = "🔔 Enable Track Alerts";
    }
}
setTimeout(syncAlertUiPermissionState, 1000);

if (toggleAutoAlertsBtn) {
    toggleAutoAlertsBtn.onclick = function() {
        if (!isWatchingAlerts) {
            if (!("Notification" in window)) {
                showError("Your mobile device or browser does not support native background push alerts.", "warning");
                return;
            }
            if (Notification.permission === "denied") {
                issuePermissionRescueGuide();
                return;
            }
            Notification.requestPermission().then(permission => {
                if (permission === "granted") { startAutomatedAlerts(); } 
                else { issuePermissionRescueGuide(); }
            });
        } else {
            stopAutomatedAlerts();
        }
    };
}

function issuePermissionRescueGuide() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    let rescueMsg = "⚠️ ALERTS BLOCKED: Your browser is blocking LIGTAS notifications. ";
    
    if (isIOS) {
        rescueMsg += "On iPhones, you must tap 'Share' [↑], select 'Add to Home Screen', and launch LIGTAS directly from your home screen to allow alerts.";
    } else {
        rescueMsg += "To resolve: Click the 'Site Info' icon (the two small slider switches) directly to the left of the URL address bar above, toggle Notifications to ALLOW, and refresh.";
    }
    showError(rescueMsg, "error");
    if(toggleAutoAlertsBtn) toggleAutoAlertsBtn.innerText = "⚠️ Alerts Blocked";
}

function startAutomatedAlerts() {
    isWatchingAlerts = true;
    toggleAutoAlertsBtn.innerText = "🔕 Disable Track Alerts";
    toggleAutoAlertsBtn.classList.add('btn-active');
    showError("Automated tracking active. Monitoring nearest AWS 20km baseline thresholds...", "warning");
    map.locate({ watch: true, setView: false, enableHighAccuracy: true, timeout: 20000 });
}

function stopAutomatedAlerts() {
    isWatchingAlerts = false;
    lastNotifiedStation = "";
    lastNotifiedLevel = -1;
    toggleAutoAlertsBtn.innerText = "🔔 Enable Track Alerts";
    toggleAutoAlertsBtn.classList.remove('btn-active');
    map.stopLocate();
    showError("Automated tracking alerts successfully disabled.", "warning");
}

function checkAndTriggerMobileNotification(station) {
    if (!station) return;
    
    const level = parseInt(station.RainfallLandslidethresholdwarninglevel) || 0;
    const stationId = station.StationName || station.Station || "Unknown AWS";
    const recommendation = station.Recommendedactions || "Continue regular observation and local tracking.";
    
    if (level >= 1) {
        if (lastNotifiedStation === stationId && lastNotifiedLevel === level) return;
        
        lastNotifiedStation = stationId;
        lastNotifiedLevel = level;
        
        const title = `⚠️ AWS ALERT: Warning Level ${level}`;
        const body = `Nearest AWS: ${stationId} (${station.distance} km away)\n\nRecommendation:\n${recommendation}`;
        
        if (Notification.permission === "granted") {
            new Notification(title, {
                body: body,
                icon: 'https://ligtas.uplb.edu.ph/wp-content/uploads/2022/04/3-e1659971771933.png',
                vibrate: [300, 100, 300, 100, 400], 
                tag: 'ligtas-weather-alert',
                renotify: true
            });
        }
    } else {
        if (lastNotifiedStation === stationId && lastNotifiedLevel > 0) {
            lastNotifiedLevel = 0;
            if (Notification.permission === "granted") {
                new Notification("✅ Nearest AWS Status: No Warning", {
                    body: `Monitoring station (${stationId}) has dropped back down to clear safety baselines.\n\nRecommendation:\n${recommendation}`,
                    icon: 'https://ligtas.uplb.edu.ph/wp-content/uploads/2022/04/3-e1659971771933.png',
                    tag: 'ligtas-weather-alert'
                });
            }
        }
    }
}
// =========================================================
// 15. CUSTOM GEOJSON LOADER (FILE & URL) - 10MB LIMIT
// =========================================================

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes

// Helper to draw the custom data on the map
function addCustomGeojsonToMap(data, layerName, colorHex) {
    try {
        const layer = L.geoJSON(data, {
            // Apply the user's chosen color here
            style: { color: colorHex, weight: 2, fillOpacity: 0.3, fillColor: colorHex },
            pointToLayer: (feature, latlng) => {
                return L.circleMarker(latlng, { radius: 6, color: colorHex, fillColor: colorHex, fillOpacity: 0.8, weight: 1 });
            },
            onEachFeature: (feature, layer) => {
                let popupRows = '';
                if (feature.properties) {
                    for (const [key, value] of Object.entries(feature.properties)) {
                        popupRows += `<tr><th style="width:40%;">${key}</th><td>${value}</td></tr>`;
                    }
                }
                const popupContent = `
                    <div class="popup-container">
                        <div class="popup-header" style="background-color: ${colorHex};">${layerName}</div>
                        <div class="popup-scroll-container">
                            <table class="popup-table">${popupRows || '<tr><td>No properties available.</td></tr>'}</table>
                        </div>
                    </div>
                `;
                layer.bindPopup(popupContent);
                layer.on('click', () => { updatePropertiesTable(`Custom: ${layerName}`, feature.properties || {}); });
            }
        });

        if (layer.getLayers().length === 0) throw new Error("No valid map features found in file.");

        // Add to map and register to global lists
        layer.addTo(map);
        const finalName = `Custom: ${layerName}`;
        overlays[finalName] = layer;
        
        if (layerControl) { layerControl.addOverlay(layer, finalName); }
        if (typeof initSidebarControls === 'function') { initSidebarControls(); }
        
        map.fitBounds(layer.getBounds());
        showError(`Successfully loaded: ${layerName}`, "warning"); 
        
    } catch (err) {
        console.error(err);
        showError("Failed to render GeoJSON. File may be corrupted or incorrectly formatted.", "error");
    }
}

// 1. Handle Local File Upload
const customFileInput = document.getElementById('customGeojsonFile');
if (customFileInput) {
    customFileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > MAX_FILE_SIZE) {
            showError("File exceeds the maximum 10MB limit.", "error");
            customFileInput.value = "";
            return;
        }

        // Get the chosen color
        const colorInput = document.getElementById('customGeojsonColor');
        const chosenColor = colorInput ? colorInput.value : '#9b59b6';

        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const geojsonData = JSON.parse(event.target.result);
                addCustomGeojsonToMap(geojsonData, file.name, chosenColor);
            } catch (err) {
                showError("Invalid JSON structure in file.", "error");
            }
            customFileInput.value = ""; 
        };
        reader.readAsText(file);
    });
}

// 2. Handle Web URL Fetch
const loadCustomUrlBtn = document.getElementById('loadCustomUrlBtn');
const customGeojsonUrl = document.getElementById('customGeojsonUrl');
if (loadCustomUrlBtn && customGeojsonUrl) {
    loadCustomUrlBtn.addEventListener('click', function() {
        const url = customGeojsonUrl.value.trim();
        if (!url) return;

        const originalText = loadCustomUrlBtn.innerText;
        loadCustomUrlBtn.innerText = "⏳...";
        loadCustomUrlBtn.disabled = true;

        // Get the chosen color
        const colorInput = document.getElementById('customGeojsonColor');
        const chosenColor = colorInput ? colorInput.value : '#9b59b6';

        fetch(url)
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const contentLength = response.headers.get('content-length');
                if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
                    throw new Error("Remote file exceeds the 10MB limit.");
                }
                return response.text();
            })
            .then(text => {
                if (new Blob([text]).size > MAX_FILE_SIZE) {
                    throw new Error("Remote file data exceeds the 10MB limit.");
                }
                const geojsonData = JSON.parse(text);
                const filename = url.split('/').pop().split('?')[0] || 'Web Layer';
                addCustomGeojsonToMap(geojsonData, filename, chosenColor);
                customGeojsonUrl.value = ""; 
            })
            .catch(err => {
                showError(err.message === "Failed to fetch" ? "Network error or blocked by CORS." : err.message, "error");
            })
            .finally(() => {
                loadCustomUrlBtn.innerText = originalText;
                loadCustomUrlBtn.disabled = false;
            });
    });
}
// =========================================================
// 16. KMZ EXPORT FEATURE (BUG FIX & DATA SANITIZATION)
// =========================================================

const exportKmlBtn = document.getElementById('exportKmlBtn');
if (exportKmlBtn) {
    exportKmlBtn.addEventListener('click', () => {
        // Check if BOTH libraries loaded properly
        if (typeof tokml === 'undefined' || typeof JSZip === 'undefined') {
            showError("Export libraries not loaded. Please wait a moment or check your internet connection.", "error");
            return;
        }

        const originalText = exportKmlBtn.innerText;
        exportKmlBtn.innerText = "⏳ Processing Map Data...";
        exportKmlBtn.disabled = true;

        try {
            let allFeatures = [];

            // --- DEFENSIVE DATA SANITIZER ---
            function addSafeFeature(f, layerName) {
                if (!f || !f.geometry || !f.geometry.type || !f.geometry.coordinates) return;
                if (Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length === 0) return;

                if (!f.properties) f.properties = {};
                f.properties.LayerName = layerName; // Folders in Google Earth

                // Flatten nested objects/arrays in properties 
                for (let key in f.properties) {
                    if (typeof f.properties[key] === 'object' && f.properties[key] !== null) {
                        try {
                            f.properties[key] = JSON.stringify(f.properties[key]);
                        } catch (e) {
                            f.properties[key] = "Data";
                        }
                    }
                }
                allFeatures.push(f);
            }
            // -----------------------------------------

            // 1. Extract features from all standard Overlays & Custom Uploads
            Object.keys(overlays).forEach(name => {
                const layer = overlays[name];
                if (map.hasLayer(layer) && typeof layer.toGeoJSON === 'function') {
                    const geojson = layer.toGeoJSON();
                    if (geojson.type === "FeatureCollection") {
                        geojson.features.forEach(f => addSafeFeature(f, name));
                    } else if (geojson.type === "Feature") {
                        addSafeFeature(geojson, name);
                    }
                }
            });

            // 2. Extract features from the AWS Warning Buffers & Markers
            if (typeof warningLayerGroup !== 'undefined' && map.hasLayer(warningLayerGroup)) {
                warningLayerGroup.eachLayer(layer => {
                    if (typeof layer.toGeoJSON === 'function') {
                        const geojson = layer.toGeoJSON();
                        if (geojson.type === "FeatureCollection") {
                            geojson.features.forEach(f => addSafeFeature(f, "AWS Station / 20km Buffer"));
                        } else {
                            addSafeFeature(geojson, "AWS Station / 20km Buffer");
                        }
                    }
                });
            }

            // 3. Extract user-drawn shapes (My Drawings)
            if (typeof drawnItems !== 'undefined' && map.hasLayer(drawnItems)) {
                drawnItems.eachLayer(layer => {
                    if (typeof layer.toGeoJSON === 'function') {
                        const geojson = layer.toGeoJSON();
                        
                        // Note: Leaflet Draw Circles natively export to GeoJSON as just a Point (the center).
                        // Polygons, Rectangles, Lines, and Markers export perfectly.
                        if (geojson.type === "FeatureCollection") {
                            geojson.features.forEach(f => addSafeFeature(f, "My Drawings"));
                        } else {
                            addSafeFeature(geojson, "My Drawings");
                        }
                    }
                });
            }

            if (allFeatures.length === 0) {
                showError("No valid shapes to export. Turn on layers or draw shapes first.", "warning");
                exportKmlBtn.innerText = originalText;
                exportKmlBtn.disabled = false;
                return;
            }

            const combinedGeoJSON = { type: "FeatureCollection", features: allFeatures };

            // --- CONVERT TO KML ---
            exportKmlBtn.innerText = "⏳ Converting to KML...";
            let kmlString = "";
            
            try {
                kmlString = tokml(combinedGeoJSON, {
                    documentName: 'LIGTAS-AGAD Map Export',
                    documentDescription: 'Exported active layers and drawings from LIGTAS-AGAD RILEWS',
                    name: 'LayerName' 
                });
            } catch (tokmlError) {
                console.error("tokml Conversion Error:", tokmlError);
                throw new Error("Failed to convert map data. Check the console for invalid shape details.");
            }

            // --- COMPRESS INTO KMZ ---
            exportKmlBtn.innerText = "⏳ Compressing KMZ...";
            const zip = new JSZip();
            zip.file("doc.kml", kmlString); 

            zip.generateAsync({
                type: "blob",
                compression: "DEFLATE",
                compressionOptions: { level: 6 } 
            }).then(function(blob) {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const timestamp = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
                
                a.href = url;
                a.download = `LIGTAS_Export_${timestamp}.kmz`; 
                
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                showError("KMZ file downloaded successfully!", "warning");
            }).catch(function(err) {
                console.error("Zipping Error:", err);
                throw new Error("Failed to compress file into KMZ format.");
            }).finally(function() {
                exportKmlBtn.innerText = originalText;
                exportKmlBtn.disabled = false;
            });

        } catch (err) {
            console.error("Export Process Error:", err);
            showError(err.message || "An error occurred while building the map data.", "error");
            exportKmlBtn.innerText = originalText;
            exportKmlBtn.disabled = false;
        }
    });
}
