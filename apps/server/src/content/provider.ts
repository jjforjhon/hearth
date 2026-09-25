import { seedLibrary, wouldYouRather, thisOrThat, wordAssociationWords, coopPuzzles, guessStatements, knowMeQuestions, storyOpeners, type SeedItem } from "./library.js";
import { checkContent, shingles, similarity } from "./safety.js";

/**
 * ContentProvider interface. The weekly pipeline asks the provider for a batch of
 * Truth-or-Dare items. `StaticContentProvider` expands the curated library with
 * systematic variations (template-based, locally generated) — always available,
 * no external dependency, zero cost. `AiContentProvider` is an optional
 * server-side-only generator; its key never reaches the frontend.
 */

export interface GeneratedItem {
  kind: "truth" | "dare";
  category: string;
  difficulty: 1 | 2 | 3;
  body: string;
  mediaPolicy: "none" | "optional" | "required";
  mediaKinds: string[];
}

export interface ContentProvider {
  readonly name: string;
  generate(count: number): Promise<GeneratedItem[]>;
}

/* ------------------------- template-based expansion ------------------------ */

// Systematic, safe templates. Placeholders expand into many distinct, natural
// items without any external API. Combined with the seed library this yields
// thousands of unique items across categories and difficulties.
const TRUTH_TEMPLATES: Array<[string, string, string, 1 | 2 | 3]> = [
  ["preferences", "comfort food|pizza topping|season of the year|board game|coffee order|breakfast|movie snack|way to relax|kind of weather|holiday", "What's your absolute favorite ${style}, and what makes it the best?", 1],
  ["experiences", "spontaneous|ridiculous|adventurous|unplanned", "What's the most ${style} thing you've ever done on a weekend?", 2],
  ["experiences", "weekend|road trip|school trip|family holiday|random Tuesday", "What's the most memorable thing that happened on a ${style}?", 2],
  ["personality", "can't sleep|have a free hour|feel nervous before something big|want to celebrate alone", "When you ${style}, what does that say about you?", 2],
  ["habits", "browser tabs|unread emails|half-finished books|photos of your pet|screens on your phone", "How many ${style} do you have right now, and is that too many?", 1],
  ["opinions", "spoil a movie for someone|read a message over someone's shoulder|reheat fish in an office microwave|reply to a message three weeks later", "Is it ever okay to ${style}? Where's your line?", 2],
  ["funny", "funniest|weirdest|most embarrassing", "What's the ${style} thing that happened to you at a family dinner?", 2],
  ["funny", "a wedding|the gym|the airport|a job interview|school", "What's the most embarrassing thing that happened to you at ${style}?", 2],
  ["hypothetical", "three apps|two hobbies|one album|four books", "If you could only keep ${style} for the rest of your life, what stays and what goes?", 2],
  ["friendship", "shown up|cheered you up|had your back|celebrated something small", "What's the best way someone has ${style} for you?", 3],
  ["everyday", "cooked|fixed|cleaned|organized|finally finished", "What did you ${style} this week that felt surprisingly good?", 1],
  ["preferences", "music|podcasts|dessert|bread|streaming|gaming", "Would you rather give up ${style} for a whole year?", 1],
];

const DARE_TEMPLATES: Array<[string, string, string, 1 | 2 | 3, "none" | "optional" | "required", string[]]> = [
  ["playful", "in opera voice|as a lullaby|rapping if you can|whispered", "Sing the chorus of the last song you played — ${style}.", 1, "optional", ["voice"]],
  ["playful", "a pirate voice|a movie-trailer voice|an extremely formal accent|a narrator voice", "Talk in ${style} for your next two turns.", 1, "none", []],
  ["creative", "a cat wearing a hat|the person to your left|your dream house|a self-portrait", "Draw ${style} using only your non-dominant hand and send it.", 2, "required", ["drawing"]],
  ["creative", "haiku|four-line rhyme|dramatic free-verse epic", "Write a ${style} about the last thing you ate.", 2, "none", []],
  ["playful", "your current view|the nearest snack|something blue you own|your shoes from above", "Send a photo of ${style} — artistic angles encouraged.", 1, "optional", ["photo"]],
  ["silly_skill", "dramatic weather report|sports commentary of you making tea|60-second nature documentary about your room", "Record a ${style} and send it. Commit to the bit.", 2, "optional", ["voice"]],
  ["conversation", "genuinely curious|impossible-to-Google|childhood-nostalgic", "Trade questions with the person who went last: each of you asks one ${style} question.", 2, "none", []],
  ["playful", "a courtroom testimony|a nature documentary|a sports recap|a breaking-news report", "Describe your day so far as ${style}.", 1, "optional", ["voice"]],
  ["reflection", "one genuine compliment|a thank-you|an over-the-top award speech", "Say ${style} to the person who has the fewest points right now.", 1, "none", []],
  ["playful", "questions|song lyrics paraphrased|words longer than six letters|words that start with vowels", "Type your next message using only ${style} until your next turn.", 2, "none", []],
];

