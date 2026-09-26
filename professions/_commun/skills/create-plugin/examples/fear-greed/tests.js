const sample = {
  data: [
    { value: "72", value_classification: "Greed", timestamp: "1758758400" },
    { value: "65", value_classification: "Greed", timestamp: "1758672000" },
    { value: "38", value_classification: "Fear", timestamp: "1758585600" },
  ],
};

test("an API error is said, with what to do", async () => {
  mock.fetch("https://api.alternative.me/fng/", { status: 500, text: "down" });
  const r = await plugin.tool("FearGreedIndex", {});
  assertEqual(r.ok, false);
  assertIncludes(r.output, "answered 500");
});

test("today's value, the trend, and a card", async () => {
  mock.fetch("https://api.alternative.me/fng/", { json: sample });
  const r = await plugin.tool("FearGreedIndex", {});
  assertIncludes(r.output, "72 (Greed)");
  assertIncludes(r.output, "38 thirty days ago");
  assertEqual(r.card.kind, "facts");
});

test("the tab gets the days in order, oldest first", async () => {
  const days = await plugin.action("history", {});
  assertEqual(days.map((d) => d.value), [38, 65, 72]);
  assertEqual(days[2].date, "2025-09-25");
});
