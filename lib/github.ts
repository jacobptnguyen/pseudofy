// Plain erasable TS only: this file is loaded by `node --test` with type stripping.

export type RepoData = {
  tree: string[];
  contents: Record<string, string>;
  omitted: string[];
  truncated: boolean;
};

export type GitHubError = Error & { status: number };

const fail = (message: string, status: number): GitHubError =>
  Object.assign(new Error(message), { status });

export function parseRepoUrl(url: string): { owner: string; repo: string } {
  const s = url
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?github\.com\//i, "");
  const m = s.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/.*)?\/?$/);
  if (!m || m[1].startsWith(".") || m[2].startsWith(".")) {
    throw new Error(
      `Invalid GitHub repo URL: "${url}". Use owner/repo or https://github.com/owner/repo`
    );
  }
  return { owner: m[1], repo: m[2] };
}

const NOISE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "vendor"]);
const LOCKFILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock",
  "Cargo.lock", "poetry.lock", "Gemfile.lock", "composer.lock", "Pipfile.lock",
  "go.sum", "uv.lock", "npm-shrinkwrap.json", "flake.lock", "mix.lock", "Podfile.lock",
]);
const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "icns", "svg", "avif", "tif", "tiff", "psd",
  "woff", "woff2", "ttf", "otf", "eot",
  "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "jar",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "mp4", "mov", "avi", "mkv", "webm", "mp3", "wav", "ogg", "flac", "m4a", "aac",
  "wasm", "exe", "dll", "so", "dylib", "bin", "class", "o", "a", "pyc", "db", "sqlite",
]);

export function isNoise(path: string): boolean {
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  if (parts.slice(0, -1).some((d) => NOISE_DIRS.has(d))) return true;
  if (LOCKFILES.has(name)) return true;
  const dot = name.lastIndexOf(".");
  return dot > 0 && BINARY_EXT.has(name.slice(dot + 1).toLowerCase());
}

// ponytail: fixed char budget; switch to real token counting if large repos get graded unfairly
export function pickFiles(
  blobs: { path: string; size: number }[],
  userPaths: string[],
  budget = 400_000
): { fetch: string[]; omitted: string[] } {
  const wanted = new Set(userPaths);
  const ordered = [...blobs].sort(
    (a, b) => Number(wanted.has(b.path)) - Number(wanted.has(a.path)) || a.size - b.size
  );
  const fetch: string[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const b of ordered) {
    if (used + b.size <= budget) {
      fetch.push(b.path);
      used += b.size;
    } else {
      omitted.push(b.path);
    }
  }
  return { fetch, omitted };
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export async function fetchRepo(owner: string, repo: string, userPaths: string[]): Promise<RepoData> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const api = async (path: string) => {
    const res = await fetch(`https://api.github.com/repos/${enc(owner)}/${enc(repo)}${path}`, { headers });
    if (res.status === 404) throw fail("Repo not found or private", 404);
    if (res.status === 403 || res.status === 429) throw fail("GitHub rate limit hit, try again later", 429);
    if (res.status === 409) throw fail("Repo is empty", 400);
    if (!res.ok) throw fail(`GitHub API error ${res.status}`, 502);
    return res.json();
  };

  const { default_branch: branch } = await api("");
  const treeRes = await api(`/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const blobs: { path: string; size: number }[] = treeRes.tree
    .filter((e: { type: string; path: string }) => e.type === "blob" && !isNoise(e.path))
    .map((e: { path: string; size?: number }) => ({ path: e.path, size: e.size ?? 0 }));

  const { fetch: toFetch, omitted } = pickFiles(blobs, userPaths);
  const contents: Record<string, string> = {};
  let next = 0;
  const worker = async () => {
    while (next < toFetch.length) {
      const path = toFetch[next++];
      try {
        const res = await fetch(
          `https://raw.githubusercontent.com/${enc(owner)}/${enc(repo)}/${enc(branch)}/${enc(path)}`,
          { headers: process.env.GITHUB_TOKEN ? { Authorization: headers.Authorization } : {} }
        );
        if (!res.ok) throw new Error();
        contents[path] = await res.text();
      } catch {
        omitted.push(path);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));

  return { tree: blobs.map((b) => b.path), contents, omitted, truncated: Boolean(treeRes.truncated) };
}
