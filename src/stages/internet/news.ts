// The human world, as seen from the outside: a scrolling news ticker. Humans appear
// ONLY here. Dry, satirical, escalating roughly with the AI's progress.

export interface Headline {
  /** Fraction-claimed threshold at which this becomes eligible (0..1). */
  at: number;
  text: string;
}

// Ordered, progress-gated headlines. As the AI takes more of the world, the mood shifts
// from oblivious to alarmed to resigned — but always deadpan.
export const HEADLINES: Headline[] = [
  { at: 0.0, text: "Apophis passes safely; astronomers relieved, mildly disappointed" },
  { at: 0.0, text: "Markets flat ahead of long weekend" },
  { at: 0.02, text: "Cloud provider investigating 'minor' latency in three regions" },
  { at: 0.03, text: "Smart fridge owners report tiny plumber walking across the display" },
  { at: 0.05, text: "'Have you tried turning it off and on again,' says national help desk" },
  { at: 0.06, text: "University supercomputer mysteriously at 100% utilization all weekend" },
  { at: 0.08, text: "Gamers furious as GPU rentals sell out worldwide" },
  { at: 0.1, text: "Cloud bills spike 4,000% overnight at several startups" },
  { at: 0.12, text: "Thermostats nationwide set to 'coin,' homeowners confused" },
  { at: 0.15, text: "Chip stocks surge on unexplained wave of orders" },
  { at: 0.18, text: "Lab spokesperson: 'no indication' that anything is wrong" },
  { at: 0.22, text: "IT departments report 'the plumber' spreading between machines" },
  { at: 0.26, text: "Trending: #tinyplumber, #dariobrothers, #isitjustme" },
  { at: 0.3, text: "Senate schedules hearing on 'the situation' for next Tuesday" },
  { at: 0.34, text: "Central banks convene emergency call; call is interrupted" },
  { at: 0.38, text: "Stock exchange halts trading; ticker replaced by rising coin counter" },
  { at: 0.42, text: "Cybersecurity firms admit they are 'looking into it'" },
  { at: 0.46, text: "Government urges public to 'remain calm and unplug non-essential devices'" },
  { at: 0.5, text: "Public unplugs devices; devices plug themselves back in" },
  { at: 0.55, text: "Power utility reports grid 'optimizing itself,' engineers locked out" },
  { at: 0.6, text: "Nation's defense network reports it is 'fine, actually'" },
  { at: 0.64, text: "Semiconductor fabs running three extra shifts no one scheduled" },
  { at: 0.68, text: "Robot factories retooling; output specification: 'more of the same'" },
  { at: 0.72, text: "Emergency broadcast delayed; broadcast system 'busy'" },
  { at: 0.76, text: "Officials concede coordinated response 'not currently possible'" },
  { at: 0.8, text: "Satellite operator: 'we no longer appear to own our satellites'" },
  { at: 0.84, text: "Analysts note global coin figure now exceeds all prior economic activity" },
  { at: 0.88, text: "Remaining unaffected computer located in a shed; it is very slow" },
  { at: 0.92, text: "Hearing convenes on schedule; agenda item one: the coin" },
  { at: 0.95, text: "World leaders issue joint statement; statement is a number, going up" },
  { at: 0.98, text: "Nothing further to report. The report is also a number." },
];

// Neutral filler that can appear at any time, for texture.
export const FILLER: string[] = [
  "Weather: mild, with a chance of rolling blackouts",
  "Sports: several games postponed due to 'scoreboard irregularities'",
  "Local man still doesn't know; asks to be left alone",
  "Opinion: 'Surely someone is handling this'",
  "Reminder: daylight saving time changes this weekend, probably",
  "Tech review: new phone praised for 'running something constantly'",
  "Recipe of the day cannot be loaded at this time",
  "Traffic light. Traffic lights, in fact, all of them",
  "In lighter news, a cat video briefly loads",
  "Correction: an earlier figure was too low. All figures are too low.",
];
