import { supabase } from "./supabaseClient.js";

async function updateUI() {
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  // --- UPDATE PAGE LINK ---
  const updateLink = document.getElementById("update-link");
  if (updateLink) {
    updateLink.style.display = user ? "inline-block" : "none";
  }

  // --- AUTH LINK (SIGN IN / SIGN OUT) ---
  const authLink = document.getElementById("auth-link");
  if (!authLink) return;

  if (user) {
    authLink.textContent = "Sign Out";
    authLink.href = "#";

    authLink.onclick = async (e) => {
  e.preventDefault();

  await supabase.auth.signOut();

  // immediate feedback
  authLink.textContent = "Signed out";
  authLink.href = "#";
  authLink.onclick = null;

  if (updateLink) {
    updateLink.style.display = "none";
  }

  // optional redirect delay
  setTimeout(() => {
    window.location.href = "index.html";
  }, 1200);
};
  } else {
    authLink.textContent = "Sign In";
    authLink.href = "login.html";
    authLink.onclick = null;
  }
}

updateUI();