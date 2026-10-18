#!/usr/bin/env bash
# Galleyleaf setup: configures your Firebase project and deploys your book site.
# Create the project first at https://console.firebase.google.com (that's also
# where you accept Firebase's terms). Made for Google Cloud Shell; it also works
# on any computer with Node.js.
#
#   ./setup.sh               first run: asks a few questions, then sets everything up
#   ./setup.sh               later runs: redeploys with your saved settings (use after updating)
#   ./setup.sh --reconfigure ask the questions again
#   ./setup.sh --dry-run     show what would be created or deployed, without changing anything
#
# Your answers are saved in book.config.json. That file and the other generated
# files (site.json, firebase.deploy.json, firestore.deploy.rules) are git-ignored,
# so `git pull` never conflicts with them.
set -euo pipefail

cd "$(dirname "$0")"

FB=(npx -y firebase-tools@latest)
CONFIG=book.config.json
DRY_RUN=0
RECONFIGURE=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --reconfigure) RECONFIGURE=1 ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)"; exit 1 ;;
  esac
done

# ---------- Output helpers ----------

bold=$'\e[1m'; dim=$'\e[2m'; green=$'\e[32m'; red=$'\e[31m'; reset=$'\e[0m'
step() { printf '\n%s▸ %s%s\n' "$bold" "$1" "$reset"; }
info() { printf '  %s\n' "$1"; }
ok()   { printf '  %s✓%s %s\n' "$green" "$reset" "$1"; }
fail() { printf '\n%s✗ %s%s\n' "$red" "$1" "$reset" >&2; [ $# -gt 1 ] && printf '  %s\n' "${@:2}" >&2; exit 1; }

# Ask a question with an optional default. Usage: ask VAR "Question" "default"
ask() {
  local __var=$1 __q=$2 __def=${3:-} __ans
  if [ -n "$__def" ]; then read -r -p "  $__q [$__def]: " __ans; else read -r -p "  $__q: " __ans; fi
  printf -v "$__var" '%s' "${__ans:-$__def}"
}

# Run a command that changes something (skipped in --dry-run).
run() {
  if [ "$DRY_RUN" = 1 ]; then printf '  %s[dry run] %s%s\n' "$dim" "$*" "$reset"; return 0; fi
  "$@"
}

# Read a value from JSON on stdin. Usage: echo "$json" | json 'j.result.length'
json() {
  node -e '
    let d = "";
    process.stdin.on("data", (c) => (d += c)).on("end", () => {
      let j; try { j = JSON.parse(d); } catch { process.exit(0); }
      let v; try { v = new Function("j", "return (" + process.argv[1] + ")")(j); } catch { v = ""; }
      process.stdout.write(v == null ? "" : String(v));
    });' "$1"
}

# ---------- 0. Requirements ----------

step "Checking requirements"
command -v node >/dev/null || fail "Node.js isn't installed." "Run this in Google Cloud Shell (shell.cloud.google.com), where it's already installed."
for f in firebase.json firestore.rules index.html; do
  [ -f "$f" ] || fail "Run this from the galleyleaf folder ($f is missing)."
done
ok "Node.js $(node --version)"
info "The first Firebase command can take a minute while the Firebase tools download."

# ---------- 1. Sign in to Firebase ----------

step "Signing in to Firebase"
account=$("${FB[@]}" login:list --json 2>/dev/null | json 'j.result && j.result[0] && j.result[0].user.email' || true)
if [ -z "$account" ]; then
  [ "$DRY_RUN" = 1 ] && fail "Not signed in to Firebase." "Run ./setup.sh without --dry-run once to sign in."
  if [ "${CLOUD_SHELL:-}" = "true" ]; then
    info "Open the link below, choose your Google account, and paste the code back here."
    "${FB[@]}" login --no-localhost
  else
    "${FB[@]}" login
  fi
  account=$("${FB[@]}" login:list --json 2>/dev/null | json 'j.result && j.result[0] && j.result[0].user.email' || true)
  [ -n "$account" ] || fail "Firebase sign-in didn't finish." "Run ./setup.sh again."
fi
ok "Signed in as $account"

# ---------- 2. Settings ----------

title="" ; owner="" ; project="" ; location=""
if [ -f "$CONFIG" ] && [ "$RECONFIGURE" = 0 ]; then
  step "Using your saved settings ($CONFIG)"
  title=$(json 'j.title' < "$CONFIG")
  owner=$(json 'j.ownerEmail' < "$CONFIG")
  project=$(json 'j.projectId' < "$CONFIG")
  location=$(json 'j.location' < "$CONFIG")
  [ -n "$project" ] && [ -n "$owner" ] && [ -n "$title" ] || fail "$CONFIG is incomplete." "Run ./setup.sh --reconfigure"
  info "Book: $title"
  info "Project: $project"
  info "Admin: $owner"
else
  step "A few questions about your book"
  info "Press Enter to accept the suggestion in [brackets]."
  echo
  while :; do
    ask title "Book title"
    title=$(printf '%s' "$title" | tr -d '"\\' | cut -c1-100)
    [ -n "$title" ] && break
    info "Please enter a title."
  done

  while :; do
    ask owner "Admin email (you'll manage readers and comments with it)" "$account"
    owner=$(printf '%s' "$owner" | tr '[:upper:]' '[:lower:]')
    [[ "$owner" =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$ ]] && break
    info "That doesn't look like an email address."
  done

  echo
  info "Which Firebase project is this book for?"
  info "Create it first at https://console.firebase.google.com if you haven't (see README.md)."
  projects=$("${FB[@]}" projects:list --json 2>/dev/null \
    | json '(j.result || []).map((p) => p.projectId + "  " + (p.displayName || "")).join("\n")' || true)
  default_project=""
  if [ -n "$projects" ]; then
    echo
    printf '%s\n' "$projects" | nl -w4 -s'. '
    echo
    [ "$(printf '%s\n' "$projects" | wc -l)" -eq 1 ] && default_project=1
    info "A project you just created can take a minute to appear. You can also type its id."
  else
    info "No projects found yet for $account. A new project can take a minute to appear; you can type its id."
  fi
  while :; do
    ask choice "Project number or id" "$default_project"
    if [[ "$choice" =~ ^[0-9]+$ ]] && [ -n "$projects" ]; then
      project=$(printf '%s\n' "$projects" | sed -n "${choice}p" | awk '{print $1}')
    else
      project=$choice
    fi
    [[ "$project" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] && break
    info "Enter a number from the list, or a project id like my-novel-draft."
  done

  echo
  info "Where should your data be stored? Pick a region near your readers, for example:"
  info "  us-central1 (USA)   europe-west1 (Belgium)   southamerica-east1 (São Paulo)   asia-northeast1 (Tokyo)"
  info "Full list: npx -y firebase-tools@latest firestore:locations"
  ask location "Region" "us-central1"

  # Save the answers now, so a rerun after a failure continues with the same project.
  if [ "$DRY_RUN" = 0 ]; then
    TITLE="$title" OWNER="$owner" PROJECT="$project" LOCATION="$location" node -e '
      const e = process.env;
      require("fs").writeFileSync("book.config.json", JSON.stringify(
        { title: e.TITLE, ownerEmail: e.OWNER, projectId: e.PROJECT, location: e.LOCATION }, null, 2) + "\n");'
    ok "Saved your answers to $CONFIG"
  fi
fi

# ---------- 3. Firebase project ----------

step "Firebase project"
"${FB[@]}" apps:list WEB --project "$project" --json >/dev/null 2>&1 \
  || fail "Can't open the Firebase project \"$project\" as $account." \
    "- Create it at https://console.firebase.google.com with this same Google account." \
    "- Check the id: it's shown under the project name in the console (Project settings)." \
    "- If you just created it, wait a minute and run ./setup.sh again." \
    "- To choose a different project, run ./setup.sh --reconfigure"
ok "Using project $project"

# ---------- 4. Database ----------

step "Database"
db_location=$("${FB[@]}" firestore:databases:list --project "$project" --json 2>/dev/null \
  | json '(j.result || []).filter((d) => d.name.endsWith("/(default)")).map((d) => d.locationId)[0]' || true)
if [ -n "$db_location" ]; then
  ok "Database exists in $db_location"
else
  info "Creating the database in $location..."
  run "${FB[@]}" firestore:databases:create "(default)" --location="$location" --project "$project" --non-interactive \
    || fail "The database couldn't be created." "Check that \"$location\" is a valid region (npx -y firebase-tools@latest firestore:locations), then run ./setup.sh --reconfigure."
  ok "Database created in $location"
fi

# ---------- 5. Web app ----------

step "Web app"
app_count=$("${FB[@]}" apps:list WEB --project "$project" --json 2>/dev/null | json '(j.result || []).length' || true)
if [ "${app_count:-0}" -gt 0 ]; then
  ok "Web app already registered"
else
  run "${FB[@]}" apps:create WEB "Galleyleaf site" --project "$project" --non-interactive >/dev/null \
    || fail "The web app couldn't be registered." "Run ./setup.sh again."
  ok "Web app registered"
fi

# ---------- 6. Your settings files ----------

step "Writing your settings"
if [ "$DRY_RUN" = 1 ]; then
  info "[dry run] would write book.config.json, site.json, firestore.deploy.rules and firebase.deploy.json"
else
  TITLE="$title" OWNER="$owner" PROJECT="$project" LOCATION="$location" ACCOUNT="$account" node -e '
    const fs = require("fs");
    const { TITLE, OWNER, PROJECT, LOCATION, ACCOUNT } = process.env;
    fs.writeFileSync("book.config.json", JSON.stringify(
      { title: TITLE, ownerEmail: OWNER, projectId: PROJECT, location: LOCATION }, null, 2) + "\n");
    fs.writeFileSync("site.json", JSON.stringify({ ownerEmail: OWNER }) + "\n");
    const rules = fs.readFileSync("firestore.rules", "utf8");
    if (!rules.includes("__OWNER_EMAIL__")) throw new Error("firestore.rules has no __OWNER_EMAIL__ placeholder");
    fs.writeFileSync("firestore.deploy.rules", rules.replaceAll("__OWNER_EMAIL__", OWNER));
    const cfg = JSON.parse(fs.readFileSync("firebase.json", "utf8"));
    cfg.firestore.rules = "firestore.deploy.rules";
    cfg.auth.providers.googleSignIn.oAuthBrandDisplayName = TITLE.slice(0, 100);
    cfg.auth.providers.googleSignIn.supportEmail = ACCOUNT;
    fs.writeFileSync("firebase.deploy.json", JSON.stringify(cfg, null, 2) + "\n");
  '
  ok "Saved book.config.json, site.json, firestore.deploy.rules and firebase.deploy.json"
fi

# ---------- 7. Deploy ----------

step "Deploying your site"
info "Google sign-in, security rules and the website. This takes a minute or two."
run "${FB[@]}" deploy --only auth,firestore:rules,hosting --config firebase.deploy.json --project "$project" --non-interactive \
  || fail "The deploy didn't finish." "Scroll up for the error, then run ./setup.sh again. It picks up where it left off."

# ---------- Done ----------

site="https://$project.web.app"
if [ "$DRY_RUN" = 1 ]; then
  printf '\n%sDry run finished. Nothing was created or deployed.%s\n' "$bold" "$reset"
  info "Run ./setup.sh without --dry-run to set up $site"
  exit 0
fi
printf '\n%s✓ Your book site is ready: %s%s\n' "$green$bold" "$site" "$reset"
cat <<EOF

  Next steps:
  1. Open $site and sign in with $owner.
     You'll be the admin automatically.
  2. Publish your manuscript: $site/admin/upload.html
  3. Share $site with your readers.
     Manage readers and read their comments at $site/admin/

  To update Galleyleaf later, run this in this folder:
     git pull && ./setup.sh

  If you signed in to the site before running this setup, your account was
  created without admin rights. Set "admin" to true on your users document
  in the Firebase console (Firestore Database).
EOF
