// radar-2.2 — the token launch radar's scoring model.
//
// Snapshot in, ranked board out. Nothing here is hand-written per protocol:
// every multiple is measured at run time from the protocols whose token already
// trades, and every row is scored by the same formula. The dashboard shows the
// working for each row, so a reader can check any implied value by hand.
//
// How a protocol is valued
//   live        a protocol with a positive market cap, positive TVL, and a
//               category other than CEX. A market cap of exactly zero is not a
//               traded token, so it is not a comparable.
//   ratio       mcap_usd / tvl_usd — what the market pays for $1 of TVL.
//   multiple    per category, the median live ratio, pulled toward the global
//               median with a prior of 3: (n*median + 3*global) / (n + 3),
//               clamped to [0.02, 1.0]. A category needs at least 3 live
//               protocols before it earns a multiple of its own; with fewer,
//               or none, it falls back to the global median, so one small
//               protocol can never price a whole category by itself.
//   growth      7-day TVL change, clamped to [-50, 100]; factor 1 + growth/100 * 0.5.
//   maturity    days from listed_at to as_of (365 when unknown);
//               factor 0.6 + min(age, 1095)/1095 * 0.4.
//   chains      factor 1 + min(chains - 1, 4) * 0.02, at most 1.08.
//   implied     round(TVL * multiple * growth * maturity * chains),
//               floored at 1 and capped at 1e14.
//
// What the board covers
// The whole 40-protocol watchlist, plus every pre-token protocol that survives
// the exclusion rules, at any TVL: the $50M floor defines the watchlist, it is
// not a ceiling on discovery, and the biggest pre-token protocols are the most
// valuable finds. Liquid-staking and liquid-restaking protocols are ranked —
// that family demonstrably launches tokens. Bridges are left out: their
// biggest entries are wrapped-asset and custodial products, and no field in
// the record separates those from the farmable few, so ranking them would put
// infrastructure at the top of a farming board. Protocols whose token already
// trades are never ranked; they appear apart, on the Live tab, as the market
// values the multiples are measured from.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model label, shown on the dashboard and in the data file. */
export const MODEL_VERSION = 'radar-2.2';

/** Every constant the model uses; the Methodology tab states them all. */
export const MODEL = {
  shrink_prior: 3,
  min_category_live: 3,
  multiple_min: 0.02,
  multiple_max: 1.0,
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_max_extra: 4,
} as const;

/** One live comparable behind a category multiple: name and own mcap/TVL. */
export interface CategoryTop {
  name: string;
  ratio: number;
}

/** One category's evidence: live count, their median ratio, the multiple used. */
export interface CategoryMultiple {
  category: string;
  live_n: number;
  live_median: number;
  multiple: number;
  /** The three biggest live comparables by market cap — the evidence shown. */
  top: CategoryTop[];
}

/** The measured multiples: the global median and one entry per live category. */
export interface Multiples {
  global_median: number;
  live_count: number;
  by_category: CategoryMultiple[];
}

/** One protocol's implied-value breakdown, exactly as the dashboard shows it. */
export interface ModelBreakdown {
  category_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  age_days: number | null;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  token_status: 'no token on record';
  watchlist: boolean;
  model: ModelBreakdown;
  farm_steps: string[];
}

/** One live-token protocol for the Live tab: the market's value, not the model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  ratio: number;
}

/** Everything the dashboard renders, written out as data.js. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: typeof MODEL;
  multiples: Multiples;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** Raised when the snapshot is not a shape this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Median of a non-empty list: the middle value, or the mean of the two middles. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A finite number, or `fallback` when the value is missing or not finite. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, never negative; null when a date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol whose token trades and can serve as a comparable. */
export function isLive(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX';
}

