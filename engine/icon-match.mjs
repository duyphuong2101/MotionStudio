import { ICON_NAMES } from '../motion-kit/icons.mjs';

/**
 * English words that point to each built-in icon. Order matters: a tie in hits goes to the earlier entry.
 * No word appears under two icons (tests/repair.test.mjs), and every built-in icon has an entry.
 */
export const ICON_KEYWORDS = {
  // Shopping
  cart: ['cart', 'checkout', 'buy', 'purchase'],
  bag: ['bag', 'shopping', 'tote', 'handbag'],
  store: ['store', 'shop', 'storefront', 'retail', 'boutique', 'outlet'],
  tag: ['tag', 'label', 'price', 'pricing', 'sale', 'deal'],
  percent: ['percent', 'discount', 'off', 'saving', 'save', 'promo', 'coupon'],
  gift: ['gift', 'present', 'bonus', 'reward'],
  card: ['card', 'credit', 'debit', 'payment', 'pay'],
  wallet: ['wallet', 'cash', 'money', 'budget'],
  coins: ['coin', 'cent', 'cheap', 'affordable', 'cost'],
  receipt: ['receipt', 'invoice', 'bill', 'billing'],
  barcode: ['barcode', 'scan', 'scanner', 'sku'],
  basket: ['basket', 'grocery', 'groceries', 'produce'],
  // Delivery
  truck: ['truck', 'shipping', 'ship', 'shipped', 'delivery', 'deliver', 'delivered', 'freight', 'courier', 'dispatch'],
  box: ['box', 'package', 'parcel', 'order', 'packaging', 'unbox'],
  return: ['return', 'refund', 'exchange', 'returnable', 'undo'],
  pin: ['pin', 'location', 'address', 'map', 'nearby', 'local'],
  globe: ['globe', 'world', 'worldwide', 'global', 'international', 'country', 'countries'],
  clock: ['clock', 'hour', 'time', 'minute'],
  timer: ['timer', 'fast', 'quick', 'speed', 'second', 'instant', 'rapid'],
  calendar: ['calendar', 'date', 'schedule', 'booking', 'book', 'appointment', 'weekly', 'monthly'],
  // Trust
  badge: ['badge', 'certified', 'verified', 'approved', 'official', 'genuine', 'authentic'],
  'shield-check': ['secure', 'security', 'safe', 'safety', 'protection', 'privacy', 'guarantee', 'warranty'],
  medal: ['medal', 'award', 'quality'],
  trophy: ['trophy', 'win', 'winner', 'prize', 'best', 'champion'],
  crown: ['crown', 'premium', 'luxury', 'vip', 'exclusive', 'elite'],
  'thumbs-up': ['thumb', 'like', 'recommend', 'recommended', 'positive', 'good'],
  handshake: ['handshake', 'partner', 'partnership', 'agreement', 'trust', 'together', 'collaboration'],
  check: ['check', 'done', 'complete', 'ready', 'yes', 'included', 'easy'],
  users: ['user', 'people', 'team', 'community', 'customer', 'member', 'everyone'],
  headset: ['headset', 'support', 'help', 'service', 'helpdesk', 'agent', 'contact'],
  // Product
  shirt: ['shirt', 'tshirt', 'clothing', 'clothes', 'apparel', 'wear', 'fashion', 'tee'],
  sneaker: ['sneaker', 'shoe', 'footwear', 'running', 'run', 'sport'],
  hanger: ['hanger', 'wardrobe', 'closet', 'outfit', 'collection'],
  ruler: ['ruler', 'size', 'sizing', 'fit', 'measure', 'measurement'],
  diamond: ['diamond', 'jewelry', 'jewel', 'gem', 'precious', 'ring'],
  sparkle: ['sparkle', 'new', 'magic', 'shine', 'clean', 'fresh'],
  palette: ['palette', 'color', 'colour', 'design', 'creative', 'paint', 'style'],
  scissors: ['scissors', 'cut', 'tailor', 'craft', 'diy', 'trim'],
  phone: ['phone', 'mobile', 'app', 'smartphone', 'call'],
  laptop: ['laptop', 'computer', 'desktop', 'online', 'web', 'website', 'software', 'digital'],
  headphones: ['headphone', 'audio', 'music', 'sound', 'listen', 'podcast'],
  camera: ['camera', 'photo', 'picture', 'video', 'film', 'shoot', 'photography'],
  battery: ['battery', 'power', 'charge', 'charging', 'energy', 'lasting'],
  plug: ['plug', 'electric', 'electricity', 'socket', 'connect', 'integration', 'plugin'],
  // Life
  home: ['home', 'house', 'living', 'room', 'apartment', 'household'],
  sun: ['sun', 'summer', 'sunny', 'solar', 'sunshine'],
  snowflake: ['snowflake', 'snow', 'winter', 'cold', 'cool', 'frozen', 'ice'],
  fire: ['fire', 'hot', 'heat', 'warm', 'trending', 'popular', 'flame'],
  plant: ['plant', 'garden', 'grow', 'nature', 'green', 'organic'],
  recycle: ['recycle', 'recycled', 'recyclable', 'sustainable', 'sustainability', 'reuse', 'eco'],
  paw: ['paw', 'pet', 'dog', 'cat', 'animal', 'puppy'],
  baby: ['baby', 'kid', 'child', 'children', 'infant', 'toddler', 'newborn', 'diaper'],
  coffee: ['coffee', 'cafe', 'tea', 'drink', 'morning'],
  food: ['food', 'meal', 'eat', 'dinner', 'lunch', 'restaurant', 'recipe', 'breakfast'],
  dumbbell: ['dumbbell', 'gym', 'fitness', 'workout', 'exercise', 'training', 'strength'],
  pill: ['pill', 'medicine', 'health', 'vitamin', 'pharmacy', 'supplement'],
  flask: ['flask', 'science', 'lab', 'research', 'test', 'formula', 'chemistry'],
  car: ['car', 'drive', 'driving', 'vehicle', 'auto', 'parking', 'ride'],
  plane: ['plane', 'flight', 'fly', 'travel', 'airport', 'trip', 'vacation'],
  // General
  rocket: ['rocket', 'launch', 'start', 'startup', 'boost', 'takeoff'],
  target: ['target', 'goal', 'aim', 'focus', 'precise', 'accuracy'],
  chart: ['chart', 'data', 'report', 'analytics', 'statistic', 'stat', 'metric', 'dashboard'],
  'trend-up': ['trend', 'growth', 'increase', 'rise', 'improve', 'higher', 'revenue', 'profit'],
  search: ['search', 'find', 'discover', 'look', 'explore', 'browse'],
  gear: ['gear', 'setting', 'setup', 'configure', 'automation', 'automate', 'tool', 'process'],
  bell: ['bell', 'notification', 'alert', 'reminder', 'notify'],
  mail: ['mail', 'email', 'newsletter', 'inbox', 'letter', 'subscribe'],
  eye: ['eye', 'see', 'view', 'watch', 'vision', 'visible', 'preview'],
  smile: ['smile', 'happy', 'smiley', 'joy', 'fun', 'satisfaction', 'satisfied'],
  info: ['info', 'information', 'learn', 'detail', 'faq', 'guide'],
  // The hand-drawn originals
  drop: ['drop', 'water', 'liquid', 'absorb', 'absorbent', 'absorbency', 'leak', 'waterproof', 'moisture', 'dry', 'wet'],
  shield: ['shield', 'protect', 'defend', 'defense', 'armor'],
  cloth: ['cloth', 'fabric', 'textile', 'soft', 'cotton', 'material', 'wipe'],
  heart: ['heart', 'love', 'care', 'caring', 'favorite', 'favourite', 'wellbeing'],
  circle: ['circle', 'round', 'cycle', 'loop', 'whole'],
  star: ['star', 'rating', 'review', 'rated', 'featured', 'excellent'],
  leaf: ['leaf', 'natural', 'vegan', 'herbal', 'botanical'],
  bolt: ['bolt', 'lightning', 'flash', 'powerful', 'turbo', 'performance'],
  chat: ['chat', 'message', 'talk', 'conversation', 'comment', 'feedback', 'ask', 'question', 'answer'],
  lock: ['lock', 'password', 'private', 'encrypted', 'encryption', 'login', 'secret'],
  moon: ['moon', 'night', 'sleep', 'overnight', 'evening', 'bedtime'],
};

