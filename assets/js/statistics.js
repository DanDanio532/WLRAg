import { supabase } from "./supabaseClient.js";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const CONTAINER = ".statistics";

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
   TRANSFORM DATA
---------------------------- */
function summarizeStackedData(blocks) {

  const locationMap = {};

  (blocks || []).forEach(block => {

    const location =
      block.location?.locationName || "Unknown";

    if (!locationMap[location]) {
      locationMap[location] = {};
    }

    let assignedTotal = 0;

    // FIX #1: safe fallback for missing relationships
    (block.block_varieties || []).forEach(v => {

      const variety =
        v.variety?.varietyName || "Unknown";

      const count =
        Number(v.varietyCount) || 0;

      assignedTotal += count;

      locationMap[location][variety] =
        (locationMap[location][variety] || 0) + count;
    });

    const totalTrees = Number(block.treeCount) || 0;

    const unassigned = totalTrees - assignedTotal;

    if (unassigned > 0) {
      locationMap[location]["Unassigned"] =
        (locationMap[location]["Unassigned"] || 0) + unassigned;
    }
  });

  return Object.entries(locationMap).map(
    ([location, varieties]) => ({
      location,
      ...varieties
    })
  );
}

/* ---------------------------
   RENDER CHART
---------------------------- */
function renderChart(data) {

  const container = d3.select(CONTAINER);

  if (container.empty() || !container.node()) return;

  container.html("");

  if (!data.length) {
    container.append("p").text("No statistics available.");
    return;
  }

  container.append("h3").text("Tree Varieties Per Location");

  const keys = Object.keys(data[0]).filter(k => k !== "location");

  const margin = {
    top: 20,
    right: 220,
    bottom: 80,
    left: 70
  };

  const width =
    Math.max(500, container.node().clientWidth || 900)
    - margin.left - margin.right;

  const height =
    450 - margin.top - margin.bottom;

  const svg = container
    .append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand()
    .domain(data.map(d => d.location))
    .range([0, width])
    .padding(0.2);

  const stackedData = d3.stack().keys(keys)(data);

  // FIX #3: safe max calculation
  const maxTotal = d3.max(data, d => {
    let total = 0;
    keys.forEach(k => total += Number(d[k]) || 0);
    return total;
  }) || 1;

  const y = d3.scaleLinear()
    .domain([0, maxTotal])
    .nice()
    .range([height, 0]);

  const color = d3.scaleOrdinal()
    .domain(keys)
    .range(d3.schemeTableau10);

  const tooltip = container
    .append("div")
    .style("position", "absolute")
    .style("background", "#fff")
    .style("padding", "8px")
    .style("border", "1px solid #ccc")
    .style("border-radius", "5px")
    .style("opacity", 0);

  svg.selectAll("g.layer")
    .data(stackedData)
    .join("g")
    .attr("fill", d => color(d.key))
    .selectAll("rect")
    .data(d => d.map(v => ({ ...v, key: d.key })))
    .join("rect")
    .attr("x", d => x(d.data.location))
    .attr("y", d => y(d[1]))

    // FIX #4: prevent NaN height crash
    .attr("height", d => {
      const h = y(d[0]) - y(d[1]);
      return isNaN(h) ? 0 : h;
    })

    .attr("width", x.bandwidth())

    .on("mouseover", (event, d) => {
      const value = d[1] - d[0];

      tooltip
        .style("opacity", 1)
        .html(`<strong>${d.key}</strong><br>${value} trees`);
    })

    .on("mousemove", event => {
      tooltip
        .style("left", (event.pageX + 10) + "px")
        .style("top", (event.pageY - 20) + "px");
    })

    .on("mouseout", () => {
      tooltip.style("opacity", 0);
    });

  svg.append("g")
    .call(d3.axisLeft(y));

  svg.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x))
    .selectAll("text")
    .attr("transform", "rotate(-35)")
    .style("text-anchor", "end");

  // legend
  const legend = svg.append("g")
    .attr("transform", `translate(${width + 20}, 20)`);

  keys.forEach((key, i) => {
    const row = legend.append("g")
      .attr("transform", `translate(0, ${i * 25})`);

    row.append("rect")
      .attr("width", 15)
      .attr("height", 15)
      .attr("fill", color(key));

    row.append("text")
      .attr("x", 25)
      .attr("y", 12)
      .style("font-size", "12px")
      .text(key);
  });
}

/* ---------------------------
   INIT (SAFE)
---------------------------- */
async function draw() {
  const blocks = await fetchBlocks();
  const summary = summarizeStackedData(blocks);
  renderChart(summary);
}

document.addEventListener("DOMContentLoaded", () => {
  if (!document.querySelector(CONTAINER)) return;

  draw();

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(draw, 150);
  });
});