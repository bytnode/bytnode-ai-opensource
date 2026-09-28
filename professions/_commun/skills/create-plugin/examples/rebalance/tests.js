/* Every test() starts fresh: set the mocks it needs inside it. */
const account = [{ id: "acc-1", label: "Binance main", exchange: "binance", testnet: true }];
const world = (btc, usdt) => {
  mock.accounts(account);
  mock.exchange("ticker", { symbol: "BTC/USDT", last: 60000 });
  mock.exchange("balance", { balances: { BTC: { total: btc }, USDT: { total: usdt } } });
};

test("within the band, nothing is proposed", async () => {
  world(0.1, 5800);
  const r = await plugin.tool("RebalanceCheck", {});
  assertIncludes(r.output, "Within the band");
  assertIncludes((await plugin.tool("RebalancePropose", {})).output, "Nothing to propose");
  assertEqual((await plugin.confirmations()).length, 0);
});

test("out of the band, it proposes the order and never places it", async () => {
  world(0.05, 9000);
  const r = await plugin.tool("RebalancePropose", { account: "Binance main" });
  assertIncludes(r.output, "waits for their confirmation");
  const [c] = await plugin.confirmations();
  assertEqual(c.tool, "PlaceOrder");
  assertEqual(c.args, { symbol: "BTC/USDT", side: "buy", type: "market", quoteAmount: 3000 });
});

test("records the user's decision on a proposal", async () => {
  world(0.05, 9000);
  await plugin.tool("RebalancePropose", { account: "Binance main" });
  const [c] = await plugin.confirmations();
  await plugin.confirm(c.id, "denied");
});
