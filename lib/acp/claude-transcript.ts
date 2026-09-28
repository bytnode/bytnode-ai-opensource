import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ---------------------------------------------------------------------------
   What Claude Code's own commands answered.

   ⚠️ CLAUDE CODE'S LOCAL COMMANDS ANSWER INTO THE VOID OVER ACP. `/usage`,
   `/model haiku`, `/mcp`, `/effort low`, `/rename`, `/goal`'s « Goal set »…
   run (the model does change), but their answer — « Set model to Haiku
   4.5 », the plan's usage bars — never reaches the client: the adapter
   (claude-agent-acp 0.23.1) forwards it for `/context` only and drops the
   rest. The terminal shows it because Claude Code writes it into the
   session's transcript, as a `system` entry of subtype `local_command`:
   `<local-command-stdout>…</local-command-stdout>`; and `/goal`'s verdict as
   a `goal_status` attachment. So do we: the transcript is read back and
   those lines are shown in the thread, where the terminal shows them.

   The transcripts live in `<config>/projects/<cwd, every non-alphanumeric
   character as "-">/<session>.jsonl`. After `/clear` Claude Code goes on in
   a NEW file of the same folder, so the whole folder is read — only its
   files touched since the command, and only their tails.
--------------------------------------------------------------------------- */

const OUTPUT = /<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>/g;

type Entry = { type?: unknown; subtype?: unknown; content?: unknown; timestamp?: unknown; attachment?: unknown };

/** The entries written since `sinceMs` whose line contains `marker`. */
function entriesSince(jsonl: string, sinceMs: number, marker: string): Entry[] {
  const out: Entry[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.includes(marker)) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; /* a line cut by the tail read */
    }
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Entry;
    const at = typeof e.timestamp === "string" ? Date.parse(e.timestamp) : NaN;
    if (at >= sinceMs) out.push(e);
  }
  return out;
}

/** The answers of the local commands run since `sinceMs`, in order, from
    the lines of a transcript. Pure. */
export function localOutputsIn(jsonl: string, sinceMs: number): string[] {
  const out: string[] = [];
  for (const e of entriesSince(jsonl, sinceMs, '"local_command"')) {
    if (e.type !== "system" || e.subtype !== "local_command" || typeof e.content !== "string") continue;
    for (const m of e.content.matchAll(OUTPUT)) {
      const text = m[2].trim();
      if (text) out.push(text);
    }
  }
  return out;
}

/** A command's answer as the thread renders it (Markdown), with the lines
    the terminal shows: `/usage` writes one fact per line, and Markdown
    would run them into one paragraph. Each line break becomes a hard
    break — except inside a table or a code block, which Markdown already
    lays out (and which hard breaks would break). Pure. */
export function withTerminalLines(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((para) => {
      const lines = para.split("\n").map((l) => l.trimEnd());
      return lines.some((l) => /^\s*(\||```)/.test(l)) ? lines.join("\n") : lines.join("  \n");
    })
    .join("\n\n");
}

/** `/goal`'s last verdict since `sinceMs`, as the terminal says it — met,
    or not yet (the turn ended anyway: stopped, out of turns). The
    « sentinel » entry that only marks the goal as active is not one. Pure. */
export function goalVerdictIn(jsonl: string, sinceMs: number): string | null {
  let last: string | null = null;
  for (const e of entriesSince(jsonl, sinceMs, '"goal_status"')) {
    const a = e.attachment as { type?: unknown; met?: unknown; sentinel?: unknown; condition?: unknown; reason?: unknown } | undefined;
    if (!a || a.type !== "goal_status" || a.sentinel === true) continue;
    const why = typeof a.reason === "string" && a.reason.trim() ? a.reason.trim() : typeof a.condition === "string" ? a.condition.trim() : "";
    last = `${a.met === true ? "**Goal met**" : "**Goal not met yet**"}${why ? ` — ${why}` : ""}`;
  }
  return last;
}

/** What `/model` and `/effort` changed, read in their answers (« Set model
    to `Haiku 4.5` for this session only », « Set effort level to low (this
    session only)… »), so the conversation's picker follows the session
    instead of showing a model it no longer runs. `models`: the session's
    model options, to turn a display name back into the value. Pure. */
export function settingsChanged(outputs: readonly string[], models: ReadonlyArray<{ value: string; name: string }>): { model?: string; effort?: string } {
  const out: { model?: string; effort?: string } = {};
  const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
  for (const text of outputs) {
    const model = /^Set model to `([^`]+)`/m.exec(text)?.[1];
    if (model) {
      const hit = models.find((m) => m.value === model) ?? models.find((m) => norm(m.name) === norm(model));
      if (hit) out.model = hit.value;
    }
    const effort = /^Set effort level to ([a-z]+)\b/im.exec(text)?.[1];
    if (effort) out.effort = effort.toLowerCase();
  }
  return out;
}

/** Claude Code's folder name for a working directory. */
export const projectSlug = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

const configDir = () => process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude");

/** The transcript folder of a session: the one holding `<session>.jsonl`
    (Claude Code shortens a very long folder name), else the one the cwd
    names. */
function transcriptDir(cwd: string, sessionId: string): string | null {
  const projects = path.join(configDir(), "projects");
  const named = path.join(projects, projectSlug(cwd));
  if (fs.existsSync(path.join(named, `${sessionId}.jsonl`))) return named;
  try {
    for (const d of fs.readdirSync(projects, { withFileTypes: true })) {
      if (d.isDirectory() && fs.existsSync(path.join(projects, d.name, `${sessionId}.jsonl`))) return path.join(projects, d.name);
    }
  } catch {
    /* no transcripts at all */
  }
  return fs.existsSync(named) ? named : null;
}

const TAIL = 512 * 1024;

function tailOf(file: string): string {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/** The tails of the session folder's transcripts touched since `sinceMs`,
    oldest first. Synchronous: read at the first word of a reply, before
    that word is passed on. */
export function recentTranscripts(cwd: string, sessionId: string, sinceMs: number): string[] {
  const dir = transcriptDir(cwd, sessionId);
  if (!dir) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ file: path.join(dir, f), at: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter((f) => f.at >= sinceMs - 2000)
      .sort((a, b) => a.at - b.at)
      .map((f) => tailOf(f.file));
  } catch {
    return [];
  }
}

/** The answers Claude Code's local commands wrote since `sinceMs` in this
    session's transcript folder. Claude Code writes its transcript a few
    milliseconds after answering: two more looks if nothing is there yet. */
export async function claudeLocalOutputs(cwd: string, sessionId: string, sinceMs: number): Promise<string[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 250));
    const found = recentTranscripts(cwd, sessionId, sinceMs).flatMap((t) => localOutputsIn(t, sinceMs));
    if (found.length) return found;
  }
  return [];
}

/** `/goal`'s verdict since `sinceMs`, if Claude Code wrote one. */
export const claudeGoalVerdict = (cwd: string, sessionId: string, sinceMs: number): string | null =>
  recentTranscripts(cwd, sessionId, sinceMs)
    .map((t) => goalVerdictIn(t, sinceMs))
    .filter((v): v is string => v !== null)
    .at(-1) ?? null;
