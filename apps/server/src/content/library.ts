/**
 * Curated seed library — the guaranteed fallback pool for the weekly pipeline.
 * All items pass the safety filter. Categories are deliberately
 * conversation-oriented: personality, preferences, experiences, habits, opinions,
 * funny situations, hypotheticals, friendship, everyday life.
 */

export interface SeedItem {
  kind: "truth" | "dare";
  category: string;
  difficulty: 1 | 2 | 3;
  body: string;
  mediaPolicy?: "none" | "optional" | "required";
  mediaKinds?: string[];
}

const TRUTHS: Array<[string, string, 1 | 2 | 3]> = [
  ["preferences", "What's a small thing that instantly makes your day better?", 1],
  ["preferences", "Coffee, tea, or something else entirely — and why?", 1],
  ["preferences", "What's your comfort food when everything goes wrong?", 1],
  ["preferences", "Mountains or ocean for a whole month — which do you pick?", 1],
  ["preferences", "What song have you played the most this year?", 1],
  ["preferences", "Which season matches your personality most closely?", 2],
  ["preferences", "What's an app on your phone you'd defend like a friend?", 2],
  ["habits", "What's the first thing you do after waking up, honestly?", 1],
  ["habits", "Are you a tabs-open person or a one-tab-at-a-time person?", 1],
  ["habits", "What habit are you quietly proud of?", 2],
  ["habits", "What's a habit you've tried to break and it just won't go?", 2],
  ["habits", "How many unread notifications are on your phone right now?", 1],
  ["experiences", "What's the best trip you've ever taken, in one sentence?", 1],
  ["experiences", "What's the most spontaneous thing you've ever done?", 2],
  ["experiences", "What's a skill you learned that you never use anymore?", 2],
  ["experiences", "What was your first job, and what did it teach you?", 2],
  ["experiences", "What's the kindest thing a stranger has done for you?", 2],
  ["experiences", "What's a moment you'd relive exactly as it happened?", 3],
  ["experiences", "What's the funniest misunderstanding you've been part of?", 2],
  ["experiences", "What's a food you hated as a kid but love now?", 1],
  ["personality", "Are you more like your morning self or your midnight self?", 1],
  ["personality", "What do people usually get wrong about you at first?", 2],
  ["personality", "When you're stressed, do you go quiet or talk more?", 2],
  ["personality", "What's something you're secretly competitive about?", 2],
  ["personality", "Planner or improviser — which one are you really?", 1],
  ["personality", "What compliment do you get most often?", 1],
  ["personality", "What's a hill you'll die on, but it's a tiny hill?", 2],
  ["opinions", "Pineapple on pizza: genuine crime or fine dinner?", 1],
  ["opinions", "Is it okay to read the last page of a book first?", 1],
  ["opinions", "Texting or calling — which one actually respects your time?", 2],
  ["opinions", "What trend do you hope disappears quietly?", 2],
  ["opinions", "Are group chats better with 4 people or 40?", 2],
  ["opinions", "What's the most overrated movie or show, in your view?", 2],
  ["opinions", "Do you think talent beats consistency? Why?", 3],
  ["funny", "What's the most embarrassing autocorrect you've sent?", 2],
  ["funny", "Describe the worst haircut of your life.", 1],
  ["funny", "What's a weird thing you do when you're home alone?", 2],
  ["funny", "What's the strangest compliment you've ever received?", 2],
  ["funny", "What's your most irrational fear that you know is silly?", 2],
  ["funny", "What food combination do you enjoy that others judge?", 1],
  ["hypothetical", "If you could have dinner with any three people, living or not, who's coming?", 2],
  ["hypothetical", "You get one free perfect day anywhere in the world — where do you wake up?", 2],
  ["hypothetical", "If money didn't matter, what would you do on a Tuesday?", 2],
  ["hypothetical", "You can instantly master any skill — which one and why?", 2],
  ["hypothetical", "If your life had a soundtrack, what genre is it right now?", 3],
  ["hypothetical", "If you had to teach one thing to a whole classroom, what could you actually teach?", 2],
  ["friendship", "What do you value most in a close friend?", 2],
  ["friendship", "What's a tradition you'd love to start with friends?", 2],
  ["friendship", "How do you show someone you care without saying it?", 3],
  ["friendship", "What's a memory with friends you'd frame on a wall?", 2],
  ["friendship", "What kind of humor makes you laugh hardest?", 1],
  ["everyday", "What's a small victory from this week?", 1],
  ["everyday", "What did you eat today that you'd actually recommend?", 1],
  ["everyday", "What's on your playlist while doing chores?", 1],
  ["everyday", "What's the last thing that made you laugh out loud?", 1],
  ["everyday", "What's your go-to way to reset after a long day?", 2],
];

