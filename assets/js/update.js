import { supabase } from "./supabaseClient.js";

/* ---------------------------
   SAFE HELPERS
---------------------------- */
function getEl(id) {
  return document.getElementById(id);
}

function safeNumber(value) {
  return Number(value) || 0;
}

/* ---------------------------
   LOAD LOCATIONS
---------------------------- */
async function loadLocations() {
  const locationSelect = getEl("locationSelect");
  if (!locationSelect) return;

  const { data, error } = await supabase
    .from("location")
    .select("*");

  if (error) {
    console.error(error);
    return;
  }

  data.forEach(loc => {
    const option = document.createElement("option");
    option.value = loc.locationID;
    option.textContent = loc.locationName;
    locationSelect.appendChild(option);
  });
}

/* ---------------------------
   LOAD BLOCKS
---------------------------- */
async function loadBlocks() {
  const blockSelect = getEl("blockSelect");
  if (!blockSelect) return;

  const { data, error } = await supabase
    .from("block")
    .select(`
      *,
      location (
        locationName
      )
    `);

  if (error) {
    console.error(error);
    return;
  }

  blockSelect.innerHTML = "";

  data.forEach(block => {
    const option = document.createElement("option");

    option.value = block.blockID;

    const locationName =
      block.location?.locationName || "Unknown";

    option.textContent =
      `${locationName} - ${block.identifier}`;

    blockSelect.appendChild(option);
  });
}

/* ---------------------------
   LOAD VARIETIES
---------------------------- */
async function loadVarieties() {
  const varietySelect = getEl("varietySelect");
  if (!varietySelect) return;

  const { data, error } = await supabase
    .from("variety")
    .select("*");

  if (error) {
    console.error(error);
    return;
  }

  varietySelect.innerHTML = "";

  data.forEach(variety => {
    const option = document.createElement("option");
    option.value = variety.varietyID;
    option.textContent = variety.varietyName;
    varietySelect.appendChild(option);
  });
}

/* ---------------------------
   UPDATE REMAINING TREES
---------------------------- */
async function updateRemainingTrees() {
  const blockID = getEl("blockSelect")?.value;
  if (!blockID) return;

  const { data: blockData, error: blockError } =
    await supabase
      .from("block")
      .select("treeCount")
      .eq("blockID", blockID)
      .single();

  if (blockError) {
    console.error(blockError);
    return;
  }

  const { data: varietyData, error: varietyError } =
    await supabase
      .from("block_varieties")
      .select("varietyCount")
      .eq("blockID", blockID);

  if (varietyError) {
    console.error(varietyError);
    return;
  }

  let usedTrees = 0;

  (varietyData || []).forEach(v => {
    usedTrees += safeNumber(v.varietyCount);
  });

  const remainingTrees =
    safeNumber(blockData.treeCount) - usedTrees;

  const remainingText = getEl("remainingTreesText");
  if (remainingText) {
    remainingText.textContent =
      `Remaining Trees: ${remainingTrees}`;
  }

  const input = getEl("varietyTreeCount");
  if (input) {
    input.max = remainingTrees;
  }
}

/* ---------------------------
   ASSIGN VARIETY
---------------------------- */
async function assignVariety(e) {
  e.preventDefault();

  const blockID = safeNumber(getEl("blockSelect")?.value);
  const varietyID = safeNumber(getEl("varietySelect")?.value);
  const treeCount = safeNumber(getEl("varietyTreeCount")?.value);

  const maxTrees = safeNumber(getEl("varietyTreeCount")?.max);

  if (!blockID || !varietyID) {
    alert("Please select both a block and a variety");
    return;
  }

  // Allow zero – just assign the variety without consuming trees
  if (treeCount < 0) {
    alert("Tree count cannot be negative");
    return;
  }

  if (treeCount > maxTrees) {
    alert("Too many trees for this block");
    return;
  }

  const { error } = await supabase
    .from("block_varieties")
    .insert([
      {
        blockID,
        varietyID,
        varietyCount: treeCount
      }
    ]);

  if (error) {
    console.error(error);
    alert("Error assigning variety: " + error.message);
    return;
  }

  console.log(`Variety assigned with ${treeCount} trees`);

  // Refresh remaining trees display
  updateRemainingTrees();
}

/* ---------------------------
   CREATE BLOCK
---------------------------- */
async function createBlock(e) {
  e.preventDefault();

  const identifier = getEl("identifier")?.value;
  const treeCount = safeNumber(getEl("treeCount")?.value);
  const locationID = safeNumber(getEl("locationSelect")?.value);

  const { error } = await supabase
    .from("block")
    .insert([
      {
        identifier,
        treeCount,
        locationID
      }
    ]);

  if (error) {
    console.error(error);
    return;
  }

  console.log("Block created");

  await loadBlocks();
  updateRemainingTrees();
}

/* ---------------------------
   INIT
---------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  // SAFE PAGE GUARD
  if (!document.getElementById("block-form")) return;

  await loadLocations();
  await loadBlocks();
  await loadVarieties();

  updateRemainingTrees();

  getEl("blockSelect")?.addEventListener(
    "change",
    updateRemainingTrees
  );

  const form = getEl("block-form");
  form?.addEventListener("submit", createBlock);

  const assignForm = getEl("assign-form");
  assignForm?.addEventListener("submit", assignVariety);
});