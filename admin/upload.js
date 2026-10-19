// Admin-only: parse book.md or a .docx in the browser and publish it to Firestore.
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { auth, db } from "../js/firebase.js";
import { ensureProfile, signIn, whenRulesReady } from "../js/auth.js";
import { parseBook } from "../js/md-parser.js";
import { parseDocx } from "../js/docx-parser.js";

const $ = (id) => document.getElementById(id);
let parsed = null;

function status(message, isError = false) {
  const s = $("status");
  s.textContent = message;
  s.classList.toggle("is-error", isError);
}

onAuthStateChanged(auth, async (user) => {
  $("tools").hidden = true;
  if (!user) {
    status("Sign in with the admin account to publish.");
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Sign in with Google";
    btn.style.marginTop = "0.75rem";
    btn.onclick = () => signIn().catch(() => status("Sign-in didn’t finish. Try again.", true));
    $("status").append(document.createElement("br"), btn);
    return;
  }
  try {
    const profile = await whenRulesReady(() => ensureProfile(user), () =>
      status("Your site is getting ready. Right after setup this can take a few minutes. This page opens by itself."));
    if (profile.admin !== true) {
      status(`${user.email} isn’t an admin. Sign in with the admin email you gave during setup, or in the Firestore console set admin: true and approved: true on users/${user.uid}, then reload this page.`, true);
      return;
    }
    status(`Signed in as ${user.email}.`);
    $("tools").hidden = false;
  } catch {
    status("Your account couldn’t be checked. Reload the page to try again.", true);
  }
});

$("file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  $("preview").hidden = true;
  if (!file) return;
  const isDocx = /\.docx$/i.test(file.name);
  try {
    parsed = isDocx ? await parseDocx(await file.arrayBuffer(), file.name) : parseBook(await file.text());
  } catch (err) {
    parsed = null;
    status(
      err.message === "too-large"
        ? "This Word file is too large to read."
        : isDocx
          ? "This file couldn’t be read as a Word document. Save it as .docx (not .doc) and try again."
          : "This file couldn’t be read as Markdown.",
      true
    );
    return;
  }
  if (!parsed.sections.length) {
    parsed = null;
    status(
      isDocx
        ? "No chapters found. Each chapter must start with a heading in Word’s “Heading 1” style."
        : "No chapters found. Chapters must start with a line like “# Chapter 1”.",
      true
    );
    return;
  }
  const tooBig = parsed.sections.find((s) => JSON.stringify(s.paragraphs).length > 900_000);
  if (tooBig) {
    parsed = null;
    status(`“${tooBig.title}” is too large to store in one document. Split it into smaller chapters.`, true);
    return;
  }

  $("preview-title").textContent = parsed.title || "Untitled";
  $("preview-author").textContent = parsed.author ? `by ${parsed.author}` : "";
  $("preview-rows").replaceChildren(
    ...parsed.sections.map((s) => {
      const tr = document.createElement("tr");
      for (const value of [s.title, s.paragraphs.length, s.breaks.length]) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      return tr;
    })
  );
  $("preview").hidden = false;
  const total = parsed.sections.reduce((n, s) => n + s.paragraphs.length, 0);
  status(`Ready to publish ${parsed.sections.length} sections and ${total} paragraphs.`);
});

$("btn-publish").addEventListener("click", async () => {
  if (!parsed) return;
  const btn = $("btn-publish");
  btn.disabled = true;
  status("Publishing…");
  try {
    const batch = writeBatch(db);
    const ids = new Set(parsed.sections.map((s) => s.id));

    // Remove chapters that no longer exist in the file.
    const existing = await getDocs(collection(db, "chapters"));
    existing.forEach((d) => {
      if (!ids.has(d.id)) batch.delete(d.ref);
    });

    for (const s of parsed.sections) {
      batch.set(doc(db, "chapters", s.id), {
        title: s.title,
        order: s.order,
        paragraphs: s.paragraphs,
        breaks: s.breaks,
      });
    }

    batch.set(doc(db, "book", "meta"), {
      title: parsed.title || "Untitled",
      author: parsed.author || "",
      dedication: parsed.dedication || "",
      chapters: parsed.sections.map((s) => ({
        id: s.id,
        title: s.title,
        order: s.order,
        paragraphCount: s.paragraphs.length,
      })),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    try {
      Object.keys(sessionStorage).filter((k) => k.startsWith("book:")).forEach((k) => sessionStorage.removeItem(k));
    } catch {
      /* ignore */
    }
    status("Published. Readers will see the new text the next time they open the site.");
  } catch (err) {
    status(
      err.code === "permission-denied"
        ? "Firestore refused the write. Check that your account has admin: true and that the security rules are deployed."
        : "Publishing failed. Check your connection and try again.",
      true
    );
  } finally {
    btn.disabled = false;
  }
});