/** The multiples, measured from the snapshot's live protocols at run time. */
export function measureMultiples(snapshot: Snapshot): Multiples {
  const live = snapshot.protocols.filter(isLive);
  const ratios = live.map((p) => p.mcap_usd! / p.tvl_usd);
  const global = median(ratios);
  const grouped = new Map<string, { name: string; ratio: number; mcap: number }[]>();
  for (const p of live) {
    const key = p.category ?? 'Uncategorized';
    const row = { name: p.name, ratio: p.mcap_usd! / p.tvl_usd, mcap: p.mcap_usd! };
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [row]);
    else bucket.push(row);
  }
  const byCategory: CategoryMultiple[] = [...grouped.entries()]
    .map(([category, rs]) => {
      const med = median(rs.map((r) => r.ratio));
      const n = rs.length;
      // Fewer than three live comparables: the category borrows the global
      // median instead of letting one or two protocols price it. At n >= 3
      // the median is shrunk toward the global median with the prior.
      const multiple =
        n < MODEL.min_category_live
          ? Math.min(MODEL.multiple_max, Math.max(MODEL.multiple_min, global))
          : Math.min(
              MODEL.multiple_max,
              Math.max(MODEL.multiple_min, (n * med + MODEL.shrink_prior * global) / (n + MODEL.shrink_prior)),
            );
      // Evidence for the drawer: the three biggest comparables by market cap.
      const top = [...rs]
        .sort((a, b) => b.mcap - a.mcap)
        .slice(0, 3)
        .map((r) => ({ name: r.name, ratio: round4(r.ratio) }));
      return { category, live_n: n, live_median: round4(med), multiple: round4(multiple), top };
    })
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { global_median: round4(global), live_count: live.length, by_category: byCategory };
}

/** A category's multiple from the measured table, or the global median when it has no live protocol. */
function multipleFor(multiples: Multiples, category: string | null): number {
  const key = category ?? 'Uncategorized';
  const entry = multiples.by_category.find((m) => m.category === key);
  return entry === undefined ? multiples.global_median : entry.multiple;
}

/** One protocol's implied value and its breakdown, from the snapshot's own figures. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  multiples: Multiples,
): { implied: number; breakdown: ModelBreakdown } {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, finite(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * MODEL.growth_weight;
  const ageForModel = age ?? MODEL.unknown_age_days;
  const maturityMult =
    MODEL.maturity_floor + (Math.min(Math.max(ageForModel, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
  const chainMult = 1 + Math.min(Math.max(p.chains.length - 1, 0), MODEL.chain_max_extra) * MODEL.chain_step;
  const catMult = multipleFor(multiples, p.category);
  const implied = Math.min(1e14, Math.max(1, Math.round(p.tvl_usd * catMult * growthMult * maturityMult * chainMult)));
  return {
    implied,
    breakdown: {
      category_multiple: round4(catMult),
      growth_pct: round2(growthPct),
      growth_multiplier: round4(growthMult),
      maturity_multiplier: round4(maturityMult),
      chain_multiplier: round4(chainMult),
      age_days: age,
    },
  };
}

/** Whether a protocol records no token at all in the snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The exclusion rules for a pre-token protocol. Bridges stay out (see the
  header); liquid-staking and liquid-restaking are ranked since radar-2.2. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Restaked BTC', 'CEX']);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isExcluded(p: SnapshotProtocol): boolean {
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  return false;
}

/** The protocols the board ranks: the whole watchlist first, then every
  pre-token protocol that passes the exclusion rules, whatever its TVL. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const multiples = measureMultiples(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isPreToken(p) && !isExcluded(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, breakdown } = scoreProtocol(p, snapshot.as_of, multiples);
    return { p, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.breakdown.age_days,
    implied_value_usd: s.implied,
    token_status: 'no token on record' as const,
    watchlist: snapshot.watchlist.includes(s.p.slug),
    model: s.breakdown,
    farm_steps: farmSteps(s.p, s.breakdown.age_days),
  }));
}

/** The live-token protocols, by market cap, for the Live tab: all of them,
  so the tab is the full evidence set the multiples are measured from. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter(isLive)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      ratio: round4(p.mcap_usd! / p.tvl_usd),
    }));
}

// ---------------------------------------------------------------- farm plans

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Gas for one transaction on a chain, as a cost phrase: cheap chains cost cents, Ethereum costs dollars. */
function gasFor(chain: string): { setup: string; weekly: string } {
  if (chain === 'Solana') return { setup: 'about $0.01 of gas', weekly: 'about $0.05 of gas a week' };
  if (chain === 'Ethereum') return { setup: 'about $5–$15 of gas', weekly: 'about $5 of gas a week' };
  const cheap = new Set([
    'Arbitrum', 'Arbitrum Nova', 'Base', 'Optimism', 'OP Mainnet', 'Ink', 'Blast', 'Linea', 'Scroll',
    'zkSync Era', 'Mode', 'Fraxtal', 'Polygon', 'Polygon zkEVM', 'BNB Chain', 'BSC', 'Avalanche',
    'Mantle', 'Berachain', 'Sonic', 'Sei', 'Sui', 'Aptos', 'Starknet', 'Gnosis', 'Celo', 'Fantom',
    'Cronos', 'Kava', 'Moonbeam', 'Harmony', 'Metis', 'Boba', 'Zora', 'World Chain', 'Unichain',
  ]);
  if (cheap.has(chain)) return { setup: 'about $0.10–$1 of gas', weekly: 'about $0.50 of gas a week' };
  return { setup: 'about $1–$3 of gas', weekly: 'about $2 of gas a week' };
}

