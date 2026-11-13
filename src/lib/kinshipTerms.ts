import { familyPath, type FamilyGraph, type Step } from './kinship';
import type { Gender, Person } from './types';

/**
 * Regional (Indian) kinship vocabularies, romanised.
 *
 * Scheme
 * ------
 * North Indian (Hindi) and Dravidian (Telugu) kinship terms are descriptive: the word depends on
 * the exact path (father's brother vs mother's brother), the genders along it, and often on
 * relative age (father's ELDER brother "Tau" vs YOUNGER brother "Chacha"). We therefore work from
 * the shortest family path (`familyPath`, which prefers blood links over step/foster/ex links),
 * encode it as a pattern of steps (P parent, C child, S sibling, H spouse) and switch on it.
 *
 * Relative age is decided by birth dates (full dates when both are complete, else years):
 *   - siblings and cousins: target vs ego;
 *   - parent's siblings: the parent's sibling vs the parent (their spouses follow the sibling);
 *   - spouse's siblings: vs the spouse; sibling's spouse: the sibling vs ego.
 * When age decides the word and is unknown, a combined form ("Tau / Chacha") or the generic word
 * ("Bhai") is returned.
 *
 * Telugu follows the Dravidian parallel/cross distinction: parallel cousins (father's brother's or
 * mother's sister's children) are called brother/sister (Anna/Akka/Tammudu/Chelli by age); cross
 * cousins (father's sister's or mother's brother's children) get affinal words (Bava, Vadina,
 * Maradalu). Cross nephews/nieces (a man's sister's children, a woman's brother's children) are
 * Menalludu/Menakodalu.
 *
 * Sources: everyday spoken usage, following the standard descriptions of the Hindi terminology
 * (S. Vatuk, "A structural analysis of the Hindi kinship terminology", 1969) and of Dravidian
 * kinship (T. R. Trautmann, "Dravidian Kinship", 1981). Spellings are common romanisations, not
 * a formal transliteration. Where a Telugu term was not certain, we return undefined instead of
 * guessing (younger male cross-cousin, parallel nephew/niece, step/foster relations).
 *
 * Step, foster and ex-spouse links return undefined: they have no reliable native term here.
 */

export type KinLang = 'en' | 'hi' | 'te';

export const KIN_LANGUAGES: { id: KinLang; label: string }[] = [
  { id: 'en', label: 'English only' },
  { id: 'hi', label: 'Hindi' },
  { id: 'te', label: 'Telugu' },
];

type Sex = 'm' | 'f' | undefined;
/** -1 = younger, 1 = elder, undefined = unknown. */
type Age = -1 | 1 | undefined;

interface Ctx {
  /** Pattern of step kinds, e.g. "PSC". */
  pat: string;
  /** Sex of each person on the path; index 0 = ego, last = target. */
  sex: Sex[];
  /** Relative age of path node i vs path node j. */
  age: (i: number, j: number) => Age;
  last: number;
}

/** Native kinship term for `targetId` from `egoId`'s view, romanised (e.g. "Chacha", "Babai"), or undefined if none/unknown. */
export function regionalTerm(graph: FamilyGraph, egoId: string, targetId: string, lang: KinLang): string | undefined {
  if (lang === 'en' || egoId === targetId) return undefined;
  const path = familyPath(graph, egoId, targetId);
  if (!path || !path.steps.length) return undefined;
  if (path.steps.some((s) => weakStep(s.step))) return undefined;
  const ids = [egoId, ...path.steps.map((s) => s.id)];
  const people = ids.map((id) => graph.person(id));
  const ctx: Ctx = {
    pat: path.steps.map((s) => KIND[s.step.kind]).join(''),
    sex: people.map((p) => sexOf(p?.gender)),
    age: (i, j) => compareAge(people[i], people[j]),
    last: ids.length - 1,
  };
  if (!ctx.sex[ctx.last]) return undefined;
  return lang === 'hi' ? hindi(ctx) : telugu(ctx);
}

const KIND: Record<Step['kind'], string> = { parent: 'P', child: 'C', sibling: 'S', spouse: 'H' };

function weakStep(s: Step): boolean {
  switch (s.kind) {
    case 'parent':
    case 'child':
      return s.sub === 'step' || s.sub === 'foster';
    case 'sibling':
      return !!s.step;
    case 'spouse':
      return s.sub === 'divorced';
  }
}

