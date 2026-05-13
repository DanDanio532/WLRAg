import { supabase } from "./supabaseClient.js";

async function protectPage() {
  console.log("PROTECT SCRIPT RUNNING");

  const { data, error } = await supabase.auth.getUser();

  console.log("AUTH CHECK:", data.user);

  if (error || !data.user) {
    window.location.replace("login.html");
  }
}

protectPage();