"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getKey, setKey } from "@/lib/key";

const mask = (k: string) => (k.length > 12 ? `${k.slice(0, 7)}…${k.slice(-4)}` : "••••");

export default function Settings() {
  const [saved, setSaved] = useState("");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setSaved(getKey()); // eslint-disable-line react-hooks/set-state-in-effect -- browser-only storage
  }, []);

  const save = (key: string) => {
    setKey(key);
    setSaved(key);
    setDraft("");
    setStatus(key ? "Key saved in this browser." : "Key removed.");
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-8 px-4 py-10">
      <Link href="/" className="font-mono text-[13px] text-muted hover:text-ink">
        ← Back to editor
      </Link>

      <header>
        <h1 className="text-3xl tracking-tight">Settings</h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Claude API key</h2>
        <p className="text-[15px] leading-relaxed text-ink/80">
          Grading runs on your own Anthropic key. Get one at{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
            console.anthropic.com
          </a>
          . It&apos;s stored only in this browser and sent with each grading request. It&apos;s never saved on the server.
        </p>
        <p className="font-mono text-[13px]">
          Current: {saved ? <span className="text-ok">{mask(saved)}</span> : <span className="text-muted">none set</span>}
        </p>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) save(draft.trim());
          }}
        >
          <label htmlFor="key" className="sr-only">
            Claude API key
          </label>
          <input
            id="key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setStatus(null);
            }}
            className="h-9 min-w-0 flex-1 rounded-md border border-rule bg-raised px-2.5 font-mono text-[13px] text-ink placeholder:text-muted/70 focus-visible:border-accent focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="press h-9 shrink-0 rounded-md bg-accent px-3 font-mono text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:bg-rule disabled:text-muted"
          >
            {saved ? "Replace" : "Save"}
          </button>
          {saved && (
            <button
              type="button"
              onClick={() => save("")}
              className="press h-9 shrink-0 rounded-md px-3 font-mono text-[13px] text-muted hover:bg-sel hover:text-ink"
            >
              Remove
            </button>
          )}
        </form>

        {status && (
          <p role="status" className="font-mono text-[12px] text-muted">
            {status}
          </p>
        )}
      </section>
    </main>
  );
}
