/* What a main agent is told about writing plugins, among its core tools
   (both engines: `tools-prompt.ts`, `lib/acp/prompt.ts`). Said plainly and
   early: a frontier model otherwise "knows" that an app's plugins are the
   developers' business, and answers the user that it cannot make one. */

export const PLUGIN_WRITING =
  "- PluginRead, PluginWrite, PluginCheck, PluginActivate: you CAN write a new BytNode-AI plugin for the user — new tools, a tab of its own, a job that watches and warns — when no plugin covers what they ask. It runs in a sandbox, and the user approves its permissions before it runs. Load the create-plugin skill first: it starts with questions to the user. Never answer that plugins cannot be created from the chat.";