const DARES: Array<[string, string, 1 | 2 | 3, SeedItem["mediaPolicy"], string[] | undefined]> = [
  ["playful", "Speak in question form only until your next turn.", 1, "none", undefined],
  ["playful", "Compliment the person to your left in the room like it's an award ceremony.", 1, "none", undefined],
  ["playful", "Say the alphabet backwards from M — no pauses to think out loud.", 1, "none", undefined],
  ["playful", "Describe your morning routine as a nature documentary narrator.", 2, "optional", ["voice"]],
  ["playful", "Type your next three chat messages with your eyes closed... wait, wrong platform — with your non-dominant hand.", 1, "none", undefined],
  ["playful", "Invent a brand-new word and define it with total confidence.", 1, "none", undefined],
  ["playful", "Give a dramatic movie-trailer voiceover for making a sandwich.", 2, "optional", ["voice"]],
  ["playful", "Send a photo of whatever is immediately to your right.", 1, "optional", ["photo"]],
  ["playful", "Draw a self-portrait in 30 seconds — masterpiece rules do not apply.", 1, "required", ["drawing"]],
  ["playful", "Recreate a famous painting pose using whatever's near you, then send the photo.", 2, "required", ["photo"]],
  ["creative", "Sketch the group as animals — send the drawing and let everyone guess who's who.", 2, "required", ["drawing"]],
  ["creative", "Write a four-line poem about the last thing you drank.", 2, "none", []],
  ["creative", "Name three things in this room that could be in a museum in 500 years, and argue why.", 2, "none", undefined],
  ["creative", "Design a ridiculous superhero whose power is totally mundane. Pitch them to the room.", 2, "none", undefined],
  ["conversation", "Pair up: find one thing you both did this week that the other didn't. Report back.", 2, "none", undefined],
  ["conversation", "Start a debate: cats vs dogs. You have one minute to make the case.", 1, "none", undefined],
  ["conversation", "Ask the person who went last a question you've never asked anyone in a game.", 2, "none", undefined],
  ["conversation", "Tell the room a two-minute story from your childhood — details welcome.", 2, "optional", ["voice"]],
  ["conversation", "Agree on a team name for the group in under 60 seconds. Everyone must say yes.", 1, "none", undefined],
  ["conversation", "Learn one new fact about the person across from you in chat, then share it back better than they told it.", 2, "none", undefined],
  ["silly_skill", "Do your best impression of a slow-motion replay of something you did today.", 1, "optional", ["video"]],
  ["silly_skill", "Balance something safe on your head for ten seconds while saying something serious.", 1, "optional", ["video"]],
  ["silly_skill", "Whisper-read the last text you sent out loud like it's poetry.", 2, "optional", ["voice"]],
  ["reflection", "Share a small thing you're looking forward to this month.", 1, "none", []],
  ["reflection", "Say one genuine thank-you to someone in this room.", 1, "none", undefined],
  ["reflection", "Describe your perfect lazy Sunday, hour by hour, in one minute.", 2, "optional", ["voice"]],
];

export const seedLibrary: SeedItem[] = [
  ...TRUTHS.map(([category, body, difficulty]) => ({ kind: "truth" as const, category, difficulty, body })),
  ...DARES.map(([category, body, difficulty, mediaPolicy, mediaKinds]) => ({
    kind: "dare" as const,
    category,
    difficulty,
    body,
    mediaPolicy: mediaPolicy ?? "none",
    mediaKinds,
  })),
];

/* -------------------------- other game content --------------------------- */

