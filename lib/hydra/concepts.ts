/**
 * Turns a shop description into the concept nodes that make a project findable
 * later.
 *
 * Recall lives or dies on entity resolution: "an organic skincare store", "the
 * organic skin care brand" and "my skincare shop" have to land on the same
 * nodes, or asking for yesterday's site finds nothing. That work happens here,
 * at ingest time, rather than in the query — which is the whole reason the graph
 * can answer with an exact match instead of a similarity score.
 *
 * The normalisation is deliberately mechanical rather than a model call: it runs
 * on the generation hot path, it has to be identical for the same words every
 * time (an id is a hash of the normalised form), and it must not add a second
 * failure mode to a request that already depends on Claude.
 */

/** Words that describe the request, not the shop. */
const STOPWORDS = new Set([
  "a", "about", "add", "all", "also", "an", "and", "any", "are", "as", "at", "be", "been", "brand",
  "build", "business", "but", "buy", "by", "can", "clean", "create", "design", "do", "each", "few",
  "for", "from", "generate", "get", "give", "has", "have", "her", "here", "his", "how", "i", "if",
  "in", "into", "is", "it", "its", "just", "like", "look", "looks", "make", "many", "me", "more",
  "most", "my", "need", "new", "no", "not", "of", "on", "one", "only", "or", "other", "our", "out",
  "over", "page", "put", "same", "section", "sell", "sells", "set", "she", "should", "show", "site",
  "so", "some", "store", "such", "than", "that", "the", "their", "them", "then", "there", "these",
  "they", "this", "those", "through", "to", "too", "under", "up", "use", "very", "want", "wants",
  "was", "way", "we", "well", "were", "what", "when", "where", "which", "while", "who", "will",
  "with", "would", "you", "your", "website", "shop", "landing", "product", "please", "using",
]);

/**
 * Spelling and phrasing variants that must resolve to one node. Keys are the
 * normalised token, values the canonical form.
 */
const SYNONYMS: Record<string, string> = {
  skin: "skincare",
  skincare: "skincare",
  cosmetic: "skincare",
  cosmetics: "skincare",
  beauty: "skincare",
  natural: "organic",
  organic: "organic",
  ecofriendly: "sustainable",
  eco: "sustainable",
  green: "sustainable",
  sustainable: "sustainable",
  coffee: "coffee",
  espresso: "coffee",
  roastery: "coffee",
  apparel: "clothing",
  clothes: "clothing",
  clothing: "clothing",
  fashion: "clothing",
  wear: "clothing",
  sneaker: "footwear",
  shoe: "footwear",
  footwear: "footwear",
  jewelry: "jewellery",
  jewellery: "jewellery",
  furniture: "furniture",
  decor: "homeware",
  homeware: "homeware",
  home: "homeware",
  kitchen: "kitchenware",
  kitchenware: "kitchenware",
  fitness: "fitness",
  gym: "fitness",
  workout: "fitness",
  supplement: "supplements",
  supplements: "supplements",
  pet: "pets",
  pets: "pets",
  dog: "pets",
  cat: "pets",
  candle: "candles",
  candles: "candles",
  tech: "electronics",
  gadget: "electronics",
  electronics: "electronics",
  minimal: "minimal",
  minimalist: "minimal",
  luxury: "luxury",
  premium: "luxury",
  highend: "luxury",
  playful: "playful",
  bold: "bold",
  vintage: "vintage",
  retro: "vintage",
  modern: "modern",
  contemporary: "modern",
};

export interface Concept {
  /** Normalised, stable key — this is what gets hashed into a node id. */
  key: string;
  /** Human-readable form, shown in the UI when a memory is recalled. */
  label: string;
  /** Multi-word concepts identify a shop far better than single words. */
  weight: number;
}