// "returns" and "return" are one word here; "address" keeps its double s.
const stem = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const KEYWORD_SETS = Object.entries(ICON_KEYWORDS).map(([name, words]) => [name, new Set(words.map(stem))]);
const tokens = (words) => (Array.isArray(words) ? words : [words]).flatMap((w) => String(w ?? '')
  .replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
const keyOf = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
// A brand icon "mega-max" matches "MegaMax", "Mega Max" or "mega-max" in the words.
const namedIn = (name, toks) => {
  const want = keyOf(name);
  if (!want) return false;
  for (let i = 0; i < toks.length; i++) {
    let joined = '';
    for (let j = i; j < toks.length && joined.length < want.length; j++) {
      joined += toks[j];
      if (joined === want) return true;
    }
  }
  return false;
};

/**
 * The icon for a line of text (a string or a list of strings): a brand icon whose name appears in the words wins,
 * then the built-in with the most keyword hits (a tie goes to the earlier table entry); null when nothing matches.
 */
export function matchIcon(words, builtIn = ICON_NAMES, brand = []) {
  const toks = tokens(words);
  const named = brand.find((name) => namedIn(name, toks));
  if (named) return named;
  const stems = new Set(toks.map(stem));
  let best = null, most = 0;
  for (const [name, set] of KEYWORD_SETS) {
    if (!builtIn.includes(name)) continue;
    let hits = 0;
    for (const t of stems) if (set.has(t)) hits++;
    if (hits > most) { best = name; most = hits; }
  }
  return best;
}

// A partial name match needs this many letters on the shorter side, so "a" or "go" never pick an icon.
const MIN_PART = 3;
const NEAR = [
  (k, x) => k.startsWith(x) || k.endsWith(x) || x.startsWith(k) || x.endsWith(k),
  (k, x) => k.includes(x) || x.includes(k),
];

/**
 * The valid icon closest to an unknown icon name: the same letters, then a name that starts, ends or holds the
 * other (closest length wins, then list order), then the keyword table, then `fallback`, then the first built-in.
 */
export function nearestIcon(name, icons = ICON_NAMES, fallback) {
  const k = keyOf(name);
  if (k) {
    const keyed = icons.map((n) => [n, keyOf(n)]);
    const exact = keyed.find(([, x]) => x === k);
    if (exact) return exact[0];
    for (const near of NEAR) {
      let best = null, gap = Infinity;
      for (const [n, x] of keyed) {
        if (Math.min(x.length, k.length) < MIN_PART || !near(k, x)) continue;
        const d = Math.abs(x.length - k.length);
        if (d < gap) { best = n; gap = d; }
      }
      if (best) return best;
    }
    const hit = matchIcon(String(name), icons);
    if (hit) return hit;
  }
  if (fallback && icons.includes(fallback)) return fallback;
  return icons.find((n) => ICON_NAMES.includes(n)) ?? icons[0] ?? null;
}
