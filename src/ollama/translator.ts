// ============================================================
// LightMCP — Query Translator
// Detects non-English queries and translates them to English
// via Ollama so the keyword pre-filter works reliably.
// ============================================================

/** Common function words for non-English language detection.
 *  If a query contains >= THRESHOLD matches, it's considered non-English. */
const NON_ENGLISH_WORDS: Record<string, string[]> = {
  it: [
    "il", "lo", "la", "i", "gli", "le", "un", "uno", "una",
    "di", "a", "da", "in", "con", "su", "per", "tra", "fra",
    "che", "chi", "cui", "è", "sono", "ho", "hai", "ha", "abbiamo",
    "del", "della", "dei", "degli", "delle", "al", "allo", "alla",
    "ai", "agli", "alle", "dal", "dallo", "dalla", "dai",
    "nel", "nello", "nella", "nei", "negli", "nelle",
    "sul", "sullo", "sulla", "sui", "sugli", "sulle",
    "non", "come", "più", "tutto", "solo", "anche", "cosa",
    "fare", "fai", "fa", "voglio", "vorrei", "devo", "posso",
    "questo", "questa", "questi", "queste", "quello", "quella",
    "mi", "ti", "si", "ci", "vi", "mio", "tuo", "suo", "nostro",
    "e", "ed", "o", "ma", "perché", "quando", "dove", "come",
  ],
  es: [
    "el", "la", "los", "las", "un", "una", "unos", "unas",
    "de", "del", "en", "con", "por", "para", "que", "es", "son",
    "una", "este", "esta", "estos", "estas", "ese", "esa",
    "mi", "tu", "su", "nuestro", "lo", "le", "se", "me", "te",
    "y", "o", "pero", "no", "sí", "más", "muy", "como", "todo",
    "hacer", "quiero", "puedo", "tengo", "tiene", "hay",
  ],
  fr: [
    "le", "la", "les", "un", "une", "des", "de", "du",
    "en", "dans", "avec", "sur", "pour", "par", "que", "qui",
    "est", "sont", "ce", "cette", "ces", "mon", "ton", "son",
    "je", "tu", "il", "elle", "nous", "vous", "ils", "elles",
    "et", "ou", "mais", "ne", "pas", "plus", "très", "comme",
    "faire", "veux", "peux", "dois", "tout", "cela",
  ],
  de: [
    "der", "die", "das", "ein", "eine", "einen", "einem", "einer",
    "dem", "den", "des", "in", "im", "auf", "mit", "für", "von",
    "zu", "und", "ist", "sind", "nicht", "auch", "wie", "was",
    "ich", "du", "er", "sie", "es", "wir", "ihr", "mein", "dein",
    "oder", "aber", "nur", "noch", "schon", "kann", "muss", "will",
  ],
  pt: [
    "o", "a", "os", "as", "um", "uma", "uns", "umas",
    "de", "da", "do", "em", "no", "na", "para", "com", "por",
    "que", "é", "são", "meu", "minha", "seu", "sua", "este",
    "eu", "tu", "ele", "ela", "nós", "eles", "elas",
    "e", "ou", "mas", "não", "mais", "muito", "como", "tudo",
    "fazer", "quero", "posso", "tenho", "tem",
  ],
};

const DETECTION_THRESHOLD = 2;

/** Heuristic: count non-English function words. Returns true if likely non-English. */
export function detectNonEnglish(task: string): boolean {
  const words = task.toLowerCase().split(/\s+/);
  let nonEnCount = 0;

  for (const w of words) {
    for (const langWords of Object.values(NON_ENGLISH_WORDS)) {
      if ((langWords as string[]).includes(w)) {
        nonEnCount++;
        if (nonEnCount >= DETECTION_THRESHOLD) return true;
        break; // count each word once across all languages
      }
    }
  }

  return false;
}

/** Translate a short task description to English via Ollama.
 *  Uses /api/generate with a minimal prompt to keep latency low. */
export async function translateToEnglish(
  task: string,
  ollamaHost: string,
  model: string
): Promise<string> {
  const prompt = `Translate the following task description to English. Return ONLY the English translation, nothing else:\n\n${task}`;

  const res = await fetch(`${ollamaHost}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0, num_predict: 128 },
    }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}`);
  }

  const data = (await res.json()) as { response: string };
  const translation = data.response?.trim();

  if (!translation) {
    throw new Error("Empty translation response");
  }

  return translation;
}