function expandTemplate(template: string, variants: string): string {
  return template.replace(/\$\{[^}]+\}/g, () => {
    const options = variants.split("|");
    return options[Math.floor(Math.random() * options.length)] ?? "";
  });
}

export class StaticContentProvider implements ContentProvider {
  readonly name = "static";

  async generate(count: number): Promise<GeneratedItem[]> {
    const items: GeneratedItem[] = [];

    // 1. Every curated seed item, first (highest quality).
    for (const s of seedLibrary) items.push(this.fromSeed(s));

    // 2. Systematic expansion: enumerate template x variant combinations so the
    // output is deterministic-ish in COVERAGE (not order) and large enough to
    // survive dedup against recent weeks. All combinations are reviewed-by-
    // construction: templates and variant lists are hand-written.
    for (const [cat, variants, tpl, diff] of TRUTH_TEMPLATES) {
      for (const variant of variants.split("|")) {
        const body = tpl.replace(/\$\{[^}]+\}/g, variant);
        if (body.length >= 12) {
          items.push({ kind: "truth", category: cat, difficulty: diff, body, mediaPolicy: "none", mediaKinds: [] });
        }
      }
    }
    for (const [cat, variants, tpl, diff, policy, kinds] of DARE_TEMPLATES) {
      for (const variant of variants.split("|")) {
        const body = tpl.replace(/\$\{[^}]+\}/g, variant);
        if (body.length >= 12) {
          items.push({ kind: "dare", category: cat, difficulty: diff, body, mediaPolicy: policy, mediaKinds: kinds });
        }
      }
    }

    // 3. Pairwise sentence recombination for volume: two curated half-sentences
    // joined into one natural question. Every fragment is hand-written and safe.
    const truthOpeners = [
      "Be honest —", "Without overthinking it:", "Your friends would say:", "On a normal day:",
      "If we asked your family:", "Late-night answer:", "First instinct:", "No filters:",
      "Deep down:", "Poll of one:", "Real talk:", "Statistically speaking:",
    ];
    const truthClosers = [
      "what's your favorite way to spend a rainy afternoon?",
      "how do you actually feel about surprise parties?",
      "what's the last thing that made you jealous?",
      "how many hours can you realistically sleep in?",
      "what's a compliment you wish you got more often?",
      "what's your unpopular food opinion?",
      "what's the pettiest reason you've disliked someone?",
      "how do you recharge after a draining week?",
      "what's a trend you secretly enjoy?",
      "what's the most useless skill you're proud of?",
      "what's your honest screen-time confession?",
      "what's a small thing you're irrationally good at?",
    ];
    for (const a of truthOpeners) {
      for (const b of truthClosers) {
        items.push({
          kind: "truth",
          category: "personality",
          difficulty: 2,
          body: `${a} ${b.charAt(0).toUpperCase()}${b.slice(1)}`,
          mediaPolicy: "none",
          mediaKinds: [],
        });
      }
    }

    // 4. Structured micro-variation pass: [frame] × [topic] × [tail] combinations.
    // Every element is hand-written and safety-reviewed; the combination space is
    // (18 frames × 24 topics × 12 tails) = 5,184 truths and (8×16×6)=768 dares.
    const frames = [
      "Be honest:", "Without thinking too hard:", "Your friends would say:", "On a normal day:",
      "If we asked your family:", "Late-night answer:", "First instinct:", "No filters:",
      "Deep down:", "Poll of one:", "Real talk:", "Statistically speaking:",
      "Between us:", "For the record:", "If you're being fully honest:", "Gut answer:",
      "Confession time:", "Quick fire:",
    ];
    const topics = [
      "your ideal Saturday morning", "your biggest irrational pet peeve", "the snack you'd defend in court",
      "your go-to karaoke song", "the last thing that made you laugh out loud", "your weirdest childhood habit",
      "the app you open first each day", "your comfort movie or show", "the hobby you'd pick up if time were free",
      "your most-used emoji", "the song you secretly know every word to", "your unpopular pizza opinion",
      "the small thing that ruins your day", "your best lazy-day trick", "the compliment you get most",
      "your relationship with alarm clocks", "the purchase you regret least", "your ideal weather for a walk",
      "the food you could eat daily forever", "your procrastination style", "the skill you fake confidently",
      "your favorite tiny convenience", "the trip you'd repeat tomorrow", "your quiet flex",
    ];
    const tails = [
      "what's the real answer?", "what's the story there?", "when did that start?",
      "why that one specifically?", "what would you never admit about it?", "has it changed this year?",
      "what surprises people about it?", "what's the version nobody hears?",
      "would your family agree?", "what's the childhood root of it?", "what does your best friend say?",
      "if you had to defend it, what's the argument?",
    ];
    for (const f of frames) {
      for (const t of topics) {
        for (const tail of tails) {
          items.push({
            kind: "truth",
            category: "personality",
            difficulty: 2,
            body: `${f} Tell us about ${t} — ${tail}`,
            mediaPolicy: "none",
            mediaKinds: [],
          });
        }
      }
    }

    const dareFrames = ["For your next three messages", "For the next round", "Until your next turn", "For one minute", "For the next two rounds", "Until someone else scores", "For the rest of this round", "Starting now"];
    const dareActions = [
      "reply only in questions", "narrate everything like a sports commentator", "type with dramatic punctuation",
      "compliment every player who scores", "rename yourself to something the room picks", "speak in third person",
      "rhyme every sentence", "type in all lowercase for effect", "open every message with a movie quote you invent",
      "sign off every message like a formal letter", "narrate your own actions in the third person", "respond with exactly five words each time",
      "pretend you're a very formal robot", "add a dramatic stage direction after every message", "start each message with a weather report",
      "end every message with an emoji verdict",
    ];
    const dareTails = [
      "Commit to the bit.", "No breaking character.", "Own it completely.", "Full commitment required.",
      "The room will be the judge.", "Oscar-level performance expected.",
    ];
    for (const f of dareFrames) {
      for (const a of dareActions) {
        for (const t of dareTails) {
          items.push({
            kind: "dare",
            category: "playful",
            difficulty: 1,
            body: `${f}: ${a}. ${t}`,
            mediaPolicy: "none",
            mediaKinds: [],
          });
        }
      }
    }

    // 5. Shuffle so the batch isn't ordered; cap at the requested count.
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items.slice(0, Math.max(count, Math.min(items.length, count)));
  }

  private fromSeed(s: SeedItem): GeneratedItem {
    return {
      kind: s.kind,
      category: s.category,
      difficulty: s.difficulty,
      body: s.body,
      mediaPolicy: s.mediaPolicy ?? "none",
      mediaKinds: s.mediaKinds ?? [],
    };
  }
}

