import { supabase } from "./supabaseClient.js";

let map;
let boundaryLayer;
let blockLayer;
let currentBounds = null;
let fixedLongitude = null;
let isTallThin = false;

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

    map = L.map("map", {
        zoomControl: false,
        scrollWheelZoom: false,   // disable Leaflet's wheel zoom
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
        dragging: false,          // disable dragging
        inertia: false,
        zoomAnimation: false,
        fadeAnimation: false
    });

    L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Tiles © Esri", maxZoom: 20 }
    ).addTo(map);

    boundaryLayer = L.layerGroup().addTo(map);
    blockLayer = L.layerGroup().addTo(map);

    // Direct wheel listener for vertical pan (works on Mac trackpad)
    const mapElement = map.getContainer();
    mapElement.addEventListener('wheel', function(e) {
        // Prevent page scrolling
        e.preventDefault();
        // Get vertical scroll amount (negative = scroll up, positive = scroll down)
        const delta = e.deltaY;
        // Pan vertically: invert direction so that scrolling down pans down
        // Adjust multiplier for trackpad sensitivity (try 0.5 to 1.0)
        const panAmount = delta * 0.8;
        map.panBy([0, panAmount], { animate: false });
    }, { passive: false });

    await loadLocations();
}

async function loadLocations() {
    const select = document.getElementById("locationSelect");
    if (!select) return;

    const { data, error } = await supabase
        .from("location")
        .select("locationID, locationName")
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

    const boundaryPoints = coords.map(p => [p.latitude, p.longitude]);
    const boundary = L.polygon(boundaryPoints, {
        color: "#2f3e46",
        weight: 1,
        fillOpacity: 0.05
    }).addTo(boundaryLayer);

    const bounds = boundary.getBounds();
    currentBounds = bounds;

    // Adaptive behaviour based on orchard shape
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
        extraZoom = 3.0;          // adjust as needed
        useHorizontalLock = true;
    } else {
        extraZoom = 0.0;
        useHorizontalLock = false;
    }

    map.fitBounds(bounds, { padding: [0, 0] });
    const currentZoom = map.getZoom();
    const newZoom = Math.min(currentZoom + extraZoom, map.getMaxZoom());
    const center = bounds.getCenter();

    if (useHorizontalLock) {
        fixedLongitude = center.lng;
        map.setView(center, newZoom, { animate: false });
        map.on("drag", enforceHorizontalLock);
        map.on("dragend", enforceHorizontalLock);
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

    await loadBlocks(locationID);
}

function enforceHorizontalLock() {
    if (!map || fixedLongitude === null) return;
    const center = map.getCenter();
    if (Math.abs(center.lng - fixedLongitude) > 0.000001) {
        map.setView([center.lat, fixedLongitude], map.getZoom(), { animate: false });
    }
}

// Enhanced loadBlocks with circular labels and variety-only popups
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

        // Draw polygon
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

        // Fetch varieties for popup (only varieties, no block name)
        const varieties = await getBlockVarieties(block.blockID);
        let varietyHtml = "";
        if (varieties.length === 0) {
            varietyHtml = "<p>No varieties assigned</p>";
        } else {
            varietyHtml = "<ul>";
            varieties.forEach(v => {
                varietyHtml += `<li><strong>${v.name}</strong>: ${v.count} trees</li>`;
            });
            varietyHtml += "</ul>";
        }

        const popupContent = `<div style="min-width: 120px;">${varietyHtml}</div>`;
        polygon.bindPopup(popupContent);
    }
}

document.addEventListener("DOMContentLoaded", initMap);