import { supabase } from "./supabaseClient.js";

let map;
let boundaryLayer;
let blockLayer;
let currentBounds = null;
let fixedLongitude = null;
let isTallThin = false;

// Detect mobile (touch support + small screen)
const isMobile = 'ontouchstart' in window && window.innerWidth <= 768;

// Helper: fetch varieties for a single block
async function getBlockVarieties(blockID) {
    const { data, error } = await supabase
        .from("block_varieties")
        .select(`
            varietyCount,
            variety:varietyID (
                varietyName
            )
        `)
        .eq("blockID", blockID);
    if (error || !data) return [];
    return data.map(v => ({
        name: v.variety?.varietyName || "Unknown",
        count: v.varietyCount
    }));
}

async function initMap() {
    const mapContainer = document.getElementById("map");
    if (!mapContainer) return;

    // Configure map based on device
    const mapOptions = {
        zoomControl: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
        zoomAnimation: false,
        fadeAnimation: false,
        dragging: isMobile ? true : false,      // enable drag on mobile
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
        // Desktop: wheel listener for vertical panning
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

    // Remove old event listeners
    map.off("drag", enforceVerticalPan);
    map.off("dragend", enforceVerticalPan);
    map.off("drag", enforceHorizontalLock);
    map.off("dragend", enforceHorizontalLock);

    // Fetch boundary coordinates
    const { data: coords, error } = await supabase
        .from("location_coordinates")
        .select("latitude, longitude, vertexOrder")
        .eq("locationID", locationID)
        .order("vertexOrder");

    if (error || !coords || coords.length < 3) {
        console.error("Invalid boundary", error);
        return;
    }

    // Fetch location's custom zoom_extra
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

    // Adaptive behaviour
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

    // Set view and apply locks based on device and orchard shape
    if (useHorizontalLock) {
        fixedLongitude = center.lng;
        map.setView(center, newZoom, { animate: false });
        // On mobile, we restrict drag to vertical; on desktop, we use horizontal lock via setView reset
        if (isMobile) {
            // For mobile: allow dragging but enforce vertical-only and prevent horizontal change
            map.on("drag", enforceVerticalPan);
            map.on("dragend", enforceVerticalPan);
        } else {
            map.on("drag", enforceHorizontalLock);
            map.on("dragend", enforceHorizontalLock);
        }
    } else {
        fixedLongitude = null;
        map.setView(center, newZoom, { animate: false });
        // For wide orchards on mobile, allow free drag (but still within maxBounds)
        if (isMobile) {
            // No additional constraint needed, just allow any direction within bounds
        }
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

    await loadBlocks(locationID);
}

// For desktop: keep horizontal lock (reset longitude on drag)
function enforceHorizontalLock() {
    if (!map || fixedLongitude === null) return;
    const center = map.getCenter();
    if (Math.abs(center.lng - fixedLongitude) > 0.000001) {
        map.setView([center.lat, fixedLongitude], map.getZoom(), { animate: false });
    }
}

// For mobile: restrict dragging to vertical only (preserve longitude)
let lastLat = null;
function enforceVerticalPan(e) {
    if (!map || fixedLongitude === null) return;
    const center = map.getCenter();
    // When dragging ends, we snap back to the fixed longitude and keep the new latitude
    if (e.type === 'dragend') {
        map.setView([center.lat, fixedLongitude], map.getZoom(), { animate: false });
    } else {
        // During drag, we continuously enforce the longitude to prevent sideways movement
        if (Math.abs(center.lng - fixedLongitude) > 0.000001) {
            map.setView([center.lat, fixedLongitude], map.getZoom(), { animate: false });
        }
    }
}

async function loadBlocks(locationID) {
    const { data: blocks, error: blocksError } = await supabase
        .from("block")
        .select("blockID, identifier")
        .eq("locationID", locationID);

    if (blocksError || !blocks?.length) {
        console.log("No blocks found");
        return;
    }

    const blockIds = blocks.map(b => b.blockID);
    const { data: coordData, error: coordError } = await supabase
        .from("block_coordinates")
        .select("blockID, latitude, longitude, vertexOrder")
        .in("blockID", blockIds)
        .order("vertexOrder");

    if (coordError || !coordData) return;

    const pointsByBlock = new Map();
    for (const p of coordData) {
        if (!pointsByBlock.has(p.blockID)) pointsByBlock.set(p.blockID, []);
        pointsByBlock.get(p.blockID).push([p.latitude, p.longitude]);
    }

    for (const block of blocks) {
        const points = pointsByBlock.get(block.blockID);
        if (!points || points.length < 3) continue;

        const polygon = L.polygon(points, {
            color: "#52796f",
            fillColor: "#84a98c",
            fillOpacity: 0.5,
            weight: 1.5
        }).addTo(blockLayer);

        // Calculate centroid
        let sumLat = 0, sumLng = 0;
        for (const p of points) {
            sumLat += p[0];
            sumLng += p[1];
        }
        const center = [sumLat / points.length, sumLng / points.length];

        // Circular yellow label
        L.marker(center, {
            icon: L.divIcon({
                className: "block-label",
                html: `<div class="block-label-text">${block.identifier}</div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            }),
            interactive: false
        }).addTo(blockLayer);

        // Fetch varieties
        const varieties = await getBlockVarieties(block.blockID);
        let varietyHtml = "";
        if (varieties.length === 0) {
            varietyHtml = "<p>No varieties assigned</p>";
        } else {
            varietyHtml = "<ul style='margin:0; padding-left:20px;'>";
            varieties.forEach(v => {
                varietyHtml += `<li><strong>${v.name}</strong>: ${v.count} trees</li>`;
            });
            varietyHtml += "</ul>";
        }

        polygon.bindPopup(varietyHtml);
    }
}

document.addEventListener("DOMContentLoaded", initMap);