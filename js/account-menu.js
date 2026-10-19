// The avatar menu shared by the reader and the admin pages: who is signed in,
// links between the pages (the admin ones only for admins) and sign out.
import { signOut } from "./auth.js";

const $ = (id) => document.getElementById(id);

const account = $("account");
const button = $("btn-account");
const menu = $("account-menu");

export function closeAccountMenu() {
  menu.hidden = true;
  button.setAttribute("aria-expanded", "false");
}

button.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = menu.hidden;
  menu.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", (e) => {
  if (!menu.hidden && !e.target.closest(".account")) closeAccountMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !menu.hidden) {
    closeAccountMenu();
    button.focus();
  }
});
for (const link of menu.querySelectorAll("a")) link.addEventListener("click", closeAccountMenu);
$("btn-sign-out").addEventListener("click", () => {
  closeAccountMenu();
  signOut();
});

/** Shows the signed-in user, or hides the menu when `user` is null. */
export function renderAccount(user, profile) {
  closeAccountMenu();
  account.hidden = !user;
  if (!user) return;
  const name = user.displayName || user.email || "Reader";
  $("account-name").textContent = name;
  $("account-email").textContent = user.email || "";
  $("avatar-initial").textContent = name.trim().charAt(0).toUpperCase();
  const img = $("avatar-img");
  if (user.photoURL) {
    img.src = user.photoURL;
    img.hidden = false;
    img.onerror = () => (img.hidden = true);
  } else {
    img.hidden = true;
  }
  for (const link of menu.querySelectorAll("[data-admin-only]")) link.hidden = profile?.admin !== true;
}