/** Optional AI provider. Runs ONLY server-side; key comes from env, never the client. */
export class AiContentProvider implements ContentProvider {
  readonly name: string;
  constructor(
    private readonly provider: string,
    private readonly apiKey: string,
  ) {
    this.name = `ai:${provider}`;
  }

  async generate(count: number): Promise<GeneratedItem[]> {
    // Minimal OpenAI-compatible chat completion call. Kept dependency-free so the
    // whole pipeline works without extra packages. Falls back by throwing; the
    // pipeline catches and uses the static provider instead.
    const prompt = [
      `Generate ${count} multiplayer party-game items as JSON: {"truths":[{...}],"dares":[{...}]}.`,
      `Each item: {"category": one of preferences|personality|experiences|habits|opinions|funny|hypothetical|friendship|everyday|playful|creative|conversation|reflection,`,
      `"difficulty": 1-3, "body": string, "mediaPolicy": "none"|"optional"|"required", "mediaKinds": []}`,
      `Rules: friendly, safe for adults, no explicit content, no self-harm, no dangerous dares,`,
      `no questions about money specifics, health, politics or religion; encourage conversation.`,
    ].join(" ");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 1,
      }),
    });
    if (!res.ok) throw new Error(`AI provider failed: ${res.status}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content ?? "";
    return this.parse(text);
  }

  private parse(text: string): GeneratedItem[] {
    const out: GeneratedItem[] = [];
    try {
      const parsed = JSON.parse(text) as { truths?: unknown[]; dares?: unknown[] };
      for (const raw of [...(parsed.truths ?? []), ...(parsed.dares ?? [])]) {
        const r = raw as Record<string, unknown>;
        const kind = parsed.truths?.includes(raw) ? "truth" : "dare";
        out.push({
          kind,
          category: String(r.category ?? "everyday"),
          difficulty: Math.min(3, Math.max(1, Number(r.difficulty ?? 1))) as 1 | 2 | 3,
          body: String(r.body ?? "").trim(),
          mediaPolicy: r.mediaPolicy === "optional" || r.mediaPolicy === "required" ? r.mediaPolicy : "none",
          mediaKinds: Array.isArray(r.mediaKinds) ? r.mediaKinds.map(String) : [],
        });
      }
    } catch {
      throw new Error("AI response was not valid JSON");
    }
    if (!out.length) throw new Error("AI response contained no items");
    return out;
  }
}

export function makeProvider(): ContentProvider {
  const key = process.env.CONTENT_AI_API_KEY;
  const provider = process.env.CONTENT_AI_PROVIDER || "openai";
  if (key) {
    try {
      return new AiContentProvider(provider, key);
    } catch {
      /* fall through to static */
    }
  }
  return new StaticContentProvider();
}
