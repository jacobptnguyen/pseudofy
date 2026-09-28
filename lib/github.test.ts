import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRepoUrl, isNoise, pickFiles } from "./github.ts";

test("parseRepoUrl accepts common forms", () => {
  const want = { owner: "vercel", repo: "next.js" };
  for (const u of [
    "vercel/next.js",
    "github.com/vercel/next.js",
    "https://github.com/vercel/next.js",
    "https://github.com/vercel/next.js/",
    "https://www.github.com/vercel/next.js.git",
    "https://github.com/vercel/next.js/tree/canary/packages/next",
    "  http://github.com/vercel/next.js  ",
  ]) {
    assert.deepEqual(parseRepoUrl(u), want, u);
  }
});

test("parseRepoUrl rejects junk", () => {
  for (const u of ["", "vercel", "https://gitlab.com/a/b", "https://github.com/a/b/blob/main/x.ts", "a/b/c", "a b/c"]) {
    assert.throws(() => parseRepoUrl(u), /Invalid GitHub repo URL/, u);
  }
});

test("isNoise filters deps, build output, lockfiles, binaries", () => {
  for (const p of ["node_modules/x/index.js", "a/.git/HEAD", "dist/main.js", "pkg/build/out.js", ".next/x", "vendor/lib.go",
    "package-lock.json", "web/yarn.lock", "Cargo.lock", "logo.PNG", "fonts/a.woff2", "doc.pdf", "app.wasm", "favicon.ico"]) {
    assert.equal(isNoise(p), true, p);
  }
  for (const p of ["src/index.ts", "README.md", "package.json", "src/build.ts", ".gitignore", "Makefile"]) {
    assert.equal(isNoise(p), false, p);
  }
});

test("pickFiles puts user paths first, then smallest, within budget, omits the rest", () => {
  const blobs = [
    { path: "big.ts", size: 60 },
    { path: "small.ts", size: 10 },
    { path: "mid.ts", size: 30 },
    { path: "user.ts", size: 50 },
    { path: "user2.ts", size: 5 },
  ];
  const r = pickFiles(blobs, ["user.ts", "user2.ts"], 100);
  assert.deepEqual(r.fetch, ["user2.ts", "user.ts", "small.ts", "mid.ts"]);
  assert.deepEqual(r.omitted, ["big.ts"]);
  assert.equal(r.fetch.length + r.omitted.length, blobs.length);
});

test("pickFiles skips an oversized file but keeps filling with smaller ones", () => {
  const r = pickFiles([{ path: "huge.ts", size: 500 }, { path: "tiny.ts", size: 1 }], ["huge.ts"], 100);
  assert.deepEqual(r.fetch, ["tiny.ts"]);
  assert.deepEqual(r.omitted, ["huge.ts"]);
});
