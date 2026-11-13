import { describe, expect, it } from 'vitest';
import { FamilyGraph } from '../kinship';
import { KIN_LANGUAGES, regionalTerm } from '../kinshipTerms';
import { emptyPerson } from '../person';
import type { Gender, Relationship, RelType } from '../types';

/**
 * Fixture: "me" (male, 1990) with an extended Indian family.
 * Birth years decide elder/younger: tau(1955) > papa(1960) > chacha(1965);
 * mausiElder(1958) > maa(1963) > mausiYounger(1968); bhaiya(1985), didi(1987) > me > chhotaBhai(1993) ...
 */
function fixture() {
  const people = new Map<string, ReturnType<typeof emptyPerson>>();
  const rels: Relationship[] = [];
  let n = 0;
  const add = (id: string, gender: Gender, birth?: string) =>
    people.set(id, emptyPerson({ id, firstName: id, gender, birthDate: birth }));
  const rel = (fromId: string, toId: string, type: RelType, subtype?: Relationship['subtype']) =>
    rels.push({ id: String(n++), fromId, toId, type, subtype, createdAt: 0 });
  const kids = (parents: string[], ...children: string[]) => {
    for (const p of parents) for (const c of children) rel(p, c, 'parent');
  };
  const marry = (a: string, b: string) => rel(a, b, 'spouse');

  // Paternal grandparents and father's siblings
  add('dada', 'male', '1930'); add('dadi', 'female', '1932'); marry('dada', 'dadi');
  add('papa', 'male', '1960'); add('tau', 'male', '1955'); add('chacha', 'male', '1965');
  add('chachaX', 'male'); add('bua', 'female', '1962');
  kids(['dada', 'dadi'], 'papa', 'tau', 'chacha', 'chachaX', 'bua');
  add('tai', 'female'); marry('tau', 'tai');
  add('chachi', 'female'); marry('chacha', 'chachi');
  add('chachiX', 'female'); marry('chachaX', 'chachiX');
  add('phupha', 'male'); marry('bua', 'phupha');
  // Maternal grandparents and mother's siblings
  add('nana', 'male', '1935'); add('nani', 'female', '1938'); marry('nana', 'nani');
  add('maa', 'female', '1963'); add('mama', 'male', '1960');
  add('mausiElder', 'female', '1958'); add('mausiYounger', 'female', '1968');
  kids(['nana', 'nani'], 'maa', 'mama', 'mausiElder', 'mausiYounger');
  add('mami', 'female'); marry('mama', 'mami');
  add('mausaElder', 'male'); marry('mausiElder', 'mausaElder');
  add('mausaYounger', 'male'); marry('mausiYounger', 'mausaYounger');
  // Me and my siblings
  marry('papa', 'maa');
  add('me', 'male', '1990'); add('bhaiya', 'male', '1985'); add('didi', 'female', '1987');
  add('chhotaBhai', 'male', '1993'); add('chhotiBehen', 'female', '1995');
  add('sibX', 'male'); add('sisX', 'female');
  kids(['papa', 'maa'], 'me', 'bhaiya', 'didi', 'chhotaBhai', 'chhotiBehen', 'sibX', 'sisX');
  add('bhabhi', 'female'); marry('bhaiya', 'bhabhi');
  add('chhotiBahu', 'female'); marry('chhotaBhai', 'chhotiBahu');
  add('jija', 'male'); marry('didi', 'jija');
  add('bhatija', 'male'); add('bhatiji', 'female'); kids(['bhaiya', 'bhabhi'], 'bhatija', 'bhatiji');
  add('bhanja', 'male'); add('bhanji', 'female'); kids(['didi', 'jija'], 'bhanja', 'bhanji');
  // Cousins
  add('chacheraElder', 'male', '1980'); kids(['tau'], 'chacheraElder');
  add('chacheriYounger', 'female', '2000'); kids(['chacha'], 'chacheriYounger');
  add('phupheraElder', 'male', '1985'); add('phupheriYounger', 'female', '1998'); kids(['bua'], 'phupheraElder', 'phupheriYounger');
  add('mameraYounger', 'male', '1995'); add('mameriElder', 'female', '1986'); kids(['mama'], 'mameraYounger', 'mameriElder');
  add('mauseraElder', 'male', '1984'); add('mauseriYounger', 'female', '1999'); kids(['mausiElder'], 'mauseraElder', 'mauseriYounger');
  add('cousinX', 'male'); kids(['tau'], 'cousinX');
  // Wife's side
  add('wife', 'female', '1992'); marry('me', 'wife');
  add('sasur', 'male'); add('saas', 'female'); marry('sasur', 'saas');
  add('saalaElder', 'male', '1988'); add('saalaYounger', 'male', '1995');
  add('saaliElder', 'female', '1989'); add('saaliYounger', 'female', '1996');
  kids(['sasur', 'saas'], 'wife', 'saalaElder', 'saalaYounger', 'saaliElder', 'saaliYounger');
  add('saadu', 'male'); marry('saaliElder', 'saadu');
  add('wifeBhatija', 'male'); kids(['saalaElder'], 'wifeBhatija');
  // Children and grandchildren
  add('son', 'male'); add('daughter', 'female'); kids(['me', 'wife'], 'son', 'daughter');
  add('bahu', 'female'); marry('son', 'bahu');
  add('damaad', 'male'); marry('daughter', 'damaad');
  add('pota', 'male'); add('poti', 'female'); kids(['son', 'bahu'], 'pota', 'poti');
  add('nati', 'male'); add('natin', 'female'); kids(['daughter', 'damaad'], 'nati', 'natin');
  // Edge cases
  add('stepMom', 'female'); rel('stepMom', 'me', 'parent', 'step');
  add('kidX', 'unknown'); kids(['me'], 'kidX');
  add('friend', 'male'); rel('me', 'friend', 'friend');
  return new FamilyGraph(people, rels);
}

