# BytNode-AI

**BytNode-AI** is a local app for AI finance agents, made by [BytNode](https://bytnode.com).

You create agents, give each one a profession and a folder to work in, and talk to them in your
browser. They read live market data, write and run code, chart, backtest and follow your exchange
accounts — on your own computer. Models come from your OpenRouter key or from the subscription you
already have: Claude, ChatGPT, GitHub Copilot or Grok.

Documentation: https://ai.bytnode.com/docs

## Early version

BytNode-AI is young and changes quickly. **Expect breaking changes between versions.**

Agents run commands and write files on your machine, and can trade on the exchange accounts you
connect. **Read the [safety notice](SAFETY.md) before running it.**

## Run

### From npm

Install [Node.js](https://nodejs.org) (20.19 or newer), then run:

```bash
npx bytnode-ai
```

This installs the `bytnode-ai` command and opens the app at http://localhost:3777. After that,
just run `bytnode-ai`. Stop it with **Ctrl-C**.

- `npx bytnode-ai@latest` updates it.
- `--port 4000` uses another port, `--no-open` does not open the browser.

A short setup asks for your profile and how you pay for models, then opens on your first agent's welcome.
See the [install guide](https://ai.bytnode.com/docs/install).

### From source

```bash
git clone https://github.com/benjfrem07/bytnode-ai.git
cd bytnode-ai
npm install
npm run dev
```

The app opens at http://localhost:3777 and reloads as you edit.

## Community and support

- Report a bug or suggest an idea in [GitHub Issues](https://github.com/benjfrem07/bytnode-ai/issues).
- Report a security problem privately, as described in [SAFETY.md](SAFETY.md#reporting-a-security-problem).
- Get a BytNode market-data key at [bytnode.com](https://bytnode.com).

## Development

Start with the [architecture documentation](ARCHITECTURE.md): how the app is built, where each
part lives, and the commands to check a change (`npm run typecheck`, `npm run lint`, `npm test`).

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free for personal, research, educational and nonprofit
use. For commercial use, contact BytNode at https://bytnode.com.
Versions up to 0.1.3 were published under the MIT license and remain so.
