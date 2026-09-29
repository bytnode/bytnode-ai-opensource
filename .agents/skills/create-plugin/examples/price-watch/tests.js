test("lists nothing at first", async () => {
  const r = await plugin.tool("PriceWatchList", {});
  assertIncludes(r.output, "no asset");
});

test("adds a pair and lists its move", async () => {
  mock.price("BTC/USDT", 60000);
  await plugin.tool("PriceWatchAdd", { symbol: "btc/usdt" });
  mock.price("BTC/USDT", 61200);
  const r = await plugin.tool("PriceWatchList", {});
  assertIncludes(r.output, "BTC/USDT 61200 (+2.00 %");
  assertEqual(r.card.kind, "table");
  assertIncludes(await plugin.prompt(), "BTC/USDT");
});

test("the job warns beyond the threshold, once", async () => {
  mock.price("ETH/USDT", 3000);
  await plugin.tool("PriceWatchAdd", { symbol: "ETH/USDT" });
  mock.price("ETH/USDT", 3060);
  await plugin.job("check");
  assertEqual((await plugin.notifications()).length, 0, "+2 % is under 3 %");
  mock.price("ETH/USDT", 3150);
  await plugin.job("check");
  const sent = await plugin.notifications();
  assertEqual(sent.length, 1);
  assertIncludes(sent[0].title, "+5.00 %");
  await plugin.job("check");
  assertEqual((await plugin.notifications()).length, 1, "the reference moved with the warning");
});
