# Galleyleaf

Share your book with a few chosen readers before it's published, and get their feedback paragraph by paragraph.

Galleyleaf is a small website that you deploy into your own free Firebase project. Your readers sign in with Google and read on their phone or computer, one paragraph at a time or as a scrolling chapter. They can leave a private note on any paragraph, and you see every note in one place.

- **Your book stays yours.** It lives in your own Firebase project, and only signed-in readers you allow can open it.
- **Feedback per paragraph.** Readers tap a paragraph to comment. You read all comments, filtered by chapter or reader, on your admin page.
- **Made for reading.** It works well on phones and offers two reading views, light and dark themes, adjustable text size, bookmarks and saved progress.
- **Discourages casual copying.** Text can't be selected, copied or printed from the reader.
- **Free to run.** Everything fits in Firebase's free Spark plan, and there's no billing to set up.

> A one-click setup and a Galleyleaf phone app are on the way. Until then, follow the steps below. They take about 20 minutes, and you don't need to install anything on your computer.

## What you need

- A Google account. Your book's Firebase project will belong to it.
- Your manuscript as a Markdown file (`.md`). See [Preparing your manuscript](#preparing-your-manuscript).

## Set up your book site

All the steps run in **Google Cloud Shell**, a free terminal in your browser with the tools already installed.

### 1. Open Cloud Shell with this project

Go to [shell.cloud.google.com](https://shell.cloud.google.com/) and sign in with your Google account. Then paste this into the terminal and press Enter:

```bash
git clone https://github.com/galleyleaf/galleyleaf.git && cd galleyleaf
```

### 2. Sign in to Firebase

```bash
npx -y firebase-tools@latest login --no-localhost
```

Follow the link it shows, approve the access, and paste the code back into the terminal.

### 3. Create your Firebase project

Pick a project id: 6–30 lowercase letters, numbers and dashes, for example `my-novel-draft`. It becomes part of your site address (`my-novel-draft.web.app`) and can't be changed later.

```bash
PROJECT=my-novel-draft
npx -y firebase-tools@latest projects:create $PROJECT --display-name "My Novel"
npx -y firebase-tools@latest use $PROJECT
```

If this fails with a message about terms of service, open [console.firebase.google.com](https://console.firebase.google.com/), accept the terms once, and run it again.

### 4. Create the database

Choose a location close to your readers, for example `us-central1`, `europe-west1` or `southamerica-east1`. The full list is shown by `npx -y firebase-tools@latest firestore:locations`.

```bash
npx -y firebase-tools@latest firestore:databases:create "(default)" --location=us-central1
```

### 5. Connect the website to your project

```bash
npx -y firebase-tools@latest apps:create WEB "Book site"
npx -y firebase-tools@latest apps:sdkconfig WEB
```

The second command prints a block of settings (`apiKey`, `authDomain`, `projectId` and so on). Open `js/firebase-config.js` in the Cloud Shell editor (the **Open Editor** button) and replace each `REPLACE_ME` value with the matching one.

These values aren't secret. Every Firebase website shares them, and the security rules are what protect your book.

### 6. Set your book title and email

In `firebase.json`, replace:
- `REPLACE_WITH_BOOK_TITLE`: shown to readers on the Google sign-in screen.
- `REPLACE_WITH_YOUR_EMAIL`: the support email on that screen. It must be the Google account you're using.

### 7. Deploy

```bash
npx -y firebase-tools@latest deploy --only auth,firestore:rules,hosting
```

When it finishes, it prints your site address, for example `https://my-novel-draft.web.app`.

### 8. Make yourself the admin

1. Open your site and sign in with Google.
2. In the [Firebase console](https://console.firebase.google.com/), open your project, then **Firestore Database**.
3. Open the `users` collection and the document with your email. Make sure both fields are set:
   - `admin`: `true`
   - `approved`: `true`

### 9. Publish your book

Open `https://<your-project>.web.app/admin/upload.html`. Choose your manuscript file, check the chapter preview, and click **Publish to readers**. Do this again whenever you revise the book.

### 10. Share it

Send your readers the site address. Anyone who signs in with Google can read, unless you remove them.

From `https://<your-project>.web.app/admin/` you can:
- see who has signed in, and remove or restore anyone's access
- read every comment, filtered by chapter or reader, and delete spam

## Preparing your manuscript

Galleyleaf reads a Markdown file. If you write in Word or Google Docs, export to Markdown (for example with [Pandoc](https://pandoc.org/)).

```markdown
---
title: The Lamplighter's Almanac
author: Your Name
---

::: {.dedication}
For everyone who reads a book before it is finished.
:::

# Chapter 1

First paragraph. A blank line starts a new one.

Second paragraph, with _italics_ and **bold**.

---

A line with only three dashes marks a scene break.

# Chapter 2

...
```

- **Front matter:** the block at the top gives the title and author.
- **Chapters:** each `# Heading` starts a chapter.
- **Unfinished sections:** a section whose text is still `[PLACEHOLDER]` is skipped.
- **Example:** see [`tests/fixtures/sample-book.md`](tests/fixtures/sample-book.md).

**Never commit your manuscript to a public repository.** The site never needs it in the code; you upload it from the admin page.

## Updating to a new version

From Cloud Shell, in the `galleyleaf` folder:

```bash
git stash && git pull && git stash pop
npx -y firebase-tools@latest deploy --only firestore:rules,hosting
```

`git stash` keeps your edits to `js/firebase-config.js` and `firebase.json` while the new version is downloaded. A simpler update command is planned.

## Costs and limits

- **The free Spark plan is enough** for a group of early readers. Don't upgrade the project to the paid Blaze plan; Galleyleaf doesn't need it.
- **If the free daily limits are reached** (tens of thousands of reads or writes, for example from comment spam), the site stops saving until the next day. Nothing is charged.
- **Copy protection only stops casual copying.** A determined reader can still take screenshots.

## For developers

- **No build step.** It's plain HTML, CSS and JavaScript, with the Firebase JS SDK loaded from Google's CDN.
- **Security rules:** `firestore.rules`.
- **UI tests:** `tests/run-ui-tests.sh` runs them in a real browser against a mocked Firebase and the sample manuscript. It needs `python3` and `playwright-cli`.
- **Project conventions:** `CLAUDE.md`.

## License

[GNU Affero General Public License v3.0](LICENSE). You're free to use, modify and deploy Galleyleaf. If you run a modified version for others, you must make your modified source code available to its users.
