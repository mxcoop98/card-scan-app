// ============================================================
// Card OCR. Same provider-registry shape as pricing.js and
// recognition.js: each provider takes an image buffer and returns
// { words, text }, and everything downstream works off that shape.
//
// v1 provider (tesseractOcr) runs locally — no API key, no vendor
// decision, no per-scan cost. It is not as good as a purpose-built
// card identifier; it is good enough to fill in fields the user
// would otherwise type, which is the whole point.
//
// Future providers slot in without changing the API surface:
//   - googleVisionOcr: better on stylised type, costs per call
//   - ximilarTcgId:    skips OCR entirely, returns the card outright
// ============================================================

import { createWorker } from 'tesseract.js';

let workerPromise = null;
// Tesseract workers handle one job at a time, so requests queue behind
// each other rather than racing for the same worker.
let queue = Promise.resolve();

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng').catch((err) => {
      // Don't cache a failed init, or every later request inherits it.
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/** Release the worker. Called on shutdown and by tests. */
export async function closeOcr() {
  if (!workerPromise) return;
  const worker = await workerPromise.catch(() => null);
  workerPromise = null;
  if (worker) await worker.terminate();
}

async function tesseractOcr(buffer) {
  const worker = await getWorker();
  // Chain onto the queue so concurrent scans don't share a worker mid-job.
  const run = queue.then(() => worker.recognize(buffer, {}, { blocks: true }));
  queue = run.catch(() => {});
  const { data } = await run;

  // tesseract.js moved word data under blocks; support both shapes so a
  // version bump doesn't silently produce zero words.
  let words = data.words;
  if (!words?.length && data.blocks) {
    words = data.blocks.flatMap((b) =>
      (b.paragraphs ?? []).flatMap((p) => (p.lines ?? []).flatMap((l) => l.words ?? []))
    );
  }
  return {
    provider: 'tesseract',
    text: data.text ?? '',
    words: (words ?? []).map((w) => ({
      text: w.text,
      confidence: w.confidence,
      bbox: w.bbox,
    })),
  };
}

const PROVIDERS = [tesseractOcr];

/**
 * Image dimensions straight from the file header.
 *
 * Needed to aim the second OCR pass at the bottom of the card. Parsing
 * two headers by hand beats adding an image library for six fields.
 * Returns null for formats we don't parse, and callers degrade to a
 * whole-image pass.
 */