/** Strips the common English plural without mangling words like "glass". */
function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("sses") || word.endsWith("shes") || word.endsWith("ches")) return word.slice(0, -2);
  if (word.endsWith("ss")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function canonical(word: string): string {
  const singular = singularize(word);
  return SYNONYMS[singular] ?? SYNONYMS[word] ?? singular;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((token) => token.length > 0);
}

const MAX_CONCEPTS = 12;

/**
 * Extracts the concepts a prompt is about, strongest first.
 *
 * Adjacent surviving tokens also form a bigram, because "organic skincare" is a
 * far better identifier for a shop than either word alone — and a bigram match
 * is what separates "the skincare site" from every other site that happened to
 * mention skin.
 */
function conceptsOf(text: string): Concept[] {
  const tokens = tokenize(text);
  const kept: string[] = [];

  for (const token of tokens) {
    if (token.length < 3 || STOPWORDS.has(token)) continue;
    if (/^\d+$/.test(token)) continue;
    kept.push(canonical(token));
  }

  const scored = new Map<string, Concept>();

  const add = (key: string, label: string, weight: number): void => {
    const existing = scored.get(key);
    if (existing) {
      existing.weight += weight;
      return;
    }
    scored.set(key, { key, label, weight });
  };

  for (const token of kept) add(token, token, 1);

  for (let index = 0; index + 1 < kept.length; index += 1) {
    const left = kept[index];
    const right = kept[index + 1];
    if (left === undefined || right === undefined || left === right) continue;
    add(`${left} ${right}`, `${left} ${right}`, 3);
  }

  return [...scored.values()].sort((a, b) => b.weight - a.weight);
}

export function extractConcepts(text: string): Concept[] {
  return conceptsOf(text).slice(0, MAX_CONCEPTS);
}

/** What a request and one shop's own words turned out to have in common. */
export interface ShopMatch {
  score: number;
  matched: readonly string[];
}

/**
 * How strongly a request describes a particular shop.
 *
 * Shared with recall on purpose. Recall weighs the request against concepts
 * recorded at ingest; this weighs the same request against the shop's own name
 * and summary. Different inputs, deliberately the same vocabulary and the same
 * scoring, so that when the two disagree it is because one of them could see
 * something the other could not — not because they were applying different
 * rules to the same question.
 *
 * Uncapped on the shop side: `extractConcepts` keeps the twelve strongest,
 * which for a summary long enough to be worth matching means the bigrams
 * crowd out the single words that carry the domain.
 */
export function describesShop(request: string, shopText: string): ShopMatch {
  const wanted = extractConcepts(request);
  if (wanted.length === 0) return { score: 0, matched: [] };

  const has = new Set(conceptsOf(shopText).map((concept) => concept.key));

  let score = 0;
  const matched: string[] = [];

  for (const concept of wanted) {
    if (!has.has(concept.key)) continue;
    score += concept.weight;
    matched.push(concept.label);
  }

  return { score, matched };
}

/**
 * Every shop the request describes, scored, by project id.
 *
 * Recall has usually proposed one of these already, but it proposes from
 * concepts recorded at ingest — the words of the prompts that built the shop,
 * which a later request may describe quite differently. Reading the shop's own
 * name and summary is a second angle on the same question; running it through
 * the same scorer is what keeps the two from answering it by different rules.
 *
 * Shops the request says nothing about are simply absent, which is the signal
 * that the dates are all there is to go on.
 */
export function describeShops(
  shops: readonly { projectId: string; name: string; summary: string }[],
  request: string,
): Map<string, ShopMatch> {
  const matches = new Map<string, ShopMatch>();

  for (const shop of shops) {
    const match = describesShop(request, `${shop.name} ${shop.summary}`);
    if (match.score > 0) matches.set(shop.projectId, match);
  }

  return matches;
}

/* ────────────────────────── relative time cues ─────────────────────────── */

export interface TimeCue {
  /** Epoch ms; recall prefers projects touched at or after this. */
  since: number;
  /** What the user said, for the memory chip: "yesterday". */
  phrase: string;
}

const DAY_MS = 86_400_000;

/**
 * Reads phrases like "yesterday" or "last week" out of a prompt.
 *
 * "Build the site I made yesterday" carries two retrieval signals, and the time
 * one is the sharper of the two — plenty of shops mention skincare, but only one
 * was touched yesterday. Windows are generous on purpose: someone saying
 * "yesterday" at 1am rarely means the last 24 hours literally.
 */
export function extractTimeCue(text: string, now: number = Date.now()): TimeCue | null {
  const lowered = text.toLowerCase();

  const patterns: readonly { pattern: RegExp; days: number; phrase: string }[] = [
    { pattern: /\byesterday\b/, days: 2, phrase: "yesterday" },
    { pattern: /\bearlier today\b|\bthis morning\b/, days: 1, phrase: "earlier today" },
    { pattern: /\blast night\b/, days: 2, phrase: "last night" },
    { pattern: /\bthe other day\b/, days: 4, phrase: "the other day" },
    { pattern: /\blast week\b|\bthis week\b/, days: 9, phrase: "last week" },
    { pattern: /\blast month\b/, days: 35, phrase: "last month" },
  ];

  for (const { pattern, days, phrase } of patterns) {
    if (pattern.test(lowered)) return { since: now - days * DAY_MS, phrase };
  }

  const relative = /\b(\d{1,2})\s+days?\s+ago\b/.exec(lowered);
  if (relative?.[1]) {
    const days = Number.parseInt(relative[1], 10);
    return { since: now - (days + 1) * DAY_MS, phrase: `${days} days ago` };
  }

  return null;
}

/**
 * Whether a prompt is asking to build on past work at all.
 *
 * Recall is only injected when the user reaches for it. Without this check every
 * new shop would inherit the palette of whatever they built last, which is the
 * opposite of helpful.
 */
export function referencesPastWork(text: string): boolean {
  return /\b(yesterday|last night|last week|last month|earlier today|the other day|days? ago|previous|earlier|before|again|that (site|shop|store|page|one)|the one i|i (built|made|created|had)|same (as|style|look|brand|ui)|like (my|the) (last|previous|other))\b/i.test(
    text,
  );
}

/**
 * Whether the prompt asks for the *same thing again* rather than for something
 * about a subject.
 *
 * The distinction decides what to do when a prompt reaches back but matches no
 * concepts, which happens more often than it looks: "create a website same as
 * yesterday, take the same UI, just change the name to Apple" describes no shop
 * at all — every content word in it belongs to the new request, not the old
 * one — so there is nothing for concept overlap to work with.
 *
 * "That motorcycle parts catalogue I built last week" is the case that must not
 * be treated the same way. It names a subject; if the graph has no motorcycle
 * shop then the user is misremembering, and handing them their skincare site
 * because it happens to be the newest thing in the window would be worse than
 * finding nothing. Asking for sameness is the signal that there is no subject
 * to get wrong.
 */
export function requestsTheSame(text: string): boolean {
  return /\b(the same\b|same (as|thing|one|ui|design|look|layout|style|site|shop|page|brand|theme|structure)|identical|copy (of|it|that|the)|(just|exactly) like|like (that|this|the last) (one|site|shop|page))/i.test(
    text,
  );
}