export const wouldYouRather: string[][] = [
  ["Always be 10 minutes late", "Always be 40 minutes early"],
  ["Read minds but only when people are hungry", "Teleport but only backwards by 10 seconds"],
  ["Have unlimited free flights", "Unlimited free restaurants for life"],
  ["Never use social media again", "Never watch another movie or series"],
  ["Live without music", "Live without the internet"],
  ["Be famous for something silly", "Be unknown for something great"],
  ["Camp in the mountains", "Sleep in a five-star city hotel"],
  ["Only texts for a month", "Only voice calls for a month"],
  ["Know the history of every object you touch", "Speak every language fluently"],
  ["A job you love with a modest salary", "A boring job that pays double"],
  ["Cook every meal for a year", "Eat takeout every meal for a year"],
  ["Have a personal theme song that plays constantly", "Have a narrator who describes your life"],
  ["Find true love tomorrow", "Win the lottery in five years"],
  ["Meet your great-grandchildren", "Meet your great-grandparents"],
  ["Always have to sing instead of speak", "Always have to dance instead of walk"],
];

export const thisOrThat: string[][] = [
  ["Beach", "Mountains"],
  ["Morning person", "Night owl"],
  ["Tea", "Coffee"],
  ["Books", "Movies"],
  ["Cats", "Dogs"],
  ["Sweet", "Savory"],
  ["Plan everything", "Wing it"],
  ["Texting", "Voice notes"],
  ["Window seat", "Aisle seat"],
  ["Summer", "Winter"],
  ["City break", "Countryside retreat"],
  ["Board games", "Video games"],
  ["Home cooking", "Street food"],
  ["Rainy day in", "Sunny day out"],
  ["Concert", "Museum"],
];

export const wordAssociationWords: string[] = [
  "ocean", "lamp", "bridge", "harvest", "echo", "lantern", "orbit", "velvet", "canyon", "pepper",
  "winter", "keyboard", "market", "drift", "compass", "meadow", "static", "ribbon", "forge", "tide",
  "clock", "branch", "storm", "paper", "glacier", "engine", "garden", "signal", "shadow", "feather",
];

export const coopPuzzles: Array<{ type: string; body: string; solution: string; hints: string[] }> = [
  { type: "sequence", body: "2, 4, 8, 16, ...", solution: "32", hints: ["Each number doubles.", "Powers of two.", "It's 2^n."] },
  { type: "sequence", body: "1, 1, 2, 3, 5, 8, ...", solution: "13", hints: ["Add the last two.", "Fibonacci.", "5 + 8."] },
  { type: "sequence", body: "3, 6, 11, 18, ...", solution: "27", hints: ["Differences grow by 2.", "+3, +5, +7, +9.", "18 + 9."] },
  { type: "riddle", body: "I have keys but no locks, space but no rooms. You can enter but can't go outside. What am I?", solution: "keyboard", hints: ["You're probably touching one.", "It has an enter key.", "It types."] },
  { type: "riddle", body: "The more you take, the more you leave behind. What am I?", solution: "footsteps", hints: ["You make them walking.", "Beach sand reveals them.", "Footprints of steps."] },
  { type: "logic", body: "Five friends race. Ana beat Bo. Bo beat Cy. Cy beat Dee. Dee beat Eve. Who finished third?", solution: "cy", hints: ["Order them.", "Ana, Bo, Cy, Dee, Eve.", "Middle of five."] },
  { type: "logic", body: "A bat and a ball cost $1.10 together. The bat costs $1.00 more than the ball. What does the ball cost?", solution: "0.05", hints: ["Not 10 cents.", "Try 5 cents and check the difference.", "$1.05 + $0.05."] },
  { type: "word", body: "Rearrange: LSTEN — a body part that hears.", solution: "listen", hints: ["Six letters.", "Starts with L.", "You do it with your ears."] },
  { type: "word", body: "Rearrange: WREATH — something you give on a special day.", solution: "wreathe", hints: ["Add nothing, just rearrange plus one letter: it means to encircle.", "It's a verb for making a wreath.", "W-R-E-A-T-H-E."] },
  { type: "pattern", body: "Sun, Moon, Sun, Moon, Sun, ... — what comes next, and why might it be Earth?", solution: "moon", hints: ["Alternating.", "Every third could break the pattern.", "Sun-Moon cycle continues."] },
];

