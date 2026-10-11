# Your skills

They go in `~/.bytnode-ai/skills/` (this folder of the repo is no longer read: it documents the
format). One folder per skill, with a `SKILL.md`:

```
~/.bytnode-ai/skills/
  analyse-funding/
    SKILL.md          ← required
    exemple.csv       ← whatever you want: the folder is copied whole
```

The `SKILL.md` starts with a header:

```markdown
---
name: analyse-funding
description: Read the funding of a perpetual and infer positioning from it — this is the line the agent reads to decide whether to open the skill
---

# Funding analysis

The instructions, in markdown. What the agent must do, in what order,
what it must avoid, the expected form of the answer.
```

`description` is the only line the agent sees at all times: it must
say **when** to open the skill, not just what it is about.

## Who sees them

- **Every agent**, whatever their access to models. The list (name +
  description) is in their prompt every turn; the body is loaded when
  they need it.
- Agents **by OpenRouter key** read them right here, through the `Skill` tool.
- Agents **by subscription** (Claude, OpenAI, Copilot, Grok)
  receive a copy in `.agents/skills/` and `.claude/skills/`
  of their workspace, where their own skill mechanisms find them. The
  copy is redone when you edit the `SKILL.md`, and a skill removed
  from here disappears from their folder.

On a name clash, the profession's skill (`professions/<profession>/skills/`)
takes precedence over this one.

## The other locations

- `professions/<profession>/skills/` — specific to one profession, shipped with the application.
- `professions/_commun/skills/` — shared by every profession.
- `<workspace>/skills/` — specific to a single agent, hand-written.
- `~/.agents/skills/` — shared with your other tools.

A skill added while a conversation is open appears at the next
message.
