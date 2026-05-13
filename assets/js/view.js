import { supabase } from "./supabaseClient.js";

async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

async function init() {
  const user = await getUser();

  const container = document.getElementById("table-container");

  if (!user) {
    container.innerHTML = `
      <div class="card">
        <h2>Sign in to view location data</h2>
        <p>This section contains restricted orchard information.</p>
        <a href="login.html">
          <button>Sign In</button>
        </a>
      </div>
    `;
    return;
  }

  await loadTables();
}

async function loadTables() {

  // GET ALL BLOCKS + LOCATIONS
  const { data: blocks, error: blockError } =
    await supabase
      .from("block")
      .select(`
        *,
        location (
          locationName
        )
      `)
      .order("identifier", { ascending: true });

  if (blockError) {
    console.error(blockError);
    return;
  }

  // GET BLOCK VARIETIES + VARIETY NAMES
  const { data: blockVarieties, error: varietyError } =
    await supabase
      .from("block_varieties")
      .select(`
        *,
        variety (
          varietyName
        )
      `);

  if (varietyError) {
    console.error(varietyError);
    return;
  }

  renderTables(blocks, blockVarieties);
}

function renderTables(blocks, blockVarieties) {

  const container =
    document.getElementById("table-container");

  container.innerHTML = "";

  // GROUP BLOCKS BY LOCATION
  const groupedLocations = {};

  blocks.forEach(block => {

    const locationName =
      block.location.locationName;

    if (!groupedLocations[locationName]) {
      groupedLocations[locationName] = [];
    }

    groupedLocations[locationName].push(block);
  });

  // CREATE TABLE FOR EACH LOCATION
  Object.keys(groupedLocations).forEach(locationName => {

    const section = document.createElement("div");
    section.className = "card";

    const title = document.createElement("h2");
    title.textContent = locationName;

    section.appendChild(title);

    const table = document.createElement("table");

    table.innerHTML = `
      <thead>
        <tr>
          <th>Block</th>
          <th>Total Trees</th>
          <th>Varieties</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");

    groupedLocations[locationName].forEach(block => {

      // GET VARIETIES FOR THIS BLOCK
      const varieties =
        blockVarieties.filter(
          v => v.blockID === block.blockID
        );

      // FORMAT VARIETY STRING
      const varietyText =
        varieties.map(v =>
          `${v.variety.varietyName} - ${v.varietyCount}`
        ).join(", ");

      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${block.identifier}</td>
        <td>${block.treeCount}</td>
        <td>${varietyText || "None Assigned"}</td>
      `;

      tbody.appendChild(row);
    });

    section.appendChild(table);

    container.appendChild(section);
  });
}

init();