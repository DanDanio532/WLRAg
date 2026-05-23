import { supabase } from "./supabaseClient.js";

async function protectPage() {
  console.log("PROTECT SCRIPT RUNNING");

  // Don't redirect if already on login page (avoid infinite loop)
  if (window.location.pathname.includes("login.html")) {
    return;
  }

  // Check if user is authenticated
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  console.log("Session:", session);
  console.log("User:", user);

  if (sessionError || userError || !session || !user) {
    console.log("Not authenticated, redirecting to login.html");
    window.location.replace("login.html");
  } else {
    console.log("Authenticated, map can load");
  }
}

protectPage();