const G = fixture();

// [ego, target, Hindi, Telugu]
type Row = [string, string, string | undefined, string | undefined];
const ROWS: Row[] = [
  // Parents, spouse, children
  ['me', 'papa', 'Pitaji', 'Nanna'],
  ['me', 'maa', 'Maa', 'Amma'],
  ['me', 'wife', 'Patni', 'Bharya'],
  ['wife', 'me', 'Pati', 'Bharta'],
  ['me', 'son', 'Beta', 'Koduku'],
  ['me', 'daughter', 'Beti', 'Kuthuru'],
  // Grandparents and grandchildren
  ['me', 'dada', 'Dada', 'Thatha'],
  ['me', 'dadi', 'Dadi', 'Nayanamma'],
  ['me', 'nana', 'Nana', 'Thatha'],
  ['me', 'nani', 'Nani', 'Ammamma'],
  ['me', 'pota', 'Pota', 'Manavadu'],
  ['me', 'poti', 'Poti', 'Manavaralu'],
  ['me', 'nati', 'Nati', 'Manavadu'],
  ['me', 'natin', 'Natin', 'Manavaralu'],
  // Siblings by age
  ['me', 'bhaiya', 'Bhaiya', 'Anna'],
  ['me', 'didi', 'Didi', 'Akka'],
  ['me', 'chhotaBhai', 'Chhota bhai', 'Tammudu'],
  ['me', 'chhotiBehen', 'Chhoti behen', 'Chelli'],
  ['me', 'sibX', 'Bhai', 'Anna / Tammudu'],
  ['me', 'sisX', 'Behen', 'Akka / Chelli'],
  ['chhotaBhai', 'me', 'Bhaiya', 'Anna'],
  // Father's side
  ['me', 'tau', 'Tau', 'Pedananna'],
  ['me', 'chacha', 'Chacha', 'Babai'],
  ['me', 'chachaX', 'Tau / Chacha', 'Pedananna / Babai'],
  ['me', 'tai', 'Tai', 'Peddamma'],
  ['me', 'chachi', 'Chachi', 'Pinni'],
  ['me', 'chachiX', 'Tai / Chachi', 'Peddamma / Pinni'],
  ['me', 'bua', 'Bua', 'Atta'],
  ['me', 'phupha', 'Phupha', 'Mavayya'],
  // Mother's side
  ['me', 'mama', 'Mama', 'Mavayya'],
  ['me', 'mami', 'Mami', 'Atta'],
  ['me', 'mausiElder', 'Mausi', 'Peddamma'],
  ['me', 'mausiYounger', 'Mausi', 'Pinni'],
  ['me', 'mausaElder', 'Mausa', 'Pedananna'],
  ['me', 'mausaYounger', 'Mausa', 'Babai'],
  // Cousins (Telugu: parallel = sibling words, cross = Bava / Vadina / Maradalu)
  ['me', 'chacheraElder', 'Chachera bhai', 'Anna'],
  ['me', 'chacheriYounger', 'Chacheri behen', 'Chelli'],
  ['me', 'cousinX', 'Chachera bhai', 'Anna / Tammudu'],
  ['me', 'mauseraElder', 'Mausera bhai', 'Anna'],
  ['me', 'mauseriYounger', 'Mauseri behen', 'Chelli'],
  ['me', 'phupheraElder', 'Phuphera bhai', 'Bava'],
  ['me', 'phupheriYounger', 'Phupheri behen', 'Maradalu'],
  ['me', 'mameriElder', 'Mameri behen', 'Vadina'],
  ['me', 'mameraYounger', 'Mamera bhai', undefined],
  // Spouse's family (husband's side seen by wife, wife's side seen by me)
  ['me', 'sasur', 'Sasur', 'Mavayya'],
  ['me', 'saas', 'Saas', 'Atta'],
  ['wife', 'papa', 'Sasur', 'Mavayya'],
  ['me', 'saalaElder', 'Sala', 'Bava'],
  ['me', 'saalaYounger', 'Sala', 'Bavamaridi'],
  ['me', 'saaliElder', 'Saali', 'Vadina'],
  ['me', 'saaliYounger', 'Saali', 'Maradalu'],
  ['wife', 'bhaiya', 'Jeth', 'Bava'],
  ['wife', 'chhotaBhai', 'Devar', 'Maridi'],
  ['wife', 'sibX', 'Jeth / Devar', 'Bava / Maridi'],
  ['wife', 'didi', 'Nanad', 'Adapaduchu'],
  ['wife', 'bhabhi', 'Jethani', 'Thodikodalu'],
  ['wife', 'chhotiBahu', 'Devrani', 'Thodikodalu'],
  ['me', 'saadu', 'Saadu', 'Thodalludu'],
  // Siblings' spouses
  ['me', 'bhabhi', 'Bhabhi', 'Vadina'],
  ['me', 'chhotiBahu', 'Bhabhi', 'Maradalu'],
  ['me', 'jija', 'Jijaji', 'Bava'],
  // Children's spouses
  ['me', 'bahu', 'Bahu', 'Kodalu'],
  ['me', 'damaad', 'Damaad', 'Alludu'],
  // Nephews and nieces (Telugu: cross only)
  ['me', 'bhatija', 'Bhatija', undefined],
  ['me', 'bhatiji', 'Bhatiji', undefined],
  ['me', 'bhanja', 'Bhanja', 'Menalludu'],
  ['me', 'bhanji', 'Bhanji', 'Menakodalu'],
  ['wife', 'wifeBhatija', 'Bhatija', 'Menalludu'],
  // Non-"me" egos
  ['bhatija', 'me', 'Chacha', 'Babai'],
  ['bhanja', 'me', 'Mama', 'Mavayya'],
  ['son', 'papa', 'Dada', 'Thatha'],
  ['nati', 'wife', 'Nani', 'Ammamma'],
  ['bhaiya', 'didi', 'Chhoti behen', 'Chelli'],
  // No term
  ['me', 'stepMom', undefined, undefined],
  ['me', 'kidX', undefined, undefined],
  ['me', 'friend', undefined, undefined],
  ['me', 'me', undefined, undefined],
];