export const guessThePlayerPrompts: string[] = [
  "What's the last thing you googled that you'd admit to?",
  "What's your most useless talent?",
  "What food could you eat every day forever?",
  "What's the weirdest thing you believed as a kid?",
  "What app do you open first in the morning?",
  "What's your guiltiest pleasure song?",
  "What's something you're bad at but keep doing anyway?",
  "If you could swap lives with anyone for a day, who?",
];

export const guessStatements: string[] = [
  "I can't fall asleep without some background noise.",
  "I've never broken a bone, and I'm weirdly proud of it.",
  "I talk to my plants more than I should admit.",
  "I've cried during a movie trailer.",
  "I always eat the corner pieces first.",
  "I rehearse conversations that will never happen.",
  "I've kept every birthday card I've ever received.",
  "I Google the ending of movies before I watch them.",
  "I still sleep with a stuffed animal within reach.",
  "I get unreasonably happy when I see a dog on a walk.",
];

export const knowMeQuestions: string[] = [
  "What's your ideal way to spend a free Saturday?",
  "Which season do you secretly prefer?",
  "What's your go-to comfort movie or show?",
  "Sweet breakfast or savory breakfast?",
  "What hobby would you pick up if time were free?",
  "Are you a window seat or aisle seat person?",
  "What's your favorite thing to cook or order?",
  "Do you recharge alone or with people?",
  "What's a small thing that always makes you smile?",
  "Which do you value more: honesty or kindness, when they conflict?",
];

export interface DrawTemplate {
  id: string;
  name: string;
  category: string;
  strokes: Array<{ c: string; w: number; p: number[] }>;
}

