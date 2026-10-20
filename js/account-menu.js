// The avatar menu shared by the reader and the admin pages: who is signed in,
// links between the pages (the admin ones only for admins) and sign out.
// Pages place an empty <div class="account" data-account-menu hidden> wherever
// the avatar goes; this module builds the menu into each one. Attributes:
//   data-root     path from the page to the site root ("" or "../")
//   data-current  the page it is on: "contents", "readers" or "publish"
import { signOut } from "./auth.js";

const PAGES = [
  { id: "contents", label: "Contents", href: "" },
  { id: "readers", label: "Readers and comments", href: "admin/", admin: true },
  { id: "publish", label: "Publish the book", href: "admin/upload.html", admin: true },
];

const menus = [...document.querySelectorAll("[data-account-menu]")].map((account, i) => {
  const root = account.dataset.root || "";
  const id = `account-menu-${i + 1}`;
  account.innerHTML = `
    <button type="button" class="avatar-btn" aria-haspopup="true" aria-expanded="false" aria-controls="${id}" aria-label="Account">
      <img class="avatar-img" alt="" referrerpolicy="no-referrer" hidden>
      <span class="avatar-initial" aria-hidden="true"></span>
    </button>
    <div class="account-menu" id="${id}" hidden>
      <p class="account-name"></p>
      <p class="account-email"></p>
      <nav class="menu-nav" aria-label="Pages"></nav>
      <button type="button" class="menu-link" data-menu-sign-out>Sign out</button>
    </div>`;
  const nav = account.querySelector(".menu-nav");
  for (const page of PAGES) {
    const a = document.createElement("a");
    a.className = "menu-link";
    a.href = page.href ? root + page.href : root || "#/";
    a.textContent = page.label;
    if (page.id === account.dataset.current) a.setAttribute("aria-current", "page");
    if (page.admin) {
      a.dataset.adminOnly = "";
      a.hidden = true;
    }
    nav.append(a);
  }
  return { account, button: account.querySelector(".avatar-btn"), menu: account.querySelector(".account-menu") };
});

export function closeAccountMenu() {
  for (const { button, menu } of menus) {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }
}

for (const { account, button, menu } of menus) {
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    closeAccountMenu();
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  });
  for (const link of menu.querySelectorAll("a")) link.addEventListener("click", closeAccountMenu);
  account.querySelector("[data-menu-sign-out]").addEventListener("click", () => {
    closeAccountMenu();
    signOut();
  });
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".account")) closeAccountMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const open = menus.find(({ menu }) => !menu.hidden);
  if (!open) return;
  closeAccountMenu();
  open.button.focus();
});

/** Shows the signed-in user in every menu, or hides them when `user` is null. */
export function renderAccount(user, profile) {
  closeAccountMenu();
  const name = user ? user.displayName || user.email || "Reader" : "";
  for (const { account } of menus) {
    account.hidden = !user;
    if (!user) continue;
    account.querySelector(".account-name").textContent = name;
    account.querySelector(".account-email").textContent = user.email || "";
    account.querySelector(".avatar-initial").textContent = name.trim().charAt(0).toUpperCase();
    const img = account.querySelector(".avatar-img");
    if (user.photoURL) {
      img.src = user.photoURL;
      img.hidden = false;
      img.onerror = () => (img.hidden = true);
    } else {
      img.hidden = true;
    }
    for (const link of account.querySelectorAll("[data-admin-only]")) link.hidden = profile?.admin !== true;
  }
}
