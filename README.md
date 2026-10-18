# Galleyleaf

Share your book with a few chosen readers before it's published, and get their feedback paragraph by paragraph.

Galleyleaf is a small website that you deploy into your own free Firebase project. Your readers sign in with Google and read on their phone or computer, one paragraph at a time or as a scrolling chapter. They can leave a private note on any paragraph, and you see every note in one place.

- **Your book stays yours.** It lives in your own Firebase project, and only signed-in readers you allow can open it.
- **Feedback per paragraph.** Readers tap a paragraph to comment. You read all comments, filtered by chapter or reader, on your admin page.
- **Made for reading.** It works well on phones and offers two reading views, light and dark themes, adjustable text size, bookmarks and saved progress.
- **Discourages casual copying.** Text can't be selected, copied or printed from the reader.
- **Free to run.** Everything fits in Firebase's free Spark plan, and there's no billing to set up.

Setup takes about 10 minutes in your browser, and you don't need to install anything. A Galleyleaf phone app for readers is on the way.

## What you need

- A Google account. Your book's Firebase project will belong to it.
- Your manuscript as a Markdown file (`.md`). See [Preparing your manuscript](#preparing-your-manuscript).

## Set up your book site

[![Open in Cloud Shell](https://www.gstatic.com/cloudssh/images/open-btn.svg)](https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https://github.com/galleyleaf/galleyleaf&cloudshell_workspace=.)

1. **Click "Open in Cloud Shell"** above and sign in with your Google account.
   - **Cloud Shell** is Google's free terminal in the browser.
   - If it asks whether to trust the repository, confirm. Galleyleaf's files open automatically.
2. **In the terminal at the bottom, run:**

   ```bash
   ./setup.sh
   ```

3. **Answer a few questions:**
   - **Your book's title.**
   - **Your admin email.** Use the Google account you'll manage the book with; the suggestion is the account you're signed in with.
   - **A project id.** It becomes your site address, for example `my-novel-draft.web.app`, and can't be changed later. The suggestion is based on your title.
   - **A region** for your data, near your readers.

   The script signs you in to Firebase (follow the link it shows and paste the code back), creates your project and database, and deploys your site.
4. **Open your site and sign in** with your admin email. You're the admin automatically.
5. **Publish your book** at `https://<your-project>.web.app/admin/upload.html`. Choose your manuscript file, check the chapter preview, and click **Publish to readers**. Do this again whenever you revise the book.
6. **Share the site address** with your readers. Anyone who signs in with Google can read, unless you remove them.

From `https://<your-project>.web.app/admin/` you can:
- see who has signed in, and remove or restore anyone's access
- read every comment, filtered by chapter or reader, and delete spam

**If something goes wrong:**
- **Setup stops with an error.** Read the message: it says what to do. Then run `./setup.sh` again; it skips what's already done.
- **"Firebase couldn't be set up" or "caller does not have permission".** Your Google account probably hasn't accepted Firebase's terms yet. To fix it:
  1. Open [console.firebase.google.com](https://console.firebase.google.com/) with the same account.
  2. Click **Create a project** and accept the terms on the first screen. You can close it after that.
  3. Run `./setup.sh` again. It continues with the same project.
- **You want to see what would happen first.** Run `./setup.sh --dry-run`. It only shows the steps.
- **You want to change your answers.** Run `./setup.sh --reconfigure`.
- **You signed in to your site before running setup.** Your account was created without admin rights. In the [Firebase console](https://console.firebase.google.com/), open **Firestore Database** › `users`, find your email and set `admin` to `true`.

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

Open [Cloud Shell](https://shell.cloud.google.com/), go to the Galleyleaf folder (`cd ~/cloudshell_open/galleyleaf` if you used the button) and run:

```bash
git pull && ./setup.sh
```

Your answers are saved in `book.config.json`, so it just redeploys. Your own settings live in files that `git pull` never touches.

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
