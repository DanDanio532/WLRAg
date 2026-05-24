import { supabase } from "./supabaseClient.js";

let map;
let boundaryLayer;
let blockLayer;
let currentBounds = null;
let fixedLongitude = null;
let isTallThin = false;
let loadingDiv = null;

// Detect mobile
const isMobile = 'ontouchstart' in window && window.innerWidth <= 768;

// Calculate area (hectares & acres)
function calculateArea(points) {
    if (!points || points.length < 3) return { hectares: 0, acres: 0 };
    const coords = points.map(p => [p[1], p[0]]);
    if (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1]) {
        coords.push(coords[0]);
    }
    const polygon = turf.polygon([coords]);
    const areaSqM = turf.area(polygon);
    const hectares = areaSqM / 10000;
    const acres = hectares * 2.47105;
    return { hectares, acres };
}

// Get label position: polylabel (guaranteed inside) with fallback
function getPolygonCentroid(points) {
    if (!points || points.length < 3) return null;
    let coords = points.map(p => [p[1], p[0]]);
    // Close ring
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
        coords.push([first[0], first[1]]);
    }
    // Remove duplicate consecutive points
    const cleaned = [];
    for (let i = 0; i < coords.length; i++) {
        const curr = coords[i];
        const prev = cleaned[cleaned.length - 1];
        if (!prev || prev[0] !== curr[0] || prev[1] !== curr[1]) {
            cleaned.push(curr);
        }
    }
    if (cleaned.length < 4) return null;
    try {
        const polygon = turf.polygon([cleaned]);
        const pt = turf.pointOnFeature(polygon);
        const [lng, lat] = pt.geometry.coordinates;
        return [lat, lng];
    } catch (e) {
        // Fallback: vertex average
        let sumLat = 0, sumLng = 0;
        for (const p of points) {
            sumLat += p[0];
            sumLng += p[1];
        }
        return [sumLat / points.length, sumLng / points.length];
    }
}

