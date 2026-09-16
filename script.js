// ==========================================
// 1. GLOBAL ERROR HANDLING & UTILITIES
// ==========================================

let errorOverrideTimer = null;

function hideErrorNotification() {
    const errDiv = document.getElementById('errorOverride');
    if (!errDiv) return;
    if (errorOverrideTimer) {
        clearTimeout(errorOverrideTimer);
        errorOverrideTimer = null;
    }
    errDiv.classList.add('notice-hiding');
    setTimeout(() => {
        errDiv.style.display = 'none';
        errDiv.classList.remove('notice-hiding');
    }, 250);
}
window.hideErrorNotification = hideErrorNotification;

function showError(message, type = 'error') {
    const errDiv = document.getElementById('errorOverride');
    const errMsg = document.getElementById('errorMessage');
    const errIcon = document.getElementById('errorIcon');
    
    if (errDiv && errMsg) {
        if (errorOverrideTimer) {
            clearTimeout(errorOverrideTimer);
            errorOverrideTimer = null;
        }

        let typeLabel = 'Notice';
        let defaultIcon = 'ℹ️';

        if (type === 'error') {
            typeLabel = 'System Error';
            defaultIcon = '❌';
        } else if (type === 'warning') {
            typeLabel = 'Warning';
            defaultIcon = '⚠️';
        } else if (type === 'info') {
            typeLabel = 'Notice';
            defaultIcon = 'ℹ️';
        }

        if (errIcon) {
            errIcon.innerText = defaultIcon;
        }

        errMsg.innerHTML = `<strong>${typeLabel}:</strong> ${message}`;
        errDiv.className = `map-floating-notice ${type}`;
        errDiv.classList.remove('notice-hiding');
        errDiv.style.display = 'flex';

        // Auto-dismiss notices and warnings after 5 seconds, errors after 8 seconds
        const timeoutMs = type === 'error' ? 8000 : 5000;
        errorOverrideTimer = setTimeout(() => {
            hideErrorNotification();
        }, timeoutMs);
    }

    if (type === 'error') {
        console.error(`[${type.toUpperCase()}] ${message}`);
    } else {
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}

window.addEventListener('unhandledrejection', (e) => {
    console.warn("Handled unhandledrejection:", e.reason);
    if (e.preventDefault) e.preventDefault();
});

window.addEventListener('error', (e) => {
    console.warn("Handled runtime error:", e.message);
});


function showLoadingScreen(customMessage) {
    const splash = document.getElementById('splash-screen');
    if (splash) {
        const title = document.getElementById('splash-message');
        if (title) title.innerText = customMessage || "Loading...";
        splash.classList.remove('hidden');
        splash.style.display = 'flex';
    }
}

let hasPromptedLocation = false;
let userLocationMarker = null;
let userAccuracyCircle = null;
let user5KmBufferCircle = null;
let userRadarRangeRing = null;
let detectedLandslidePingsGroup = null;
let radarNearbyLandslidesGroup = null;
let userAssessmentActive = false;
let userAssessmentLatLng = null;
let isLandslide5KmMaskActive = false;
let isGpsLocating = false;

// Safe global overlay dictionary
var overlays = overlays || {};

function getLandslidesLayer() {
    if (typeof overlays === 'undefined') return null;
    const key = Object.keys(overlays).find(k => k.includes('LIGTAS-LSDB'));
    return key ? overlays[key] : null;
}

function applyLandslide5KmMask(centerLatLng) {
    if (!centerLatLng) return;
    const normCenter = L.latLng(centerLatLng);
    userAssessmentActive = true;
    userAssessmentLatLng = normCenter;
    isLandslide5KmMaskActive = true;

    const lsLayer = getLandslidesLayer();

    // PERFORMANCE & WEBKIT CRASH FIX:
    // Do NOT render all 8,000 regional markers to the map while 5km proximity radar is active.
    // Removing the 8,000-marker regional layer frees up memory and prevents WebKit SVG invalidation crashes.
    if (lsLayer && map && map.hasLayer(lsLayer)) {
        map.removeLayer(lsLayer);
    }

    // Initialize or reset the dedicated nearby landslide layer group
    if (!radarNearbyLandslidesGroup && map) {
        radarNearbyLandslidesGroup = L.layerGroup().addTo(map);
    } else if (radarNearbyLandslidesGroup) {
        radarNearbyLandslidesGroup.clearLayers();
        if (map && !map.hasLayer(radarNearbyLandslidesGroup)) {
            radarNearbyLandslidesGroup.addTo(map);
        }
    }

    // Initialize or reset the detected radar pings layer group
    if (!detectedLandslidePingsGroup && map) {
        detectedLandslidePingsGroup = L.layerGroup().addTo(map);
    } else if (detectedLandslidePingsGroup) {
        detectedLandslidePingsGroup.clearLayers();
        if (map && !map.hasLayer(detectedLandslidePingsGroup)) {
            detectedLandslidePingsGroup.addTo(map);
        }
    }

    let visibleCount = 0;

    // Retrieve features either from landslideFeatures array or GeoJSON layer
    const candidateFeatures = (typeof landslideFeatures !== 'undefined' && landslideFeatures && landslideFeatures.length > 0)
        ? landslideFeatures
        : (lsLayer && lsLayer.toGeoJSON ? (lsLayer.toGeoJSON().features || []) : []);

    candidateFeatures.forEach(feature => {
        if (!feature.geometry || feature.geometry.type !== 'Point') return;
        const coords = feature.geometry.coordinates;
        if (!coords || coords.length < 2) return;
        const mLatLng = L.latLng(coords[1], coords[0]);
        const distMeters = normCenter.distanceTo(mLatLng);

        if (distMeters <= 5000) {
            visibleCount++;

            // Create high-visibility detected landslide marker
            const marker = L.circleMarker(mLatLng, {
                color: '#ef4444',
                fillColor: '#ea580c',
                fillOpacity: 0.95,
                radius: 7.5,
                weight: 2.2,
                opacity: 1,
                className: 'detected-landslide-marker',
                pane: 'markerPane'
            });

            marker.bindPopup(generateLandslidePointReport(feature, mLatLng), {
                autoPan: false,
                maxWidth: 360
            });

            marker.on('click', (e) => {
                if (e.originalEvent) e.originalEvent._stopped = true;
                const clickPt = e.latlng || mLatLng;
                const freshReport = generateLandslidePointReport(feature, clickPt);
                marker.setPopupContent(freshReport);

                const p = feature.properties || {};
                const yr = p['Year'] || p['YYYY-MM-DD'] || 'N/A';
                const loc = p['LANDSLID_2'] || 'N/A';
                const nearAWS = findPriorityStationNearby(clickPt, 20);

                const conciseProps = {
                    "Incident Type": "Recorded Historical Landslide",
                    "Event Year": yr,
                    "Location (LANDSLID_2)": loc,
                    "Nearest AWS Station": nearAWS ? `${nearAWS.StationName || nearAWS.Station} (${nearAWS.distance} km)` : "None nearby (>20km)",
                    "Weather Warning Level": nearAWS ? `Level ${nearAWS.RainfallLandslidethresholdwarninglevel}` : "N/A",
                    "Recommended Action": nearAWS ? (nearAWS.Recommendedactions || "Monitor") : "Monitor Local Advisories"
                };
                updatePropertiesTable("Recorded Landslide Incident", conciseProps);
                focusMapOnPopup(clickPt);
            });

            if (radarNearbyLandslidesGroup) {
                radarNearbyLandslidesGroup.addLayer(marker);
            }

            // Add radar contact expanding ping wave animation (cap to nearest 10 for mobile WebKit performance)
            if (visibleCount <= 10 && detectedLandslidePingsGroup) {
                const delaySec = (((visibleCount - 1) % 5) * 0.35).toFixed(2);
                const pingMarker = L.marker(mLatLng, {
                    icon: L.divIcon({
                        className: 'detected-ls-ping-icon',
                        html: `<div class="detected-ls-ping-wave" style="animation-delay: ${delaySec}s;"></div>`,
                        iconSize: [32, 32],
                        iconAnchor: [16, 16]
                    }),
                    interactive: false,
                    pane: 'markerPane'
                });
                detectedLandslidePingsGroup.addLayer(pingMarker);
            }
        }
    });

    console.log(`[5km Mask] Applied: ${visibleCount} landslides within 5km radius.`);
    updateMaskButtonUI(true);
}

function clearLandslide5KmMask() {
    isLandslide5KmMaskActive = false;
    if (radarNearbyLandslidesGroup) {
        radarNearbyLandslidesGroup.clearLayers();
        if (map && map.hasLayer(radarNearbyLandslidesGroup)) {
            map.removeLayer(radarNearbyLandslidesGroup);
        }
    }
    if (detectedLandslidePingsGroup) {
        detectedLandslidePingsGroup.clearLayers();
        if (map && map.hasLayer(detectedLandslidePingsGroup)) {
            map.removeLayer(detectedLandslidePingsGroup);
        }
    }

    // Restore full regional landslide layer if user requests to see all regional landslides
    const lsLayer = getLandslidesLayer();
    if (lsLayer && map && !map.hasLayer(lsLayer)) {
        map.addLayer(lsLayer);
    }

    updateMaskButtonUI(false);
}

function refreshLandslideMaskDisplay() {
    if (!isLandslide5KmMaskActive || !userAssessmentLatLng) return;
    const lsLayer = getLandslidesLayer();
    if (lsLayer && map && map.hasLayer(lsLayer)) {
        map.removeLayer(lsLayer);
    }
    if (radarNearbyLandslidesGroup && map && !map.hasLayer(radarNearbyLandslidesGroup)) {
        map.addLayer(radarNearbyLandslidesGroup);
    }
    if (detectedLandslidePingsGroup && map && !map.hasLayer(detectedLandslidePingsGroup)) {
        map.addLayer(detectedLandslidePingsGroup);
    }
}

function toggleLandslideMask() {
    if (isLandslide5KmMaskActive) {
        clearLandslide5KmMask();
        showError("5km filter disabled: Showing all recorded landslides across the region.", "info");
    } else {
        if (userAssessmentLatLng) {
            applyLandslide5KmMask(userAssessmentLatLng);
            showError("5km filter activated: Showing only landslides within 5km buffer.", "info");
        } else {
            showError("No active user assessment location found to apply 5km filter.", "warning");
        }
    }
}

function updateMaskButtonUI(isActive) {
    const popupBtn = document.getElementById('toggleLs5kmMaskBtn');
    if (popupBtn) {
        popupBtn.innerHTML = isActive ? '🌐 Show All Regional Landslides' : '🎯 Mask Landslides > 5km';
        popupBtn.classList.toggle('active', isActive);
    }
    document.querySelectorAll('.toggle-ls-mask-btn').forEach(btn => {
        btn.innerHTML = isActive ? '🌐 Show All Regional Landslides' : '🎯 Mask Landslides > 5km';
        btn.classList.toggle('active', isActive);
    });
    const badge = document.getElementById('bufferMaskBadge');
    if (badge) {
        badge.className = `buffer-status-badge ${isActive ? 'badge-active' : 'badge-inactive'}`;
        badge.innerHTML = isActive ? '🛡️ Filtered (5km Radius Only)' : '🌐 Inactive (All Regional Shown)';
    }
}

function fitTo5KmBuffer() {
    if (user5KmBufferCircle && map) {
        map.fitBounds(user5KmBufferCircle.getBounds(), {
            padding: [60, 60],
            maxZoom: 14,
            animate: true,
            duration: 0.8
        });
    } else if (userAssessmentLatLng && map) {
        map.setView(userAssessmentLatLng, 13);
    }
}

function clearUserLocationAssessment() {
    userAssessmentActive = false;
    userAssessmentLatLng = null;

    if (userLocationMarker && map) {
        map.removeLayer(userLocationMarker);
        userLocationMarker = null;
    }
    if (userAccuracyCircle && map) {
        map.removeLayer(userAccuracyCircle);
        userAccuracyCircle = null;
    }
    if (user5KmBufferCircle && map) {
        map.removeLayer(user5KmBufferCircle);
        user5KmBufferCircle = null;
    }
    if (userRadarRangeRing && map) {
        map.removeLayer(userRadarRangeRing);
        userRadarRangeRing = null;
    }

    clearLandslide5KmMask();
    if (typeof hideLandslidePointsLSDB === 'function') {
        hideLandslidePointsLSDB();
    }
    showError("GPS Proximity Landslide Radar cleared and normal map view restored.", "info");
}

function resetMapView() {
    if (!map) return;
    const center = (typeof initialCenter !== 'undefined') ? initialCenter : [12.8797, 121.7740];
    const zoom = (typeof initialZoom !== 'undefined') ? initialZoom : 6;
    const hadRadar = (typeof userAssessmentActive !== 'undefined' && userAssessmentActive);

    if (typeof clearUserLocationAssessment === 'function') {
        clearUserLocationAssessment();
    }
    if (typeof resetGeoJSONHighlight === 'function') {
        resetGeoJSONHighlight();
    }
    if (typeof hideLandslidePointsLSDB === 'function') {
        hideLandslidePointsLSDB();
    }
    map.closePopup();
    map.setView(center, zoom);
    if (!hadRadar) {
        showError("Map view reset to default.", "info");
    }
}
window.resetMapView = resetMapView;



function focusMapOnPopup(latlng, targetZoom = null) {
    if (!map || !latlng) return;
    try {
        const normLatLng = L.latLng(latlng);
        const currentZoom = map.getZoom();
        const destZoom = targetZoom !== null ? targetZoom : (currentZoom < 13 ? 14 : currentZoom);
        
        // Project at destZoom and shift upward by 140px so the popup balloon sits dead-center in the map viewport below navigation
        const pt = map.project(normLatLng, destZoom);
        const offsetPt = pt.subtract([0, 140]);
        const offsetLatLng = map.unproject(offsetPt, destZoom);
        
        const zoomDelta = Math.abs(currentZoom - destZoom);
        const animDuration = zoomDelta > 3 ? 0.9 : 0.6;
        
        map.flyTo(offsetLatLng, destZoom, { 
            animate: true, 
            duration: animDuration,
            easeLinearity: 0.25
        });
    } catch (err) {
        console.error("Error focusing on popup:", err);
    }
}

function setVisualEffects(enabled, showNotice = false) {
    const body = document.body;
    const toggleEffectsBtn = document.getElementById('toggleEffectsBtn');
    
    if (!enabled) {
        body.classList.add('disable-effects');
        if (toggleEffectsBtn) {
            toggleEffectsBtn.innerText = '✨ Enable Effects';
            toggleEffectsBtn.classList.add('btn-warning');
        }
    } else {
        body.classList.remove('disable-effects');
        if (toggleEffectsBtn) {
            toggleEffectsBtn.innerText = '✨ Disable Effects';
            toggleEffectsBtn.classList.remove('btn-warning');
        }
        // If enabling visual effects, automatically disable heavy landslide data
        setLandslideData(false, false);
        if (showNotice) {
            showError("Visual effects enabled: Landslide layers disabled to optimize performance.", "warning");
        }
    }
}

function hideLandslidePointsLSDB() {
    if (radarNearbyLandslidesGroup && map) {
        radarNearbyLandslidesGroup.clearLayers();
        if (map.hasLayer(radarNearbyLandslidesGroup)) {
            map.removeLayer(radarNearbyLandslidesGroup);
        }
    }
    if (detectedLandslidePingsGroup && map) {
        detectedLandslidePingsGroup.clearLayers();
        if (map.hasLayer(detectedLandslidePingsGroup)) {
            map.removeLayer(detectedLandslidePingsGroup);
        }
    }
    if (typeof overlays !== 'undefined') {
        Object.keys(overlays).forEach(k => {
            if (k.includes('LIGTAS-LSDB') || k.includes('LandslideDB') || k.includes('Recorded Landslides')) {
                const layer = overlays[k];
                if (layer && map && map.hasLayer(layer)) {
                    map.removeLayer(layer);
                }
            }
        });
    }
    const lsLayer = getLandslidesLayer();
    if (lsLayer && map && map.hasLayer(lsLayer)) {
        map.removeLayer(lsLayer);
    }
    document.querySelectorAll('.layer-toggle-input').forEach(cb => {
        const label = cb.nextElementSibling ? cb.nextElementSibling.innerText : '';
        if (label.includes('LIGTAS-LSDB') || label.includes('Recorded Landslides')) {
            cb.checked = false;
        }
    });
}
window.hideLandslidePointsLSDB = hideLandslidePointsLSDB;

function setLandslideData(enabled, showNotice = false, includeLSDB = false) {
    if (!map || typeof overlays === 'undefined') return;

    const landslideKeys = Object.keys(overlays).filter(k => 
        k.includes('LIGTAS-LSDB') || k.includes('MGB') || k.includes('Susceptibility')
    );

    landslideKeys.forEach(k => {
        const layer = overlays[k];
        if (layer) {
            if (enabled) {
                if (k.includes('MGB-HIGH')) {
                    if (!map.hasLayer(layer)) map.addLayer(layer);
                } else if (k.includes('LIGTAS-LSDB')) {
                    if (includeLSDB) {
                        if (!map.hasLayer(layer)) map.addLayer(layer);
                    } else {
                        if (map.hasLayer(layer)) map.removeLayer(layer);
                    }
                }
            } else {
                if (map.hasLayer(layer)) map.removeLayer(layer);
            }
        }
    });

    // Update sidebar checkboxes if initialized
    document.querySelectorAll('.layer-toggle-input').forEach(cb => {
        const label = cb.nextElementSibling ? cb.nextElementSibling.innerText : '';
        if (label.includes('MGB-HIGH')) {
            cb.checked = enabled;
        } else if (label.includes('LIGTAS-LSDB')) {
            cb.checked = enabled && includeLSDB;
        } else if (!enabled && (label.includes('MGB') || label.includes('Susceptibility'))) {
            cb.checked = false;
        }
    });

    // RULE: If landslide data is enabled, automatically disable visual effects to prevent performance issues
    if (enabled) {
        setVisualEffects(false, false);
        if (showNotice) {
            showError("Landslide Data active: Visual effects auto-disabled to optimize performance.", "warning");
        }
    }
}

function gpsProximityLandslideRadar() {
    hasPromptedLocation = true;
    if (!map) return;

    if (isGpsLocating) {
        showError("GPS acquisition already in progress. Please wait...", "info");
        return;
    }
    isGpsLocating = true;

    // Show non-blocking status notification that doesn't freeze the WebKit compositor
    showError("📡 Acquiring GPS Signal for GPS PROXIMITY LANDSLIDE RADAR (5km)...", "info");

    try {
        map.locate({ 
            setView: false, 
            maxZoom: 17, 
            enableHighAccuracy: true, 
            timeout: 12000,
            maximumAge: 30000
        }); 
    } catch (err) {
        isGpsLocating = false;
        console.error("GPS locate call failed:", err);
        showError("Could not initiate GPS location on this browser.", "warning");
    }
}
const assessUserLocation = gpsProximityLandslideRadar;
window.gpsProximityLandslideRadar = gpsProximityLandslideRadar;
window.assessUserLocation = gpsProximityLandslideRadar;

function showLocationPrompt() {
    if (hasPromptedLocation) return;
    hasPromptedLocation = true;

    if (sessionStorage.getItem('ligtas-skip-location-prompt') === 'true') {
        return;
    }

    const modal = document.getElementById('locationPromptModal');
    if (modal) {
        modal.style.display = 'flex';
        const promptLandslideToggle = document.getElementById('promptLandslideToggle');
        const promptEffectsToggle = document.getElementById('promptEffectsToggle');
        if (promptLandslideToggle) promptLandslideToggle.checked = true;
        if (promptEffectsToggle) promptEffectsToggle.checked = false;
        if (typeof updatePromptNotice === 'function') updatePromptNotice();
    }
}

function dismissLocationPrompt() {
    const modal = document.getElementById('locationPromptModal');
    const rememberCheckbox = document.getElementById('promptRememberChoice');

    if (rememberCheckbox && rememberCheckbox.checked) {
        sessionStorage.setItem('ligtas-skip-location-prompt', 'true');
    }

    if (modal) {
        modal.style.display = 'none';
    }
}

function hideLoadingScreen() {
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.classList.add('hidden');
        setTimeout(() => { 
            splash.style.display = 'none'; 
            if (!hasPromptedLocation) {
                showLocationPrompt();
            }
        }, 1000); 
    }
}

