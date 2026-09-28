# Pseudofy

Test how well you really know a codebase. Rebuild a GitHub repo's file tree from memory, explain each file in plain English, and get it graded against the real code.

## [▶ Live Demo](https://pseudofy-gn4q.vercel.app/)

![Pseudofy screenshot](docs/screenshot.png)

## The problem

Reading code and knowing code are different things. It's easy to feel familiar with a repo after skimming it, and hard to tell whether you could actually explain where things live, what each file does and how the pieces connect. The usual ways of checking, such as quizzes and flashcards, test isolated facts instead of your mental model of the whole system.

Pseudofy makes you rebuild that model from scratch. You get a blank, minimal IDE and write the repo's structure and each file's purpose from memory. An AI grader then compares your version with the real repo, file by file, and shows where your understanding is solid, where it's off, and which important files you forgot existed.

## Features

- **Minimal IDE:** a toggleable file tree where you can create, rename and delete files and folders, plus a plain-text editor for each file's explanation.
- **Any public GitHub repo:** paste a URL and press ▶. Nothing is fetched until you do.
- **Rubric-based grading:**
  - an overall score out of 100
  - sub-scores for structure (30%), purpose (40%) and relationships (30%)
  - per-file feedback marking each file as matched, misplaced (with the real path) or nonexistent
  - a list of important files you missed
- **Detail is rewarded only when it's correct:** confident wrong claims cost more than vague ones.
- **Autosaved:** your tree and notes are kept in local storage, so a refresh doesn't lose your work.
- **Bring your own key:** each user adds their own Claude API key in Settings. It's kept in their browser, so the host pays nothing and there's no shared rate limit.

## Tech stack

- Next.js 16 (App Router) with TypeScript
- Tailwind CSS v4
- Claude Opus 5 (`@anthropic-ai/sdk`) with structured outputs, validated with Zod
- GitHub REST API for the repo tree and file contents
- Deployed on Vercel

## Running locally

```bash
npm install
npm run dev                         # then add your Claude API key under Settings (gear icon)
npm test                            # GitHub URL parsing and file-selection tests
```
