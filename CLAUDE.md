# Galleyleaf

A mobile-first website where an author shares a book before publication and readers comment on it paragraph by paragraph. Readers read paragraph by paragraph or as a scrolling chapter. It uses Firebase Authentication with Google sign-in, Cloud Firestore and Firebase Hosting.

This is the public template. Each author deploys their own copy into their own Firebase project, so there is no shared live site. It's licensed under AGPL-3.0 (see `LICENSE`).

- Firestore: Standard edition, `(default)` database
- Setup steps for authors are in `README.md`

## Ground rules

- **Plain HTML, CSS and JavaScript only.** No frameworks, no npm packages in the app and no build step. A bundler was considered and rejected: it would trim the Firebase SDK, but it isn't worth adding a build step.
- **The Firebase JS SDK loads as ES modules from the gstatic CDN**, pinned to `12.19.0`. To upgrade, change the version everywhere it appears: every import in `js/` and `admin/`, plus the `modulepreload` links in `index.html`.
- **Always run the Firebase CLI as `npx -y firebase-tools@latest`**, never bare `firebase`.
- **Use the Firebase plugin for Firebase work.** It is installed at project scope (`firebase@firebase`). Load the matching skill before acting:

  | Task | What to use |
  |---|---|
  | Firestore data, queries, indexes | `firebase:firebase-firestore` |
  | Changing `firestore.rules` | The `firebase:firestore-rules-creation` skill. Its `firestore-rules-author` subagent can't start in Claude Code (its tool list targets another editor), so follow the skill directly, including its devil's-advocate pass and a `--dry-run` |
  | Reviewing rules | `firebase:firebase-security-rules-auditor` |
  | Sign-in, Google provider | `firebase:firebase-auth-basics` |
  | Hosting config, `firebase.json` headers and ignores, deploys | `firebase:firebase-hosting-basics` |
  | CLI login, project selection | `firebase:firebase-basics` |

  The plugin's MCP tools (`mcp__plugin_firebase_firebase__*`) can read and write Firestore documents, validate rules and look up Firebase docs. Ask before writing to the live database.
- **Security rules follow the `firestore-rules-creation` pattern:**
  - a documented data model at the top
  - helper functions
  - validator functions used on both create and update
  - `hasOnly` schemas and size limits
  - timestamps checked against `request.time`
- **Use `frontend-design:frontend-design` for UI and visual changes.**
- **An author's manuscript (`book.md`, or a `.docx`) is never deployed or committed here.** Readers get the text from Firestore, where security rules protect it.
- **Run the UI tests after changes and before deploying** (see Testing).
- **It must run on Firebase's free Spark plan.** Authors deploy into their own accounts at no cost. Don't add anything that needs Blaze (Cloud Functions included) or another paid cloud service.
- **No personal or project-specific data in this repo.** No real Firebase config, emails or manuscripts. `js/firebase-config.js` and `firebase.json` keep their `REPLACE_ME` placeholders, and `firestore.rules` keeps `__OWNER_EMAIL__`.

## Product decisions

- **Access:** a reader signs in with Google, and `users/{uid}` is created with `approved: true`, so anyone with a Google account can read. The rules only allow profile creation through verified Google sign-in, and `photoURL` must be empty or a `https://lh3.googleusercontent.com/` URL.
  - **Removing access:** an admin removes it from `/admin/` ("Remove access"), or by setting `approved: false` in the console.
  - **What a removed reader sees:** an "access paused" screen.
  - **Restoring access:** "Approve" turns it back on, and the screen switches to the library live, with no reload.
- **Admins:** the site owner (the email given to `setup.sh`) becomes admin on first sign-in, on any page: the reader and both admin pages create a missing profile through `ensureProfile()` in `js/auth.js`. The rules allow `admin: true` on create only for that verified Google address (`isSiteOwner()`), and `js/auth.js` compares the signed-in email with the SHA-256 hash in `/site.json`, so the address isn't published. Other admins are set in the Firebase console. Admins can:
  - read all profiles
  - change only the `approved` flag
  - read every reader's comments, and delete any of them (spam cleanup)
  - publish the book
