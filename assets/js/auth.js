import { supabase } from "./supabaseClient.js";

const form = document.getElementById("login-form");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  const message = document.getElementById("message");

  if (error) {
    message.textContent = "Login failed";
    console.error(error);
    return;
  }

  message.textContent = "Login successful";

    window.location.href = "update.html";

  console.log("User:", data.user);

  
});