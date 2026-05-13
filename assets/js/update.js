import { supabase } from "./supabaseClient.js";

/* ---------------------------
   LOAD LOCATIONS (OUTSIDE FORM)
---------------------------- */
async function loadLocations() {
  const locationSelect = document.getElementById("locationSelect");

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

async function loadBlocks() {
  const blockSelect = document.getElementById("blockSelect");

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
    option.textContent =
        `${block.location.locationName} - ${block.identifier}`;

    blockSelect.appendChild(option);
  });
}

async function loadVarieties() {
  const varietySelect = document.getElementById("varietySelect");

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

async function assignVariety(e) {
  e.preventDefault();

  const blockID = Number(
    document.getElementById("blockSelect").value
  );

  const varietyID = Number(
    document.getElementById("varietySelect").value
  );

  const treeCount = Number(
    document.getElementById("varietyTreeCount").value
  );

  // CHECK MAX TREES
  const maxTrees =
    Number(
      document.getElementById(
        "varietyTreeCount"
      ).max
    );

  if (treeCount > maxTrees) {
    alert("Too many trees for this block");
    return;
  }

  if (!blockID || !varietyID || !treeCount) {
    alert("Please fill in all fields");
    return;
  }

  const { data, error } = await supabase
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
    return;
  }

  console.log("Variety assigned:", data);

  updateRemainingTrees();
}

async function updateRemainingTrees() {

  const blockID =
    document.getElementById("blockSelect").value;

  // TOTAL TREES IN BLOCK
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

  // TREES ALREADY USED BY VARIETIES
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

  varietyData.forEach(v => {
    usedTrees += Number(v.varietyCount);
  });

  const remainingTrees =
    Number(blockData.treeCount) - usedTrees;

  // SHOW REMAINING
  document.getElementById(
    "remainingTreesText"
  ).textContent =
    `Remaining Trees: ${remainingTrees}`;

  // LIMIT INPUT
  document.getElementById(
    "varietyTreeCount"
  ).max = remainingTrees;
}


/* ---------------------------
   MAIN
---------------------------- */
document.addEventListener("DOMContentLoaded", async () => {

  // LOAD DROPDOWNS
  await loadLocations();
  await loadBlocks();
  await loadVarieties();

  // NOW update remaining trees
  updateRemainingTrees();

  // UPDATE WHEN BLOCK CHANGES
  document.getElementById("blockSelect")
    .addEventListener(
      "change",
      updateRemainingTrees
    );

  /* ---------------------------
     CREATE BLOCK FORM
  ---------------------------- */
  const form = document.getElementById("block-form");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const identifier =
      document.getElementById("identifier").value;

    const treeCount = Number(
    document.getElementById("treeCount").value
    );

    const locationID = Number(
    document.getElementById("locationSelect").value
    );

    const { data, error } = await supabase
    .from("block")
    .insert([
        {
        identifier,
        treeCount,
        locationID
        }
    ])
    .select()
    .single();

    if (error) {
      console.error(error);
      return;
    }

    console.log("Inserted block:", data);

    await loadBlocks();

    updateRemainingTrees();
  });

  /* ---------------------------
     ASSIGN VARIETY FORM
  ---------------------------- */
  const assignForm =
    document.getElementById("assign-form");

  assignForm.addEventListener(
    "submit",
    assignVariety
  );

});