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
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
        dragging: false,
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

    // Direct wheel listener for vertical pan (works on Mac trackpad & mobile)
    const mapElement = map.getContainer();
    mapElement.addEventListener('wheel', function(e) {
        e.preventDefault();
        const delta = e.deltaY;
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
        // Store zoom_extra as a data attribute for later use (optional)
        option.dataset.zoomExtra = loc.zoom_extra ?? 0;
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

    // Fetch the location's zoom_extra value
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
        // Use custom zoom if set, otherwise default 3.0
        extraZoom = (customZoom !== null && !isNaN(customZoom)) ? customZoom : 3.0;
        useHorizontalLock = true;
    } else {
        // For wide orchards, optionally use custom zoom (but default 0)
        extraZoom = (customZoom !== null && !isNaN(customZoom)) ? customZoom : 0.0;
        useHorizontalLock = false;
    }

    map.fitBounds(bounds, { padding: [0, 0] });
    const currentZoom = map.getZoom();
    const newZoom = Math.min(currentZoom + extraZoom, map.getMaxZoom());

    console.log("fitBounds zoom:", currentZoom);
    console.log("extraZoom:", extraZoom);
    console.log("newZoom:", newZoom);
    console.log("zoom_extra from DB:", customZoom);
    
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

        // Popup shows ONLY varieties (no block name)
        polygon.bindPopup(varietyHtml);
    }
}

document.addEventListener("DOMContentLoaded", initMap);