window.addEventListener('offline', () => { showError("Internet connection lost. Map data may not load.", 'error'); });
window.addEventListener('online', () => {
    showError("Internet connection restored. Refreshing data...", 'warning');
    setTimeout(() => { 
        const errDiv = document.getElementById('errorOverride');
        if (errDiv) errDiv.style.display = 'none'; 
        fetchAndRefreshData(); 
    }, 2000);
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
};

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

function Homebutton() { window.location.href = 'https://ligtas.uplb.edu.ph/LIGTAS-AGAD_new_portal-main/'; }

function formatPropertyName(key) {
    if (!key) return 'Unknown';
    const k = String(key).toLowerCase().trim();
    if (k === 'rating' || k.includes('suscept')) return 'Rating';
    if (k === 'brgy' || k === 'barangay' || k === 'name_3' || k.includes('adm4')) return 'Barangay';
    if (k.includes('area') || k === 'ha' || k.includes('hectare')) return 'Distance in hectares';
    if (k === 'mun' || k === 'muni' || k.includes('municipali') || k === 'name_2' || k.includes('adm3')) return 'Municipality';
    if (k === 'prov' || k.includes('province') || k === 'name_1' || k.includes('adm2')) return 'Province';
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
        const isSyncLayer = typeof synchronizedLayers !== 'undefined' && synchronizedLayers.some(sl => sl.name === layerName || (sl.targetAws && layerName.includes(sl.targetAws)));
        for (const [key, value] of Object.entries(properties)) {
            const kLower = String(key).toLowerCase().trim();
            if (['objectid', 'fid', 'shape_length', 'shape_area', 'id'].includes(kLower)) continue;
            if (isSyncLayer && ['site id', 'site_id', 'site name', 'site_name', 'latitude', 'longitude', 'lat', 'long'].includes(kLower)) continue;
            const displayKey = formatPropertyName(key); let displayValue = formatPropertyValue(key, value);
            if (typeof displayValue === 'object' && displayValue !== null) displayValue = JSON.stringify(displayValue);
            const row = document.createElement('tr');
            row.innerHTML = `<td><strong>${layerName}</strong></td><td>${displayKey}</td><td>${displayValue}</td>`;
            tableBody.appendChild(row);
        }
    } catch (e) { console.error("Error updating table", e); }
}

