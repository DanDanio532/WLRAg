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

    console.error(
      "Supabase error:",
      error
    );

    return [];
  }

  return data || [];
}

/* ---------------------------
   TRANSFORM DATA FOR STACKED CHART
---------------------------- */
function summarizeStackedData(blocks) {

  const locationMap = {};

  blocks.forEach(block => {

    const location =
      block.location?.locationName || "Unknown";

    if (!locationMap[location]) {
      locationMap[location] = {};
    }

    let assignedTotal = 0;

    // ASSIGNED VARIETIES
    block.block_varieties.forEach(v => {

      const variety =
        v.variety?.varietyName || "Unknown";

      const count =
        Number(v.varietyCount) || 0;

      assignedTotal += count;

      locationMap[location][variety] =
        (locationMap[location][variety] || 0)
        + count;
    });

    // UNASSIGNED TREES
    const totalTrees =
      Number(block.treeCount) || 0;

    const unassigned =
      totalTrees - assignedTotal;

    if (unassigned > 0) {

      locationMap[location]["Unassigned"] =
        (locationMap[location]["Unassigned"] || 0)
        + unassigned;
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
   RENDER STACKED BAR CHART
---------------------------- */
function renderChart(data) {

  const container = d3.select(CONTAINER);

  if (container.empty()) {

    console.error(
      `Container '${CONTAINER}' not found`
    );

    return;
  }

  // CLEAR PREVIOUS CHART
  container.html("");

  if (!data.length) {

    container
      .append("p")
      .text("No statistics available.");

    return;
  }

  container
    .append("h3")
    .text("Tree Varieties Per Location");

  /* ---------------------------
     GET VARIETY KEYS
  ---------------------------- */
  const keys = Object.keys(data[0])
    .filter(key => key !== "location");

  /* ---------------------------
     DIMENSIONS
  ---------------------------- */
  const margin = {
    top: 20,
    right: 220,
    bottom: 80,
    left: 70
  };

  const containerWidth =
    container.node().clientWidth || 900;

  const width =
    Math.max(500, containerWidth)
    - margin.left
    - margin.right;

  const height =
    450
    - margin.top
    - margin.bottom;

  /* ---------------------------
     SVG
  ---------------------------- */
  const svg = container
    .append("svg")
    .attr(
      "width",
      width + margin.left + margin.right
    )
    .attr(
      "height",
      height + margin.top + margin.bottom
    )
    .attr(
      "viewBox",
      `0 0 ${
        width + margin.left + margin.right
      } ${
        height + margin.top + margin.bottom
      }`
    )
    .style("max-width", "100%")
    .append("g")
    .attr(
      "transform",
      `translate(${margin.left},${margin.top})`
    );

  /* ---------------------------
     X SCALE
  ---------------------------- */
  const x = d3.scaleBand()
    .domain(
      data.map(d => d.location)
    )
    .range([0, width])
    .padding(0.2);

  /* ---------------------------
     STACK DATA
  ---------------------------- */
  const stackedData = d3.stack()
    .keys(keys)
    (data);

  /* ---------------------------
     Y MAX
  ---------------------------- */
  const maxTotal = d3.max(
    data,
    d => {

      let total = 0;

      keys.forEach(key => {
        total += Number(d[key] || 0);
      });

      return total;
    }
  );

  /* ---------------------------
     Y SCALE
  ---------------------------- */
  const y = d3.scaleLinear()
    .domain([0, maxTotal])
    .nice()
    .range([height, 0]);

  /* ---------------------------
     COLOUR SCALE
  ---------------------------- */
  const color = d3.scaleOrdinal()
    .domain(keys)
    .range(d3.schemeTableau10);

    /* ---------------------------
   TOOLTIP
    ---------------------------- */
    const tooltip = container
        .append("div")
        .style("position", "absolute")
        .style("background", "#fff")
        .style("padding", "8px")
        .style("border", "1px solid #ccc")
        .style("border-radius", "5px")
        .style("pointer-events", "none")
        .style("opacity", 0);

/* ---------------------------
   DRAW STACKS
---------------------------- */
svg.selectAll("g.layer")
  .data(stackedData)
  .join("g")
  .attr("class", "layer")
  .attr(
    "fill",
    d => color(d.key)
  )
  .selectAll("rect")
  .data(d =>
    d.map(v => ({
      ...v,
      key: d.key
    }))
  )
  .join("rect")
  .attr(
    "x",
    d => x(d.data.location)
  )
  .attr(
    "y",
    d => y(d[1])
  )
  .attr(
    "height",
    d => y(d[0]) - y(d[1])
  )
  .attr(
    "width",
    x.bandwidth()
  )

  // TOOLTIP EVENTS
  .on("mouseover", (event, d) => {

    const value =
      d[1] - d[0];

    tooltip
      .style("opacity", 1)
      .html(`
        <strong>${d.key}</strong><br>
        ${value} trees
      `);
  })

  .on("mousemove", event => {

    tooltip
      .style(
        "left",
        (event.pageX + 10) + "px"
      )
      .style(
        "top",
        (event.pageY - 20) + "px"
      );
  })

  .on("mouseout", () => {

    tooltip
      .style("opacity", 0);
  });

  /* ---------------------------
     Y AXIS
  ---------------------------- */
  svg.append("g")
    .call(d3.axisLeft(y));

  /* ---------------------------
     X AXIS
  ---------------------------- */
  svg.append("g")
    .attr(
      "transform",
      `translate(0,${height})`
    )
    .call(d3.axisBottom(x))
    .selectAll("text")
    .attr(
      "transform",
      "rotate(-35)"
    )
    .style(
      "text-anchor",
      "end"
    );

  /* ---------------------------
     Y LABEL
  ---------------------------- */
  svg.append("text")
    .attr(
      "transform",
      "rotate(-90)"
    )
    .attr(
      "x",
      -height / 2
    )
    .attr(
      "y",
      -50
    )
    .attr(
      "text-anchor",
      "middle"
    )
    .style(
      "font-size",
      "12px"
    )
    .text(
      "Number of Trees"
    );

  /* ---------------------------
     X LABEL
  ---------------------------- */
  svg.append("text")
    .attr(
      "x",
      width / 2
    )
    .attr(
      "y",
      height + 65
    )
    .attr(
      "text-anchor",
      "middle"
    )
    .style(
      "font-size",
      "12px"
    )
    .text(
      "Location"
    );

  /* ---------------------------
     LEGEND
  ---------------------------- */
  const legend = svg.append("g")
    .attr(
      "transform",
      `translate(${width + 20}, 20)`
    );

  keys.forEach((key, i) => {

    const row = legend
      .append("g")
      .attr(
        "transform",
        `translate(0, ${i * 25})`
      );

    // COLOUR BOX
    row.append("rect")
      .attr("width", 15)
      .attr("height", 15)
      .attr(
        "fill",
        color(key)
      );

    // LABEL
    row.append("text")
      .attr("x", 25)
      .attr("y", 12)
      .style("font-size", "12px")
      .text(key);
  });
}

/* ---------------------------
   MAIN DRAW
---------------------------- */
async function draw() {

  const blocks =
    await fetchBlocks();

  console.log(
    "Fetched blocks:",
    blocks
  );

  const summary =
    summarizeStackedData(blocks);

  console.log(
    "Summary:",
    summary
  );

  renderChart(summary);
}

/* ---------------------------
   INIT
---------------------------- */
document.addEventListener(
  "DOMContentLoaded",
  () => {

    draw();

    // RESPONSIVE RESIZE
    let resizeTimer;

    window.addEventListener(
      "resize",
      () => {

        clearTimeout(
          resizeTimer
        );

        resizeTimer = setTimeout(
          draw,
          150
        );
      }
    );
  }
);