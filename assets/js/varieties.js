// 1. Create client

import { supabase } from "./supabaseClient.js";

// 2. HELPER FUNCTIONS (⬅ PUT IT HERE)
function formatDayOfMonth(dateStr) {
  const date = new Date(dateStr);

  const day = String(date.getDate()).padStart(2, "0");
  const month = date.toLocaleString("en-AU", { month: "long" });

  return `${day} of ${month}`;
}

// 3. APP ENTRY POINT
async function init() {
  await loadVarieties();
}

// 4. FETCH DATA
async function loadVarieties() {
  const { data, error } = await supabase
    .from("variety")
    .select("*");

  if (error) {
    console.error(error);
    return;
  }

  renderVarieties(data);
}

// 5. RENDER UI
function renderVarieties(varieties) {
  const app = document.getElementById("variety-container");
  app.innerHTML = "";

  varieties.forEach(variety => {
    const div = document.createElement("div");
    div.className = "card";

    div.innerHTML = `
  <strong>${variety.varietyName}</strong><br/>
  ID: ${variety.varietyID}<br/>
  Season: ${formatDayOfMonth(variety.seasonStart)} → ${formatDayOfMonth(variety.seasonEnd)}
`;

app.appendChild(div);
  });
}

// 6. START APP
init();

// 7. TEST FUNCTIONS
async function testConnection() {
  const { data, error } = await supabase
    .from("variety")
    .select("*");

  console.log("Supabase connection test:");
  console.log("Data:", data);
  console.log("Error:", error);
}

testConnection();