// ==========================================
// 2B. GEOJSON HIGHLIGHT EFFECT LOGIC
// ==========================================
let activeSelectedLayer = null;

function highlightGeoJSONFeature(targetLayer) {
    if (!targetLayer || typeof targetLayer.setStyle !== 'function') return;

    // Reset style of previously clicked layer
    resetGeoJSONHighlight();

    // Cache current original style parameters
    if (!targetLayer._originalStyle) {
        targetLayer._originalStyle = {
            color: targetLayer.options.color || '#2c3e50',
            weight: targetLayer.options.weight || 1,
            fillColor: targetLayer.options.fillColor || targetLayer.options.color,
            fillOpacity: targetLayer.options.fillOpacity || globalLayerOpacity,
            opacity: targetLayer.options.opacity || 0.9
        };
    }

    // Apply Highlight Style for selected Barangay/Polygon
    targetLayer.setStyle({
        weight: 3.5,
        color: '#FFD700',      // Vivid Yellow Border Outline
        fillColor: '#FF5722',  // Accent highlight fill color
        fillOpacity: 0.75,
        opacity: 1.0
    });

    if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
        targetLayer.bringToFront();
    }

    activeSelectedLayer = targetLayer;
}

function resetGeoJSONHighlight() {
    if (activeSelectedLayer && activeSelectedLayer.setStyle) {
        if (activeSelectedLayer._originalStyle) {
            activeSelectedLayer.setStyle(activeSelectedLayer._originalStyle);
        } else {
            activeSelectedLayer.setStyle({
                weight: 1.5,
                color: '#2c3e50',
                fillOpacity: globalLayerOpacity
            });
        }
        activeSelectedLayer = null;
    }
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
    map.getPane('siteBoundaries').style.pointerEvents = 'none';

    // Prevent clicks inside map-floating-notice from propagating to the map canvas
    const errNotificationEl = document.getElementById('errorOverride');
    if (errNotificationEl && typeof L !== 'undefined' && L.DomEvent) {
        L.DomEvent.disableClickPropagation(errNotificationEl);
        L.DomEvent.disableScrollPropagation(errNotificationEl);
    }

    // Reset GeoJSON Highlight when map canvas is clicked directly & show raster popup if raster is active
    map.on('click', (e) => {
        if (e.originalEvent && !e.originalEvent._stopped) {
            resetGeoJSONHighlight();
            if (typeof showRaster !== 'undefined' && showRaster) {
                const latlng = e.latlng;
                const nearestSt = typeof findPriorityStationNearby === 'function' ? findPriorityStationNearby(latlng, 35) : null;
                const lsNearby = typeof getNearbyLandslideCount === 'function' ? getNearbyLandslideCount(latlng, 10) : 0;
                const dayNum = (typeof currentGroupIndex !== 'undefined') ? (currentGroupIndex + 1) : 1;
                const popupContent = `
                    <div class="popup-container">
                        <div class="popup-header">🌧️ PAGASA WRF Rainfall Forecast (Day ${dayNum})</div>
                        <div class="popup-scroll-container">
                            <div class="popup-section-title">1. Forecast Location</div>
                            <table class="popup-table">
                                <tr><th>Coordinates</th><td>${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}</td></tr>
                                <tr><th>Forecast Horizon</th><td>Day ${dayNum} of 10-day WRF model</td></tr>
                            </table>
                            <div class="popup-section-title">2. Nearest Monitoring Station</div>
                            <table class="popup-table">
                                ${nearestSt ? `
                                    <tr><th>Station</th><td><strong>${nearestSt.StationName || nearestSt.Station}</strong></td></tr>
                                    <tr><th>Distance</th><td>${nearestSt.distance} km</td></tr>
                                    <tr><th>Warning Level</th><td><span class="warning-badge badge-level-${nearestSt.RainfallLandslidethresholdwarninglevel || 0}">Level ${nearestSt.RainfallLandslidethresholdwarninglevel || 0}</span></td></tr>
                                    <tr><th>Rainfall</th><td><b>${nearestSt.Rainfall || nearestSt.R24H || '0'}</b> mm</td></tr>
                                ` : `<tr><td colspan="2" style="text-align:center; color:#888;">No active AWS within 35km</td></tr>`}
                            </table>
                            <div class="popup-section-title">3. Historical Landslides</div>
                            <table class="popup-table">
                                <tr><th>Recorded Events (10km)</th><td><b style="color:var(--primary-color);">${lsNearby}</b> event(s)</td></tr>
                            </table>
                        </div>
                        <div class="popup-credits">DOST Project LIGTAS-AGAD RIILEWS Forecast System</div>
                    </div>
                `;
                L.popup({ autoPan: false, maxWidth: 360 })
                    .setLatLng(latlng)
                    .setContent(popupContent)
                    .openOn(map);
                if (typeof focusMapOnPopup === 'function') focusMapOnPopup(latlng);
            }
        }
    });

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
        isGpsLocating = false;
        hideLoadingScreen(); 

        try {
            const latlng = e.latlng;
            const accuracyMeters = Math.round(e.accuracy || 0);

            // Remove previous GPS marker, accuracy circle, and buffer circles if any
            if (userLocationMarker) {
                map.removeLayer(userLocationMarker);
                userLocationMarker = null;
            }
            if (userAccuracyCircle) {
                map.removeLayer(userAccuracyCircle);
                userAccuracyCircle = null;
            }
            if (user5KmBufferCircle) {
                map.removeLayer(user5KmBufferCircle);
                user5KmBufferCircle = null;
            }
            if (userRadarRangeRing) {
                map.removeLayer(userRadarRangeRing);
                userRadarRangeRing = null;
            }

            // Draw accuracy circle with high-visibility cyan radar perimeter (GPU-safe)
            userAccuracyCircle = L.circle(latlng, {
                radius: Math.max(accuracyMeters, 5),
                color: 'rgba(0, 255, 255, 0.75)',
                fillColor: '#00ffff',
                fillOpacity: 0.05,
                weight: 1.5,
                dashArray: '5, 5',
                className: 'cyan-accuracy-circle',
                pane: 'overlayPane'
            }).addTo(map);

            userAccuracyCircle.bindTooltip(`📍 GPS Accuracy: ±${accuracyMeters} meters`, {
                direction: 'top',
                offset: [0, -5],
                className: 'cyan-accuracy-tooltip'
            });

            // Modern, lightweight Cyan Radar Beacon (Hardware-Accelerated & WebKit-Safe)
            const userIcon = L.divIcon({
                className: 'user-location-marker-container cyan-radar-mode',
                html: `
                    <div class="user-location-radar-sweep"></div>
                    <div class="user-location-pulse-ring ring-1"></div>
                    <div class="user-location-pulse-ring ring-2"></div>
                    <div class="user-location-dot">
                        <div class="user-location-dot-core"></div>
                    </div>
                `,
                iconSize: [60, 60],
                iconAnchor: [30, 30],
                popupAnchor: [0, -26]
            });

            userLocationMarker = L.marker(latlng, {
                icon: userIcon,
                zIndexOffset: 2000,
                title: `Your Location (±${accuracyMeters}m)`
            }).addTo(map);

            const priorityStation = findPriorityStationNearby(latlng, 20); 
            const lsCount = getNearbyLandslideCount(latlng, 5); 

            // Draw 5km Assessment Zone Cyan Radar Buffer Circle
            user5KmBufferCircle = L.circle(latlng, {
                radius: 5000,
                color: '#00e5ff',
                fillColor: '#00e5ff',
                fillOpacity: 0.035,
                weight: 1.6,
                dashArray: '6, 6',
                className: 'user-5km-buffer-zone',
                interactive: true
            }).addTo(map);

            user5KmBufferCircle.bindTooltip(`📡 GPS PROXIMITY LANDSLIDE RADAR (5km Buffer): ${lsCount} detected`, {
                direction: 'top',
                offset: [0, -10],
                className: 'buffer-5km-tooltip'
            });

            // Concentric 2.5km inner range ring for tactical radar display
            userRadarRangeRing = L.circle(latlng, {
                radius: 2500,
                color: 'rgba(0, 229, 255, 0.3)',
                fillColor: 'transparent',
                fillOpacity: 0,
                weight: 1,
                dashArray: '4, 4',
                className: 'user-radar-range-ring',
                interactive: false
            }).addTo(map);

            user5KmBufferCircle.on('click', () => {
                if (userLocationMarker) {
                    focusMapOnPopup(latlng);
                    userLocationMarker.openPopup();
                }
            });

            // Mask out distant landslides and populate nearby radar landslides
            applyLandslide5KmMask(latlng);

            // Accuracy classification badge
            let accuracyBadge = '';
            if (accuracyMeters <= 25) {
                accuracyBadge = `<span class="accuracy-pill accuracy-high">🟢 High (±${accuracyMeters} m)</span>`;
            } else if (accuracyMeters <= 100) {
                accuracyBadge = `<span class="accuracy-pill accuracy-med">🟡 Fair (±${accuracyMeters} m)</span>`;
            } else {
                accuracyBadge = `<span class="accuracy-pill accuracy-low">🔴 Approx (±${accuracyMeters} m)</span>`;
            }

            const userProperties = {
                "Location Type": "📍 GPS Detected Location",
                "Latitude": `${latlng.lat.toFixed(6)}°`,
                "Longitude": `${latlng.lng.toFixed(6)}°`,
                "GPS Accuracy": `±${accuracyMeters} meters`,
                "Signal Precision": accuracyBadge
            };

            const reportContent = generateCombinedReport("GPS PROXIMITY LANDSLIDE RADAR", userProperties, priorityStation, lsCount);

            if (typeof isWatchingAlerts !== 'undefined' && isWatchingAlerts) {
                checkAndTriggerMobileNotification(priorityStation);
            }

            // CRITICAL FOR SAFARI / ALL BROWSERS: autoPan: false prevents animation collision with flyTo
            userLocationMarker.bindPopup(reportContent, {
                autoPan: false,
                maxWidth: 360,
                className: 'user-location-popup'
            });

            // Determine optimal zoom level based on accuracy
            const targetZoom = accuracyMeters < 100 ? 16 : (accuracyMeters < 500 ? 15 : 14);

            userLocationMarker.on('click', () => {
                focusMapOnPopup(latlng, targetZoom);
            });

            // Smoothly fly and focus map directly on user location
            focusMapOnPopup(latlng, targetZoom);

            // Open popup cleanly AFTER map movement completes
            let popupOpened = false;
            const openPopupSafely = () => {
                if (popupOpened) return;
                popupOpened = true;
                if (userLocationMarker) {
                    userLocationMarker.openPopup();
                }
            };

            map.once('moveend', () => {
                setTimeout(openPopupSafely, 200);
            });
            setTimeout(openPopupSafely, 1500); // Reliable fallback if moveend finished early

            updatePropertiesTable("GPS PROXIMITY LANDSLIDE RADAR", userProperties);
            showError(`📍 GPS Signal Locked: ${lsCount} landslide(s) within 5km radius`, "info");
        } catch (err) {
            console.error("Error processing locationfound:", err);
            showError("GPS location acquired, but an error occurred updating map layers.", "warning");
        }
    });
    
    map.on('locationerror', function(e) { 
        isGpsLocating = false;
        hideLoadingScreen(); 
        showError("Could not acquire GPS location: " + (e.message || "Permission denied or unavailable"), 'warning'); 
    });

    map.on('overlayremove', (e) => {
        if (e.name && e.name.includes('LIGTAS-LSDB')) {
            if (detectedLandslidePingsGroup) detectedLandslidePingsGroup.clearLayers();
            if (radarNearbyLandslidesGroup) radarNearbyLandslidesGroup.clearLayers();
        }
    });
    map.on('overlayadd', (e) => {
        if (e.name && e.name.includes('LIGTAS-LSDB') && isLandslide5KmMaskActive && userAssessmentLatLng) {
            applyLandslide5KmMask(userAssessmentLatLng);
        }
    });
    map.on('zoomend moveend', () => {
        if (isLandslide5KmMaskActive && userAssessmentLatLng) {
            refreshLandslideMaskDisplay();
        }
    });
    
    L.Control.ResetView = L.Control.extend({
        onAdd: map => {
            const c = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
            c.style.backgroundColor = 'white'; c.style.width = '30px'; c.style.height = '30px'; c.style.cursor = 'pointer';
            c.innerHTML = '<span style="font-size:20px; line-height:30px; display:block; text-align:center;">🏠</span>'; c.title = "Reset View";
            c.onclick = () => {
                resetMapView();
            };
            return c;
        }
    });
    map.addControl(new L.Control.ResetView({ position: 'topleft' }));

    L.Control.GPSButton = L.Control.extend({
        onAdd: map => {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control gps-image-btn');
            const img = L.DomUtil.create('img', '', container);
            img.src = 'https://raw.githubusercontent.com/LIGTAS-AGAD/ligtas-agad-rilews-v-15-mobile-edition/refs/heads/main/ISLAW2.png'; 
            img.title = "GPS PROXIMITY LANDSLIDE RADAR (5km Radius)";
            const closeBtn = L.DomUtil.create('div', 'gps-close-btn', container);
            closeBtn.innerHTML = '×'; closeBtn.title = "Hide GPS Button";

            img.onclick = (e) => {
                L.DomEvent.stopPropagation(e);
                gpsProximityLandslideRadar();
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

overlays = overlays || {};
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

function generateCombinedReport(layerName, properties, nearestStation, landslideCount, isSyncAWS = false) {
    const isSyncLayer = isSyncAWS || (typeof synchronizedLayers !== 'undefined' && synchronizedLayers.some(sl => sl.name === layerName || (sl.targetAws && layerName.includes(sl.targetAws))));
    let susContent = '';
    const safeProps = properties || {};

    if (isSyncLayer) {
        // 1. Reorganize Section 1 for initSynchronizedAWSLayer:
        // Exclude: Site ID, Site Name, Latitude, Longitude (and any raw sensor metadata)
        // Include ONLY: LS Landslide Susceptibility based on layer attributes, followed by Region, Province, Municipality, and Barangay

        // A. LS Landslide Susceptibility
        let lsVal = '';
        for (const [k, v] of Object.entries(safeProps)) {
            const cleanKey = k.toLowerCase().replace(/[^a-z]/g, '');
            if (cleanKey === 'ls' || cleanKey === 'landslide' || cleanKey.includes('suscept') || cleanKey === 'rating') {
                lsVal = v;
                break;
            }
        }
        if (!lsVal && safeProps['LS']) lsVal = safeProps['LS'];
        if (!lsVal && safeProps['Landslide ']) lsVal = safeProps['Landslide '];
        if (!lsVal) lsVal = 'High Landslide Susceptibility';

        // B. Region
        let regVal = '';
        for (const [k, v] of Object.entries(safeProps)) {
            const cleanKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cleanKey === 'region' || cleanKey === 'reg' || cleanKey === 'name0' || cleanKey === 'adm1') {
                regVal = v;
                break;
            }
        }
        if (!regVal) regVal = 'N/A';

        // C. Province
        let provVal = '';
        for (const [k, v] of Object.entries(safeProps)) {
            const cleanKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cleanKey === 'province' || cleanKey === 'prov' || cleanKey === 'name1' || cleanKey === 'adm2') {
                provVal = v;
                break;
            }
        }
        if (!provVal) provVal = 'N/A';

        // D. Municipality
        let munVal = '';
        for (const [k, v] of Object.entries(safeProps)) {
            const cleanKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cleanKey === 'municipality' || cleanKey === 'municipali' || cleanKey === 'mun' || cleanKey === 'muni' || cleanKey === 'name2' || cleanKey === 'adm3') {
                munVal = v;
                break;
            }
        }
        if (!munVal) munVal = 'N/A';

        // E. Barangay
        let brgyVal = '';
        for (const [k, v] of Object.entries(safeProps)) {
            const cleanKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cleanKey === 'barangay' || cleanKey === 'brgy' || cleanKey === 'name3' || cleanKey === 'adm4') {
                brgyVal = v;
                break;
            }
        }
        if (!brgyVal) brgyVal = 'N/A';

        susContent = `
            <tr><th>LS Landslide Susceptibility</th><td><strong>${lsVal}</strong></td></tr>
            <tr><th>Region</th><td>${regVal}</td></tr>
            <tr><th>Province</th><td>${provVal}</td></tr>
            <tr><th>Municipality</th><td>${munVal}</td></tr>
            <tr><th>Barangay</th><td>${brgyVal}</td></tr>
        `;
    } else {
        for (const [key, value] of Object.entries(safeProps)) {
            const kLower = String(key).toLowerCase().trim();
            if (['objectid', 'fid', 'shape_length', 'shape_area', 'id'].includes(kLower)) continue;
            const displayKey = formatPropertyName(key); let displayValue = formatPropertyValue(key, value);
            if (typeof displayValue === 'string' && (displayValue.startsWith('http') || displayValue.startsWith('www'))) {
                 displayValue = `<a href="${displayValue}" target="_blank" style="color:var(--primary-color); text-decoration:none; font-weight:bold;">View Link 🔗</a>`;
            }
            susContent += `<tr><th>${displayKey}</th><td>${displayValue}</td></tr>`;
        }
    }

    let stationContent = `
        <tr>
            <td colspan="2" style="text-align:center; padding:14px; color:#e11d48; font-weight:700; background:rgba(244,63,94,0.06); border-radius:8px;">
                ❌ No AWS nearby (Out of 20km Coverage Zone)
            </td>
        </tr>`;

    if (nearestStation) {
        const rawWLevel = parseInt(nearestStation.RainfallLandslidethresholdwarninglevel) || 0;
        const badgeClass = `badge-level-${rawWLevel}`;
        stationContent = `
            <tr><th>Nearest Station</th><td><strong>${nearestStation.StationName || nearestStation.Station}</strong></td></tr>
            <tr><th>Distance</th><td>${nearestStation.distance} km</td></tr>
            <tr><th>Warning Level</th><td><span class="warning-badge ${badgeClass}">${rawWLevel > 0 ? '⚠️ ' : '✅ '}Level ${rawWLevel}</span></td></tr>
            <tr><th>Rainfall (7-days)</th><td><b>${nearestStation.R24H || nearestStation.Rainfall || '0'}</b> mm</td></tr>
            <tr><th>Latitude</th><td>${nearestStation.Latitude || 'N/A'}</td></tr>
            <tr><th>Longitude</th><td>${nearestStation.Longitude || 'N/A'}</td></tr>
            <tr><th>Elevation</th><td>${nearestStation.Elevation ? nearestStation.Elevation + ' m' : 'N/A'}</td></tr>
            <tr><th>Rec. Actions</th><td><span style="color:var(--dark-teal); font-weight:600;">${nearestStation.Recommendedactions || 'Monitor'}</span></td></tr>
        `;
    }

    let lsContent = `
        <tr><th>Nearby Landslides (5km)</th><td><b style="color:var(--primary-color); font-size:1.05em;">${landslideCount}</b> recorded event(s)</td></tr>
    `;
    if (layerName === "User Location" || layerName.includes("GPS PROXIMITY") || userAssessmentActive) {
        lsContent += `
            <tr>
                <th>5km Buffer Mask</th>
                <td>
                    <span id="bufferMaskBadge" class="buffer-status-badge ${isLandslide5KmMaskActive ? 'badge-active' : 'badge-inactive'}">
                        ${isLandslide5KmMaskActive ? '🛡️ Filtered (5km Radius Only)' : '🌐 Inactive (All Regional Shown)'}
                    </span>
                </td>
            </tr>
        `;
    }

    let userLocationActions = '';
    if (layerName === "User Location" || layerName.includes("GPS PROXIMITY")) {
        userLocationActions = `
            <div class="user-assessment-controls" style="margin: 8px 0 4px 0; display: flex; flex-direction: column; gap: 4px;">
                <button class="filter-ls-btn toggle-ls-mask-btn" id="toggleLs5kmMaskBtn" onclick="toggleLandslideMask()">
                    ${isLandslide5KmMaskActive ? '🌐 Show All Regional Landslides' : '🎯 Mask Landslides > 5km'}
                </button>
                <button class="filter-ls-btn outline" onclick="fitTo5KmBuffer()">
                    🔍 Fit Map to 5km Buffer Zone
                </button>
            </div>
        `;
    }

    let clearBtnHtml = (layerName === "User Location" || layerName.includes("GPS PROXIMITY")) ? 
        `<button class="clear-btn" onclick="clearUserLocationAssessment()" title="Clear GPS Proximity Radar & Restore Map" style="background:#ef4444; color:white; border:none; border-radius:6px; padding:6px 12px; font-weight:600; cursor:pointer;">✕ Clear</button>` : '';

    const popupHeaderTitle = (layerName === "User Location" || layerName.includes("GPS PROXIMITY")) ? 
        "GPS PROXIMITY LANDSLIDE RADAR" : "Generated Report";

    const section1Title = isSyncLayer ? "1 LOCATION DETAILS (Barangay)" : `1. Location Details (${layerName})`;

    return `
        <div class="popup-container">
            <div class="popup-header">${popupHeaderTitle}</div>
            <div class="popup-scroll-container">
                <div class="popup-section-title">${section1Title}</div>
                <table class="popup-table">${susContent}</table>
                <div class="popup-section-title">2. Weather Status</div>
                <table class="popup-table">${stationContent}</table>
                <div class="popup-section-title">3. Historical Context</div>
                <table class="popup-table">${lsContent}</table>
                ${userLocationActions}
            </div>
            <div class="popup-credits">Report Generated by <strong>DOST Project LIGTAS-AGAD RIILEWS</strong> (SESAM-UPLB)</div>
            <div class="popup-actions">
                <button class="pdf-btn" onclick="downloadPopupPDF(this)">📥 PDF</button>
                <button class="share-btn" onclick="sharePopupData(this)">📤 Share</button>
                ${clearBtnHtml}
            </div>
        </div>
    `;
}

