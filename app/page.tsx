"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { getKey } from "@/lib/key";
import { DIFFICULTIES, TEMPLATE, type Difficulty, type GradeError, type GradeRequest, type GradeResult, type TreeResponse } from "@/lib/types";

type Files = Record<string, string>;
type Node = { name: string; path: string; dir: boolean; children: Node[] };
type Editing = { kind: "file" | "folder" | "rename"; parent: string; target?: string; value: string; error?: string };

const STORAGE_KEY = "pseudofy:v1";
const PICK_KEY = "pseudofy:pick";

// ---------- tree helpers (paths: folders end with "/", files don't) ----------

const isDir = (p: string) => p.endsWith("/");
const parentOf = (p: string) => {
  const base = p.replace(/\/$/, "");
  return base.slice(0, base.lastIndexOf("/") + 1);
};
const nameOf = (p: string) => p.replace(/\/$/, "").slice(parentOf(p).length);
const ancestors = (p: string) => {
  const out: string[] = [];
  for (let q = parentOf(p); q; q = parentOf(q)) out.push(q);
  return out;
};

/** Every explicit key plus the folders its path implies. */
function allPaths(files: Files) {
  const set = new Set<string>();
  for (const k of Object.keys(files)) {
    set.add(k);
    for (const a of ancestors(k)) set.add(a);
  }
  return set;
}

function buildTree(paths: Set<string>): Node[] {
  const byParent = new Map<string, Node[]>();
  for (const p of [...paths].sort()) {
    const node: Node = { name: nameOf(p), path: p, dir: isDir(p), children: [] };
    const siblings = byParent.get(parentOf(p)) ?? [];
    siblings.push(node);
    byParent.set(parentOf(p), siblings);
  }
  const attach = (list: Node[]): Node[] =>
    list
      .map((n) => ({ ...n, children: n.dir ? attach(byParent.get(n.path) ?? []) : [] }))
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  return attach(byParent.get("") ?? []);
}

/** Returns an error message, or null if `path` can be created. */
function checkPath(paths: Set<string>, name: string, path: string): string | null {
  if (!name) return "Name can't be empty";
  if (name.includes("//")) return "Name can't contain //";
  if (name.startsWith("/") || name.endsWith("/")) return "Name can't start or end with /";
  const base = path.replace(/\/$/, "");
  if (paths.has(base) || paths.has(base + "/")) return `“${name}” already exists here`;
  const fileAncestor = ancestors(path).find((a) => paths.has(a.slice(0, -1)));
  if (fileAncestor) return `“${fileAncestor.slice(0, -1)}” is a file, not a folder`;
  return null;
}

/** Moves `from` (and everything under it, for folders) to `to`. */
function movePath(files: Files, from: string, to: string): Files {
  const out: Files = {};
  for (const [k, v] of Object.entries(files)) {
    out[k === from || (isDir(from) && k.startsWith(from)) ? to + k.slice(from.length) : k] = v;
  }
  if (isDir(from) && !(to in out)) out[to] = "";
  return out;
}

// ---------- storage (optional: the page works without it) ----------

function load(): { files?: Files; repoUrl?: string; selected?: string | null; difficulty?: Difficulty; hints?: Files } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// ---------- page ----------

