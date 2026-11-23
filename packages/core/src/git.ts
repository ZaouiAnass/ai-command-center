import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DB, run, one, all, uid, now } from "./db.js";

export function git(cwd: string, args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}
export const isGitRepo = (p: string) => existsSync(p) && git(p, ["rev-parse", "--is-inside-work-tree"]).out === "true";
export const currentBranch = (p: string) => git(p, ["rev-parse", "--abbrev-ref", "HEAD"]).out;
export const hasCommits = (p: string) => git(p, ["rev-parse", "--verify", "HEAD"]).ok;

/** Crée une branche dédiée + worktree isolé. Jamais destructif. */
export function createWorktree(db: DB, o: { projectId: string; projectPath: string; executionId: string; baseDir: string }) {
  if (!isGitRepo(o.projectPath)) throw new Error("Le projet n'est pas un dépôt Git");
  if (!hasCommits(o.projectPath)) throw new Error("Le dépôt n'a aucun commit : impossible de créer un worktree");
  const base = currentBranch(o.projectPath);
  const branch = `acc/${o.executionId.slice(0, 8)}`;
  const dir = resolve(o.baseDir, `${o.projectId.slice(0, 8)}-${o.executionId.slice(0, 8)}`);
  mkdirSync(o.baseDir, { recursive: true });
  const r = git(o.projectPath, ["worktree", "add", "-b", branch, dir, "HEAD"]);
  if (!r.ok) throw new Error(`git worktree add a échoué : ${r.err}`);
  const id = uid();
  run(db, "INSERT INTO git_worktrees (id,project_id,execution_id,branch,path,base_branch,status,created_at) VALUES (?,?,?,?,?,?,?,?)", id, o.projectId, o.executionId, branch, dir, base, "active", now());
  return { id, branch, path: dir, base };
}
export function worktreeChanges(path: string) {
  const st = git(path, ["status", "--porcelain"]).out.split("\n").filter(Boolean).map((l) => ({ status: l.slice(0, 2).trim(), path: l.slice(3) }));
  const diff = git(path, ["diff", "HEAD", "--stat"]).out;
  return { files: st, stat: diff, commits: git(path, ["log", "--oneline", "-n", "20"]).out };
}
export function worktreeDiff(path: string) { return git(path, ["diff", "HEAD"]).out; }
/** Fusion : refuse si l'arbre de base est sale ou si conflit ; annule proprement le merge en cas de conflit. */
export function mergeWorktree(projectPath: string, branch: string, opts: { confirmed: boolean }) {
  if (!opts.confirmed) return { ok: false, reason: "Confirmation requise" };
  if (git(projectPath, ["status", "--porcelain"]).out) return { ok: false, reason: "Le dépôt principal a des modifications non commitées" };
  const r = git(projectPath, ["merge", "--no-ff", "--no-edit", branch]);
  if (!r.ok) { git(projectPath, ["merge", "--abort"]); return { ok: false, reason: "Conflit de fusion (merge annulé) : " + r.err, conflict: true }; }
  return { ok: true };
}
export const listWorktrees = (db: DB, projectId?: string) => projectId ? all(db, "SELECT * FROM git_worktrees WHERE project_id=? ORDER BY created_at DESC", projectId) : all(db, "SELECT * FROM git_worktrees ORDER BY created_at DESC");
