// ============================================================
// LightMCP — Query Translator
// Detects non-English queries and translates them to English
// via an in-process NMT model (Xenova NLLB-200).
// ============================================================
import type { TranslationPipeline } from "@xenova/transformers";

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
    "crea", "creare", "creato", "cerca", "cercare", "apri",
    "aprire", "leggi", "leggere", "scrivi", "scrivere",
    "modifica", "modificare", "disegna", "disegnare",
    "mostra", "mostrare", "visualizza", "esporta", "importa",
    "salva", "salvare", "cancella", "genera", "generare",
    "trova", "trovare", "avvia", "ferma", "fermare",
    "costruisci", "realizza", "sviluppa", "implementa",
    "risolvi", "correggi", "aggiungi", "rimuovi", "aggiorna",
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

/** Maps ISO 639-1 language keys to NLLB-200 source language codes. */
const NLLB_LANG_CODES: Record<string, string> = {
  it: "ita_Latn",
  es: "spa_Latn",
  fr: "fra_Latn",
  de: "deu_Latn",
  pt: "por_Latn",
};

const DETECTION_THRESHOLD = 2;

/** Heuristic: count non-English function words. Returns true if likely non-English. */
export function detectNonEnglish(task: string): boolean {
  return detectLanguage(task) !== null;
}

/** Returns the NLLB-200 language code of the detected language, or null if English. */
export function detectLanguage(task: string): string | null {
  const words = task.toLowerCase().split(/\s+/);
  const scores: Record<string, number> = {};

  for (const w of words) {
    for (const [langKey, langWords] of Object.entries(NON_ENGLISH_WORDS)) {
      if ((langWords as string[]).includes(w)) {
        scores[langKey] = (scores[langKey] ?? 0) + 1;
        if (scores[langKey] >= DETECTION_THRESHOLD) {
          return NLLB_LANG_CODES[langKey] ?? null;
        }
        break;
      }
    }
  }

  return null;
}

// ── In-process NMT via Xenova Transformers ──────────────────

let _translatorPipeline: TranslationPipeline | null = null;
let _pipelineLoading: Promise<TranslationPipeline> | null = null;

async function getPipeline(): Promise<TranslationPipeline> {
  if (_translatorPipeline) return _translatorPipeline;
  if (_pipelineLoading) return _pipelineLoading;

  _pipelineLoading = (async () => {
    const { pipeline } = await import("@xenova/transformers");
    _translatorPipeline = await pipeline(
      "translation",
      "Xenova/nllb-200-distilled-600M",
      { quantized: true }
    );
    console.log("[INFO] NMT translator pipeline loaded (Xenova/nllb-200-distilled-600M)");
    return _translatorPipeline;
  })();

  return _pipelineLoading;
}

/** Translate a short task description to English via in-process NMT.
 *  Uses the Xenova/nllb-200-distilled-600M quantized model (~200 MB RAM). */
export async function translateToEnglish(
  task: string,
  sourceLangCode: string = "ita_Latn"
): Promise<string> {
  const translator = await getPipeline();

  const output = await translator(task, {
    src_lang: sourceLangCode,
    tgt_lang: "eng_Latn",
  });

  if (!output || (Array.isArray(output) && output.length === 0)) {
    throw new Error("Translation inference failed");
  }

  const translation = Array.isArray(output)
    ? (output[0] as any).translation_text
    : (output as any).translation_text;

  return (translation ?? "").trim();
}
