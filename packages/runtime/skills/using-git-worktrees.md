# Workspace Isolation

Adapted from superpowers:using-git-worktrees. Use when cloning or working in a repository.

## Core principle

This workstream already has an isolated workspace directory. Work inside it — do not create parallel worktrees or clone outside the workspace.

## Setup tasks

1. Check whether the repo is already cloned (list_files, git status).
2. If not cloned: `git clone {repoUrl}` into the workspace (use `.` if empty, or a subdirectory like `repo`).
3. Checkout base commit when specified: `git checkout {baseCommit}`.
4. Never clone to /tmp or paths outside the workspace.

## During work

- All file edits and git operations stay inside the workspace.
- Do not run `git worktree add` — the runtime provides isolation per workstream.
- Use git status / git diff to understand state before committing.

## Detached HEAD

If checkout leaves detached HEAD (common for bench base commits), that is expected. Commit on the detached state or create a branch only when the task requires it.
