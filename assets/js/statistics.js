import { supabase } from "./supabaseClient.js";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const CONTAINER = ".statistics";

/* ---------------------------
   OPTIONAL: CHECK AUTH
---------------------------- */
async function isLoggedIn() {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
}

/* ---------------------------
   FETCH DATA
---------------------------- */
async function fetchBlocks() {
  const { data, error } = await supabase
    .from("block")
    .select(`
      identifier,
      treeCount,

      location:locationID (
        locationName
      ),

      block_varieties (
        varietyCount,
        variety:varietyID (
          varietyName
        )
      )
    `);

  if (error) {
    console.error("Supabase error:", error);
    return [];
  }

  return data || [];
}

/* ---------------------------
   SAFE NUMBER HELPER
---------------------------- */
function safeNum(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

/* ---------------------------
   TRANSFORM DATA (SAFE)
---------------------------- */
function summarizeStackedData(blocks) {

  const locationMap = {};

  blocks.forEach(block => {

    const location =
      block.location?.locationName || "Unassigned";

    if (!locationMap[location]) {
      locationMap[location] = {};
    }

    const varieties = block.block_varieties || [];

    let assignedTotal = 0;

    varieties.forEach(v => {

      const variety =
        v.variety?.varietyName || "Unknown";

      const count = safeNum(v.varietyCount);

      assignedTotal += count;

      locationMap[location][variety] =
        safeNum(locationMap[location][variety]) + count;
    });

    const totalTrees = safeNum(block.treeCount);

    const unassigned = Math.max(totalTrees - assignedTotal, 0);

    locationMap[location]["Unassigned"] =
      safeNum(locationMap[location]["Unassigned"]) + unassigned;
  });

  return Object.entries(locationMap).map(
    ([location, varieties]) => ({
      location,
      ...varieties
    })
  );
}

/* ---------------------------
   RENDER
---------------------------- */
async function renderChart(data) {

  const container = d3.select(CONTAINER);

  if (container.empty()) return;

  container.html("");

  // AUTH / EMPTY STATE
  const loggedIn = await isLoggedIn();

  if (!loggedIn || !data.length) {
    container.append("div")
      .style("padding", "20px")
      .style("text-align", "center")
      .text("Sign in to view statistics.");
    return;
  }

  container.append("h3")
    .text("Tree Varieties Per Location");

  const keys = Object.keys(data[0])
    .filter(k => k !== "location");

  const margin = { top: 20, right: 220, bottom: 80, left: 70 };

  const width =
    Math.max(500, container.node().clientWidth || 800)
    - margin.left - margin.right;

  const height = 450 - margin.top - margin.bottom;

  const svg = container.append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand()
    .domain(data.map(d => d.location))
    .range([0, width])
    .padding(0.2);

  const stacked = d3.stack().keys(keys)(data);

  const maxTotal = d3.max(data, d =>
    keys.reduce((sum, k) => sum + safeNum(d[k]), 0)
  ) || 1;

  const y = d3.scaleLinear()
    .domain([0, maxTotal])
    .nice()
    .range([height, 0]);

  const color = d3.scaleOrdinal()
    .domain(keys)
    .range(d3.schemeTableau10);

  /* ---------------------------
     TOOLTIP
  ---------------------------- */
  const tooltip = container.append("div")
    .style("position", "absolute")
    .style("background", "#fff")
    .style("padding", "6px")
    .style("border", "1px solid #ccc")
    .style("border-radius", "5px")
    .style("opacity", 0);

  /* ---------------------------
     BARS
  ---------------------------- */
  svg.selectAll("g")
    .data(stacked)
    .join("g")
    .attr("fill", d => color(d.key))
    .selectAll("rect")
    .data(d => d.map(v => ({ ...v, key: d.key })))
    .join("rect")
    .attr("x", d => x(d.data.location))
    .attr("y", d => {
      const top = y(d[1]);
      return Number.isFinite(top) ? top : 0;
    })
    .attr("height", d => {
      const h = y(d[0]) - y(d[1]);
      return Number.isFinite(h) ? h : 0;
    })
    .attr("width", x.bandwidth())

    .on("mouseover", (event, d) => {
      tooltip
        .style("opacity", 1)
        .html(`<b>${d.key}</b><br>${d[1] - d[0]} trees`);
    })
    .on("mousemove", event => {
      tooltip
        .style("left", (event.pageX + 10) + "px")
        .style("top", (event.pageY - 20) + "px");
    })
    .on("mouseout", () => tooltip.style("opacity", 0));

  /* ---------------------------
     AXES
  ---------------------------- */
  svg.append("g").call(d3.axisLeft(y));

  svg.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x))
    .selectAll("text")
    .attr("transform", "rotate(-35)")
    .style("text-anchor", "end");
}

/* ---------------------------
   MAIN
---------------------------- */
async function draw() {
  const blocks = await fetchBlocks();
  const data = summarizeStackedData(blocks);
  renderChart(data);
}

document.addEventListener("DOMContentLoaded", draw);