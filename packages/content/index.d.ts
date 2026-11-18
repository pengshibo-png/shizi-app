/**
 * @shi/content 的类型声明。
 *
 * 数据在运行时由 index.js 从 data/*.json 加载；这里独立声明结构，
 * 不从 index.js 取类型（TS 无法从纯 JS 文件推断导出类型）。
 */

export interface CharacterRecord {
  id: string;
  char: string;
  pinyin: string;
  readings: string[];
  tier: '592' | '358' | '550' | 'extra';
  day: number;
  strokes: number | null;
  /** 部首 */
  radical?: string | null;
  /** 简短释义（新华字典精简） */
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
  week: number;
  theme: string;
  title: string;
  body: string;
  question: string;
  optionA: string;
  optionB: string;
  correct: 'A' | 'B';
  explain: string;
  audioKey: string;
}

export interface CharactersBundle {
  meta: Record<string, unknown>;
  characters: CharacterRecord[];
  dailyChars: { day: number; chars: string[] }[];
}

export interface WordsBundle {
  meta: Record<string, unknown>;
  words: WordRecord[];
}

export interface MathBundle {
  meta: Record<string, unknown>;
  lessons: MathLesson[];
}

export interface ScienceBundle {
  meta: Record<string, unknown>;
  cards: ScienceCard[];
}

export interface EncyclopediaCard {
  id: string;
  day?: number;
  week?: number;
  theme?: string;
  cat: string;
  order: number;
  title: string;
  body: string;
  question: string;
  optionA: string;
  optionB: string;
  correct: 'A' | 'B';
  explain: string;
  audioKey: string | null;
}

export interface EncyclopediaBundle {
  meta: { total: number; cats: number; aShare: number };
  cats: { key: string; name: string; about: string; priority: number; count: number }[];
  cards: EncyclopediaCard[];
}

export declare function loadCharacters(): Promise<CharactersBundle>;
export declare function loadWords(): Promise<WordsBundle>;
export declare function loadMath(): Promise<MathBundle>;
export declare function loadScience(): Promise<ScienceBundle>;
export declare function loadEncyclopedia(): Promise<EncyclopediaBundle>;

/** 单字笔顺：s = SVG 路径数组，m = 每笔中线点阵 */
export interface StrokeData {
  s: string[];
  m: number[][][];
}
export declare function loadStrokes(): Promise<Record<string, StrokeData>>;
export declare function indexByChar(chars: CharacterRecord[]): Map<string, CharacterRecord>;
export declare function indexWords(words: WordRecord[]): Map<string, WordRecord>;
export declare function wordsOf(
  char: CharacterRecord,
  wordsById: Map<string, WordRecord>,
): WordRecord[];