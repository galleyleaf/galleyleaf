// UI checks run by tests/run-ui-tests.sh through `playwright-cli run-code`.
// The file is one async function that receives a Playwright `page`.
// __BASE__ is replaced with the local server URL by the runner.
async (page) => {
  const BASE = "__BASE__";
  const results = [];
  const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  (got: ${detail})`}`);
  const wait = (ms) => page.waitForTimeout(ms);
  const text = (sel) => page.locator(sel).first().textContent();
  const visible = (sel) => page.locator(sel).first().isVisible();
  const evalPage = (fn) => page.evaluate(fn);

  // Serve the mock SDK files instead of Google's CDN.
  for (const name of ["app", "auth", "firestore"]) {
    await page.context().route(`**/firebasejs/*/firebase-${name}.js`, async (route) =>
      route.fulfill({
        response: await page.request.fetch(`${BASE}/tests/mock/${name}.js`),
        headers: { "content-type": "text/javascript" },
      })
    );
  }

  // Serve HTML pages with the Content-Security-Policy and other headers from firebase.json,
  // as Firebase Hosting would, and record anything the policy blocks.
  const hosting = (await (await page.request.fetch(`${BASE}/firebase.json`)).json()).hosting;
  const pageHeaders = Object.fromEntries(
    hosting.headers.find((h) => h.source === "**/*.html").headers.map((h) => [h.key.toLowerCase(), h.value])
  );
  const cspViolations = [];
  page.on("console", (msg) => {
    if (msg.text().includes("Content Security Policy")) cspViolations.push(msg.text());
  });
  await page.context().route(`${BASE}/**`, async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), ...pageHeaders } });
  });

  // Full page load (a hash-only change would not reload the mock).
  // GitHub's latest release, as the admin pages' version check sees it.
  await page.context().route("https://api.github.com/**", (route) =>
    route.fulfill({ json: { tag_name: "v0.3.0", html_url: "https://github.com/galleyleaf/galleyleaf/releases/tag/v0.3.0" } })
  );

  const open = async (path) => {
    await page.goto(`${BASE}/${path}`);
    await page.reload();
    await wait(900);
  };

  try {
    /* ---------- Sign-in and approval ---------- */
    await page.goto(`${BASE}/`);
    await evalPage(() => localStorage.clear());
    await evalPage(() => localStorage.setItem("mock:approved", "0"));
    await open("");
    check("Login screen shows for signed-out visitors", await visible("#view-login"));
    check("The sign-in screen links to Galleyleaf for authors", (await visible("#galleyleaf-link")) && (await page.locator("#galleyleaf-link").getAttribute("href")) === "https://galleyleaf.web.app/");

    await page.getByRole("button", { name: "Continue with Google" }).click();
    await wait(300);
    check("Account with access removed sees the paused screen", await visible("#view-pending"));

    await evalPage(() => window.__approve());
    await wait(900);
    check("Restoring access opens the library without a reload", await visible("#view-library"));
    const chapters = await page.locator("#chapter-list li").count();
    check("Library lists the chapters", chapters > 0, String(chapters));
    await evalPage(() => localStorage.setItem("mock:approved", "1"));

    /* ---------- A reader's first sign-in ---------- */
    await evalPage(() => { localStorage.setItem("mock:fresh", "1"); sessionStorage.clear(); });
    await open("");
    await wait(900);
    check("A reader's first sign-in opens the book", (await visible("#view-library")) && !(await visible("#library-message")) && (await page.locator("#chapter-list li").count()) > 0, (await visible("#library-message")) ? await text("#library-message-text") : "");
    await evalPage(() => localStorage.removeItem("mock:fresh"));

    /* ---------- Paragraph view ---------- */
    await evalPage(() => localStorage.setItem("reader:pref:readMode", '"paragraph"'));
    await open("#/read/chapter-3/1");
    const total = Number((await text("#reader-count")).split(" of ")[1]);
    check("Reader opens at paragraph 1", (await text("#reader-count")) === `1 of ${total}`, await text("#reader-count"));

    await page.keyboard.press("ArrowRight");
    await wait(200);
    check("Right arrow goes to the next paragraph", (await text("#reader-count")) === `2 of ${total}`, await text("#reader-count"));

    await page.locator("#btn-prev").click();
    await wait(200);
    check("Previous button goes back", (await text("#reader-count")) === `1 of ${total}`, await text("#reader-count"));

    await page.locator("#btn-bookmark").click();
    check("Bookmark button toggles on", (await page.locator("#btn-bookmark").getAttribute("aria-pressed")) === "true");

    await page.locator("#passage-text").click();
    await wait(200);
    check("Tapping the paragraph opens its comments", await evalPage(() => document.getElementById("comment-dialog").open));
    await page.fill("#comment-text", "Paragraph view note");
    await page.getByRole("button", { name: "Save comment" }).click();
    await wait(200);
    check("Saved comment appears in the sheet", (await page.locator("#comment-list li").count()) === 1);
    await page.locator("#btn-close-comments").click();
    check("Comment icon is highlighted", await page.locator("#btn-comment").evaluate((b) => b.classList.contains("has-comments")));
    check("Comment badge shows the count", (await text("#comment-badge")) === "1", await text("#comment-badge"));

    check("Book text can't be selected", (await page.locator("#passage-text").evaluate((e) => getComputedStyle(e).userSelect)) === "none");
    const copyBlocked = await page.locator("#passage-text").evaluate((e) => !e.dispatchEvent(new Event("copy", { bubbles: true, cancelable: true })));
    check("Copying from the reader is blocked", copyBlocked);
    await page.emulateMedia({ media: "print" });
    const printOk = (await page.locator(".print-notice").isVisible()) && !(await page.locator("#view-reader").isVisible());
    await page.emulateMedia({ media: "screen" });
    check("Printing shows a notice instead of the book", printOk);

    await page.goto(`${BASE}/#/read/chapter-3/${total}`);
    await wait(500);
    check("Last paragraph shows Finish", (await text("#next-label")) === "Finish", await text("#next-label"));
    await page.locator("#btn-next").click();
    await wait(600);
    check("Finishing a chapter shows the celebration", await evalPage(() => document.getElementById("celebrate-dialog").open));

    await page.locator("#btn-to-library").click();
    await wait(600);
    const ch3 = await page.locator(".chapter", { hasText: "Chapter 3" }).first().textContent();
    check("Finished chapter is marked in the library", ch3.includes("Finished"), ch3);
    check("Bookmark is listed in the library", (await page.locator("#bookmark-list li").count()) === 1);

    /* ---------- Scroll view ---------- */
    await page.goto(`${BASE}/#/read/chapter-2/5`);
    await wait(600);
    await page.locator("#btn-view-mode").click();
    await wait(500);
    const activeIndex = () => evalPage(() => Number(document.querySelector(".flow-p.is-active")?.dataset.index));
    check("Switching to scroll view keeps the same paragraph", (await activeIndex()) === 4, String(await activeIndex()));
    check("Scroll view shows the whole chapter", (await page.locator(".flow-p").count()) > 1);

    await page.mouse.move(200, 400);
    await page.mouse.wheel(0, 900);
    await wait(600);
    const afterScroll = await activeIndex();
    check("Scrolling moves the highlight", afterScroll > 4, String(afterScroll));
    check("Counter follows the highlight", (await text("#reader-count")).startsWith(`${afterScroll + 1} of`), await text("#reader-count"));

    const target = afterScroll + 2;
    await page.locator(`.flow-p[data-index="${target}"]`).click();
    await wait(200);
    check("Tapping a paragraph makes it active", (await activeIndex()) === target, String(await activeIndex()));
    check("Tapping a paragraph opens its comments", await evalPage(() => document.getElementById("comment-dialog").open));

    await page.fill("#comment-text", "Scroll view note");
    await page.getByRole("button", { name: "Save comment" }).click();
    await wait(200);
    await page.locator("#btn-close-comments").click();
    const badge = await page.locator(`.flow-p[data-index="${target}"] .flow-note`).count();
    check("Commented paragraph gets a badge", badge === 1, String(badge));

    await page.locator("#btn-next").click();
    await wait(1000);
    check("Next moves the highlight", (await activeIndex()) === target + 1, String(await activeIndex()));

    await page.getByRole("button", { name: "Finish chapter" }).click();
    await wait(600);
    check("Finish chapter button shows the celebration", await evalPage(() => document.getElementById("celebrate-dialog").open));
    await page.locator("#btn-to-library").click();
    await wait(300);

    /* ---------- Daily comment limit ---------- */
    await evalPage(() => localStorage.setItem("mock:quotaUsed", "300"));
    await evalPage(() => localStorage.setItem("reader:pref:readMode", '"paragraph"'));
    await open("#/read/chapter-1/1");
    await page.locator("#passage-text").click();
    await wait(200);
    await page.fill("#comment-text", "One too many");
    await page.getByRole("button", { name: "Save comment" }).click();
    await wait(300);
    check("Comments stop at the daily limit", (await text("#comment-error")).includes("today’s limit"), await text("#comment-error"));
    await page.locator("#btn-close-comments").click();
    await evalPage(() => localStorage.removeItem("mock:quotaUsed"));

    /* ---------- Account menu ---------- */
    const openMenu = () => page.locator(".avatar-btn:visible").click();
    const menuLinks = async () => (await page.locator(".account-menu:visible a:visible").allTextContents()).map((t) => t.trim());
    await open("#/read/chapter-1/1");
    await openMenu();
    check("The reader's top bar has the account menu", (await menuLinks()).includes("Contents"));
    await page.keyboard.press("Escape");
    await open("");
    await openMenu();
    const libraryLinks = await menuLinks();
    check("The account menu links to every page for an admin", libraryLinks.join("|") === "Contents|Readers and comments|Publish the book", libraryLinks.join("|"));
    await evalPage(() => localStorage.setItem("reader:pref:theme", '"dark"'));
    await page.locator(".account-menu:visible").getByRole("link", { name: "Readers and comments" }).click();
    await wait(900);
    check("The account menu opens the admin page", await visible("#content"));
    check("Admin pages use the saved theme", await evalPage(() => document.documentElement.dataset.theme === "dark"));
    await evalPage(() => localStorage.removeItem("reader:pref:theme"));

    /* ---------- Admin ---------- */
    await open("admin/");
    await openMenu();
    check("The admin page has the same account menu", (await menuLinks()).length === 3 && (await text('.account-menu [aria-current="page"]')).trim() === "Readers and comments");
    await page.keyboard.press("Escape");
    check("Admin page lists readers with access removed", (await page.locator("#pending-list li").count()) === 1);
    check("Admin page lists comments", (await page.locator("#comment-list li").count()) >= 1);
    const before = await page.locator("#comment-list li").count();
    await evalPage(() => { window.confirm = () => true; });
    await page.locator("#comment-list li").first().getByRole("button", { name: "Delete" }).click();
    await wait(300);
    check("Admin can delete a comment", (await page.locator("#comment-list li").count()) === before - 1);
    await page.getByRole("button", { name: "Approve" }).click();
    await wait(300);
    check("Approving moves the reader to approved", (await page.locator("#pending-list li").count()) === 0);

    /* ---------- Site version ---------- */
    const withSiteVersion = async (version) => {
      await page.context().route("**/site.json", (route) => route.fulfill({ json: { version } }));
      await evalPage(() => localStorage.removeItem("galleyleaf:latestRelease"));
      await open("admin/");
      await page.context().unroute("**/site.json");
    };
    await withSiteVersion("v0.2.1");
    check("An outdated site shows the update notice", (await visible("#update-notice")) && (await text("#update-notice")).includes("Galleyleaf v0.3.0 is available. Your site runs v0.2.1.") && (await page.getByRole("link", { name: "Update my site" }).getAttribute("href")) === "https://galleyleaf.web.app/setup/", await text("#update-notice"));
    await withSiteVersion("v0.3.0");
    check("An up-to-date site shows its version and no notice", !(await visible("#update-notice")) && (await text("#site-version-text")) === "Galleyleaf v0.3.0. You have the latest version.", await text("#site-version-text"));

    /* ---------- Publishing from a Word file ---------- */
    await open("admin/upload.html");
    const docx = await page.request.fetch(`${BASE}/tests/fixtures/sample-book.docx`);
    await page.locator("#file").setInputFiles({ name: "sample-book.docx", mimeType: "application/octet-stream", buffer: await docx.body() });
    await wait(500);
    const docxRows = await page.locator("#preview-rows tr").allTextContents();
    check("A .docx file is split into its chapters", docxRows.length === 3 && docxRows[0].startsWith("Chapter 1"), docxRows.join(" | "));
    check("A .docx file keeps its title and scene breaks", (await text("#preview-title")) === "The Lamplighter’s Almanac" && docxRows[1].endsWith("1"), `${await text("#preview-title")} | ${docxRows[1]}`);

    /* ---------- Removing the book ---------- */
    check("The publish page shows the published book", (await text("#published-summary")).includes("Test Title"), await text("#published-summary"));
    await evalPage(() => { window.confirm = () => true; });
    await page.getByRole("button", { name: "Remove the book" }).click();
    await wait(300);
    check("Removing the book leaves nothing published", (await text("#published-summary")).startsWith("No book is published") && !(await visible("#btn-remove")), await text("#published-summary"));
    await open("");
    check("Readers see that the book isn't published", (await text("#library-message-text")).includes("hasn’t been published"), await text("#library-message-text"));
    check("Without a book, Contents shows only a link to publish it", !(await visible("#chapter-list")) && !(await visible("#bookmark-list")) && (await page.locator("#library-publish").getAttribute("href")) === "admin/upload.html" && (await visible("#library-publish")));
    await evalPage(() => localStorage.removeItem("mock:noBook"));

    /* ---------- First sign-in on an admin page ---------- */
    const firstSignIn = async (ownerEmail) => {
      const ownerEmailHash = await page.evaluate(async (email) => {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
        return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      }, ownerEmail);
      await page.context().route("**/site.json", (route) => route.fulfill({ json: { ownerEmailHash } }));
      await evalPage(() => localStorage.setItem("mock:fresh", "1"));
      await open("admin/");
      await page.context().unroute("**/site.json");
    };
    await firstSignIn("reader@example.com");
    check("Owner's first sign-in on the admin page makes them admin", await visible("#content"), await text("#status"));
    await firstSignIn("someone-else@example.com");
    check("Anyone else's first sign-in on the admin page isn't admin", (await text("#status")).includes("isn’t an admin"), await text("#status"));
    await evalPage(() => localStorage.removeItem("mock:fresh"));

    /* ---------- Rules not ready yet, right after setup ---------- */
    await evalPage(() => localStorage.setItem("mock:notReady", "1"));
    await page.goto(`${BASE}/`);
    await page.reload();
    await wait(600);
    check("Reader waits while the rules aren't ready", (await visible("#loading-message")) && !(await visible("#view-error")));
    await wait(4000);
    check("Reader opens by itself once they are", await visible("#view-library"));
    await evalPage(() => localStorage.setItem("mock:notReady", "1"));
    await page.goto(`${BASE}/admin/`);
    await page.reload();
    await wait(600);
    check("Admin page waits while the rules aren't ready", (await text("#status")).includes("getting ready"), await text("#status"));
    await wait(4000);
    check("Admin page opens by itself once they are", await visible("#content"));
    await evalPage(() => localStorage.removeItem("mock:notReady"));

    /* ---------- Security headers ---------- */
    check("Pages send the security headers", !!pageHeaders["content-security-policy"] && pageHeaders["x-frame-options"] === "DENY");
    check("The Content-Security-Policy blocks nothing the site uses", cspViolations.length === 0, cspViolations.slice(0, 2).join(" | "));
  } catch (err) {
    results.push(`FAIL  Test run stopped: ${String(err.message || err).split("\n")[0]}`);
  }

  return results.join("\n");
}