export default function Page() {
  const [files, setFiles] = useState<Files>({});
  const [repoUrl, setRepoUrl] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [hints, setHints] = useState<Files>({});
  const [confirmingChange, setConfirmingChange] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editDone = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const paths = useMemo(() => allPaths(files), [files]);
  const tree = useMemo(() => buildTree(paths), [paths]);
  const fileCount = Object.keys(files).filter((k) => !isDir(k)).length;
  const selectedIsFile = selected !== null && !isDir(selected) && selected in files;
  const canGrade = repoUrl.trim() !== "" && fileCount > 0 && !loading;

  // Hydrate after mount so server and client render the same first frame.
  useEffect(() => {
    const saved = load();
    /* eslint-disable react-hooks/set-state-in-effect -- one-time read of browser-only storage */
    if (saved.files && typeof saved.files === "object") {
      const kept = Object.fromEntries(Object.entries(saved.files).filter(([, v]) => typeof v === "string"));
      setFiles(kept);
      // Sessions saved before difficulty existed were all from-memory, i.e. hard.
      if (Object.keys(kept).length > 0) setDifficulty("hard");
    }
    if (saved.difficulty && DIFFICULTIES.includes(saved.difficulty)) setDifficulty(saved.difficulty);
    if (saved.hints && typeof saved.hints === "object") {
      setHints(Object.fromEntries(Object.entries(saved.hints).filter(([, v]) => typeof v === "string")));
    }
    if (typeof saved.repoUrl === "string") setRepoUrl(saved.repoUrl);
    if (typeof saved.selected === "string") setSelected(saved.selected);
    if (window.matchMedia("(max-width: 767px)").matches) setSidebarOpen(false);
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ files, repoUrl, selected, difficulty, hints }));
    } catch {
      // storage full or blocked: keep working in memory
    }
  }, [files, repoUrl, selected, difficulty, hints, hydrated]);

  const locked = difficulty === "easy" || difficulty === "medium";

  const start = (d: Difficulty, url: string, seeded: Files, seededHints: Files) => {
    setDifficulty(d);
    setHints(seededHints);
    setRepoUrl(url);
    setFiles(seeded);
    setSelected(null);
    setCollapsed(new Set());
    setEditing(null);
    setResult(null);
    setError(null);
    setPanelOpen(false);
  };

  const changeDifficulty = () => {
    const written = Object.values(files).some((v) => v.trim() && v.trim() !== TEMPLATE.trim());
    if (written) setConfirmingChange(true);
    else resetToStart();
  };

  const resetToStart = () => {
    setConfirmingChange(false);
    setDifficulty(null);
    setHints({});
    setFiles({});
    setSelected(null);
    setResult(null);
    setError(null);
    setPanelOpen(false);
  };

  // ---- tree actions ----

  const reveal = (p: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      for (const a of ancestors(p)) next.delete(a);
      next.delete(p);
      return next;
    });

  const startCreate = (kind: "file" | "folder") => {
    const parent = selected === null ? "" : isDir(selected) ? selected : parentOf(selected);
    if (parent) reveal(parent);
    editDone.current = false;
    setEditing({ kind, parent, value: "" });
  };

  const startRename = (p: string) => {
    editDone.current = false;
    setEditing({ kind: "rename", parent: parentOf(p), target: p, value: nameOf(p) });
  };

  /** Applies the inline edit. On blur, invalid input just cancels. */
  const commitEdit = (fromBlur: boolean) => {
    if (!editing || editDone.current) return;
    const dir = editing.kind === "folder" || (editing.kind === "rename" && isDir(editing.target!));
    const name = dir ? editing.value.trim().replace(/\/+$/, "") : editing.value.trim();
    const path = editing.parent + name + (dir ? "/" : "");

    if (editing.kind === "rename" && path === editing.target) {
      editDone.current = true;
      return setEditing(null);
    }
    let problem = checkPath(paths, name, path);
    if (!problem && editing.kind === "rename" && dir && path.startsWith(editing.target!)) {
      problem = "Can't move a folder inside itself";
    }
    if (problem) {
      if (fromBlur || !name) {
        editDone.current = true;
        return setEditing(null);
      }
      return setEditing({ ...editing, error: problem });
    }

    editDone.current = true;
    setEditing(null);
    if (editing.kind === "rename") {
      const from = editing.target!;
      setFiles((f) => movePath(f, from, path));
      if (selected !== null && (selected === from || (isDir(from) && selected.startsWith(from)))) {
        setSelected(path + selected.slice(from.length));
      }
    } else {
      setFiles((f) => ({ ...f, [path]: "" }));
      setSelected(path);
      reveal(path);
      if (!dir) requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const remove = (p: string) => {
    const children = Object.keys(files).filter((k) => k !== p && isDir(p) && k.startsWith(p));
    if (children.length && !confirm(`Delete “${nameOf(p)}” and the ${children.length} item(s) inside it?`)) return;
    setFiles((f) => {
      const out: Files = {};
      for (const [k, v] of Object.entries(f)) if (!(k === p || (isDir(p) && k.startsWith(p)))) out[k] = v;
      const parent = parentOf(p);
      if (parent && !allPaths(out).has(parent)) out[parent] = ""; // keep the now-empty parent folder
      return out;
    });
    if (selected !== null && (selected === p || (isDir(p) && selected.startsWith(p)))) {
      setSelected(parentOf(p) || null);
    }
  };

  const toggle = (p: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  // ---- grading ----

  const grade = async () => {
    if (!canGrade) return;
    setLoading(true);
    setStartedAt(Date.now());
    setError(null);
    setResult(null);
    setPanelOpen(true);
    try {
      // Template text the user never edited counts as unwritten.
      const sent = Object.fromEntries(Object.entries(files).map(([p, v]) => [p, v.trim() === TEMPLATE.trim() ? "" : v]));
      const body: GradeRequest = { repoUrl: repoUrl.trim(), files: sent, difficulty: difficulty ?? "hard" };
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-anthropic-key": getKey() },
        body: JSON.stringify(body),
      });
      const data: GradeResult | GradeError | null = await res.json().catch(() => null);
      if (!res.ok || !data || "error" in data) {
        setError(data && "error" in data ? data.error : `The grader failed (HTTP ${res.status}).`);
      } else {
        setResult(data);
      }
    } catch {
      setError("Couldn't reach the grader. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const openFromResults = (p: string) => {
    if (!(p in files) || isDir(p)) return;
    setSelected(p);
    reveal(p);
    if (!sidebarOpen && window.matchMedia("(min-width: 768px)").matches) setSidebarOpen(true);
    if (window.matchMedia("(max-width: 1023px)").matches) setPanelOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  // ---- render ----

  const editInput = (depth: number, icon: ReactNode) =>
    editing && (
      <div style={{ paddingLeft: 12 + depth * 14 }} className="pr-2 py-0.5">
        <div className="flex items-center gap-1.5">
          {icon}
          <input
            autoFocus
            aria-label={editing.kind === "rename" ? "New name" : `New ${editing.kind} name`}
            aria-invalid={!!editing.error}
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value, error: undefined })}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit(false);
              if (e.key === "Escape") {
                editDone.current = true;
                setEditing(null);
              }
            }}
            onBlur={() => commitEdit(true)}
            placeholder={editing.kind === "folder" ? "folder" : "file.ts"}
            className="min-w-0 flex-1 rounded-sm border border-accent bg-raised px-1 py-px font-mono text-[13px] text-ink outline-none placeholder:text-muted/60"
          />
        </div>
        {editing.error && (
          <p role="alert" className="mt-1 pl-5 font-mono text-[11px] text-accent">
            {editing.error}
          </p>
        )}
      </div>
    );

  const renderNodes = (nodes: Node[], parent: string, depth: number): ReactNode => (
    <ul role={depth === 0 ? "tree" : "group"} aria-label={depth === 0 ? "Your file tree" : undefined}>
      {editing && editing.kind !== "rename" && editing.parent === parent && (
        <li>{editInput(depth, editing.kind === "folder" ? <FolderGlyph open={false} /> : <FileGlyph />)}</li>
      )}
      {nodes.map((n) => {
        const open = n.dir && !collapsed.has(n.path);
        const active = selected === n.path;
        return (
          <li key={n.path} role="treeitem" aria-expanded={n.dir ? open : undefined} aria-selected={active}>
            {editing?.kind === "rename" && editing.target === n.path ? (
              editInput(depth, n.dir ? <FolderGlyph open={open} /> : <FileGlyph />)
            ) : (
              <div className={`group flex items-center ${active ? "bg-sel" : "hover:bg-sel/60"}`}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(n.path);
                    if (n.dir) toggle(n.path);
                  }}
                  onDoubleClick={() => !locked && startRename(n.path)}
                  title={n.path}
                  style={{ paddingLeft: 12 + depth * 14 }}
                  className={`flex min-w-0 flex-1 items-center gap-1.5 py-[3px] pr-1 text-left font-mono text-[13px] ${
                    active ? "text-ink" : "text-ink/80"
                  } focus-visible:-outline-offset-2`}
                >
                  {n.dir ? <FolderGlyph open={open} /> : <FileGlyph />}
                  <span className="truncate">{n.name}</span>
                  {!n.dir && !files[n.path]?.trim() && (
                    <span aria-label="no explanation yet" className="ml-auto size-1.5 shrink-0 rounded-full bg-muted/40" />
                  )}
                </button>
                {!locked && (
                  <div className="flex shrink-0 pr-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                    <IconButton label={`Rename ${n.name}`} onClick={() => startRename(n.path)}>
                      ✎
                    </IconButton>
                    <IconButton label={`Delete ${n.name}`} onClick={() => remove(n.path)}>
                      ×
                    </IconButton>
                  </div>
                )}
              </div>
            )}
            {open && renderNodes(n.children, n.path, depth + 1)}
          </li>
        );
      })}
    </ul>
  );

  const explanation = selectedIsFile ? files[selected!] : "";
  const words = explanation.trim() ? explanation.trim().split(/\s+/).length : 0;

  if (!hydrated) return <div className="h-dvh" />;
  if (!difficulty) return <Start url={repoUrl} setUrl={setRepoUrl} onStart={start} />;

  return (
    <div className="flex h-dvh flex-col">
      {/* top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-rule bg-panel px-3">
        <button
          type="button"
          onClick={() => setSidebarOpen((o) => !o)}
          aria-label={sidebarOpen ? "Hide file tree" : "Show file tree"}
          aria-expanded={sidebarOpen}
          aria-controls="sidebar"
          title="Toggle file tree"
          className="press grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-sel hover:text-ink"
        >
          <SidebarGlyph />
        </button>
        <span className="hidden shrink-0 text-xl leading-none tracking-tight sm:block">
          pseudo<em className="text-accent">fy</em>
        </span>
        <label htmlFor="repo" className="sr-only">
          Public GitHub repository URL
        </label>
        <input
          id="repo"
          type="url"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          placeholder="https://github.com/owner/repo"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && grade()}
          readOnly={locked}
          className="h-8 min-w-0 flex-1 rounded-md border border-rule bg-raised px-2.5 font-mono text-[13px] text-ink placeholder:text-muted/70 focus-visible:border-accent focus-visible:outline-none read-only:text-muted sm:max-w-xl sm:mx-auto"
        />
        <button
          type="button"
          onClick={changeDifficulty}
          title="Change difficulty"
          aria-label={`Difficulty: ${difficulty}. Change difficulty`}
          className="press h-8 shrink-0 rounded-md px-2.5 font-mono text-xs capitalize text-muted hover:bg-sel hover:text-ink"
        >
          {difficulty}
        </button>
        {(result || error) && !panelOpen && !loading && (
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            className="press h-8 shrink-0 rounded-md px-2.5 font-mono text-xs text-muted hover:bg-sel hover:text-ink"
          >
            {result ? `Score ${result.overall}` : "Error"}
          </button>
        )}
        <Link
          href="/settings"
          aria-label="Settings"
          title="Settings"
          className="press grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-sel hover:text-ink"
        >
          <GearGlyph />
        </Link>
        <button
          type="button"
          onClick={grade}
          disabled={!canGrade}
          aria-label="Grade my tree against the repository"
          title={
            loading
              ? "Grading…"
              : !repoUrl.trim()
                ? "Enter a repository URL first"
                : fileCount === 0
                  ? "Add at least one file first"
                  : "Grade"
          }
          className="press flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 font-mono text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:bg-rule disabled:text-muted"
        >
          {loading ? <span className="size-3 animate-spin rounded-full border-2 border-current border-r-transparent" /> : "▶"}
          <span className="hidden sm:inline">{loading ? "Grading" : "Grade"}</span>
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* sidebar */}
        {sidebarOpen && (
          <>
            <div aria-hidden className="absolute inset-0 z-10 bg-ink/20 md:hidden" onClick={() => setSidebarOpen(false)} />
            <aside
              id="sidebar"
              aria-label="File tree"
              className="absolute inset-y-0 left-0 z-20 flex w-64 flex-col border-r border-rule bg-panel shadow-xl md:static md:shadow-none"
            >
              <div className="flex h-9 shrink-0 items-center justify-between pl-3 pr-1.5">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                  {locked ? "Repository" : "From memory"}
                </span>
                {!locked && (
                  <div className="flex">
                    <IconButton label="New file" onClick={() => startCreate("file")}>
                      <span className="font-mono text-[13px]">+f</span>
                    </IconButton>
                    <IconButton label="New folder" onClick={() => startCreate("folder")}>
                      <span className="font-mono text-[13px]">+d</span>
                    </IconButton>
                  </div>
                )}
              </div>
              <div
                className="min-h-0 flex-1 overflow-y-auto pb-6"
                onClick={(e) => e.target === e.currentTarget && setSelected(null)}
              >
                {tree.length === 0 && !editing ? (
                  <p className="px-3 pt-2 text-sm leading-relaxed text-muted">
                    Empty. Recreate the repo’s structure from memory with{" "}
                    <span className="font-mono text-[12px] text-ink">+f</span> and{" "}
                    <span className="font-mono text-[12px] text-ink">+d</span>. Nested paths like{" "}
                    <span className="font-mono text-[12px] text-ink">src/app.ts</span> work too.
                  </p>
                ) : (
                  renderNodes(tree, "", 0)
                )}
              </div>
            </aside>
          </>
        )}

        {/* editor */}
        <main className="flex min-w-0 flex-1 flex-col bg-raised">
          <div className="flex h-9 shrink-0 items-center justify-between gap-4 border-b border-rule px-5 font-mono text-[12px] text-muted">
            <span className="truncate">
              {selectedIsFile ? (
                <>
                  {parentOf(selected!)}
                  <span className="text-ink">{nameOf(selected!)}</span>
                </>
              ) : (
                "no file open"
              )}
            </span>
            {selectedIsFile && <span className="shrink-0 tabular-nums">{words} words</span>}
          </div>
          {selectedIsFile && hints[selected!] && (
            <p className="shrink-0 border-b border-rule bg-panel px-5 py-2 text-[14px] leading-snug text-muted md:px-10">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em]">Hint</span>
              <span className="ml-3 text-ink/85">{hints[selected!]}</span>
            </p>
          )}
          <div className="relative min-h-0 flex-1">
            <label htmlFor="explanation" className="sr-only">
              {selectedIsFile ? `Explanation of ${selected}` : "Explanation (select a file first)"}
            </label>
            <textarea
              id="explanation"
              ref={textareaRef}
              disabled={!selectedIsFile}
              value={explanation}
              onChange={(e) => selectedIsFile && setFiles((f) => ({ ...f, [selected!]: e.target.value }))}
              placeholder={
                selectedIsFile
                  ? "What does this file do? What does it import, export, and who uses it? The more specific, the better."
                  : ""
              }
              spellCheck
              className="ruled absolute inset-0 h-full w-full resize-none bg-transparent px-5 pt-5 pb-16 font-mono text-[14px] text-ink outline-none placeholder:text-muted/60 disabled:cursor-default md:px-10"
            />
            {!selectedIsFile && hydrated && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center p-8">
                <div className="max-w-sm text-center">
                  <p className="text-2xl italic leading-snug">How well do you know this codebase?</p>
                  <p className="mt-3 text-[15px] leading-relaxed text-muted">
                    {fileCount === 0
                      ? "Rebuild its file tree from memory on the left, then open a file and explain what it does and how it connects to the rest. Press ▶ to be graded against the real repo."
                      : "Open a file from the tree to write its explanation."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* results */}
        {panelOpen && (
          <>
            <div aria-hidden className="absolute inset-0 z-10 bg-ink/20 lg:hidden" onClick={() => setPanelOpen(false)} />
            <aside
              aria-label="Results"
              aria-busy={loading}
              className="panel-in absolute inset-y-0 right-0 z-20 flex w-[min(400px,100%)] flex-col border-l border-rule bg-panel shadow-xl lg:static lg:shadow-none"
            >
              <div className="flex h-9 shrink-0 items-center justify-between pl-4 pr-1.5">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Results</span>
                <IconButton label="Close results" onClick={() => setPanelOpen(false)}>
                  ×
                </IconButton>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8" aria-live="polite">
                {loading && <Loading startedAt={startedAt} />}
                {error && !loading && (
                  <div role="alert" className="mt-2 border-l-2 border-accent bg-raised px-3 py-3">
                    <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent">Grading failed</p>
                    <p className="mt-1.5 text-[15px] leading-relaxed">{error}</p>
                    <button
                      type="button"
                      onClick={grade}
                      disabled={!canGrade}
                      className="press mt-3 rounded-md border border-rule px-2.5 py-1 font-mono text-xs hover:bg-sel disabled:opacity-50"
                    >
                      Try again
                    </button>
                  </div>
                )}
                {result && !loading && <Results result={result} files={files} onOpen={openFromResults} />}
              </div>
            </aside>
          </>
        )}
      </div>
      {confirmingChange && (
        <ConfirmDialog
          title="Start over?"
          body="Changing the difficulty clears everything you've written so far."
          confirmLabel="Clear and continue"
          onConfirm={resetToStart}
          onCancel={() => setConfirmingChange(false)}
        />
      )}
    </div>
  );
}