- **Comments:**
  - Each comment is stored per paragraph at `users/{uid}/comments`.
  - Only its author and admins can read it.
  - Only the author can create or edit it, and only while approved. The author (while approved) or an admin can delete it. A reader whose access is removed can't read or delete their comments until access is restored.
  - **Daily limit:** each reader can make 300 comment creates and edits per day, counted in `users/{uid}/limits/commentWrites`, which is written in the same batch as the comment and names it. It bounds how many comments are stored, and so what the admin page reads. The limit is in both `firestore.rules` and `js/comments.js`.
    - **What it doesn't stop:** a script can still use up the free daily writes, because one batch can write the same comment up to 500 times for one +1. Every write in a batch is checked against the state before the batch, so rules can't tell the copies apart; the Firestore emulator confirmed this. On Spark that means saving fails until the next day and nothing is charged. Closing it fully would need Cloud Functions.
  - The comment icon changes colour when the paragraph has comments.
- **Book text:** stored in Firestore and readable only by approved users. Admins publish it from `/admin/upload.html`, which parses `book.md` or a Word `.docx` in the browser. That page also shows the published book and can remove it: one batch deletes `book/meta` and every chapter, readers' comments are kept, and readers see that the book isn't published yet.
- **Contents page with no book:** it hides the title, chapters and bookmarks and shows only a message. Admins also get a "Publish the book" button there.
- **Sign-in screen:** below the Google button, a short note tells readers who write that Galleyleaf can share their book too, linking to `https://galleyleaf.web.app/` in a new tab.
- **Top bar and account menu:** Contents and both admin pages share one top bar: the book title (linking to Contents), the theme button and the avatar. The reader's top bar has the back arrow, chapter title, view, text size and theme buttons, and the avatar too. The avatar opens the same menu everywhere: who is signed in, links to Contents, Readers and comments, and Publish the book (the admin links only for admins), and Sign out. Pages hold an empty `<div class="account" data-account-menu>` with `data-root` and `data-current`, and `js/account-menu.js` builds the menu into each one, so its markup lives in one place.
- **Theme:** `js/theme.js` applies the saved theme (`reader:pref:theme`, else the system's) and handles every theme button, on the reader and the admin pages alike.
- **Two reading views:** the reader switches between them with the top-bar toggle, and the choice is saved.
  - **Paragraph view** shows one paragraph at a time, with Prev/Next, swipe and ←/→.
  - **Scroll view** shows the whole chapter, and the paragraph at the reading line (35% down the viewport) is highlighted. Comments and bookmarks still attach to that paragraph.
- **Saved in the browser (`localStorage`):** progress, bookmarks, finished chapters, theme, text size and view. They are kept per account (`reader:{uid}:...`), and preferences use `reader:pref:{name}`.
- **Tapping or clicking a paragraph opens its comment sheet** in both views. In scroll view it also makes that paragraph active.
- **Copy deterrents** (casual copying only; screenshots and developer tools still work):
  - the book text can't be selected
  - copy, cut, drag and the context menu are blocked in the reading area
  - printing shows a notice instead of the book
  - A watermark and stopping the `sessionStorage` chapter cache were considered and not done.
- **Chapter completion:** shows a confetti and check celebration, which is skipped when the reader prefers reduced motion.
- **Loading:** `index.html` has `modulepreload` links for every module the reader page imports, so they download in parallel. Add a link when you add a module to that import graph. The admin pages don't use preloads.
- **Caching:** HTML pages, JS, CSS and JSON (`site.json`) are served with `Cache-Control: no-cache`, so browsers check for a newer copy every time and deploys show up immediately. Without it Firebase Hosting sends `max-age=3600`, and a cached old page could run with newer scripts. Images and icons keep that one-hour default.
- **Security headers:** HTML pages (`**/*.html`, `/` and `/admin/`) get a Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff` and a `Referrer-Policy`. They're set on pages only, because `frame-ancestors` on Firebase's `/__/auth/` pages would break popup sign-in. When you load something from a new origin, add it to the CSP in all three header blocks of `firebase.json`; the UI tests apply the CSP and fail on anything it blocks.
- **Version and updates:** both admin pages show the site's version (from `site.json`) in a footer with a link to the setup page. `js/site-version.js` asks GitHub's API for the latest release of `galleyleaf/galleyleaf`, caches the answer for 6 hours in `localStorage`, and shows an "Update my site" notice when it's newer. Sites deployed before v0.2.2 have no version in `site.json`, so they show "an earlier version". Updating itself happens on the setup page.
- **Admin page reads:** it subscribes to every comment, which is fine at a beta-reader scale. Paging it would need `orderBy` on a collection-group query, which needs an index the setup page doesn't deploy. Excerpts are fetched only for chapters in `book/meta`, since a comment's `chapterId` is chosen by the reader.

## Data model (Firestore)

| Path | Fields | Access |
|---|---|---|
| `users/{uid}` | `displayName`, `email`, `photoURL`, `approved`, `admin`, `createdAt` | Owner creates it once, with `approved: true` and `admin: false`. Owner and admins can read it. Admins can update `approved` only. |
| `users/{uid}/comments/{id}` | `chapterId`, `paragraphIndex`, `text` (≤ 2000 chars), `createdAt`, `updatedAt` | Owner reads, writes and deletes while approved; each create or edit must advance the quota below. Admins read through a collection-group query and can delete. |
| `users/{uid}/limits/commentWrites` | `count` (1–300), `windowStart`, `commentId`, `updatedAt` | Owner reads and writes while approved: +1 within a day of `windowStart`, or a new window at 1 after that. Never deleted. |
| `book/meta` | `title`, `author`, `dedication`, `chapters[{id,title,order,paragraphCount}]`, `updatedAt` | Approved users can read it. Admins can write it. |
| `chapters/{id}` | `title`, `order`, `paragraphs[]` (HTML with only `<em>` and `<strong>`), `breaks[]` | Approved users and admins can read it. Admins can write it. |

## Book format (`book.md`)

- YAML front matter supplies `title` and `author`. A `::: {.dedication}` block is shown in the library unless it is a `[PLACEHOLDER]`.
- Each `# Heading` starts a section, and its id is a slug of the heading (`chapter-1`, `epilogue`). Sections that are still `[PLACEHOLDER]` text are skipped.
- A blank line separates paragraphs. A `---` line marks a scene break. `_x_` or `*x*` makes italics, and `**x**` makes bold.
- After editing the book, republish it from `/admin/upload.html`.

## Book format (`.docx`)

`js/docx-parser.js` unzips the file with `DecompressionStream` and reads its XML with `DOMParser`, so it needs no library. It returns the same shape as `parseBook()` and shares its slugs and placeholder rule.
- Styles are matched by name through `styles.xml`, not by id, so Word in other languages works. An outline level of 0 also counts as Heading 1.
- **Heading 1** starts a section, and text before the first one is skipped. A Heading 1 called "Dedication" becomes the dedication.
- **Title** gives the title, and **Author**, or a **Subtitle** like "by Jane Doe", gives the author. The fallbacks are `dc:title` and `dc:creator` in `docProps/core.xml`, and generic creators such as "Microsoft Office User" are ignored.
- Scene breaks are a paragraph of only `*`, `#`, `~` or dashes, a horizontal-line shape, an empty paragraph with a border, or a bottom border on a paragraph (what Word draws for a typed `---`).
- Italic and bold come from direct formatting, character styles (including Emphasis and Strong) and paragraph styles. Deleted tracked changes and table-of-contents paragraphs are skipped.

- **Right after setup, the site waits for its security rules.** Rules published through the API can take several minutes to reach a new database, which refuses everything until then. A refused read of the user's **own** profile can only mean that, so `whenRulesReady()` and `watchAccess()` in `js/auth.js` retry for up to 10 minutes. Meanwhile the reader shows "Your site is getting ready" (the `starting` state) and the admin pages say the same in their status line.

## Setup and deploy

Authors set up and update their site from the **Galleyleaf setup page** (`https://galleyleaf.web.app/setup/`, private repo `galleyleaf/hub`). It runs the steps below from the browser through Google's APIs, deploying the files of the **latest GitHub release** of this repo. `./setup.sh` does the same from a terminal (made for Google Cloud Shell) and is the path for developers. It:
1. signs in to Firebase
2. asks for the title, admin email, project and region, and saves the answers to `book.config.json` right away
3. uses a project the author created in the Firebase console, chosen from `projects:list`. Creating it there is how the author accepts Firebase's terms; `projects:create` from the CLI fails with a 403 for accounts that haven't. It then creates the `(default)` Standard database and a web app, skipping whatever already exists.
4. generates its own settings files, all git-ignored, so `git pull` never conflicts:

   | File | What it holds | Deployed? |
   |---|---|---|
   | `site.json` | `{ownerEmailHash, version}`: SHA-256 of the lowercased owner email, and the Galleyleaf version (`git describe --tags`) | Yes, read by `js/auth.js` and `js/site-version.js` |
   | `firestore.deploy.rules` | `firestore.rules` with `__OWNER_EMAIL__` filled in | Deployed as the rules |
   | `firebase.deploy.json` | `firebase.json` with the title, support email and the generated rules path | No, it's the deploy config |

5. deploys auth, rules and hosting with `--config firebase.deploy.json`, and a release message that records the settings as JSON: `{"galleyleaf": "<version>", "title", "ownerEmail", "location"}`. The setup page reads the latest release's message to recognise a Galleyleaf site and prefill its update form, so **both must keep writing it in this shape**. Both also write `version` into `site.json`.

**Merging to `main`:** always squash a branch into one commit (`git merge --squash`, or squash and merge on a pull request), so `main` gets one commit per change.

**Releasing a version:** tag `main` as `vX.Y.Z` and publish a GitHub release (`gh release create vX.Y.Z --generate-notes`). Authors get it the next time they click **Update my site** on the setup page. Keep `firebase.json`'s `hosting.ignore` and `headers` simple globs: the setup page reads them to decide which files to upload.

**Other runs:**
- **Running it again redeploys with the saved answers.** Updating is `git pull && ./setup.sh`.
- **`--dry-run`** shows the steps without changing anything.
- **`--reconfigure`** asks the questions again.

**The deployed site needs no config file.** `js/firebase.js` reads the web config from Firebase Hosting's reserved `/__/firebase/init.json`. `js/firebase-config.js` is only a fallback for local previews.

```bash
# Local preview (localhost is an authorized sign-in domain)
python3 -m http.server 8000

# UI tests
tests/run-ui-tests.sh

# Check that the rules compile (any project you can access)
npx -y firebase-tools@latest deploy --only firestore:rules --dry-run --project <id>
```

Hosting serves the project root and ignores:
- the deploy settings: `firebase.json`, `firebase.deploy.json`, `firestore.rules` and `firestore.deploy.rules`
- `setup.sh` and `book.config.json`
- manuscripts and drafts anywhere: `**/*.md`, `.markdown`, `.docx`, `.doc`, `.odt`, `.rtf`, `.pdf`
- `**/*.log`, such as `firebase-debug.log`
- the docs: `CLAUDE.md`, `README.md` and `LICENSE`
- `tests/**`, `docs/**` and dotfiles

`site.json` is deployed on purpose. Check this list when you add files that shouldn't go live.

## Testing

`tests/run-ui-tests.sh` runs 56 checks in a real browser with `playwright-cli`. It needs `python3` and `playwright-cli`. The checks cover:
- sign-in (including a reader's first sign-in), and removed and restored access
- both reading views
- comments (including the daily limit), bookmarks and chapter completion
- the account menu, and removing the published book
- the version footer and the update notice (GitHub's API is answered by the test)
- the admin page, including a first sign-in that happens there
- reading a `.docx` on the publish page (`tests/fixtures/sample-book.docx`, made from the sample manuscript with `pandoc`)
- waiting for the security rules right after setup
- the security headers: every HTML page is served with the CSP from `firebase.json`, and any violation fails

The test swaps the gstatic Firebase files for the mock in `tests/mock/`, which builds the book from `tests/fixtures/sample-book.md`, a short original sample manuscript. It keeps users and comments in memory and runs no security rules, so it never touches the real project. The mock's test hooks are:
- `localStorage["mock:approved"] = "0"` simulates a reader whose access was removed.
- `window.__approve()` restores access live.
- `localStorage["mock:fresh"] = "1"` starts with no profile, as on a first sign-in. Like Firestore, the new profile first reaches the listener as a pending local write and is confirmed 400 ms later; until then the book can't be read, as the rules can't see the profile yet.
- `localStorage["mock:notReady"] = "N"` refuses the first N profile reads with `permission-denied`, as before new rules arrive.
- `localStorage["mock:quotaUsed"] = "N"` starts the reader's daily comment count at N.
- `localStorage["mock:noBook"] = "1"` means no book is published. Removing the book on the publish page sets it.

When you change UI labels or ids, update `tests/ui-checks.js`. The security rules themselves are untested; the Firebase Emulator Suite would be the way to test them.

## Files

| Path | Purpose |
|---|---|
| `index.html`, `css/styles.css` | App shell, SVG icon sprite, all views and styles |
| `icon.svg`, `apple-touch-icon.png` | Site icon (favicon) and the 180px home-screen icon, linked from all three pages |
| `js/app.js` | Access gate, hash routing (`#/`, `#/read/{chapterId}/{p}`), library, theme and text size |
| `js/auth.js` | Google sign-in (popup with redirect fallback), profile creation, access watcher |
| `js/book.js` | Loads `book/meta` and chapters, cached in memory and `sessionStorage` |
| `js/reader.js` | Both reading views, bookmarks, comment sheet, chapter completion |
| `js/comments.js` | Comment reads and writes |
| `js/account-menu.js` | The avatar menu shared by the reader and the admin pages |
| `js/theme.js` | Light and dark theme, shared by the reader and the admin pages |
| `js/site-version.js` | The admin pages' version footer and update notice |
| `js/storage.js` | `localStorage` progress, bookmarks and preferences |
| `js/celebrate.js` | Confetti animation |
| `js/md-parser.js` | Turns `book.md` into sections and paragraphs (used by the upload page and the test mock) |
| `js/docx-parser.js` | Turns a Word `.docx` into the same sections and paragraphs (used by the upload page) |
| `js/firebase.js`, `js/firebase-config.js` | Firebase init (config from Hosting's `init.json`; the file is a local-preview fallback) |
| `setup.sh` | Creates, configures and deploys an author's project (see Setup and deploy) |
| `admin/index.html`, `admin/admin.js` | Readers (remove or restore access) and all comments |
| `admin/upload.html`, `admin/upload.js` | Publishes `book.md` or a `.docx` to Firestore |
| `css/admin.css` | Styles shared by the admin pages |
| `firestore.rules`, `firebase.json` | Security rules; hosting, auth and Firestore config |
| `tests/` | Mock Firebase SDK, sample manuscript, UI checks and runner |
| `README.md`, `LICENSE` | Setup guide for authors; AGPL-3.0 license |

## Design

- **Look:** dawn-blue paper, indigo ink and a gold star accent.
- **Icon:** an open book shaped like a leaf (the spine is the midrib) with a gold stem, on an indigo tile. Inside the pages the same leaf is the logo: the `i-leaf` sprite symbol (ink leaf, `--leaf-stem` gold stem) marks the top-bar brand, the sign-in screen, the loading pulse and the access-paused orbit. Gold stars stay as the accent inside the book: the progress marker, scene breaks and the completion confetti. With no book title, pages say "Galleyleaf Reader". `apple-touch-icon.png` is `icon.svg` with square corners, since phones round them, rendered at 180px.
- **Typefaces:** Spectral for reading text and Instrument Sans for the UI.
- **Colours:** colour tokens live on `:root` in `css/styles.css`, with light and dark themes.
- **Layout:** mobile-first, with breakpoints at 600px and 960px.
- **Accessibility:** touch targets are at least 44px, and reduced motion is respected.