/** The category family's one qualifying action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const fam = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (fam === 'chain') return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds in an app on ${chain}.`;
  if (fam.includes('risk curator') || fam.includes('onchain capital allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (fam.includes('basis trading')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position open.`;
  if (fam.includes('lend') || fam.includes('cdp') || fam.includes('collateral') || fam.includes('uncollateralized')) return `Supply $${capital} of USDC to ${name} on ${chain}, borrow a small amount against it, and keep both sides open.`;
  if (fam.includes('dex') || fam.includes('leveraged farm') || fam === 'farm' || fam.includes('liquidity manager')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (fam.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (fam.includes('staking') || fam.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (fam.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (fam.includes('payment')) return `Top up $${capital} through ${name} on ${chain} and make one real payment with it.`;
  if (fam.includes('governance')) return `Lock $${capital} with ${name} on ${chain} and vote in its next governance round.`;
  if (fam.includes('prediction')) return `Fund $${capital} on ${name} and place one market position on ${chain}.`;
  if (fam.includes('derivative') || fam.includes('interest rate')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge on ${chain}.`;
  if (fam.includes('cedefi')) return `Deposit $${capital} into ${name}'s CeDeFi vault on ${chain} and keep the vault shares.`;
  if (fam.includes('stablecoin') || fam.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (fam.includes('launchpad')) return `Stake $${capital} with ${name} on ${chain} and register for its next launch allocation.`;
  if (fam.includes('anchor btc') || fam.includes('decentralized btc')) return `Deposit $${capital} of the BTC-backed asset through ${name} on ${chain} and hold it.`;
  if (fam.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  if (fam.includes('crypto card')) return `Order ${name}'s card on ${chain}, top it up with $${capital}, and make one real payment.`;
  if (fam.includes('yield')) return `Deposit $${capital} into ${name}'s yield vault on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** One step as a single string: its action, then its cost and time, within the gate's 20..600 characters. */
function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list. Step 3 works the protocol's second
 * chain when it has one, so a multi-chain position counts twice; on a single
 * chain it makes a second, different qualifying move instead.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const second =
    p.chains.length > 1
      ? stepText(
          `Repeat the same qualifying move on ${p.chains[1]} too, so the position counts on two chains instead of one`,
          `${gasFor(p.chains[1]!).setup} on ${p.chains[1]}`,
          '10 minutes',
        )
      : stepText(
          'Make a second, different qualifying move on the same chain — a swap, a second deposit or a vote — so the wallet shows more than one kind of activity',
          gas.setup,
          '10 minutes',
        );
  return [
    stepText(
      'Open a fresh wallet used only for farming this protocol, and store its seed phrase offline on paper, never in a screenshot or a chat',
      'under $3 of gas for the first transaction',
      '5 minutes',
    ),
    stepText(actionFor(p, capital, chain), `$${capital} of capital and ${gas.setup}`, '15 minutes to set up'),
    second,
    stepText(
      `Once a week, make one qualifying move on ${p.name} — a small deposit, a borrow, a swap or a vote — and leave the position open between moves`,
      gas.weekly,
      '10 minutes a week',
    ),
    stepText(
      `Hold the position for at least ${hold} days, so the activity is counted in more than one snapshot`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
    stepText(
      `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from a link that page publishes — never pay anyone to claim for you`,
      'no fee to check, and never pay to claim',
      '10 minutes',
    ),
    stepText(
      'Write the wallet address, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it later',
      'nothing but the log',
      '5 minutes',
    ),
  ];
}

// ---------------------------------------------------------------- assembly

/** Everything the dashboard needs, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const multiples = measureMultiples(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: MODEL,
    multiples,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the gate's 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** The dashboard's data as one script: `window.RADAR = {...};`, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
