/**
 * A deterministic model route for the harness tests and for runs without provider keys. It answers with the first
 * `accuracy` share of the words of the expected answer, takes the next latency of `latencyMs` in turn, and costs
 * `pricePer1kPages` per 1,000 pages. It is the only route that exists until a domestic API key and a self-hosted
 * endpoint are available; real adapters implement the same `complete(item)` contract.
 */
export function createMockRoute({ name, kind = 'mock', accuracy = 1, latencyMs = [100], pricePer1kPages = 0 }) {
  let calls = 0;
  return {
    name,
    kind,
    async complete(item) {
      const latency = latencyMs[calls % latencyMs.length];
      calls += 1;
      const words = item.expected.split(/\s+/).filter(Boolean);
      const kept = Math.round(words.length * accuracy);
      return { text: words.slice(0, kept).join(' '), latencyMs: latency, cost: (pricePer1kPages * item.pages) / 1000 };
    },
  };
}
