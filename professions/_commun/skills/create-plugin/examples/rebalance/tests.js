mock.accounts([{ id: "acc-1", label: "Binance main", exchange: "binance", testnet: true }]);
mock.exchange("ticker", { symbol: "BTC/USDT", last: 60000 });

test("within the band, nothing is proposed", async () => {
  mock.exchange("balance", { balances: { BTC: { total: 0.1 }, USDT: { total: 5800 } } });
  const r = await plugin.tool("RebalanceCheck", {});
  assertIncludes(r.output, "Within the band");
  assertIncludes((await plugin.tool("RebalancePropose", {})).output, "Nothing to propose");
  assertEqual((await plugin.confirmations()).length, 0);
});

test("out of the band, it proposes the order and never places it", async () => {
  mock.exchange("balance", { balances: { BTC: { total: 0.05 }, USDT: { total: 9000 } } });
  const r = await plugin.tool("RebalancePropose", { account: "Binance main" });
  assertIncludes(r.output, "waits for their confirmation");
  const [c] = await plugin.confirmations();
  assertEqual(c.tool, "PlaceOrder");
  assertEqual(c.args, { symbol: "BTC/USDT", side: "buy", type: "market", quoteAmount: 3000 });
});

test("records the user's decision", async () => {
  const [c] = await plugin.confirmations();
  await plugin.confirm(c.id, "denied");
});
