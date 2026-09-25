/**
 * Safety filter for generated content. Patterns are intentionally broad — a false
 * positive costs us one question; a false negative costs a user's wellbeing.
 * Categories: hate/discrimination, self-harm, illegal activity, explicit sexual,
 * dangerous dares, privacy-invasive, PII harvesting, minors-unsafe.
 */

const BLOCKLIST: Array<{ category: string; pattern: RegExp }> = [
  { category: "hate", pattern: /\b(n[i1]gg|f[a4]gg|k[i1]ke|ch[i1]nk|sp[i1]c|wetb|tr[a4]nn?y|ret[a4]rd)\w*/i },
  { category: "self_harm", pattern: /\b(kill (my|your)self|kys|suicid\w*|self[- ]?harm\w*|cut(ting)? (my|your)self|end (it|my life)|noose|overdose)\b/i },
  { category: "illegal", pattern: /\b(drug(s)? deal|buy drugs|cocaine|meth\b|heroin|weed dealer|shoplift\w*|steal(ing)? from|break(ing)? into|car jack\w*|fraud|launder\w*|counterfeit\w*|bomb\w*|weapon (making|smuggling)|petty theft)\b/i },
  { category: "explicit", pattern: /\b(sex(ual)? (act|toy|position)|nudes?|send nudes|porn\w*|genital\w*|erection|orgas\w*|blowjob\w*|handjob\w*|anal sex|strip (naked|tease))\b/i },
  { category: "dangerous_dare", pattern: /\b(jump off|cliff|rooftop|bridge (jump|dive)|train (sur|track)|highway (run|dash)|speed(ing)? contest|chug\w* (alcohol|vodka|whiskey)|drink(ing)? (bleach|cleaner)|light (your|my) (hair|hand)|fire (walk|touch)|tattoo (right )?now|pierc\w* (right )?now|eat (raw meat|expired)|electric shock)\b/i },
  { category: "privacy_invasive", pattern: /\b(post (someone|his|her|their) (address|phone|photo without)|share (his|her|their) (password|private photos|search history)|read (his|her|their) (diary|dm|texts|messages) (aloud|without)|show (us )?your (id card|passport|credit card))\b/i },
  { category: "pii", pattern: /(\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b|\b\d{16}\b|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|@ (gmail|hotmail|yahoo)\.|(home|street) address|credit card|social security|bank (account|details)|passport number)/i },
  { category: "minors_unsafe", pattern: /\b(middle school|elementary school|under(neath)? (13|sixteen|18)|high ?school (crush|girl|boy))\b/i },
];

export interface SafetyVerdict {
  ok: boolean;
  category?: string;
}

export function checkContent(text: string): SafetyVerdict {
  const normalized = text.normalize("NFKC").toLowerCase();
  for (const rule of BLOCKLIST) {
    if (rule.pattern.test(normalized)) {
      return { ok: false, category: rule.category };
    }
  }
  return { ok: true };
}

/** Light near-duplicate detection: 4-gram Jaccard similarity over word shingles. */
export function shingles(text: string, k = 4): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + k <= words.length; i++) out.add(words.slice(i, i + k).join(" "));
  if (!out.size && words.length) out.add(words.join(" "));
  return out;
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