// ---------- confirm dialog ----------

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal(); // strict mode runs effects twice
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      aria-describedby="confirm-body"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
      className="dialog m-auto w-[min(26rem,calc(100%-2rem))] rounded-lg border border-rule bg-panel p-0 text-ink shadow-xl"
    >
      <div className="p-6">
        <h2 id="confirm-title" className="text-2xl leading-tight tracking-tight">
          {title}
        </h2>
        <p id="confirm-body" className="mt-2 text-[15px] leading-relaxed text-muted">
          {body}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="press h-9 rounded-md border border-rule px-4 font-mono text-[13px] hover:bg-sel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="press h-9 rounded-md bg-accent px-4 font-mono text-[13px] font-medium text-accent-ink hover:brightness-110"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

// ---------- start screen ----------

const LEVELS: { id: Difficulty; blurb: string }[] = [
  { id: "easy", blurb: "The file tree and a template for every file. Fill in what each one does." },
  { id: "medium", blurb: "The file tree only. Write every explanation yourself." },
  { id: "hard", blurb: "Nothing given. Rebuild the tree from memory, then explain it." },
];

function Start({ url, setUrl, onStart }: { url: string; setUrl: (u: string) => void; onStart: (d: Difficulty, url: string, files: Files, hints: Files) => void }) {
  // Remembered for the round trip to Settings. Start only renders after hydration, so reading here is safe.
  const [pick, setPickState] = useState<Difficulty | null>(() => {
    try {
      const v = sessionStorage.getItem(PICK_KEY) as Difficulty | null;
      return v && DIFFICULTIES.includes(v) ? v : null;
    } catch {
      return null;
    }
  });
  const setPick = (d: Difficulty | null) => {
    setPickState(d);
    try {
      if (d) sessionStorage.setItem(PICK_KEY, d);
      else sessionStorage.removeItem(PICK_KEY);
    } catch {
      // storage blocked: the pick just won't survive leaving the page
    }
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const givesTree = pick === "easy" || pick === "medium";
  const ready = pick !== null && url.trim() !== "" && !busy;

  const go = async () => {
    if (!pick || !ready) return;
    if (!givesTree) {
      setPick(null);
      return onStart(pick, url.trim(), {}, {});
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tree", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-anthropic-key": getKey() },
        body: JSON.stringify({ repoUrl: url.trim(), difficulty: pick }),
      });
      const data: TreeResponse | GradeError | null = await res.json().catch(() => null);
      if (!res.ok || !data || "error" in data) {
        setError(data && "error" in data ? data.error : `Couldn't load the repository (HTTP ${res.status}).`);
      } else {
        setPick(null);
        onStart(pick, url.trim(), Object.fromEntries(data.paths.map((p) => [p, pick === "easy" ? TEMPLATE : ""])), data.hints ?? {});
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <form
        className="w-full max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <div className="flex items-center justify-between">
          <p className="text-xl leading-none tracking-tight">
            pseudo<em className="text-accent">fy</em>
          </p>
          <Link
            href="/settings"
            aria-label="Settings"
            title="Settings"
            className="press grid size-8 place-items-center rounded-md text-muted hover:bg-sel hover:text-ink"
          >
            <GearGlyph />
          </Link>
        </div>
        <h1 className="mt-8 text-4xl leading-tight tracking-tight">Choose a difficulty</h1>

        <div role="radiogroup" aria-label="Difficulty" className="mt-6 divide-y divide-rule border-y border-rule">
          {LEVELS.map((l) => {
            const on = pick === l.id;
            return (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPick(l.id)}
                className={`flex w-full items-baseline gap-4 border-l-2 px-4 py-3.5 text-left transition-colors duration-150 focus-visible:-outline-offset-2 ${
                  on ? "border-l-accent bg-sel" : "border-l-transparent hover:bg-sel/60"
                }`}
              >
                <span className="w-24 shrink-0 text-xl italic capitalize">{l.id}</span>
                <span className="text-[15px] leading-snug text-muted">{l.blurb}</span>
              </button>
            );
          })}
        </div>

        <label htmlFor="start-repo" className="mt-6 block font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
          Repository URL
        </label>
        <input
          id="start-repo"
          type="url"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          placeholder="https://github.com/owner/repo"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          aria-invalid={!!error}
          className="mt-2 h-10 w-full rounded-md border border-rule bg-raised px-3 font-mono text-[13px] text-ink placeholder:text-muted/70 focus-visible:border-accent focus-visible:outline-none"
        />
        {error && (
          <p role="alert" className="mt-2 font-mono text-[12px] text-accent">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!ready}
          className="press mt-6 flex h-10 items-center gap-2 rounded-md bg-accent px-5 font-mono text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:bg-rule disabled:text-muted"
        >
          {busy && <span className="size-3 animate-spin rounded-full border-2 border-current border-r-transparent" />}
          {busy ? (pick === "easy" ? "Writing hints" : "Loading") : "Start"}
        </button>
      </form>
    </main>
  );
}