// Simple outline templates players complete together (normalized 0-1000 coordinate space).
export const drawTemplatesSeed: DrawTemplate[] = [
  {
    id: "cat", name: "Cat", category: "animals",
    strokes: [
      { c: "#555555", w: 4, p: [200, 600, 300, 350, 500, 350, 600, 600, 200, 600] }, // head base (triangle-ish)
      { c: "#555555", w: 4, p: [280, 380, 320, 280, 380, 360] }, // left ear
      { c: "#555555", w: 4, p: [420, 360, 480, 280, 520, 380] }, // right ear
      { c: "#555555", w: 3, p: [360, 460, 375, 470, 390, 460] }, // left eye
      { c: "#555555", w: 3, p: [430, 460, 445, 470, 460, 460] }, // right eye
      { c: "#555555", w: 3, p: [470, 510, 520, 500, 470, 530] }, // whiskers L
      { c: "#555555", w: 3, p: [350, 510, 300, 500, 350, 530] }, // whiskers R
    ],
  },
  {
    id: "house", name: "House", category: "architecture",
    strokes: [
      { c: "#555555", w: 4, p: [250, 500, 250, 750, 750, 750, 750, 500] }, // walls
      { c: "#555555", w: 4, p: [200, 500, 500, 300, 800, 500] }, // roof
      { c: "#555555", w: 3, p: [430, 750, 430, 620, 570, 620, 570, 750] }, // door
      { c: "#555555", w: 3, p: [300, 550, 360, 550, 360, 610, 300, 610, 300, 550] }, // window
    ],
  },
  {
    id: "tree", name: "Tree", category: "nature",
    strokes: [
      { c: "#555555", w: 5, p: [480, 850, 480, 550] }, // trunk
      { c: "#555555", w: 4, p: [480, 550, 350, 620] }, // branch L
      { c: "#555555", w: 4, p: [480, 550, 610, 620] }, // branch R
      { c: "#555555", w: 4, p: [480, 480, 330, 520, 300, 430, 380, 340, 480, 300, 580, 340, 660, 430, 630, 520, 480, 480] }, // canopy
    ],
  },
  {
    id: "car", name: "Car", category: "vehicles",
    strokes: [
      { c: "#555555", w: 4, p: [150, 650, 200, 560, 320, 540, 430, 430, 620, 430, 720, 540, 860, 560, 880, 650] }, // body
      { c: "#555555", w: 4, p: [150, 650, 880, 650] }, // underline
      { c: "#555555", w: 3, p: [300, 650, 300, 545] }, // door line
      { c: "#555555", w: 3, p: [470, 430, 470, 540] }, // window divider
    ],
  },
  {
    id: "boat", name: "Sailboat", category: "vehicles",
    strokes: [
      { c: "#555555", w: 4, p: [200, 700, 800, 700, 700, 800, 300, 800, 200, 700] }, // hull
      { c: "#555555", w: 4, p: [500, 700, 500, 300] }, // mast
      { c: "#555555", w: 4, p: [500, 320, 700, 660, 500, 660] }, // sail
      { c: "#555555", w: 3, p: [100, 840, 900, 840] }, // waterline
    ],
  },
  {
    id: "flower", name: "Flower", category: "nature",
    strokes: [
      { c: "#555555", w: 4, p: [500, 850, 500, 550] }, // stem
      { c: "#555555", w: 4, p: [500, 550, 430, 500, 500, 420, 570, 500, 500, 550] }, // petal N
      { c: "#555555", w: 4, p: [430, 500, 330, 500, 430, 440] }, // petal W
      { c: "#555555", w: 4, p: [570, 500, 670, 500, 570, 440] }, // petal E
      { c: "#555555", w: 4, p: [500, 420, 460, 340, 500, 300, 540, 340, 500, 420] }, // petal top
    ],
  },
  {
    id: "mountains", name: "Mountains", category: "landscapes",
    strokes: [
      { c: "#555555", w: 4, p: [100, 800, 350, 400, 550, 650] }, // peak 1
      { c: "#555555", w: 4, p: [450, 800, 650, 350, 900, 800] }, // peak 2
      { c: "#555555", w: 3, p: [580, 480, 650, 350, 720, 480] }, // snow cap
      { c: "#555555", w: 3, p: [80, 800, 920, 800] }, // ground
    ],
  },
  {
    id: "cupcake", name: "Cupcake", category: "food",
    strokes: [
      { c: "#555555", w: 4, p: [350, 550, 380, 800, 620, 800, 650, 550] }, // wrapper
      { c: "#555555", w: 4, p: [350, 550, 420, 480, 500, 540, 580, 470, 650, 550] }, // frosting
      { c: "#555555", w: 3, p: [500, 470, 490, 420, 520, 400] }, // cherry stem
      { c: "#555555", w: 4, p: [470, 400, 530, 400, 500, 430, 470, 400] }, // cherry
    ],
  },
  {
    id: "rocket", name: "Rocket", category: "vehicles",
    strokes: [
      { c: "#555555", w: 4, p: [500, 200, 560, 350, 560, 650, 440, 650, 440, 350, 500, 200] }, // body
      { c: "#555555", w: 4, p: [440, 500, 350, 600, 440, 620] }, // fin L
      { c: "#555555", w: 4, p: [560, 500, 650, 600, 560, 620] }, // fin R
      { c: "#555555", w: 3, p: [500, 350, 530, 400, 500, 450, 470, 400, 500, 350] }, // window
      { c: "#555555", w: 3, p: [470, 680, 500, 760, 530, 680] }, // flame
    ],
  },
  {
    id: "fish", name: "Fish", category: "animals",
    strokes: [
      { c: "#555555", w: 4, p: [300, 500, 420, 400, 620, 400, 720, 500, 620, 600, 420, 600, 300, 500] }, // body
      { c: "#555555", w: 4, p: [300, 500, 200, 420, 200, 580, 300, 500] }, // tail
      { c: "#555555", w: 3, p: [640, 470, 655, 485, 640, 500] }, // eye
      { c: "#555555", w: 3, p: [500, 400, 480, 470, 500, 600] }, // gill
    ],
  },
];

export const storyOpeners: string[] = [
  "The lighthouse keeper found a bottle on the shore, and inside was a map of somewhere that doesn't exist.",
  "On the first morning of the power outage, the whole street smelled inexplicably of cinnamon.",
  "The elevator arrived with a single umbrella inside, dry despite the storm outside.",
  "Nobody remembered inviting the accordion player, but nobody wanted him to leave.",
  "The library book was due back in 1987, and someone had just returned it.",
];