function sexOf(g: Gender | undefined): Sex {
  return g === 'male' ? 'm' : g === 'female' ? 'f' : undefined;
}

/** 1 if a is elder than b, -1 if younger, undefined if unknown or equal. */
function compareAge(a: Person | undefined, b: Person | undefined): Age {
  const da = a?.birthDate;
  const db = b?.birthDate;
  if (!da || !db) return undefined;
  const full = /^\d{4}-\d{2}-\d{2}$/;
  const [ka, kb] = full.test(da) && full.test(db) ? [da, db] : [da.slice(0, 4), db.slice(0, 4)];
  if (!/^\d{4}/.test(ka) || !/^\d{4}/.test(kb) || ka === kb) return undefined;
  return ka < kb ? 1 : -1;
}

/** Pick by sex; undefined sex gives undefined. */
function bySex(s: Sex, m: string | undefined, f: string | undefined): string | undefined {
  return s === 'm' ? m : s === 'f' ? f : undefined;
}

/** Pick by age; unknown age gives `unknown` (default: "elder / younger" when both exist). */
function byAge(a: Age, elder: string | undefined, younger: string | undefined, unknown?: string): string | undefined {
  if (a === 1) return elder;
  if (a === -1) return younger;
  if (unknown !== undefined) return unknown;
  return elder && younger ? `${elder} / ${younger}` : undefined;
}

// ---------------------------------------------------------------------------
// Hindi

