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
- **An author's manuscript (`book.md`) is never deployed or committed here.** Readers get the text from Firestore, where security rules protect it.
- **Run the UI tests after changes and before deploying** (see Testing).
- **It must run on Firebase's free Spark plan.** Authors deploy into their own accounts at no cost. Don't add anything that needs Blaze (Cloud Functions included) or another paid cloud service.
- **No personal or project-specific data in this repo.** No real Firebase config, emails or manuscripts. `js/firebase-config.js` and `firebase.json` keep their `REPLACE_ME` placeholders.

## Product decisions

- **Access:** a reader signs in with Google, and `users/{uid}` is created with `approved: true`, so anyone with a Google account can read. The rules only allow profile creation through verified Google sign-in, and `photoURL` must be empty or a `https://lh3.googleusercontent.com/` URL.
  - **Removing access:** an admin removes it from `/admin/` ("Remove access"), or by setting `approved: false` in the console.
  - **What a removed reader sees:** an "access paused" screen.
  - **Restoring access:** "Approve" turns it back on, and the screen switches to the library live, with no reload.
- **Admins:** `admin: true` is set only in the Firebase console. Admins can:
  - read all profiles
  - change only the `approved` flag
  - read every reader's comments, and delete any of them (spam cleanup)
  - publish the book
- **Comments:**
  - Each comment is stored per paragraph at `users/{uid}/comments`.
  - Only its author and admins can read it.
  - Only the author can create or edit it, and only while approved. The author or an admin can delete it.
  - The comment icon changes colour when the paragraph has comments.
- **Book text:** stored in Firestore and readable only by approved users. Admins publish it from `/admin/upload.html`, which parses `book.md` in the browser.
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
- **Caching:** JS and CSS are served with `Cache-Control: no-cache`, so deploys show up immediately.

## Data model (Firestore)

| Path | Fields | Access |
|---|---|---|
| `users/{uid}` | `displayName`, `email`, `photoURL`, `approved`, `admin`, `createdAt` | Owner creates it once, with `approved: true` and `admin: false`. Owner and admins can read it. Admins can update `approved` only. |
| `users/{uid}/comments/{id}` | `chapterId`, `paragraphIndex`, `text` (≤ 2000 chars), `createdAt`, `updatedAt` | Owner reads and writes while approved. Admins read through a collection-group query. |
| `book/meta` | `title`, `author`, `dedication`, `chapters[{id,title,order,paragraphCount}]`, `updatedAt` | Approved users can read it. Admins can write it. |
| `chapters/{id}` | `title`, `order`, `paragraphs[]` (HTML with only `<em>` and `<strong>`), `breaks[]` | Approved users and admins can read it. Admins can write it. |

## Book format (`book.md`)

- YAML front matter supplies `title` and `author`. A `::: {.dedication}` block is shown in the library unless it is a `[PLACEHOLDER]`.
- Each `# Heading` starts a section, and its id is a slug of the heading (`chapter-1`, `epilogue`). Sections that are still `[PLACEHOLDER]` text are skipped.
- A blank line separates paragraphs. A `---` line marks a scene break. `_x_` or `*x*` makes italics, and `**x**` makes bold.
- After editing the book, republish it from `/admin/upload.html`.

## Commands

```bash
# Local preview (localhost is an authorized sign-in domain)
python3 -m http.server 8000

# UI tests
tests/run-ui-tests.sh

# Deploy
npx -y firebase-tools@latest deploy --only firestore:rules --dry-run   # check rules compile
npx -y firebase-tools@latest deploy --only firestore:rules,hosting
npx -y firebase-tools@latest deploy --only auth                        # Google sign-in settings
```

Hosting serves the project root and ignores `firebase.json`, `firestore.rules`, `book.md`, `CLAUDE.md`, `tests/**`, `docs/**` and dotfiles. Check that list when you add files that shouldn't go live.

## Testing

`tests/run-ui-tests.sh` runs 32 checks in a real browser with `playwright-cli`. It needs `python3` and `playwright-cli`. The checks cover:
- sign-in, and removed and restored access
- both reading views
- comments, bookmarks and chapter completion
- the admin page

The test swaps the gstatic Firebase files for the mock in `tests/mock/`, which builds the book from `tests/fixtures/sample-book.md`, a short original sample manuscript. It keeps users and comments in memory and runs no security rules, so it never touches the real project. The mock's test hooks are:
- `localStorage["mock:approved"] = "0"` simulates a reader whose access was removed.
- `window.__approve()` restores access live.

When you change UI labels or ids, update `tests/ui-checks.js`. The security rules themselves are untested; the Firebase Emulator Suite would be the way to test them.

## Files

| Path | Purpose |
|---|---|
| `index.html`, `css/styles.css` | App shell, SVG icon sprite, all views and styles |
| `js/app.js` | Access gate, hash routing (`#/`, `#/read/{chapterId}/{p}`), library, theme and text size |
| `js/auth.js` | Google sign-in (popup with redirect fallback), profile creation, access watcher |
| `js/book.js` | Loads `book/meta` and chapters, cached in memory and `sessionStorage` |
| `js/reader.js` | Both reading views, bookmarks, comment sheet, chapter completion |
| `js/comments.js` | Comment reads and writes |
| `js/storage.js` | `localStorage` progress, bookmarks and preferences |
| `js/celebrate.js` | Confetti animation |
| `js/md-parser.js` | Turns `book.md` into sections and paragraphs (used by the upload page and the test mock) |
| `js/firebase.js`, `js/firebase-config.js` | Firebase init and web app config |
| `admin/index.html`, `admin/admin.js` | Readers (remove or restore access) and all comments |
| `admin/upload.html`, `admin/upload.js` | Publishes `book.md` to Firestore |
| `css/admin.css` | Styles shared by the admin pages |
| `firestore.rules`, `firebase.json` | Security rules; hosting, auth and Firestore config |
| `tests/` | Mock Firebase SDK, sample manuscript, UI checks and runner |
| `README.md`, `LICENSE` | Setup guide for authors; AGPL-3.0 license |

## Design

- **Look:** dawn-blue paper, indigo ink and a gold star accent.
- **Typefaces:** Spectral for reading text and Instrument Sans for the UI.
- **Colours:** colour tokens live on `:root` in `css/styles.css`, with light and dark themes.
- **Layout:** mobile-first, with breakpoints at 600px and 960px.
- **Accessibility:** touch targets are at least 44px, and reduced motion is respected.

## Roadmap

- **A guided setup:** an "Open in Cloud Shell" button and a `setup.sh` script will create and configure an author's Firebase project in one step.
  - The author will become admin automatically.
  - Until then, authors follow the manual steps in `README.md`.
- **The Galleyleaf mobile app:** it will let readers open approved books from their phone.
  - Each book's site will gain a `reader.json`, an app sign-in page, and an "Available in the app" switch on the admin page.