function pointInLeafletPolygon(latlng, polyLayer) {
    if (!latlng || !polyLayer || !polyLayer.getBounds) return false;
    try {
        if (!polyLayer.getBounds().contains(latlng)) return false;
    } catch(e) { return false; }
    
    const lat = latlng.lat, lng = latlng.lng;
    
    function rayCast(rings) {
        if (!rings || !rings.length) return false;
        if (Array.isArray(rings[0])) {
            for (let r = 0; r < rings.length; r++) {
                if (rayCast(rings[r])) return true;
            }
            return false;
        }
        let inside = false;
        for (let i = 0, j = rings.length - 1; i < rings.length; j = i++) {
            const xi = rings[i].lat !== undefined ? rings[i].lat : rings[i][1];
            const yi = rings[i].lng !== undefined ? rings[i].lng : rings[i][0];
            const xj = rings[j].lat !== undefined ? rings[j].lat : rings[j][1];
            const yj = rings[j].lng !== undefined ? rings[j].lng : rings[j][0];
            const intersect = ((yi > lng) !== (yj > lng)) && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    try {
        return rayCast(polyLayer.getLatLngs());
    } catch (e) {
        return false;
    }
}

function findLandslideSusceptibilityAt(latlng) {
    if (!latlng) return null;
    const targetLatLng = L.latLng(latlng);
    let exactResult = null;
    let nearestResult = null;
    let minDistanceKm = 25;

    // 1. Check Synchronized AWS Layers (initSynchronizedAWSLayer)
    if (typeof synchronizedLayers !== 'undefined' && synchronizedLayers.length > 0) {
        for (const item of synchronizedLayers) {
            if (!item.layer) continue;
            item.layer.eachLayer(fl => {
                if (exactResult || !fl.getBounds) return;
                
                // Test exact polygon containment
                if (pointInLeafletPolygon(targetLatLng, fl)) {
                    const p = (fl.feature && fl.feature.properties) ? fl.feature.properties : {};
                    const lsRating = p['LS'] || p['Landslide '] || p['Landslide'] || p['rating'] || 'High Landslide Susceptibility';
                    exactResult = {
                        source: `${item.name}`,
                        susceptibility: lsRating,
                        level: String(lsRating).toLowerCase().includes('high') ? 'High' : (String(lsRating).toLowerCase().includes('mod') ? 'Moderate' : 'Low'),
                        municipality: p['Municipali'] || p['MUNICIPALI'] || '',
                        barangay: p['Barangay'] || p['BARANGAY'] || ''
                    };
                    return;
                }

                // Centroid distance fallback
                try {
                    const center = fl.getBounds().getCenter();
                    const distKm = targetLatLng.distanceTo(center) / 1000;
                    if (distKm < minDistanceKm) {
                        minDistanceKm = distKm;
                        const p = (fl.feature && fl.feature.properties) ? fl.feature.properties : {};
                        const lsRating = p['LS'] || p['Landslide '] || p['Landslide'] || p['rating'] || 'High Landslide Susceptibility';
                        nearestResult = {
                            source: `${item.name} (~${distKm.toFixed(1)} km)`,
                            susceptibility: lsRating,
                            level: String(lsRating).toLowerCase().includes('high') ? 'High' : (String(lsRating).toLowerCase().includes('mod') ? 'Moderate' : 'Low'),
                            municipality: p['Municipali'] || p['MUNICIPALI'] || '',
                            barangay: p['Barangay'] || p['BARANGAY'] || ''
                        };
                    }
                } catch(err) {}
            });
            if (exactResult) return exactResult;
        }
    }

    // 2. Check MGB Susceptibility Overlays (MGB-HIGH, MGB-MED, MGB-LOW)
    const mgbLayers = [
        { key: 'MGB-HIGH', name: 'MGB High Susceptibility', defaultRating: 'High Landslide Susceptibility', level: 'High' },
        { key: 'MGB-MED', name: 'MGB Moderate Susceptibility', defaultRating: 'Moderate Landslide Susceptibility', level: 'Moderate' },
        { key: 'MGB-LOW', name: 'MGB Low Susceptibility', defaultRating: 'Low Landslide Susceptibility', level: 'Low' }
    ];

    if (typeof overlays !== 'undefined') {
        for (const mgb of mgbLayers) {
            const overlayKey = Object.keys(overlays).find(k => k.includes(mgb.key));
            const layer = overlayKey ? overlays[overlayKey] : null;
            if (!layer) continue;

            layer.eachLayer(fl => {
                if (exactResult || !fl.getBounds) return;
                if (pointInLeafletPolygon(targetLatLng, fl)) {
                    const p = (fl.feature && fl.feature.properties) ? fl.feature.properties : {};
                    exactResult = {
                        source: mgb.name,
                        susceptibility: p['rating'] || mgb.defaultRating,
                        level: mgb.level,
                        municipality: p['ADM3_EN'] || p['ADM4_EN'] || '',
                        barangay: p['ADM4_EN'] || ''
                    };
                }
            });
            if (exactResult) return exactResult;
        }
    }

    return nearestResult;
}

function generateLandslidePointReport(feature, latlng) {
    const props = (feature && feature.properties) ? feature.properties : {};
    const normLatLng = L.latLng(latlng);

    // Strictly Year and Location (LANDSLID_2)
    const year = props['Year'] || props['YYYY-MM-DD'] || props['Month'] || 'Historical Event';
    const location = props['LANDSLID_2'] || props['BARANGAY'] || props['MUNICIPALI'] || 'Recorded Landslide Location';

    // 1. Nearby AWS Weather Data & Recommended Actions (20km radius)
    const priorityStation = findPriorityStationNearby(normLatLng, 20);
    let stationContent = `
        <tr>
            <td colspan="2" style="text-align:center; padding:12px; color:#e11d48; font-weight:700; background:rgba(244,63,94,0.06); border-radius:8px;">
                ❌ No AWS nearby (Out of 20km Coverage Zone)
            </td>
        </tr>
    `;
    let recActionContent = `
        <tr><th>Recommended Action</th><td><span style="color:#64748b; font-weight:600;">Monitor Local Weather Advisories</span></td></tr>
    `;

    if (priorityStation) {
        const rawWLevel = parseInt(priorityStation.RainfallLandslidethresholdwarninglevel) || 0;
        const badgeClass = `badge-level-${rawWLevel}`;
        stationContent = `
            <tr><th>Nearest Station</th><td><strong>${priorityStation.StationName || priorityStation.Station}</strong></td></tr>
            <tr><th>Station Distance</th><td><b>${priorityStation.distance} km</b></td></tr>
            <tr><th>Threshold Warning</th><td><span class="warning-badge ${badgeClass}">${rawWLevel > 0 ? '⚠️ ' : '✅ '}Level ${rawWLevel}</span></td></tr>
            <tr><th>Rainfall (7-days)</th><td><b>${priorityStation.R24H || priorityStation.Rainfall || '0'}</b> mm</td></tr>
        `;
        const actionText = priorityStation.Recommendedactions || (rawWLevel > 0 ? 'Prepare for possible evacuation' : 'Continue routine monitoring');
        recActionContent = `
            <tr><th>Recommended Action</th><td><strong style="color:var(--dark-teal); font-weight:700;">${actionText}</strong></td></tr>
        `;
    }

    return `
        <div class="popup-container">
            <div class="popup-header">Recorded Landslide Incident</div>
            <div class="popup-scroll-container">
                <div class="popup-section-title">1. Historical Incident Record</div>
                <table class="popup-table">
                    <tr><th>Event Year</th><td><strong style="color:var(--primary-color); font-size:1.1em;">📅 ${year}</strong></td></tr>
                    <tr><th>Location (LANDSLID_2)</th><td><strong>📍 ${location}</strong></td></tr>
                    <tr><th>Coordinates</th><td><small>${normLatLng.lat.toFixed(6)}°, ${normLatLng.lng.toFixed(6)}°</small></td></tr>
                </table>

                <div class="popup-section-title">2. Nearby AWS Weather Status</div>
                <table class="popup-table">
                    ${stationContent}
                    ${recActionContent}
                </table>
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
                interactive: styleOptions.interactive !== false,
                pointToLayer: (feature, latlng) => {
                    if (iconUrl) { return L.marker(latlng, { icon: L.icon({ iconUrl: iconUrl, iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12] }) }); } 
                    else { return L.circleMarker(latlng, { color: styleOptions.color || 'blue', fillColor: styleOptions.fillColor || styleOptions.color || 'blue', fillOpacity: styleOptions.fillOpacity || 0.8, radius: styleOptions.radius || 6, weight: styleOptions.weight || 1 }); }
                },
                onEachFeature: (feature, layer) => {
                    if (styleOptions.interactive === false) return; 

                    const displayTitle = styleOptions.customPopupName || name;

                    if (name === 'LIGTAS-LSDB') {
                        // REVISED LANDSLIDE POPUP: Year + Location LANDSLID_2 + Nearby AWS + Actions
                        const latlng = layer.getLatLng ? layer.getLatLng() : (feature.geometry && feature.geometry.coordinates ? L.latLng(feature.geometry.coordinates[1], feature.geometry.coordinates[0]) : null);
                        if (latlng) {
                            layer.bindPopup(generateLandslidePointReport(feature, latlng), {
                                autoPan: true,
                                autoPanPaddingTopLeft: [40, 70],
                                autoPanPaddingBottomRight: [40, 40],
                                maxWidth: 360
                            });
                        }
                    } else {
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
                        
                        layer.bindPopup(popupContent, {
                            autoPan: true,
                            autoPanPaddingTopLeft: [40, 70],
                            autoPanPaddingBottomRight: [40, 40],
                            maxWidth: 360
                        });
                    }

                    layer.on('click', (e) => { 
                        if (e.originalEvent) e.originalEvent._stopped = true;
                        
                        // Highlight selected Barangay / Feature boundary polygon
                        highlightGeoJSONFeature(e.target);

                        if (name === 'LIGTAS-LSDB') {
                            const clickPt = e.latlng || (layer.getLatLng ? layer.getLatLng() : null);
                            if (clickPt) {
                                const freshReport = generateLandslidePointReport(feature, clickPt);
                                layer.setPopupContent(freshReport);

                                const p = feature.properties || {};
                                const yr = p['Year'] || p['YYYY-MM-DD'] || 'N/A';
                                const loc = p['LANDSLID_2'] || 'N/A';
                                const nearAWS = findPriorityStationNearby(clickPt, 20);

                                const conciseProps = {
                                    "Incident Type": "Recorded Historical Landslide",
                                    "Event Year": yr,
                                    "Location (LANDSLID_2)": loc,
                                    "Nearest AWS Station": nearAWS ? `${nearAWS.StationName || nearAWS.Station} (${nearAWS.distance} km)` : "None nearby (>20km)",
                                    "Weather Warning Level": nearAWS ? `Level ${nearAWS.RainfallLandslidethresholdwarninglevel}` : "N/A",
                                    "Recommended Action": nearAWS ? (nearAWS.Recommendedactions || "Monitor") : "Monitor Local Advisories"
                                };
                                updatePropertiesTable("Recorded Landslide Incident", conciseProps);
                            }
                        } else {
                            updatePropertiesTable(displayTitle, feature.properties);
                            if (name.includes('MGB') || name.includes('Susceptibility')) {
                                const priorityStation = findPriorityStationNearby(e.latlng, 20); 
                                const lsCount = getNearbyLandslideCount(e.latlng, 5); 
                                const reportContent = generateCombinedReport(displayTitle, feature.properties, priorityStation, lsCount);
                                layer.setPopupContent(reportContent);
                            }
                        }
                        focusMapOnPopup(e.latlng);
                    });
                }
            });
            
            overlays[fullName] = layer;
            if (layerControl) layerControl.addOverlay(layer, fullName);

            if (name === 'LIGTAS-LSDB' && userAssessmentActive && userAssessmentLatLng) {
                applyLandslide5KmMask(userAssessmentLatLng);
            }

            return layer;
        })
        .catch(error => { console.error(`Error loading ${name}:`, error); return null; });
}

const layerPromises = [
    createGeoJSONLayer('LIGTAS-LSDB', 'Recorded Landslides', 'https://raw.githubusercontent.com/Gabzrock/LIGTAS-AGAD/refs/heads/main/LandslideDB-web.geojson', { color: 'orange', fillColor: 'orange', fillOpacity: 0.8, radius: 6, weight: 1, pane: 'markerPane'}, null),
    createGeoJSONLayer('MGB-HIGH', 'Susceptibility', 'https://raw.githubusercontent.com/Gabzrock/LIGTASAGADEWSV3/refs/heads/main/uRIL_AWS_High%20Susceptibility.geojson', { color: 'red', fillOpacity: 0.6, weight: 1, customPopupName: 'High Landslide Risk Area' }),
    createGeoJSONLayer('MGB-MED', 'Susceptibility', 'https://raw.githubusercontent.com/Gabzrock/LIGTASAGADEWSV3/refs/heads/main/uRIL_AWS_Moderate_Susceptibility.geojson', { color: 'yellow', fillOpacity: 0.6 }),
    createGeoJSONLayer('MGB-LOW', 'Susceptibility', 'https://raw.githubusercontent.com/Gabzrock/LIGTASAGADEWSV3/refs/heads/main/uRIL_AWS_Low_Susceptibility.geojson', { color: 'green', fillOpacity: 0.6 }),
    createGeoJSONLayer('PH-Boundary', 'Boundary', 'https://raw.githubusercontent.com/faeldon/philippines-json-maps/refs/heads/master/2023/geojson/country/hires/country.0.1.json', { color: 'white', fillOpacity: 0.0, weight: 0.5, interactive: false }, null),
    createGeoJSONLayer('LIGTAS-AGAD sites', 'Boundary', 'https://raw.githubusercontent.com/Gabzrock/LIGTASAGADsites/refs/heads/main/LIGTAS-AGAD_sites2.geojson', { color: 'white', fillOpacity: 0.0, weight: 0.5, pane: 'siteBoundaries', interactive: false })
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

        setTimeout(() => {
            const autoToggleBtn = document.getElementById('toggleMaskBtn');
            if (autoToggleBtn && !autoToggleBtn.classList.contains('btn-active')) {
                autoToggleBtn.click();
            }
        }, 1000); 
    })
    .catch(err => console.error("Error building mask:", err));

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
                style: { 
                    color: '#2c3e50',      
                    weight: 1.5,           
                    opacity: 0.9,          
                    fillColor: '#808080',  
                    fillOpacity: globalLayerOpacity 
                }, 
                onEachFeature: (feature, featureLayer) => { 
                    const featureProps = (feature && feature.properties) ? feature.properties : {};
                    const initialReport = generateCombinedReport(
                        layerDisplayName,
                        featureProps,
                        null,
                        0,
                        true
                    );
                    featureLayer.bindPopup(initialReport, {
                        autoPan: false,
                        maxWidth: 360
                    }); 
                    featureLayer.on('click', (e) => {
                        if (e) {
                            if (e.originalEvent) {
                                e.originalEvent._stopped = true;
                                L.DomEvent.stopPropagation(e.originalEvent);
                            }
                            L.DomEvent.stopPropagation(e);
                        }
                        highlightGeoJSONFeature(e.target);
                        updatePropertiesTable(layerDisplayName, featureProps);
                        const clickLatLng = (e && e.latlng) ? e.latlng : (featureLayer.getBounds ? featureLayer.getBounds().getCenter() : (featureLayer.getLatLng ? featureLayer.getLatLng() : null));
                        if (clickLatLng) {
                            const nearStation = findPriorityStationNearby(clickLatLng, 20);
                            const currentLs = getNearbyLandslideCount(clickLatLng, 5);
                            const freshReport = generateCombinedReport(layerDisplayName, featureProps, nearStation, currentLs, true);
                            featureLayer.setPopupContent(freshReport);
                            featureLayer.openPopup(clickLatLng);
                            focusMapOnPopup(clickLatLng);
                        } else {
                            featureLayer.openPopup();
                        }
                    });
                }
            }).addTo(map);

            const layerItem = { targetAws: targetAwsName, layer: layer, name: layerDisplayName };
            synchronizedLayers.push(layerItem);
            overlays[layerDisplayName] = layer;
            if (layerControl) layerControl.addOverlay(layer, layerDisplayName);

            // Trigger sync immediately if AWS data has already arrived
            if (typeof cachedAWSData !== 'undefined' && cachedAWSData && cachedAWSData.length > 0) {
                syncSingleAwsLayer(layerItem);
            }
        })
        .catch(err => console.error(`Error loading synced layer ${layerDisplayName}:`, err));
}

const awsSyncPromises = [
    initSynchronizedAWSLayer('LANDGRANT', 'https://raw.githubusercontent.com/Gabzrock/LIGTASkanaba/refs/heads/main/LIGTAS_Landgrant%20AWS_RIL_HL.geojson', 'LIGTAS LANDGRANT AWS'),
    initSynchronizedAWSLayer('NAC', 'https://raw.githubusercontent.com/Gabzrock/LIGTASkanaba/refs/heads/main/LIGTAS_NAC%20AWS_RIL_HL.geojson', 'LIGTAS NAC 2026'),
    initSynchronizedAWSLayer('PGPC', 'https://raw.githubusercontent.com/Gabzrock/LIGTASkanaba/refs/heads/main/LIGTAS_PGPC%20AWS_RIL_HL.geojson', 'VOTE PGPC AWS'),
    initSynchronizedAWSLayer('MANKAYAN', 'https://api.maptiler.com/data/019f44a0-c1f3-7d6c-a4cd-bf01ec8769e3/features.json?key=HnKlTumvQGjlZFqKA35V', 'LIGTAS MANKAYAN AWS'),
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
    initSynchronizedAWSLayer('Virac, Catanduanes AWS', 'https://raw.githubusercontent.com/LIGTAS-AGAD/LIGTAS/refs/heads/main/Virac%20Catanduanes%20AWS_RIL_HL.geojson', 'PAGASA-Virac, Catanduanes AWS'),
    initSynchronizedAWSLayer('LIGTAS-AGAD PASIL AWS', 'https://raw.githubusercontent.com/LIGTAS-AGAD/LIGTAS/refs/heads/main/LIGTAS_Pasil%20AWS_RIL_HL.geojson', 'LIGTAS-AGAD PASIL AWS'),
    initSynchronizedAWSLayer('LIGTAS-AGAD Licuan-Baay AWS', 'https://raw.githubusercontent.com/LIGTAS-AGAD/LIGTAS/refs/heads/main/LIGTAS_Licuan%20Baay%20AWS_RIL_HL.geojson', 'LIGTAS-AGAD Licuan-Baay AWS'),
    initSynchronizedAWSLayer('LIGTAS-AGAD Calanasan AWS', 'https://raw.githubusercontent.com/LIGTAS-AGAD/LIGTAS/refs/heads/main/LIGTAS_Calanasan%20AWS_RIL_HL.geojson', 'LIGTAS-AGAD Calanasan AWS'),
    initSynchronizedAWSLayer('LIGTAS-AGAD Barlig AWS', 'https://raw.githubusercontent.com/LIGTAS-AGAD/LIGTAS/refs/heads/main/LIGTAS_Barlig%20AWS_RIL_HL.geojson', 'LIGTAS-AGAD Barlig AWS')
];

Promise.allSettled(awsSyncPromises).then(() => {
    if (typeof cachedAWSData !== 'undefined' && cachedAWSData && cachedAWSData.length > 0) {
        syncAwsLayersWithData();
    }
    if (typeof initSidebarControls === 'function') {
        initSidebarControls();
    }
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

function syncSingleAwsLayer(layerData) {
    if (!cachedAWSData || cachedAWSData.length === 0 || !layerData || !layerData.layer) return;

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

    let targetColor = '#808080';
    if (station) {
        const rawLevel = String(station.RainfallLandslidethresholdwarninglevel).trim().toLowerCase();
        warningLevel = parseInt(rawLevel) || 0; 
        if (warningLevel === 1) targetColor = 'yellow'; 
        else if (warningLevel === 2) targetColor = 'orange'; 
        else if (warningLevel === 3) targetColor = 'red'; 
        else if (warningLevel === 0 || rawLevel === '0') targetColor = 'transparent'; 
    }

    layerData.layer.setStyle({ 
        color: '#2c3e50',                
        fillColor: targetColor,          
        fillOpacity: globalLayerOpacity, 
        weight: 1.5,                     
        opacity: 0.9                     
    });
    layerData.currentLevel = warningLevel;
    
    layerData.layer.eachLayer(featureLayer => {
        let centerLatLng;
        if (featureLayer.getBounds) { centerLatLng = featureLayer.getBounds().getCenter(); } 
        else if (featureLayer.getLatLng) { centerLatLng = featureLayer.getLatLng(); }

        let lsCount = 0;
        let finalStationDisplay = station ? { ...station, distance: "0.00" } : null;

        if (centerLatLng) {
            lsCount = getNearbyLandslideCount(centerLatLng, 5); 
            const priorityNearbyStation = findPriorityStationNearby(centerLatLng, 20);

            if (priorityNearbyStation) {
                finalStationDisplay = priorityNearbyStation;
            } else if (station) {
                const stLat = parseFloat(station.Latitude); const stLng = parseFloat(station.Longitude);
                if (!isNaN(stLat) && !isNaN(stLng)) {
                    const stationLatLng = L.latLng(stLat, stLng);
                    finalStationDisplay.distance = (centerLatLng.distanceTo(stationLatLng) / 1000).toFixed(2);
                }
            }
        }

        const featureProps = (featureLayer.feature && featureLayer.feature.properties) ? featureLayer.feature.properties : {};
        const reportContent = generateCombinedReport(
            layerData.name, 
            featureProps, 
            finalStationDisplay, 
            lsCount,
            true
        );

        featureLayer.bindPopup(reportContent, {
            autoPan: false,
            maxWidth: 360
        }); 
        
        featureLayer.off('click');
        featureLayer.on('click', (e) => {
            if (e) {
                if (e.originalEvent) {
                    e.originalEvent._stopped = true;
                    L.DomEvent.stopPropagation(e.originalEvent);
                }
                L.DomEvent.stopPropagation(e);
            }
            highlightGeoJSONFeature(e.target);
            updatePropertiesTable(layerData.name, featureProps);
            const clickLatLng = (e && e.latlng) ? e.latlng : (featureLayer.getBounds ? featureLayer.getBounds().getCenter() : (featureLayer.getLatLng ? featureLayer.getLatLng() : null));
            if (clickLatLng) {
                const currentNearStation = findPriorityStationNearby(clickLatLng, 20) || finalStationDisplay;
                const currentLsCount = getNearbyLandslideCount(clickLatLng, 5);
                const freshReport = generateCombinedReport(layerData.name, featureProps, currentNearStation, currentLsCount, true);
                featureLayer.setPopupContent(freshReport);
                featureLayer.openPopup(clickLatLng);
                focusMapOnPopup(clickLatLng);
            } else {
                featureLayer.openPopup();
            }
        });
    });
}

function syncAwsLayersWithData() {
    if (!cachedAWSData || cachedAWSData.length === 0) return;
    
    synchronizedLayers.forEach(layerData => {
        syncSingleAwsLayer(layerData);
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

    const phBoundaryLayer = overlays['PH-Boundary: Boundary'];
    if (phBoundaryLayer && !map.hasLayer(phBoundaryLayer)) {
        map.addLayer(phBoundaryLayer);
    }

    try { initSidebarControls(); } catch (e) { console.error("Error setting default layers", e); }
});

const opacitySlider = document.getElementById('opacitySlider');
const opacityValue = document.getElementById('opacityValue');
if (opacitySlider && opacityValue) {
    opacitySlider.oninput = function() {
        globalLayerOpacity = this.value / 100;
        opacityValue.innerHTML = this.value + "%";
        synchronizedLayers.forEach(layerData => {
            if (layerData.layer) { 
                layerData.layer.setStyle({ 
                    fillOpacity: globalLayerOpacity 
                }); 
            }
        });
    };
}

let globalBaseMapOpacity = 0.5; 
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

const phBoundaryColor = document.getElementById('phBoundaryColor');
const phBoundaryOpacitySlider = document.getElementById('phBoundaryOpacitySlider');
const phBoundaryOpacityValue = document.getElementById('phBoundaryOpacityValue');

const ligtasSitesColor = document.getElementById('ligtasSitesColor');
const ligtasSitesOpacitySlider = document.getElementById('ligtasSitesOpacitySlider');
const ligtasSitesOpacityValue = document.getElementById('ligtasSitesOpacityValue');

function updateBoundaryStyle(layerName, colorInput, opacityInput, opacityText) {
    const layer = overlays[layerName];
    if (layer) {
        const newColor = colorInput.value;
        const newOpacity = opacityInput.value / 100;
        if (opacityText) opacityText.innerHTML = opacityInput.value + "%";
        
        layer.setStyle({
            color: newColor,
            fillColor: newColor,
            fillOpacity: newOpacity,
            weight: 0.2
        });
    }
}

if (phBoundaryColor && phBoundaryOpacitySlider) {
    phBoundaryColor.addEventListener('input', () => updateBoundaryStyle('PH-Boundary: Boundary', phBoundaryColor, phBoundaryOpacitySlider, phBoundaryOpacityValue));
    phBoundaryOpacitySlider.addEventListener('input', () => updateBoundaryStyle('PH-Boundary: Boundary', phBoundaryColor, phBoundaryOpacitySlider, phBoundaryOpacityValue));
}

if (ligtasSitesColor && ligtasSitesOpacitySlider) {
    ligtasSitesColor.addEventListener('input', () => updateBoundaryStyle('LIGTAS-AGAD sites: Boundary', ligtasSitesColor, ligtasSitesOpacitySlider, ligtasSitesOpacityValue));
    ligtasSitesOpacitySlider.addEventListener('input', () => updateBoundaryStyle('LIGTAS-AGAD sites: Boundary', ligtasSitesColor, ligtasSitesOpacitySlider, ligtasSitesOpacityValue));
}

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
            
            marker.bindPopup(popupContent, {
                autoPan: true,
                autoPanPaddingTopLeft: [40, 70],
                autoPanPaddingBottomRight: [40, 40],
                maxWidth: 360
            });
            marker.on('click', () => { 
                updatePropertiesTable("AWS Station", station); 
                focusMapOnPopup(marker.getLatLng(), 14);
            });
            warningLayerGroup.addLayer(marker);
        } catch (err) { console.error("Error processing station:", station.StationName, err); }
    });
    
    updateAlertTicker();
}

function fetchAndRefreshData() {
    if (typeof Papa !== 'undefined') {
        Papa.parse(googleSheetCSV, {
            download: true, 
            header: true, 
            skipEmptyLines: true,
            complete: function(results) { processAWSData(results.data); },
            error: function(err) { showError("Data connection lost. Retrying...", 'warning'); }
        });
    } else { 
        showError("Critical library missing: PapaParse.", 'error'); 
    }
}
fetchAndRefreshData(); setInterval(fetchAndRefreshData, 60000);

// ==========================================
// 8. SIDEBAR & FORECAST LOGIC
// ==========================================

const geojsonUrls = [
    'https://raw.githubusercontent.com/LIGTAS-AGAD/upgraded-octo-pancake/refs/heads/main/6hr_Hours_007-012_Bin5_50-100.geojson'
];
const colors = ['yellow', 'orange', 'red', 'yellow', 'orange', 'red', 'yellow', 'orange', 'red', 'yellow', 'orange', 'red', 'yellow', 'orange', 'red', 'yellow', 'orange', 'red', 'yellow', 'orange', 'red', 'yellow', 'orange', 'red', 'yellow', 'orange', 'red', 'yellow'];
const rasterForecastUrls = [
    'https://placehold.co/800x600?text=Rainfall+Raster+Day+1',
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
    };
}

function updateRaster(index) {
    if (!showRaster) { if (currentRasterLayer) { map.removeLayer(currentRasterLayer); currentRasterLayer = null; } return; }
    if (currentRasterLayer) map.removeLayer(currentRasterLayer);
    const imageUrl = rasterForecastUrls[index % rasterForecastUrls.length];
    currentRasterLayer = L.imageOverlay(imageUrl, rasterBounds, { opacity: 0.6, interactive: false, attribution: 'Rainfall Raster Forecast' });
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
                onEachFeature: (feature, featLayer) => {
                    const props = feature.properties || {};
                    const rainVal = props.rainfall_mm || props.Rainfall || props.rain || '10 - 25';
                    const forecastPopup = `
                        <div class="popup-container">
                            <div class="popup-header">🌧️ WRF Rainfall Hazard Layer (Day ${groupIndex + 1})</div>
                            <div class="popup-scroll-container">
                                <div class="popup-section-title">Rainfall Forecast</div>
                                <table class="popup-table">
                                    <tr><th>Model</th><td>PAGASA-WRF Forecast Model</td></tr>
                                    <tr><th>Forecast Day</th><td>Day ${groupIndex + 1}</td></tr>
                                    <tr><th>Estimated Precipitation</th><td><b>${rainVal}</b> mm</td></tr>
                                    <tr><th>Status</th><td>Active Forecast Layer</td></tr>
                                </table>
                            </div>
                            <div class="popup-credits">DOST Project LIGTAS-AGAD RIILEWS</div>
                        </div>
                    `;
                    featLayer.bindPopup(forecastPopup, { autoPan: false, maxWidth: 360 });
                    featLayer.on('click', (e) => { 
                        if (e) {
                            if (e.originalEvent) {
                                e.originalEvent._stopped = true;
                                L.DomEvent.stopPropagation(e.originalEvent);
                            }
                            L.DomEvent.stopPropagation(e);
                        }
                        updatePropertiesTable("PAGASA-WRF (Day " + (groupIndex + 1) + ")", props);
                        const clickPt = (e && e.latlng) ? e.latlng : (featLayer.getBounds ? featLayer.getBounds().getCenter() : null);
                        if (clickPt) {
                            featLayer.openPopup(clickPt);
                            if (typeof focusMapOnPopup === 'function') focusMapOnPopup(clickPt);
                        } else {
                            featLayer.openPopup();
                        }
                    }); 
                }
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

let isGlobalSidebarSyncBound = false;

function initSidebarControls() {
    const container = document.getElementById('layerControls');
    if (!container) return;
    container.innerHTML = ''; 

    function createToggle(id, label, layerObj, onChangeOverride) {
        const div = document.createElement('div'); div.className = 'layer-item';
        const input = document.createElement('input'); input.type = 'checkbox'; input.id = id; input.className = 'layer-toggle-input';
        input.dataset.layerLabel = label;
        
        if (layerObj) { input.checked = map.hasLayer(layerObj); }
        input.onchange = (e) => { 
            if (onChangeOverride) { onChangeOverride(e.target.checked); } 
            else if (layerObj) { 
                if (e.target.checked) {
                    map.addLayer(layerObj);
                    if (label.includes('LIGTAS-LSDB') || label.includes('MGB') || label.includes('Susceptibility')) {
                        setVisualEffects(false, true);
                    }
                } else {
                    map.removeLayer(layerObj);
                }
            }
        };

        const lbl = document.createElement('label'); lbl.htmlFor = id; lbl.innerText = label;
        div.appendChild(input); div.appendChild(lbl); container.appendChild(div);
        return input;
    }

    Object.keys(overlays).forEach((name, idx) => {
        const layer = overlays[name];
        createToggle('toggle_overlay_' + idx, name, layer);
    });

    createToggle('toggle_warning', '20-KM Warning & AWS', warningLayerGroup);

    createToggle('toggle_raster', 'Show Raster Forecast', null, (checked) => {
        showRaster = checked;
        if (checked) updateRaster(currentGroupIndex); 
        else if (currentRasterLayer) map.removeLayer(currentRasterLayer);
    });

    if (!isGlobalSidebarSyncBound && map) {
        isGlobalSidebarSyncBound = true;
        const syncCheckboxes = () => {
            document.querySelectorAll('.layer-toggle-input').forEach(input => {
                const label = input.dataset.layerLabel || (input.nextElementSibling ? input.nextElementSibling.innerText : '');
                if (label === '20-KM Warning & AWS' && typeof warningLayerGroup !== 'undefined') {
                    input.checked = map.hasLayer(warningLayerGroup);
                } else if (label && typeof overlays !== 'undefined' && overlays[label]) {
                    input.checked = map.hasLayer(overlays[label]);
                }
            });
        };
        map.on('layeradd layerremove', syncCheckboxes);
    }
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
        assessUserLocation();
    });
}

const toggleEffectsBtn = document.getElementById('toggleEffectsBtn');
if (toggleEffectsBtn) {
    toggleEffectsBtn.addEventListener('click', () => {
        const isEffectsCurrentlyDisabled = document.body.classList.contains('disable-effects');
        // If currently disabled, clicking it enables visual effects (which auto-disables heavy landslide layers)
        setVisualEffects(isEffectsCurrentlyDisabled, true);
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

// --- RESET MAP VIEW BUTTON ---
const resetMapViewBtn = document.getElementById('resetMapViewBtn');
if (resetMapViewBtn) {
    resetMapViewBtn.addEventListener('click', () => {
        resetMapView();
    });
}

// --- MASK MAP TOGGLE LOGIC ---
let preMaskSusOpacity = 30; 
let preMaskBaseOpacity = 50; 

const toggleMaskBtn = document.getElementById('toggleMaskBtn');
if (toggleMaskBtn) {
    toggleMaskBtn.addEventListener('click', () => {
        const isCurrentlyMasked = toggleMaskBtn.classList.contains('btn-active');
        const susSlider = document.getElementById('opacitySlider');
        const baseSlider = document.getElementById('baseMapOpacitySlider');

        if (!isCurrentlyMasked) {
            toggleMaskBtn.innerText = '👁️ Unmask Map';
            toggleMaskBtn.classList.remove('btn-warning');
            toggleMaskBtn.classList.add('btn-active');
            
            if (invertedMaskLayer) {
                const isDark = document.body.classList.contains('dark-mode');
                invertedMaskLayer.setStyle({ fillColor: isDark ? '#121212' : '#ffffff', fillOpacity: 0.85 });
                map.addLayer(invertedMaskLayer);
            }

            const sitesLayerName = Object.keys(overlays).find(name => name.includes('LIGTAS-AGAD sites'));
            if (sitesLayerName && overlays[sitesLayerName] && !map.hasLayer(overlays[sitesLayerName])) {
                map.addLayer(overlays[sitesLayerName]);
                document.querySelectorAll('.layer-toggle-input').forEach(cb => {
                    if (cb.nextElementSibling && cb.nextElementSibling.innerText.includes('LIGTAS-AGAD sites')) {
                        cb.checked = true;
                    }
                });
            }

            if (susSlider && baseSlider) {
                preMaskSusOpacity = susSlider.value;
                preMaskBaseOpacity = baseSlider.value;
                
                susSlider.value = 100;
                susSlider.oninput();
                
                baseSlider.value = 50;
                baseSlider.oninput();
            }

        } else {
            toggleMaskBtn.innerText = '👁️ Mask Map';
            toggleMaskBtn.classList.add('btn-warning');
            toggleMaskBtn.classList.remove('btn-active');
            
            if (invertedMaskLayer) map.removeLayer(invertedMaskLayer);

            if (susSlider && baseSlider) {
                susSlider.value = preMaskSusOpacity;
                susSlider.oninput();
                
                baseSlider.value = preMaskBaseOpacity;
                baseSlider.oninput();
            }
        }
    });
}

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

function checkAndTriggerMobileNotification(nearestStation) {
    if (!nearestStation || Notification.permission !== "granted") return;

    const level = parseInt(nearestStation.RainfallLandslidethresholdwarninglevel) || 0;
    const stationName = nearestStation.StationName || nearestStation.Station || 'Nearby AWS';

    if (level >= 1 && (lastNotifiedStation !== stationName || lastNotifiedLevel !== level)) {
        lastNotifiedStation = stationName;
        lastNotifiedLevel = level;

        const title = `⚠️ Landslide Warning Level ${level}`;
        const options = {
            body: `Station ${stationName} is currently at Level ${level}. Distance: ${nearestStation.distance || '20'}km. Take appropriate precautions.`,
            icon: layerLogos[0] || '',
            vibrate: [200, 100, 200]
        };

        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
            navigator.serviceWorker.ready.then(registration => {
                registration.showNotification(title, options);
            });
        } else {
            new Notification(title, options);
        }
    }
}

function startAutomatedAlerts() {
    isWatchingAlerts = true;
    if (toggleAutoAlertsBtn) {
        toggleAutoAlertsBtn.innerText = "🔔 Tracking Active";
        toggleAutoAlertsBtn.classList.add("btn-warning");
    }
    showError("Background Location Warning Tracking Enabled.", "warning");
}

function stopAutomatedAlerts() {
    isWatchingAlerts = false;
    lastNotifiedStation = "";
    lastNotifiedLevel = -1;
    if (toggleAutoAlertsBtn) {
        toggleAutoAlertsBtn.innerText = "🔔 Enable Track Alerts";
        toggleAutoAlertsBtn.classList.remove("btn-warning");
    }
}

if (toggleAutoAlertsBtn) {
    toggleAutoAlertsBtn.onclick = function() {
        if (!isWatchingAlerts) {
            if (!("Notification" in window)) {
                showError("Your mobile device or browser does not support native background push alerts.", "warning");
                return;
            }
            if (Notification.permission === "denied") {
                showError("Notification permissions are blocked in browser settings.", "warning");
                return;
            }
            Notification.requestPermission().then(permission => {
                if (permission === "granted") { startAutomatedAlerts(); } 
                else { showError("Notification permission denied.", "warning"); }
            });
        } else {
            stopAutomatedAlerts();
        }
    };
}

// =========================================================
// 15. AUTOMATED ONBOARDING LOCATION PROMPT & PERFORMANCE UI
// =========================================================
const locationPromptModal = document.getElementById('locationPromptModal');
const promptAssessBtn = document.getElementById('promptAssessBtn');
const promptBrowseBtn = document.getElementById('promptBrowseBtn');
const closeLocationPromptBtn = document.getElementById('closeLocationPromptBtn');
const promptLandslideToggle = document.getElementById('promptLandslideToggle');
const promptEffectsToggle = document.getElementById('promptEffectsToggle');
const promptPerfNotice = document.getElementById('promptPerfNotice');

function updatePromptNotice() {
    if (!promptPerfNotice) return;
    const landslideActive = promptLandslideToggle ? promptLandslideToggle.checked : false;
    const effectsActive = promptEffectsToggle ? promptEffectsToggle.checked : false;

    if (landslideActive) {
        promptPerfNotice.innerHTML = '⚡ <strong>Performance Optimized:</strong> Visual effects are automatically disabled when Landslide Data is active to eliminate map lag.';
        promptPerfNotice.style.borderLeftColor = 'var(--primary-color, #008080)';
    } else if (effectsActive) {
        promptPerfNotice.innerHTML = '✨ <strong>Visual Effects Active:</strong> Landslide hazard layers are disabled to ensure smooth 60fps animations.';
        promptPerfNotice.style.borderLeftColor = '#e67e22';
    } else {
        promptPerfNotice.innerHTML = '💡 <strong>Lightweight Mode:</strong> Heavy landslide polygons and animations are disabled for maximum performance.';
        promptPerfNotice.style.borderLeftColor = '#64748b';
    }
}
window.updatePromptNotice = updatePromptNotice;

if (promptLandslideToggle) {
    promptLandslideToggle.addEventListener('change', (e) => {
        if (e.target.checked && promptEffectsToggle) {
            promptEffectsToggle.checked = false;
        }
        updatePromptNotice();
    });
}

if (promptEffectsToggle) {
    promptEffectsToggle.addEventListener('change', (e) => {
        if (e.target.checked && promptLandslideToggle) {
            promptLandslideToggle.checked = false;
        }
        updatePromptNotice();
    });
}

function applyPromptSettings(includeLSDB = false) {
    const enableLandslide = promptLandslideToggle ? promptLandslideToggle.checked : true;
    const enableEffects = promptEffectsToggle ? promptEffectsToggle.checked : false;

    if (enableLandslide) {
        setLandslideData(true, false, includeLSDB);
    } else if (enableEffects) {
        setVisualEffects(true, false);
    } else {
        setLandslideData(false, false, false);
        setVisualEffects(false, false);
    }
}

if (promptAssessBtn) {
    promptAssessBtn.addEventListener('click', () => {
        applyPromptSettings(true);
        dismissLocationPrompt();
        assessUserLocation();
    });
}

if (promptBrowseBtn) {
    promptBrowseBtn.addEventListener('click', () => {
        // Hide the landslide points LSDB by default when user clicks to continue browsing map to reduce map lag
        applyPromptSettings(false);
        hideLandslidePointsLSDB();
        dismissLocationPrompt();
    });
}

if (closeLocationPromptBtn) {
    closeLocationPromptBtn.addEventListener('click', () => {
        applyPromptSettings(false);
        hideLandslidePointsLSDB();
        dismissLocationPrompt();
    });
}

window.addEventListener('click', (e) => {
    if (e.target === locationPromptModal) {
        applyPromptSettings(false);
        hideLandslidePointsLSDB();
        dismissLocationPrompt();
    }
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && locationPromptModal && locationPromptModal.style.display === 'flex') {
        applyPromptSettings(false);
        hideLandslidePointsLSDB();
        dismissLocationPrompt();
    }
});