// Show/hide loading spinner
function setLoading(visible) {
    if (!loadingDiv) {
        loadingDiv = document.createElement('div');
        loadingDiv.id = 'map-loading';
        loadingDiv.textContent = 'Loading blocks...';
        loadingDiv.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 5px 10px;
            border-radius: 4px;
            z-index: 1000;
            font-size: 12px;
            pointer-events: none;
        `;
        document.getElementById('map').parentElement.style.position = 'relative';
        document.getElementById('map').parentElement.appendChild(loadingDiv);
    }
    loadingDiv.style.display = visible ? 'block' : 'none';
}

async function initMap() {
    const mapContainer = document.getElementById("map");
    if (!mapContainer) return;

    const mapOptions = {
        zoomControl: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
        zoomAnimation: false,
        fadeAnimation: false,
        dragging: isMobile ? true : false,
        inertia: isMobile ? true : false
    };

    map = L.map("map", mapOptions);

    L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Tiles © Esri", maxZoom: 20 }
    ).addTo(map);

    boundaryLayer = L.layerGroup().addTo(map);
    blockLayer = L.layerGroup().addTo(map);

    if (!isMobile) {
        const mapElement = map.getContainer();
        mapElement.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY;
            const panAmount = delta * 0.8;
            map.panBy([0, panAmount], { animate: false });
        }, { passive: false });
    }

    await loadLocations();
}

async function loadLocations() {
    const select = document.getElementById("locationSelect");
    if (!select) return;

    const { data, error } = await supabase
        .from("location")
        .select("locationID, locationName, zoom_extra")
        .order("locationID");

    if (error || !data?.length) {
        console.error(error);
        select.innerHTML = "<option>Error loading orchards</option>";
        return;
    }

    select.innerHTML = "";
    data.forEach((loc, i) => {
        const option = document.createElement("option");
        option.value = loc.locationID;
        option.textContent = `${i+1}. ${loc.locationName || "Unnamed"}`;
        select.appendChild(option);
    });

    await loadLocation(data[0].locationID);
    select.addEventListener("change", () => loadLocation(select.value));
}

async function loadLocation(locationID) {
    boundaryLayer.clearLayers();
    blockLayer.clearLayers();

    map.off("drag", enforceVerticalPan);
    map.off("dragend", enforceVerticalPan);
    map.off("drag", enforceHorizontalLock);
    map.off("dragend", enforceHorizontalLock);

    const { data: coords, error } = await supabase
        .from("location_coordinates")
        .select("latitude, longitude, vertexOrder")
        .eq("locationID", locationID)
        .order("vertexOrder");

    if (error || !coords || coords.length < 3) {
        console.error("Invalid boundary", error);
        return;
    }

    const { data: locData } = await supabase
        .from("location")
        .select("zoom_extra")
        .eq("locationID", locationID)
        .single();
    const customZoom = locData?.zoom_extra ?? null;

    const boundaryPoints = coords.map(p => [p.latitude, p.longitude]);
    const boundary = L.polygon(boundaryPoints, {
        color: "#2f3e46",
        weight: 1,
        fillOpacity: 0.05
    }).addTo(boundaryLayer);

    const bounds = boundary.getBounds();
    currentBounds = bounds;

    const north = bounds.getNorth();
    const south = bounds.getSouth();
    const east = bounds.getEast();
    const west = bounds.getWest();
    const height = north - south;
    const width = east - west;
    const aspectRatio = height / width;

    const TALL_THIN_THRESHOLD = 1.5;
    isTallThin = aspectRatio > TALL_THIN_THRESHOLD;

    let extraZoom;
    let useHorizontalLock = false;
    if (isTallThin) {
        extraZoom = (customZoom !== null && !isNaN(customZoom)) ? customZoom : 3.0;
        useHorizontalLock = true;
    } else {
        extraZoom = (customZoom !== null && !isNaN(customZoom)) ? customZoom : 0.0;
        useHorizontalLock = false;
    }

    map.fitBounds(bounds, { padding: [0, 0] });
    const currentZoom = map.getZoom();
    const newZoom = Math.min(currentZoom + extraZoom, map.getMaxZoom());
    const center = bounds.getCenter();

    if (useHorizontalLock) {
        fixedLongitude = center.lng;
        map.setView(center, newZoom, { animate: false });
        if (isMobile) {
            map.on("drag", enforceVerticalPan);
            map.on("dragend", enforceVerticalPan);
        } else {
            map.on("drag", enforceHorizontalLock);
            map.on("dragend", enforceHorizontalLock);
        }
    } else {
        fixedLongitude = null;
        map.setView(center, newZoom, { animate: false });
    }

    map.setMinZoom(newZoom);
    map.setMaxZoom(newZoom);
    map.setMaxBounds(bounds);

    const mapEl = document.getElementById("map");
    if (mapEl) {
        let height = window.innerHeight * 0.8;
        height = Math.min(1000, Math.max(500, height));
        mapEl.style.height = `${height}px`;
        setTimeout(() => map.invalidateSize(), 50);
    }

    await loadBlocksOptimized(locationID);
}

function enforceHorizontalLock() {
    if (!map || fixedLongitude === null) return;
    const center = map.getCenter();
    if (Math.abs(center.lng - fixedLongitude) > 0.000001) {
        map.setView([center.lat, fixedLongitude], map.getZoom(), { animate: false });
    }
}

function enforceVerticalPan(e) {
    if (!map || fixedLongitude === null) return;
    const center = map.getCenter();
    if (e.type === 'dragend') {
        map.setView([center.lat, fixedLongitude], map.getZoom(), { animate: false });
    } else {
        if (Math.abs(center.lng - fixedLongitude) > 0.000001) {
            map.setView([center.lat, fixedLongitude], map.getZoom(), { animate: false });
        }
    }
}

// Optimised block loading with incremental rendering + manual label override
async function loadBlocksOptimized(locationID) {
    setLoading(true);

    // 1. Get blocks (including manual label columns if they exist)
    const { data: blocks, error: blocksError } = await supabase
        .from("block")
        .select("blockID, identifier, label_lat, label_long")
        .eq("locationID", locationID);
    if (blocksError || !blocks?.length) {
        setLoading(false);
        return;
    }

    const blockIds = blocks.map(b => b.blockID);

    // 2. Fetch coordinates
    const { data: coordData, error: coordError } = await supabase
        .from("block_coordinates")
        .select("blockID, latitude, longitude, vertexOrder")
        .in("blockID", blockIds)
        .order("vertexOrder");
    if (coordError || !coordData) {
        setLoading(false);
        return;
    }

    // 3. Fetch all varieties
    const { data: allVarieties, error: varietiesError } = await supabase
        .from("block_varieties")
        .select(`
            blockID,
            varietyCount,
            variety:varietyID ( varietyName )
        `)
        .in("blockID", blockIds);
    const varietiesByBlock = new Map();
    if (!varietiesError && allVarieties) {
        for (const v of allVarieties) {
            if (!varietiesByBlock.has(v.blockID)) varietiesByBlock.set(v.blockID, []);
            varietiesByBlock.get(v.blockID).push({
                name: v.variety?.varietyName || "Unknown",
                count: v.varietyCount
            });
        }
    }

    // 4. Group points
    const pointsByBlock = new Map();
    for (const p of coordData) {
        if (!pointsByBlock.has(p.blockID)) pointsByBlock.set(p.blockID, []);
        pointsByBlock.get(p.blockID).push([p.latitude, p.longitude]);
    }

    // 5. Incrementally render
    let index = 0;
    function renderNextBlock() {
        if (index >= blocks.length) {
            setLoading(false);
            return;
        }
        const block = blocks[index];
        const points = pointsByBlock.get(block.blockID);
        if (points && points.length >= 3) {
            // Draw polygon
            const polygon = L.polygon(points, {
                color: "#52796f",
                fillColor: "#84a98c",
                fillOpacity: 0.5,
                weight: 1.5
            }).addTo(blockLayer);

            // Label position: use manual if provided, else auto centroid
            let center = null;
            if (block.label_lat && block.label_long) {
                center = [block.label_lat, block.label_long];
            } else {
                center = getPolygonCentroid(points);
            }
            if (center) {
                L.marker(center, {
                    icon: L.divIcon({
                        className: "block-label",
                        html: `<div class="block-label-text">${block.identifier}</div>`,
                        iconSize: [30, 30],
                        iconAnchor: [15, 15]
                    }),
                    interactive: false
                }).addTo(blockLayer);
            }

            // Area
            const { hectares, acres } = calculateArea(points);
            const areaText = `<p><strong>Area:</strong> ${hectares.toFixed(2)} ha / ${acres.toFixed(2)} acres</p>`;

            // Varieties: if count == 0, show only name (no number)
            const varieties = varietiesByBlock.get(block.blockID) || [];
            let varietyHtml = "";
            if (varieties.length === 0) {
                varietyHtml = "<p>No varieties assigned</p>";
            } else {
                varietyHtml = "<ul style='margin:0; padding-left:20px;'>";
                varieties.forEach(v => {
                    if (v.count === 0) {
                        varietyHtml += `<li><strong>${v.name}</strong></li>`;
                    } else {
                        varietyHtml += `<li><strong>${v.name}</strong>: ${v.count} trees</li>`;
                    }
                });
                varietyHtml += "</ul>";
            }

            const popupContent = `<div style="min-width: 150px;">${areaText}${varietyHtml}</div>`;
            polygon.bindPopup(popupContent, {
                autoPan: true,
                autoPanPadding: [20, 20],
                offset: [0, -10],
                closeButton: true,
                closeOnClick: true
            });
        }
        index++;
        setTimeout(renderNextBlock, 5);
    }

    renderNextBlock();
}

document.addEventListener("DOMContentLoaded", initMap);