// ---------- results ----------

function Results({ result, files, onOpen }: { result: GradeResult; files: Files; onOpen: (p: string) => void }) {
  const status = {
    matched: "text-ok border-ok/40",
    misplaced: "text-warn border-warn/40",
    nonexistent: "text-accent border-accent/40",
  } as const;
  return (
    <>
      <div className="flex items-end gap-2 pt-2">
        <CountUp value={result.overall} className="text-7xl leading-[0.85] tracking-tight tabular-nums" />
        <span className="pb-1 font-mono text-xs text-muted">/ 100</span>
      </div>
      <dl className="mt-5 space-y-2.5">
        {(["structure", "purpose", "relationships"] as const).map((k) => (
          <div key={k}>
            <div className="flex justify-between font-mono text-[12px]">
              <dt className="text-muted">{k}</dt>
              <dd className="tabular-nums">{result[k]}</dd>
            </div>
            <div className="mt-1 h-[3px] overflow-hidden bg-rule">
              <div className="bar h-full bg-ink" style={{ transform: `scaleX(${result[k] / 100})` }} />
            </div>
          </div>
        ))}
      </dl>
      <p className="mt-5 text-[16px] leading-relaxed">{result.summary}</p>

      <h2 className="mt-7 mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
        Your files · {result.files.length}
      </h2>
      <ul className="divide-y divide-rule border-y border-rule">
        {result.files.map((f, i) => {
          const openable = f.path in files;
          return (
            <li key={f.path + i}>
              <button
                type="button"
                onClick={() => onOpen(f.path)}
                disabled={!openable}
                className="w-full py-2.5 text-left enabled:hover:bg-sel/50 disabled:cursor-default"
              >
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={f.path}>
                    {f.path}
                  </span>
                  <span className="shrink-0 font-mono text-[12px] tabular-nums">{f.score}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={`rounded-sm border px-1 font-mono text-[10px] uppercase tracking-wider ${status[f.status]}`}>
                    {f.status}
                  </span>
                  {f.status === "misplaced" && f.actualPath && (
                    <span className="min-w-0 truncate font-mono text-[11px] text-muted" title={f.actualPath}>
                      → {f.actualPath}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[14px] leading-snug text-ink/85">{f.feedback}</p>
              </button>
            </li>
          );
        })}
      </ul>

      {result.missed.length > 0 && (
        <>
          <h2 className="mt-7 mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
            Missed important files · {result.missed.length}
          </h2>
          <ul className="space-y-3">
            {result.missed.map((m, i) => (
              <li key={m.path + i}>
                <p className="font-mono text-[13px]">{m.path}</p>
                <p className="mt-0.5 text-[14px] leading-snug text-muted">{m.why}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Loading({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <div className="pt-2">
      <p className="text-2xl italic">Reading the repository…</p>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        Comparing your tree and explanations with the real code. This usually takes 30 seconds to 2 minutes.
      </p>
      <div className="mt-5 h-[3px] overflow-hidden bg-rule">
        <div className="sweep h-full w-2/5 bg-accent" />
      </div>
      <p className="mt-2 font-mono text-[12px] tabular-nums text-muted">{s}s</p>
    </div>
  );
}

function CountUp({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value); // eslint-disable-line react-hooks/set-state-in-effect -- no animation under reduced motion
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 700);
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <span className={className} aria-label={`${value} out of 100`}>
      {shown}
    </span>
  );
}

// ---------- small bits ----------

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="press grid size-6 place-items-center rounded text-[14px] leading-none text-muted hover:bg-sel hover:text-ink"
    >
      {children}
    </button>
  );
}

const FolderGlyph = ({ open }: { open: boolean }) => (
  <span aria-hidden className="w-3 shrink-0 text-center text-[10px] text-muted">
    {open ? "▾" : "▸"}
  </span>
);
const FileGlyph = () => (
  <span aria-hidden className="w-3 shrink-0 text-center text-[10px] text-muted/70">
    ·
  </span>
);
const SidebarGlyph = () => (
  <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M6 2.5v11" />
  </svg>
);

function GearGlyph() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
