# Galleyleaf

Share your book with a few chosen readers before it's published, and get their feedback paragraph by paragraph.

Galleyleaf is a small website that you deploy into your own free Firebase project. Your readers sign in with Google and read on their phone or computer, one paragraph at a time or as a scrolling chapter. They can leave a private note on any paragraph, and you see every note in one place.

- **Your book stays yours.** It lives in your own Firebase project, and only signed-in readers you allow can open it.
- **Feedback per paragraph.** Readers tap a paragraph to comment. You read all comments, filtered by chapter or reader, on your admin page.
- **Made for reading.** It works well on phones and offers two reading views, light and dark themes, adjustable text size, bookmarks and saved progress.
- **Discourages casual copying.** Text can't be selected, copied or printed from the reader.
- **Free to run.** Everything fits in Firebase's free Spark plan, and there's no billing to set up.

Setup takes about 10 minutes in your browser: create a project on the Firebase website, then let the [Galleyleaf setup page](https://galleyleaf.web.app/setup) do the rest. You don't need to install anything. A Galleyleaf phone app for readers is on the way.

## What you need

- A Google account with 2-Step Verification turned on (Firebase requires it). Your book's Firebase project will belong to it.
- Your manuscript as a Word file (`.docx`) or a Markdown file (`.md`). See [Preparing your manuscript](#preparing-your-manuscript).

## Set up your book site

### 1. Create your Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com/) and sign in with the Google account you'll manage the book with.
   - **Firebase requires 2-Step Verification** on your Google account. If it isn't on, Firebase asks you to turn it on first, or you can do it ahead of time at [myaccount.google.com/signinoptions/twosv](https://myaccount.google.com/signinoptions/twosv). It takes a couple of minutes and uses your phone.
2. Click **Create a project** and give it a name, for example your book's title.
   - **The project id** is shown under the name. It becomes your site address (`<id>.web.app`) and can't be changed later. Click it to edit it if you like.
3. **Accept the Firebase terms** when asked.
4. **Turn off Google Analytics** when asked. Galleyleaf doesn't use it.
5. Click **Create project** and wait until it's ready.
   - It's created on the free Spark plan, and you don't need to upgrade.

### 2. Run the setup page

1. **Open [galleyleaf.web.app/setup](https://galleyleaf.web.app/setup)** and sign in with the same Google account.
   - Google asks you to let Galleyleaf manage your Firebase projects. That's how the page sets up your site for you. It only changes the project you choose, it works from your browser, and the access expires after an hour.
   - Google may say the app hasn't been verified yet. Choose **Advanced**, then **Go to galleyleaf.firebaseapp.com**.
2. **Choose your project**, then check the book title, the admin email and where to keep your data.
3. **Click "Set up my book"** and wait for the checklist to finish. It ends with your site's address.

### 3. Start sharing

1. **Open your site and sign in** with your admin email. You're the admin automatically.
2. **Publish your book** at `https://<your-project>.web.app/admin/upload.html`. Choose your manuscript file, check the chapter preview, and click **Publish to readers**. Do this again whenever you revise the book.
3. **Share the site address** with your readers. Anyone who signs in with Google can read, unless you remove them.

From `https://<your-project>.web.app/admin/` you can:
- see who has signed in, and remove or restore anyone's access
- read every comment, filtered by chapter or reader, and delete spam

**If something goes wrong:**
- **Setup stops with an error.** Read the message: it says what to do. Then click **Try again**; it picks up where it stopped.
- **Your project isn't listed.** Make sure you created it with the same Google account you signed in with. A brand-new project can take a minute: click **Look again**.
- **You signed in to your site before running setup.** Your account was created without admin rights. In the [Firebase console](https://console.firebase.google.com/), open **Firestore Database** › `users`, find your email and set `admin` to `true`.
- **You want to remove Galleyleaf's access.** Go to your [Google account's third-party connections](https://myaccount.google.com/connections). Your site keeps working.

## Preparing your manuscript

Galleyleaf reads a Word file (`.docx`) or a Markdown file (`.md`).

### Word or Google Docs

Save or download the manuscript as `.docx` (in Google Docs: **File › Download › Microsoft Word**). Galleyleaf follows the paragraph styles:

- **Chapters:** each paragraph in the **Heading 1** style starts a chapter. Text before the first one, such as a title page, is skipped.
- **Title and author:** the paragraph in the **Title** style is the book's title. A **Subtitle** such as "by Jane Doe" gives the author. Without them, the document's title and author properties are used.
- **Dedication:** a Heading 1 called "Dedication" makes the text under it the dedication.
- **Scene breaks:** a paragraph of only `***`, `* * *` or `#`, or a horizontal line.
- **Formatting:** italic and bold are kept. Other formatting, images, footnotes and comments are left out.
- **Unfinished sections:** a section whose text is still `[PLACEHOLDER]` is skipped.

Old `.doc` files need to be saved as `.docx` first.

### Markdown

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

Open the [setup page](https://galleyleaf.web.app/setup) again, sign in and choose the same project. It recognises your site, shows its version, and offers **Update my site**. Your book, your readers and their notes stay as they are.

## Costs and limits

- **The free Spark plan is enough** for a group of early readers. Don't upgrade the project to the paid Blaze plan; Galleyleaf doesn't need it.
- **If the free daily limits are reached** (tens of thousands of reads or writes, for example from comment spam), the site stops saving until the next day. Nothing is charged.
- **Copy protection only stops casual copying.** A determined reader can still take screenshots.

## For developers

- **No build step.** It's plain HTML, CSS and JavaScript, with the Firebase JS SDK loaded from Google's CDN.
- **Security rules:** `firestore.rules`.
- **UI tests:** `tests/run-ui-tests.sh` runs them in a real browser against a mocked Firebase and the sample manuscript. It needs `python3` and `playwright-cli`.
- **Project conventions:** `CLAUDE.md`.

### Set up from a terminal

`setup.sh` does what the setup page does, with the Firebase CLI. It needs `node` and `git`; [Google Cloud Shell](https://shell.cloud.google.com/) has both:

[![Open in Cloud Shell](https://www.gstatic.com/cloudssh/images/open-btn.svg)](https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https://github.com/galleyleaf/galleyleaf&cloudshell_workspace=.)

```bash
./setup.sh               # signs in to Firebase, asks a few questions, then deploys
./setup.sh --dry-run     # shows the steps without changing anything
./setup.sh --reconfigure # asks the questions again, for example to pick another project
git pull && ./setup.sh   # updates to the latest version
```

Your answers are saved in `book.config.json`. It and the other generated files are git-ignored, so `git pull` never conflicts. Sites set up either way can be updated either way.

## License

[GNU Affero General Public License v3.0](LICENSE). You're free to use, modify and deploy Galleyleaf. If you run a modified version for others, you must make your modified source code available to its users.
