export interface CharacterRecord {
  id: string;
  char: string;
  pinyin: string;
  readings: string[];
  tier: '592' | '358' | '550' | 'extra';
  day: number;
  strokes: number | null;
  radical?: string | null;
  gloss?: string;
  audioKey: string;
  wordIds: string[];
}

export interface WordRecord {
  id: string;
  word: string;
  chars: string[];
  freq?: number;
  gloss: string;
  audioKey: string;
}

export interface MathItem {
  id: string;
  prompt: string;
  kind: 'choice' | 'count';
  options: string[];
  correct: number;
  hint: string;
}

export interface MathLesson {
  day: number;
  module: string;
  title: string;
  goal: string;
  script: string;
  items: MathItem[];
  action: string;
  audioKey: string;
}

export interface ScienceCard {
  id: string;
  day: number;
  week?: number;
  theme?: string;
  cat?: string;
  order?: number;
  title: string;
  body: string;
  question: string;
  optionA: string;
  optionB: string;
  correct: 'A' | 'B';
  explain: string;
  audioKey: string;
}

export interface EncyclopediaBundle {
  meta: { total: number; cats: number; aShare: number };
  cats: { key: string; name: string; about: string; priority: number; count: number }[];
  cards: ScienceCard[];
}