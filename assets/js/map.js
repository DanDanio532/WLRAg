import { supabase } from "./supabaseClient.js";

let map;
let boundaryLayer;
let blockLayer;
let currentBounds = null;
let fixedLongitude = null;
let isTallThin = false;   // flag for tall & thin orchards

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
        dragging: true,
        inertia: true,
        zoomAnimation: false,
        fadeAnimation: false
    });

    L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Tiles © Esri", maxZoom: 20 }
    ).addTo(map);

    boundaryLayer = L.layerGroup().addTo(map);
    blockLayer = L.layerGroup().addTo(map);

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

    // Remove previous horizontal lock listener if any
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

    // ---- ADAPTIVE BEHAVIOR BASED ON ORCHARD SHAPE ----
    const north = bounds.getNorth();
    const south = bounds.getSouth();
    const east = bounds.getEast();
    const west = bounds.getWest();
    const height = north - south;      // degrees latitude
    const width = east - west;         // degrees longitude
    const aspectRatio = height / width; // >1 means taller than wide

    // Threshold: if orchard is more than 1.5x taller than wide, treat as "tall & thin"
    const TALL_THIN_THRESHOLD = 1.5;
    isTallThin = aspectRatio > TALL_THIN_THRESHOLD;

    let extraZoom;
    let useHorizontalLock = false;

    if (isTallThin) {
        // Tall & thin: zoom in heavily, lock horizontal pan
        extraZoom = 3.0;          // adjust as needed
        useHorizontalLock = true;
    } else {
        // Wider or square: standard fit, no horizontal lock, moderate zoom
        extraZoom = 0.0;          // no extra zoom beyond fit
        useHorizontalLock = false;
    }

    // Fit bounds with zero padding
    map.fitBounds(bounds, { padding: [0, 0] });
    
    const currentZoom = map.getZoom();
    const newZoom = Math.min(currentZoom + extraZoom, map.getMaxZoom());
    const center = bounds.getCenter();

    if (useHorizontalLock) {
        fixedLongitude = center.lng;
        map.setView(center, newZoom, { animate: false });
        // Enforce horizontal lock on drag
        map.on("drag", enforceHorizontalLock);
        map.on("dragend", enforceHorizontalLock);
    } else {
        // For wider orchards: just set view and allow free panning (bounded)
        fixedLongitude = null;
        map.setView(center, newZoom, { animate: false });
    }

    // Lock the zoom level to prevent accidental changes
    map.setMinZoom(newZoom);
    map.setMaxZoom(newZoom);
    
    // Set bounds for panning (prevents leaving the orchard)
    map.setMaxBounds(bounds);
    
    // Set map container height (tall for all cases)
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
        polygon.bindPopup(`<strong>${block.identifier}</strong>`);
    }
}

document.addEventListener("DOMContentLoaded", initMap);