export function imageSize(buf) {
  // PNG: 8-byte signature, then IHDR with width/height as big-endian u32.
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: walk the segment chain to a Start-Of-Frame marker.
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      // SOF0..SOF15, excluding DHT (c4), JPG (c8) and DAC (cc).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/**
 * Re-read just the bottom of the card looking for the collector number.
 *
 * It is printed small, often over artwork, and a whole-card pass misses it
 * about half the time — which matters more than it sounds, because the
 * number is what turns five "Charizard" candidates into one. Confining
 * OCR to the bottom strip gives it far less to be distracted by.
 */
async function readNumberFromBottom(buffer, size) {
  if (!size) return null;
  const worker = await getWorker();
  const rectangle = {
    left: 0,
    top: Math.floor(size.height * 0.82),
    width: size.width,
    height: Math.ceil(size.height * 0.18),
  };
  const run = queue.then(() => worker.recognize(buffer, { rectangle }));
  queue = run.catch(() => {});
  const { data } = await run;
  return matchCardNumber(data.text ?? '');
}

/** The "4/102" collector number, normalised (strips zero padding). */
export function matchCardNumber(text) {
  const matches = [...text.matchAll(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/g)];
  if (!matches.length) return null;
  // Last match wins: the number sits low on the card, so anything earlier
  // is more likely to be noise out of the attack text.
  const m = matches[matches.length - 1];
  return `${Number(m[1])}/${Number(m[2])}`;
}

/** Strip the HP reading that sits on the same line as the name. */
function stripHp(line) {
  return line
    .replace(/\b\d{1,3}\s*HP\b/gi, ' ')
    .replace(/\bHP\s*\d{1,3}\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Group words into lines by vertical overlap. Tesseract's own line
 * grouping isn't exposed uniformly across versions, and we need the
 * geometry anyway to find the biggest text.
 */
export function groupIntoLines(words) {
  const usable = words.filter((w) => w.text?.trim() && w.bbox);
  const lines = [];
  for (const w of usable) {
    const mid = (w.bbox.y0 + w.bbox.y1) / 2;
    const height = w.bbox.y1 - w.bbox.y0;
    const line = lines.find((l) => Math.abs(l.mid - mid) < Math.max(l.height, height) * 0.6);
    if (line) {
      line.words.push(w);
      line.mid = (line.mid * (line.words.length - 1) + mid) / line.words.length;
      line.height = Math.max(line.height, height);
    } else {
      lines.push({ words: [w], mid, height });
    }
  }
  for (const l of lines) {
    l.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    l.text = l.words.map((w) => w.text).join(' ').trim();
    l.confidence = l.words.reduce((s, w) => s + (w.confidence ?? 0), 0) / l.words.length;
    l.top = Math.min(...l.words.map((w) => w.bbox.y0));
  }
  return lines.sort((a, b) => a.mid - b.mid);
}

/** Words that are large type on a card but never part of the name. */
const NOT_A_NAME_WORD =
  /^(hp|basic|stage|evolves|from|put|on|the|card|pokemon|pokémon|trainer|energy|weakness|resistance|retreat|cost|length|weight|illus|lv)$/i;

/** Short tokens that ARE part of a name, so the length rule can't drop them. */
const NAME_SUFFIX = /^(ex|gx|v|vmax|vstar)$/i;

/** Tesseract's per-word confidence, below which a reading is noise. */
const MIN_WORD_CONFIDENCE = 70;

/**
 * Pick the card name.
 *
 * Confidence does the real work here, not size. Holo foil makes OCR
 * hallucinate large nonsense over the artwork — on a Base Set Charizard
 * the two tallest "words" are "sthce" (44px, 66% confident) and "Eon"
 * (32px, 47%), while the actual name is only 29px but 96% confident.
 * Selecting purely by height picks the garbage every time.
 *
 * So: keep only high-confidence, word-shaped tokens near the top of the
 * card, then use height among those to choose between them and to pull in
 * the rest of a multi-word name on the same baseline.
 */
export function pickNameByHeight(words, imageHeight) {
  const usable = words
    .filter((w) => w.bbox && w.text?.trim())
    .map((w) => ({
      text: w.text.trim(),
      h: w.bbox.y1 - w.bbox.y0,
      mid: (w.bbox.y0 + w.bbox.y1) / 2,
      x: w.bbox.x0,
      confidence: w.confidence ?? 0,
    }))
    // The name banner sits at the very top; artwork starts below it.
    .filter((w) => w.mid < imageHeight * 0.2)
    .filter((w) => w.confidence >= MIN_WORD_CONFIDENCE)
    .filter((w) => /^[A-Za-z][A-Za-z'’\-]{2,}$/.test(w.text) || NAME_SUFFIX.test(w.text))
    .filter((w) => !NOT_A_NAME_WORD.test(w.text));

  if (!usable.length) return null;

  const anchor = usable.reduce((a, b) => (b.h > a.h ? b : a));
  const sameSize = usable.filter(
    (w) => w.h >= anchor.h * 0.72 && Math.abs(w.mid - anchor.mid) < anchor.h * 0.8
  );

  const name = sameSize
    .sort((a, b) => a.x - b.x)
    .map((w) => w.text)
    .join(' ');

  return cleanName(name);
}

/** Trim OCR debris: stray punctuation, orphaned single letters at the edges. */
export function cleanName(raw) {
  if (!raw) return null;
  let s = stripHp(raw)
    .replace(/[^A-Za-z0-9'’\- ]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Drop leading/trailing 1-character fragments — "Pikachu ." and
  // "Blastoise J" are the usual shapes.
  const parts = s.split(' ').filter(Boolean);
  while (parts.length > 1 && parts[0].length < 2) parts.shift();
  while (parts.length > 1 && parts[parts.length - 1].length < 2) parts.pop();
  s = parts.join(' ');
  if (s.length < 2 || !/[A-Za-z]{2,}/.test(s)) return null;
  return s;
}

// Team nicknames, not cities: the nickname is the distinctive token and it
// survives OCR better than a two-word city. Includes defunct/relocated
// names because those are exactly the cards worth scanning.
const TEAM_NICKNAMES = new Set(
  `angels astros athletics bluejays braves brewers cardinals cubs diamondbacks dodgers giants
   guardians indians mariners marlins mets nationals orioles padres phillies pirates rangers rays
   reds redsox rockies royals tigers twins whitesox yankees expos senators
   bucks bulls cavaliers celtics clippers grizzlies hawks heat hornets jazz kings knicks lakers
   magic mavericks nets nuggets pacers pelicans pistons raptors rockets sixers spurs
   suns thunder timberwolves trailblazers warriors wizards supersonics bullets
   bears bengals bills broncos browns buccaneers cardinals chargers chiefs colts commanders
   cowboys dolphins eagles falcons jaguars jets lions packers panthers patriots raiders rams
   ravens saints seahawks steelers texans titans vikings oilers redskins
   avalanche blackhawks bluejackets blues bruins canadiens canucks capitals coyotes devils
   ducks flames flyers goldenknights hurricanes islanders jets kraken lightning maple leafs
   oilers panthers penguins predators rangers sabres senators sharks stars wild`
    .split(/\s+/).filter(Boolean)
);

// Positions are printed next to the name and are never part of it.
const POSITIONS = new Set(
  `pitcher catcher infield outfield shortstop first second third base baseman designated hitter
   quarterback runningback fullback halfback receiver tightend tackle guard center linebacker
   cornerback safety kicker punter defensive offensive lineman back end
   forward guard center point shooting power small
   goalie goaltender defenseman wing winger centre`
    .split(/\s+/).filter(Boolean)
);

// City/franchise locations. Needed twice over: to attach the city to a
// matched nickname, and to keep a bare city off the player field — OCR
// reading "PITTSBURG" off a Wagner card is a location, not a person.
const TEAM_CITIES = new Set(
  `anaheim arizona atlanta baltimore boston brooklyn buffalo calgary carolina charlotte chicago
   cincinnati cleveland colorado columbus dallas denver detroit edmonton florida georgia golden
   green houston indiana indianapolis jacksonville kansas lasvegas losangeles memphis miami
   milwaukee minnesota minneapolis montreal nashville newengland neworleans newyork oakland
   oklahoma orlando ottawa philadelphia phoenix pittsburgh pittsburg portland quebec sacramento
   sandiego sanfrancisco sanjose seattle stlouis tampa tennessee texas toronto utah vancouver
   washington winnipeg`
    .split(/\s+/).filter(Boolean)
);

const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Sports-card hints. A different problem from Pokémon, and the earlier
 * heuristics get it exactly wrong:
 *
 *  - The name is not at the top. On a 1955 Topps Koufax it sits at 92% of
 *    the card height, and the card is landscape.
 *  - Player and team are printed together in similar-sized type
 *    ("SANDY KOUFAX / BROOKLYN DODGERS"), so size can't separate them.
 *
 * What does work is the same confidence floor as Pokémon, plus a
 * dictionary: team nicknames and positions are closed sets, so whatever
 * high-confidence text is left over is the player.
 */
export function extractSportsHints(ocr) {
  const words = ocr.words
    .filter((w) => w.bbox && w.text?.trim())
    .map((w) => ({
      text: w.text.trim().replace(/[“”"']/g, ''),
      confidence: w.confidence ?? 0,
      y: (w.bbox.y0 + w.bbox.y1) / 2,
      x: w.bbox.x0,
      h: w.bbox.y1 - w.bbox.y0,
    }))
    .filter((w) => w.confidence >= MIN_WORD_CONFIDENCE);

  const text = ocr.text || '';

  // --- team ---
  let team = null;
  const teamWords = new Set();
  const teamWord = words.find((w) => TEAM_NICKNAMES.has(norm(w.text)));
  if (teamWord) {
    teamWords.add(teamWord);
    // Pull in an adjacent city word on the same line to the left.
    const sameLine = words
      .filter((w) => Math.abs(w.y - teamWord.y) < teamWord.h * 0.8)
      .sort((a, b) => a.x - b.x);
    const idx = sameLine.indexOf(teamWord);
    const city = idx > 0 ? sameLine[idx - 1] : null;
    const cityOk = city && TEAM_CITIES.has(norm(city.text));
    if (cityOk) teamWords.add(city);
    team = cleanName(cityOk ? `${city.text} ${teamWord.text}` : teamWord.text);
  }

  // --- player ---
  // Everything word-shaped that isn't part of the team, a position, a
  // location, or a brand. Excluding the words the team already claimed is
  // what stops "SANDY KOUFAX BROOKLYN" coming back as the player.
  const nameish = words.filter(
    (w) =>
      /^[A-Za-z][A-Za-z.'’\-]{1,}$/.test(w.text) &&
      !teamWords.has(w) &&
      !TEAM_NICKNAMES.has(norm(w.text)) &&
      !TEAM_CITIES.has(norm(w.text)) &&
      !POSITIONS.has(norm(w.text)) &&
      !/^(topps|panini|bowman|donruss|fleer|upper|deck|score|rookie|card|series)$/i.test(w.text)
  );
  let player = null;
  if (nameish.length) {
    // Group by line, then take the line with the strongest combined
    // confidence — the printed name reads far more cleanly than artwork.
    const lines = [];
    for (const w of nameish.sort((a, b) => a.y - b.y)) {
      const line = lines.find((l) => Math.abs(l.y - w.y) < Math.max(l.h, w.h) * 0.8);
      if (line) { line.words.push(w); line.y = (line.y + w.y) / 2; line.h = Math.max(line.h, w.h); }
      else lines.push({ words: [w], y: w.y, h: w.h });
    }
    const scored = lines
      .map((l) => ({
        text: l.words.sort((a, b) => a.x - b.x).map((w) => w.text).join(' '),
        score: l.words.reduce((s, w) => s + w.confidence, 0),
        n: l.words.length,
      }))
      // A name is one to four words; longer lines are stat or copyright text.
      .filter((l) => l.n >= 1 && l.n <= 4)
      .sort((a, b) => b.score - a.score);
    player = scored.length ? cleanName(scored[0].text) : null;
  }

  // --- year and number ---
  const yearMatch = text.match(/\b(19[3-9]\d|20[0-4]\d)\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const card_number =
    matchCardNumber(text) ?? (text.match(/#\s*(\d{1,4})\b/) ? `#${text.match(/#\s*(\d{1,4})\b/)[1]}` : null);

  const found = [player, team, card_number].filter(Boolean).length;
  return {
    name: player,
    player,
    team,
    year,
    card_number,
    set_name: null,
    confidence: found === 0 ? 0 : Math.min(0.9, found / 3),
    text,
  };
}

/**
 * Derive search hints from OCR output.
 *
 * Name: on a Pokémon card the name is the largest type in the upper
 * portion, which survives OCR far better than the small print. Picking by
 * glyph height beats picking the first line — "Evolves from Charmeleon"
 * and "Stage 2" both sit above the name.
 *
 * Card number: the "4/102" form is the single most reliable thing on the
 * card, and it is what actually disambiguates a search. "Charizard" alone
 * returns five candidates; with the number it returns one.
 *
 * Set name: deliberately not attempted. Pokémon sets are identified by a
 * printed symbol, not text, so there is nothing here to read — guessing
 * would put a wrong value in a field the user then has to notice and
 * clear.
 */
export function extractHints(ocr, imageHeight) {
  const lines = groupIntoLines(ocr.words);
  const text = ocr.text || lines.map((l) => l.text).join('\n');

  // --- card number ---
  const card_number = matchCardNumber(text);

  // --- name ---
  //
  // Selected by glyph height across individual words, not by line. On a
  // real card "Evolves from Charmeleon" and "Put Charizard on the Stage 1
  // card" are printed right beside the name at roughly its baseline, so
  // any line-based approach drags them in — the first version of this
  // returned "sthce Evolves from Eon Put Charizard on the Stage card".
  // The name is set several times larger than that small print, and that
  // size gap is the one thing that reliably separates them.
  const height = imageHeight || Math.max(...ocr.words.map((w) => w.bbox?.y1 ?? 0), 1);
  const name = pickNameByHeight(ocr.words, height);

  const scored = [name, card_number].filter(Boolean).length;
  return {
    name: name || null,
    card_number,
    set_name: null,
    // Rough: how much we found, tempered by how sure the OCR was.
    confidence: scored === 0 ? 0 : Math.min(0.95, (scored / 2) * 0.9),
    text,
  };
}

/**
 * Run OCR over an image buffer and return hints plus the raw reading.
 * `category` selects the layout rules — Pokémon and sports cards put their
 * text in different places and need different extraction.
 */
export async function readCardHints(buffer, category = 'pokemon') {
  const size = imageSize(buffer);
  let lastError;
  for (const provider of PROVIDERS) {
    try {
      const ocr = await provider(buffer);
      if (category === 'sports') {
        const hints = extractSportsHints(ocr);
        // Sports numbers are usually on the back, so a bottom-strip retry
        // on the front rarely helps and just costs a second pass.
        return { ...hints, provider: ocr.provider };
      }
      const hints = extractHints(ocr, size?.height);

      // Only pay for the second pass when the first didn't find a number.
      if (!hints.card_number) {
        try {
          const fromBottom = await readNumberFromBottom(buffer, size);
          if (fromBottom) hints.card_number = fromBottom;
        } catch (err) {
          console.error('ocr bottom-strip pass failed:', err.message);
        }
      }

      const found = [hints.name, hints.card_number].filter(Boolean).length;
      hints.confidence = found === 0 ? 0 : Math.min(0.95, (found / 2) * 0.9);
      return { ...hints, provider: ocr.provider };
    } catch (err) {
      console.error('ocr provider failed:', err.message);
      lastError = err;
    }
  }
  throw lastError ?? new Error('no ocr provider available');
}
