import { describe, expect, it } from "vitest";
import { composeView, VIEW_CSP, viewProblems } from "./view";

const kit = { css: ".bn-app{}", js: "window.bn={};" };

describe("the page of a plugin written by an agent", () => {
  it("is served as one document: the kit first, its own CSS and JS inline, the theme set", () => {
    const html = composeView(
      {
        "view/index.html": '<html data-theme="dark"><head><link rel="stylesheet" href="style.css"></head><body><div class="bn-app"></div><script src="./app.js"></script></body></html>',
        "view/style.css": ".x{color:red}",
        "view/app.js": "bn.call('list').then(render); const s = '</script>';",
      },
      kit,
      "light",
    );
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('data-theme="light"');
    expect(html).not.toContain('data-theme="dark"');
    expect(html.indexOf("data-bn-kit")).toBeLessThan(html.indexOf(".x{color:red}"));
    expect(html).toContain("<style>.x{color:red}</style>");
    expect(html).toContain("bn.call('list')");
    expect(html).not.toContain('src="./app.js"');
    /* A closing tag inside a script cannot end it early. */
    expect(html).toContain("<\\/script>");
  });

  it("has no network and an origin of its own", () => {
    expect(VIEW_CSP).toContain("connect-src 'none'");
    expect(VIEW_CSP).toContain("default-src 'none'");
    expect(VIEW_CSP).toContain("sandbox allow-scripts");
    expect(VIEW_CSP).not.toContain("allow-same-origin");
  });

  it("the check refuses what reaches outside, and scripts that do not parse", async () => {
    const r = await viewProblems(
      {
        "view/index.html": '<link rel="stylesheet" href="https://cdn.example.com/x.css"><script src="missing.js"></script><script>fetch("/api/keys")</script><script>let = ;</script>',
      },
      true,
    );
    const text = r.errors.join("\n");
    expect(text).toMatch(/a URL outside the plugin/);
    expect(text).toMatch(/a network call/);
    expect(text).toMatch(/missing\.js, which is not a file/);
    expect(text).toMatch(/SyntaxError/);
  });

  it("a declared tab needs its index.html; view files need a declared tab", async () => {
    expect((await viewProblems({}, true)).errors.join()).toMatch(/index.html is missing/);
    expect((await viewProblems({ "view/index.html": "<p>x</p>" }, false)).errors.join()).toMatch(/declares no `view`/);
  });

  it("notes a page that ignores the kit or its plugin", async () => {
    const r = await viewProblems({ "view/index.html": "<p>Hello</p>" }, true);
    expect(r.errors).toEqual([]);
    expect(r.notes.join()).toMatch(/never calls bn.call/);
    expect(r.notes.join()).toMatch(/BytNode kit/);
  });
});

describe("the kit is not overridden", () => {
  it("refuses !important and rules on the page's frame", async () => {
    const r = await viewProblems({ "view/index.html": '<style>.bn-sheet { background: transparent !important; } html, body { background: #000; }</style><div class="bn-app"></div><script>bn.call("x")</script>' }, true);
    expect(r.errors.join(" ")).toMatch(/uses !important/);
    expect(r.errors.join(" ")).toMatch(/restyles (html|\.bn-sheet)/);
  });

  it("lets a page style its own classes", async () => {
    const r = await viewProblems({ "view/index.html": '<style>.tj-note { color: var(--label-2); } .bn-sheet .tj-row { gap: 4px; }</style><div class="bn-app"></div><script>bn.call("x")</script>' }, true);
    expect(r.errors).toEqual([]);
  });

  it("notes figures set in monospace", async () => {
    const r = await viewProblems({ "view/index.html": '<span class="bn-figure-value bn-mono">1</span><script>bn.call("x")</script>' }, true);
    expect(r.notes.join()).toMatch(/monospace/);
  });
});