function hindi(c: Ctx): string | undefined {
  const { pat, sex, age, last } = c;
  const t = sex[last];
  switch (pat) {
    case 'P':
      return bySex(t, 'Pitaji', 'Maa');
    case 'H':
      return bySex(t, 'Pati', 'Patni');
    case 'C':
      return bySex(t, 'Beta', 'Beti');
    case 'S':
      return bySex(t, byAge(age(1, 0), 'Bhaiya', 'Chhota bhai', 'Bhai'), byAge(age(1, 0), 'Didi', 'Chhoti behen', 'Behen'));
    case 'PP':
      // Dada/Dadi on the father's side, Nana/Nani on the mother's side.
      return sex[1] === 'm' ? bySex(t, 'Dada', 'Dadi') : sex[1] === 'f' ? bySex(t, 'Nana', 'Nani') : undefined;
    case 'CC':
      return sex[1] === 'm' ? bySex(t, 'Pota', 'Poti') : sex[1] === 'f' ? bySex(t, 'Nati', 'Natin') : undefined;
    case 'PS': {
      const a = age(2, 1); // parent's sibling vs parent
      if (sex[1] === 'm') return bySex(t, byAge(a, 'Tau', 'Chacha'), 'Bua');
      if (sex[1] === 'f') return bySex(t, 'Mama', 'Mausi');
      return undefined;
    }
    case 'PSH': {
      const a = age(2, 1);
      if (sex[1] === 'm') {
        if (sex[2] === 'm') return t === 'f' ? byAge(a, 'Tai', 'Chachi') : undefined;
        if (sex[2] === 'f') return t === 'm' ? 'Phupha' : undefined;
      }
      if (sex[1] === 'f') {
        if (sex[2] === 'm') return t === 'f' ? 'Mami' : undefined;
        if (sex[2] === 'f') return t === 'm' ? 'Mausa' : undefined;
      }
      return undefined;
    }
    case 'PSC': {
      const prefix = sex[1] === 'm' ? (sex[2] === 'm' ? 'Chacher' : sex[2] === 'f' ? 'Phupher' : undefined)
        : sex[1] === 'f' ? (sex[2] === 'm' ? 'Mamer' : sex[2] === 'f' ? 'Mauser' : undefined) : undefined;
      return prefix ? bySex(t, `${prefix}a bhai`, `${prefix}i behen`) : undefined;
    }
    case 'SC':
      return sex[1] === 'm' ? bySex(t, 'Bhatija', 'Bhatiji') : sex[1] === 'f' ? bySex(t, 'Bhanja', 'Bhanji') : undefined;
    case 'SH':
      if (sex[1] === 'm' && t === 'f') return 'Bhabhi';
      if (sex[1] === 'f' && t === 'm') return 'Jijaji';
      return undefined;
    case 'HP':
      return bySex(t, 'Sasur', 'Saas');
    case 'HS': {
      const a = age(2, 1); // spouse's sibling vs spouse
      if (sex[1] === 'm') return bySex(t, byAge(a, 'Jeth', 'Devar'), 'Nanad');
      if (sex[1] === 'f') return bySex(t, 'Sala', 'Saali');
      return undefined;
    }
    case 'HSH': {
      const a = age(2, 1);
      if (sex[1] === 'm' && sex[2] === 'm' && t === 'f') return byAge(a, 'Jethani', 'Devrani');
      if (sex[1] === 'f' && sex[2] === 'f' && t === 'm') return 'Saadu';
      return undefined;
    }
    case 'CH':
      if (sex[1] === 'm' && t === 'f') return 'Bahu';
      if (sex[1] === 'f' && t === 'm') return 'Damaad';
      return undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Telugu

function telugu(c: Ctx): string | undefined {
  const { pat, sex, age, last } = c;
  const t = sex[last];
  const siblingWord = (a: Age) => bySex(t, byAge(a, 'Anna', 'Tammudu'), byAge(a, 'Akka', 'Chelli'));
  switch (pat) {
    case 'P':
      return bySex(t, 'Nanna', 'Amma');
    case 'H':
      return bySex(t, 'Bharta', 'Bharya');
    case 'C':
      return bySex(t, 'Koduku', 'Kuthuru');
    case 'S':
      return siblingWord(age(1, 0));
    case 'PP':
      return sex[1] === 'm' ? bySex(t, 'Thatha', 'Nayanamma') : sex[1] === 'f' ? bySex(t, 'Thatha', 'Ammamma') : undefined;
    case 'CC':
      return bySex(t, 'Manavadu', 'Manavaralu');
    case 'PS': {
      const a = age(2, 1);
      if (sex[1] === 'm') return bySex(t, byAge(a, 'Pedananna', 'Babai'), 'Atta');
      if (sex[1] === 'f') return bySex(t, 'Mavayya', byAge(a, 'Peddamma', 'Pinni'));
      return undefined;
    }
    case 'PSH': {
      // Spouses of parallel uncles/aunts take the elder/younger word of the blood relative.
      const a = age(2, 1);
      if (sex[1] === 'm' && sex[2] === 'm' && t === 'f') return byAge(a, 'Peddamma', 'Pinni');
      if (sex[1] === 'f' && sex[2] === 'f' && t === 'm') return byAge(a, 'Pedananna', 'Babai');
      if (sex[1] === 'm' && sex[2] === 'f' && t === 'm') return 'Mavayya';
      if (sex[1] === 'f' && sex[2] === 'm' && t === 'f') return 'Atta';
      return undefined;
    }
    case 'PSC': {
      if (!sex[1] || !sex[2]) return undefined;
      const a = age(last, 0);
      if (sex[1] === sex[2]) return siblingWord(a); // parallel cousin
      // Cross cousin. Younger male cross-cousin is left undefined (not confident).
      return bySex(t, byAge(a, 'Bava', undefined), byAge(a, 'Vadina', 'Maradalu'));
    }
    case 'SC':
      // Cross nephew/niece only (sibling of the opposite sex to ego).
      if (!sex[0] || !sex[1] || sex[0] === sex[1]) return undefined;
      return bySex(t, 'Menalludu', 'Menakodalu');
    case 'SH':
      if (sex[1] === 'm' && t === 'f') return byAge(age(1, 0), 'Vadina', 'Maradalu');
      if (sex[1] === 'f' && t === 'm') return 'Bava';
      return undefined;
    case 'HP':
      return bySex(t, 'Mavayya', 'Atta');
    case 'HS': {
      const a = age(2, 1);
      if (sex[1] === 'm') return bySex(t, byAge(a, 'Bava', 'Maridi'), 'Adapaduchu');
      if (sex[1] === 'f') return bySex(t, byAge(a, 'Bava', 'Bavamaridi'), byAge(a, 'Vadina', 'Maradalu'));
      return undefined;
    }
    case 'HSH':
      if (sex[1] === 'm' && sex[2] === 'm' && t === 'f') return 'Thodikodalu';
      if (sex[1] === 'f' && sex[2] === 'f' && t === 'm') return 'Thodalludu';
      return undefined;
    case 'CH':
      if (sex[1] === 'm' && t === 'f') return 'Kodalu';
      if (sex[1] === 'f' && t === 'm') return 'Alludu';
      return undefined;
  }
  return undefined;
}
