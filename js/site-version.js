// The admin pages' version line: which Galleyleaf release this site runs, and
// a notice with a link to the setup page when a newer one is out.
// Setup writes the deployed version to /site.json; the latest release comes
// from GitHub's public API and is cached for a few hours.

export const SETUP_URL = "https://galleyleaf.web.app/setup/";
const LATEST_URL = "https://api.github.com/repos/galleyleaf/galleyleaf/releases/latest";
const CACHE_KEY = "galleyleaf:latestRelease";
const CACHE_MS = 6 * 60 * 60 * 1000;

const $ = (id) => document.getElementById(id);

async function siteVersion() {
  try {
    const res = await fetch("/site.json", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()).version || null;
  } catch {
    return null;
  }
}

async function latestRelease() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (cached && Date.now() - cached.at < CACHE_MS) return cached;
  } catch {
    /* ignore */
  }
  try {
    const res = await fetch(LATEST_URL, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return null;
    const { tag_name: tag, html_url: url } = await res.json();
    const release = { tag, url, at: Date.now() };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(release));
    } catch {
      /* ignore */
    }
    return release;
  } catch {
    return null;
  }
}

// "v0.2.1" or "v0.2.1-3-gabc123" (a checkout past a tag) -> [0, 2, 1]
function parse(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version || "");
  return m ? m.slice(1).map(Number) : null;
}

function isNewer(latest, current) {
  const a = parse(latest);
  const b = parse(current);
  if (!a) return false;
  if (!b) return true;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Fills #update-notice and #site-version. Call once the user is an admin. */
export async function showSiteVersion() {
  const [current, latest] = await Promise.all([siteVersion(), latestRelease()]);
  const outdated = latest && isNewer(latest.tag, current);

  $("update-notice").hidden = !outdated;
  if (outdated) {
    $("update-latest").textContent = `Galleyleaf ${latest.tag}`;
    $("update-current").textContent = current ? `runs ${current}` : "runs an earlier version";
    $("update-notes").href = latest.url;
  }

  $("site-version-text").textContent =
    (current ? `Galleyleaf ${current}.` : "Galleyleaf, an earlier version.") +
    (latest && !outdated ? " You have the latest version." : "");
  $("site-version").hidden = false;
}