describe('regionalTerm', () => {
  it.each(ROWS)('%s → %s: hi=%s te=%s', (ego, target, hi, te) => {
    expect(regionalTerm(G, ego, target, 'hi')).toBe(hi);
    expect(regionalTerm(G, ego, target, 'te')).toBe(te);
  });

  it('returns nothing for English', () => {
    for (const [ego, target] of ROWS) expect(regionalTerm(G, ego, target, 'en')).toBeUndefined();
  });

  it('lists the languages', () => {
    expect(KIN_LANGUAGES).toEqual([
      { id: 'en', label: 'English only' },
      { id: 'hi', label: 'Hindi' },
      { id: 'te', label: 'Telugu' },
    ]);
  });

  it('uses full dates when both are complete and same-year births are otherwise unknown', () => {
    const people = [
      emptyPerson({ id: 'a', firstName: 'a', gender: 'male', birthDate: '1990-03-01' }),
      emptyPerson({ id: 'b', firstName: 'b', gender: 'male', birthDate: '1990-01-01' }),
      emptyPerson({ id: 'c', firstName: 'c', gender: 'female', birthDate: '1990' }),
    ];
    const rels: Relationship[] = [
      { id: '1', fromId: 'a', toId: 'b', type: 'sibling', createdAt: 0 },
      { id: '2', fromId: 'a', toId: 'c', type: 'sibling', createdAt: 0 },
    ];
    const g = new FamilyGraph(people, rels);
    expect(regionalTerm(g, 'a', 'b', 'te')).toBe('Anna');
    expect(regionalTerm(g, 'b', 'a', 'te')).toBe('Tammudu');
    expect(regionalTerm(g, 'a', 'c', 'te')).toBe('Akka / Chelli');
  });
});
