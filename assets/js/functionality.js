import { supabase } from "./supabaseClient.js";

const authLink = document.getElementById("auth-link");
const signOutLink = document.getElementById("signout-link");
const updateLink = document.getElementById("update-link");

function setOpacity(el, visible) {
  if (!el) return;
  el.style.opacity = visible ? "1" : "0";
  el.style.pointerEvents = visible ? "auto" : "none";
}

async function updateAuthUI() {
  const { data: { session } } = await supabase.auth.getSession();
  const loggedIn = !!session;

  // AUTH TOGGLE (Sign In / Sign Out)
  if (authLink && signOutLink) {
    authLink.classList.toggle("visible", !loggedIn);
    signOutLink.classList.toggle("visible", loggedIn);
  }

  // Do NOT hide any navigation links – they are always visible.
  // protect.js will handle redirects to login if not authenticated.
}

document.addEventListener("DOMContentLoaded", async () => {

  // initial state
  await updateAuthUI();

  // react to auth changes
  supabase.auth.onAuthStateChange((event, session) => {
    updateAuthUI();
  });

  // sign out handler
  if (signOutLink) {
    signOutLink.addEventListener("click", async (e) => {

      e.preventDefault();

      await supabase.auth.signOut();

      await updateAuthUI();

      window.location.href = "index.html";
    });
  }
});