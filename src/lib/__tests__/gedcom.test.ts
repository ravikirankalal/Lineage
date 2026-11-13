import { describe, expect, it } from 'vitest';
import { decodeGedcom, exportGedcom, joinPlace, parseGedcom, parseGedcomDate, relaToSibling, resolveImportedMe, splitPlace } from '../gedcom';
import { emptyPerson } from '../person';
import type { Person, Relationship } from '../types';

// Invented family; phone numbers use the fictional 555-01xx range and emails example.com. Exercises: BOM, CRLF, ANSEL header, CONT/CONC, NOTE records, PEDI, DIV, _FREL/_MREL,
// qualified dates, custom tags, RESI/ADDR, FAMC-only back links, a bad line, and a nameless person.
const FIXTURE = [
  '﻿0 HEAD',
  '1 SOUR FAMILY_TREE_APP',
  '1 GEDC',
  '2 VERS 5.5.1',
  '2 FORM LINEAGE-LINKED',
  '1 CHAR ANSEL',
  '0 @I1@ INDI',
  '1 NAME Ravindra Nath /Vermalu/',
  '2 GIVN Ravindra Nath',
  '2 SURN Vermalu',
  '2 NICK Ravi',
  '1 NAME Ravi /Vermala/',
  '2 TYPE aka',
  '1 SEX M',
  '1 BIRT',
  '2 DATE 12 MAR 1931',
  '2 PLAC Kothapalle, Nalgonda, Telangana, India',
  '1 DEAT',
  '2 DATE ABT 1999',
  '2 PLAC Hyderabad, Telangana, India',
  '1 OCCU Schoolteacher',
  '1 EDUC B.A. History',
  '2 AGNC Imaginary Arts College',
  '2 DATE FROM 1949 TO 1952',
  '1 RELI Hindu',
  '1 _GOTRA Kashyapa',
  '1 NOTE @N1@',
  '1 FAMS @F1@',
  '1 FAMS @F3@',
  '1 _UID 0123456789ABCDEF',
  '0 @I2@ INDI',
  '1 NAME Sarala /Devipuri/',
  '1 SEX F',
  '1 BIRT',
  '2 DATE BET 1935 AND 1938',
  '1 RESI',
  '2 PLAC Secunderabad, Telangana',
  '2 PHON +1 202-555-0101',
  '2 EMAIL sarala@@example.com',
  '1 NOTE Loved gardening.',
  '2 CONT Grew jasmine on the terr',
  '2 CONC ace.',
  '1 FAMS @F1@',
  '0 @I3@ INDI',
  '1 NAME Mohan /Vermalu/',
  '1 SEX M',
  '1 BIRT',
  '2 DATE MAR 1960',
  '1 FAMC @F1@',
  '0 @I4@ INDI',
  '1 NAME Latha /Vermalu/',
  '1 SEX F',
  '1 BIRT',
  '2 DATE 1963',
  '1 FAMC @F1@',
  '2 PEDI adopted',
  '0 @I5@ INDI',
  '1 NAME //',
  '1 SEX U',
  '1 DEAT Y',
  '1 FAMC @F1@',
  '0 @I6@ INDI',
  '1 NAME Kamala /Raomuri/',
  '1 SEX F',
  '1 BIRT',
  '2 DATE (during the monsoon)',
  '1 FAMS @F3@',
  '0 @I7@ INDI',
  '1 NAME Suresh /Vermalu/',
  '1 SEX M',
  '1 FAMC @F3@',
  'this line is garbage',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @I2@',
  '1 MARR',
  '2 DATE 4 MAY 1958',
  '2 PLAC Warangal, Telangana, India',
  '1 CHIL @I3@',
  '1 CHIL @I4@',
  '0 @F3@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @I6@',
  '1 DIV Y',
  '1 CHIL @I7@',
  '2 _FREL Natural',
  '2 _MREL Step',
  '0 @N1@ NOTE Retired headmaster of the village school.',
  '1 CONT Wrote poems in Telugu.',
  '0 TRLR',
].join('\r\n');

describe('parseGedcom', () => {
  const res = parseGedcom(FIXTURE);
  const by = (first: string) => res.people.find((p) => p.firstName === first)!;
  const edge = (type: string, a: Person, b: Person) =>
    res.relationships.find((r) => r.type === type && ((r.fromId === a.id && r.toId === b.id) || (type !== 'parent' && r.fromId === b.id && r.toId === a.id)));

  it('reads every INDI with fresh ids and manual source', () => {
    expect(res.people).toHaveLength(7);
    expect(new Set(res.people.map((p) => p.id)).size).toBe(7);
    expect(res.people.every((p) => p.source === 'manual' && !p.id.startsWith('@'))).toBe(true);
  });

  it('warns about ANSEL and bad lines', () => {
    expect(res.warnings.some((w) => /ANSEL/.test(w))).toBe(true);
    expect(res.warnings.some((w) => /Skipped 1 line/.test(w))).toBe(true);
  });

  it('parses names, nicknames and other names', () => {
    const r = by('Ravindra');
    expect([r.firstName, r.middleName, r.lastName, r.nickname]).toEqual(['Ravindra', 'Nath', 'Vermalu', 'Ravi']);
    expect(r.otherNames).toBe('Ravi Vermala');
    const unknown = res.people.find((p) => p.gender === 'unknown')!;
    expect(unknown.firstName).toBe('Unknown');
    expect(unknown.lastName).toBeUndefined();
    expect(unknown.deceased).toBe(true);
  });

  it('parses sex, dates, places, deceased', () => {
    const r = by('Ravindra');
    expect(r.gender).toBe('male');
    expect(r.birthDate).toBe('1931-03-12');
    expect(r.origin).toEqual({ city: 'Kothapalle', district: 'Nalgonda', state: 'Telangana', country: 'India' });
    expect(r.deceased).toBe(true);
    expect(r.deathDate).toBe('1999');
    expect(r.facts).toContainEqual({ label: 'Death date', value: 'about 1999' });
    expect(r.facts).toContainEqual({ label: 'Place of death', value: 'Hyderabad, Telangana, India' });
    expect(by('Mohan').birthDate).toBe('1960-03');
    expect(by('Latha').birthDate).toBe('1963');
    // A range is not an exact year: only the fact is kept.
    expect(by('Sarala').birthDate).toBeUndefined();
    expect(by('Sarala').facts).toContainEqual({ label: 'Birth date', value: 'between 1935 and 1938' });
    expect(by('Kamala').birthDate).toBeUndefined();
    expect(by('Kamala').facts).toContainEqual({ label: 'Birth date', value: 'during the monsoon' });
  });

  it('parses occupation, education, facts and skips bookkeeping tags', () => {
    const r = by('Ravindra');
    expect(r.occupation).toBe('Schoolteacher');
    expect(r.education).toEqual([{ institution: 'Imaginary Arts College', course: 'B.A. History', from: '1949', to: '1952' }]);
    expect(r.facts).toContainEqual({ label: 'Religion', value: 'Hindu' });
    expect(r.facts).toContainEqual({ label: 'Gotra', value: 'Kashyapa' });
    expect(r.facts.some((f) => /UID/i.test(f.label))).toBe(false);
  });

  it('resolves NOTE records and folds CONT/CONC', () => {
    expect(by('Ravindra').notes).toBe('Retired headmaster of the village school.\nWrote poems in Telugu.');
    expect(by('Sarala').notes).toBe('Loved gardening.\nGrew jasmine on the terrace.');
  });

  it('reads RESI place, phone and @@-escaped email', () => {
    const s = by('Sarala');
    expect(s.address).toEqual({ city: 'Secunderabad', state: 'Telangana' });
    expect(s.phones[0].value).toBe('+1 202-555-0101');
    expect(s.emails[0].value).toBe('sarala@example.com');
  });

  it('builds spouse and parent edges', () => {
    const [r, s, m, l, k, su] = ['Ravindra', 'Sarala', 'Mohan', 'Latha', 'Kamala', 'Suresh'].map(by);
    const unknown = res.people.find((p) => p.firstName === 'Unknown')!;
    const sp = edge('spouse', r, s)!;
    expect(sp.subtype).toBe('married');
    expect(sp.note).toBe('Married 4 May 1958, Warangal, Telangana, India');
    expect(edge('spouse', r, k)!.subtype).toBe('divorced');
    expect(edge('parent', r, m)!.subtype).toBeUndefined();
    expect(edge('parent', s, m)).toBeDefined();
    expect(edge('parent', r, l)!.subtype).toBe('adoptive');
    expect(edge('parent', s, l)!.subtype).toBe('adoptive');
    // I5 is only linked from its own FAMC, not from the FAM's CHIL list.
    expect(edge('parent', r, unknown)).toBeDefined();
    expect(edge('parent', r, su)!.subtype).toBe('biological');
    expect(edge('parent', k, su)!.subtype).toBe('step');
    expect(res.relationships.filter((x) => x.type === 'parent')).toHaveLength(8);
    expect(res.relationships.filter((x) => x.type === 'spouse')).toHaveLength(2);
  });
});

describe('GEDCOM quirks', () => {
  it('handles LF/CR-only line endings, lowercase tags and missing header', () => {
    const r = parseGedcom('0 @A@ INDI\r1 name Asha /Kulmaran/\r1 sex F\r0 TRLR');
    expect(r.people[0]).toMatchObject({ firstName: 'Asha', lastName: 'Kulmaran', gender: 'female' });
    expect(r.warnings.some((w) => /header/.test(w))).toBe(true);
  });

  it('adds FAMS-only spouses and FAMC-only children; warns on missing links', () => {
    const r = parseGedcom(['0 HEAD', '0 @P1@ INDI', '1 NAME Arun /Joshimar/', '1 SEX M', '1 FAMS @F1@',
      '0 @P2@ INDI', '1 NAME Meera /Joshimar/', '1 SEX F', '1 FAMS @F1@', '0 @P3@ INDI', '1 NAME Kiran /Joshimar/', '1 FAMC @F1@',
      '1 FAMC @F9@', '0 @F1@ FAM', '1 CHIL @P404@', '0 TRLR'].join('\n'));
    expect(r.relationships.filter((x) => x.type === 'spouse')).toHaveLength(1);
    expect(r.relationships.filter((x) => x.type === 'parent')).toHaveLength(2);
    expect(r.warnings.some((w) => /people not in the file/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /families not in the file/.test(w))).toBe(true);
  });

  it('drops parent edges that form a cycle', () => {
    const r = parseGedcom(['0 @A@ INDI', '1 NAME A //', '1 FAMS @F1@', '1 FAMC @F2@', '0 @B@ INDI', '1 NAME B //',
      '1 FAMS @F2@', '1 FAMC @F1@', '0 @F1@ FAM', '1 HUSB @A@', '1 CHIL @B@', '0 @F2@ FAM', '1 HUSB @B@', '1 CHIL @A@'].join('\n'));
    expect(r.relationships.filter((x) => x.type === 'parent')).toHaveLength(1);
    expect(r.warnings.some((w) => /own ancestor/.test(w))).toBe(true);
  });

  it('makes children of a parentless family siblings', () => {
    const r = parseGedcom(['0 @A@ INDI', '1 NAME Uma //', '0 @B@ INDI', '1 NAME Usha //', '0 @F@ FAM', '1 CHIL @A@', '1 CHIL @B@'].join('\n'));
    expect(r.relationships).toEqual([expect.objectContaining({ type: 'sibling' })]);
  });

  it('reads OCCU with AGNC as work and ADOP FAMC as adoptive for one parent', () => {
    const r = parseGedcom(['0 @A@ INDI', '1 NAME Dev /Iyerdas/', '1 SEX M', '1 FAMS @F@', '0 @B@ INDI', '1 NAME Gita /Iyerdas/', '1 SEX F', '1 FAMS @F@',
      '0 @C@ INDI', '1 NAME Nila /Iyerdas/', '1 OCCU Clerk', '2 AGNC Imaginary Rail Co', '2 DATE FROM 1980 TO 1995',
      '1 ADOP', '2 FAMC @F@', '3 ADOP WIFE', '1 FAMC @F@',
      '0 @F@ FAM', '1 HUSB @A@', '1 WIFE @B@', '1 CHIL @C@'].join('\n'));
    const c = r.people[2];
    expect(c.work).toEqual([{ organization: 'Imaginary Rail Co', role: 'Clerk', from: '1980', to: '1995' }]);
    const sub = (name: string) => r.relationships.find((x) => x.type === 'parent' && x.fromId === r.people.find((p) => p.firstName === name)!.id)?.subtype;
    expect(sub('Gita')).toBe('adoptive');
    expect(sub('Dev')).toBeUndefined();
  });

  it('decodes UTF-8, UTF-16 with BOM and falls back to Windows-1252', () => {
    expect(decodeGedcom(new TextEncoder().encode('0 HEAD é'))).toBe('0 HEAD é');
    const u16 = new Uint8Array([0xff, 0xfe, ...Array.from('0 HEAD').flatMap((c) => [c.charCodeAt(0), 0])]);
    expect(decodeGedcom(u16)).toBe('0 HEAD');
    expect(decodeGedcom(new Uint8Array([0x4a, 0x6f, 0x73, 0xe9]))).toBe('José');
  });
});

describe('dates and places', () => {
  it.each([
    ['12 MAR 1958', { date: '1958-03-12' }],
    ['MAR 1958', { date: '1958-03' }],
    ['1958', { date: '1958' }],
    ['2 Sept 1958', { date: '1958-09-02' }],
    ['1720/21', { date: '1720' }],
    ['@#DGREGORIAN@ 5 JAN 1901', { date: '1901-01-05' }],
    ['ABT 1900', { date: '1900', note: 'about 1900' }],
    ['CAL 1901', { date: '1901', note: 'calculated 1901' }],
    ['EST 1870', { date: '1870', note: 'estimated 1870' }],
    // Bounds and ranges never give a date: a year would read as exact.
    ['BEF 12 JUN 1900', { note: 'before 12 Jun 1900' }],
    ['AFT 1900', { note: 'after 1900' }],
    ['BET 1890 AND 1900', { note: 'between 1890 and 1900' }],
    ['FROM 1890 TO 1900', { note: 'from 1890 to 1900' }],
    ['FROM 1890', { note: 'from 1890' }],
    ['TO 1900', { note: 'to 1900' }],
    ['(the year of the flood)', { note: 'the year of the flood' }],
    ['32 MAR 1958', { note: '32 MAR 1958' }],
    ['@#DJULIAN@ 1 JAN 1700', { note: '@#DJULIAN@ 1 JAN 1700' }],
  ])('%s', (raw, expected) => expect(parseGedcomDate(raw)).toEqual(expected));

  it('splits places from the right', () => {
    expect(splitPlace('Kothapalle, Nalgonda, Telangana, India')).toEqual({ city: 'Kothapalle', district: 'Nalgonda', state: 'Telangana', country: 'India' });
    expect(splitPlace('Ward 4, Kothapalle, Nalgonda, Telangana, India')).toMatchObject({ area: 'Ward 4', city: 'Kothapalle' });
    expect(splitPlace(', , Ohio, USA')).toEqual({ state: 'Ohio', country: 'USA' });
    expect(splitPlace('Pune, Maharashtra, India')).toEqual({ city: 'Pune', state: 'Maharashtra', country: 'India' });
    expect(splitPlace('Springfield, Sangamon, Illinois')).toEqual({ city: 'Springfield', district: 'Sangamon', state: 'Illinois' });
    expect(splitPlace('Nairobi, Kenya')).toEqual({ city: 'Nairobi', country: 'Kenya' });
    expect(splitPlace('Mysuru, Karnataka')).toEqual({ city: 'Mysuru', state: 'Karnataka' });
    expect(splitPlace('Nepal')).toEqual({ country: 'Nepal' });
    expect(splitPlace(' , ')).toBeUndefined();
  });

  it.each([
    [{ city: 'Mysuru' }],
    [{ city: 'Mysuru', district: 'Mysuru Rural' }],
    [{ city: 'Mysuru', state: 'Karnataka' }],
    [{ city: 'Mysuru', country: 'India' }],
    [{ district: 'Nalgonda', state: 'Telangana', country: 'India' }],
    [{ area: 'Ward 4', city: 'Kothapalle', state: 'Telangana' }],
  ])('joinPlace round-trips %o', (pl) => expect(splitPlace(joinPlace(pl))).toEqual(pl));
});

describe('exportGedcom', () => {
  const mk = (id: string, p: Partial<Person>) => emptyPerson({ id, ...p });
  const rel = (id: string, fromId: string, toId: string, type: Relationship['type'], subtype?: Relationship['subtype']): Relationship => ({
    id, fromId, toId, type, createdAt: 0, ...(subtype ? { subtype } : {}),
  });
  const people: Person[] = [
    mk('gf', { firstName: 'Ravindra', middleName: 'Nath', lastName: 'Vermalu', gender: 'male', birthDate: '1931-03-12', deceased: true, deathDate: '1999',
      facts: [{ label: 'Death date', value: 'about 1999' }, { label: 'Religion', value: 'Hindu' }, { label: 'Gotra', value: 'Kashyapa' }],
      origin: { city: 'Kothapalle', district: 'Nalgonda', state: 'Telangana', country: 'India' }, notes: 'Line one\nLine two with an @ sign' }),
    mk('gm', { firstName: 'Sarala', lastName: 'Devipuri', gender: 'female', birthDate: '1935-06', nickname: 'Sallu',
      phones: [{ label: 'mobile', value: '+1 202-555-0101' }], emails: [{ label: 'home', value: 'sarala@example.com' }],
      address: { city: 'Secunderabad', state: 'Telangana' } }),
    mk('dad', { firstName: 'Mohan', lastName: 'Vermalu', gender: 'male', occupation: 'Engineer',
      work: [{ organization: 'Imaginary Dams Ltd', role: 'Site engineer', from: '1985', to: '2001' }],
      education: [{ institution: 'Fictional Institute of Technology', course: 'B.Tech', from: '1978', to: '1982' }] }),
    mk('mom', { firstName: 'Padma', lastName: 'Vermalu', gender: 'female', otherNames: 'Padma Ayyamkar (maiden)' }),
    mk('me', { firstName: 'Anika', lastName: 'Vermalu', gender: 'female', isMe: true, birthDate: '1990-01-05', howWeMet: 'Family' }),
    mk('sib', { firstName: 'Arjun', lastName: 'Vermalu', gender: 'male' }),
    mk('step', { firstName: 'Vikram', lastName: 'Sethiraman', gender: 'male' }),
    mk('friend', { firstName: 'Zoya', lastName: 'Friendly', gender: 'female' }),
  ];
  const rels: Relationship[] = [
    rel('r1', 'gf', 'gm', 'spouse', 'married'),
    rel('r2', 'gf', 'dad', 'parent'),
    rel('r3', 'gm', 'dad', 'parent', 'biological'),
    rel('r4', 'dad', 'mom', 'spouse', 'divorced'),
    rel('r5', 'dad', 'me', 'parent'),
    rel('r6', 'mom', 'me', 'parent'),
    rel('r7', 'dad', 'sib', 'parent', 'adoptive'),
    rel('r8', 'mom', 'sib', 'parent', 'adoptive'),
    rel('r9', 'mom', 'step', 'spouse', 'partner'),
    rel('r10', 'step', 'me', 'parent', 'step'),
    rel('r11', 'me', 'friend', 'close_friend'),
  ];

  it('writes a valid 5.5.1 envelope', () => {
    const out = exportGedcom(people, rels);
    const lines = out.trimEnd().split('\n');
    expect(lines[0]).toBe('0 HEAD');
    expect(out).toContain('1 SOUR LINEAGE');
    expect(out).toMatch(/1 GEDC\n2 VERS 5\.5\.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8/);
    expect(lines[lines.length - 1]).toBe('0 TRLR');
    // Every line follows "level [xref] tag [value]" and stays under 255 chars.
    for (const l of lines) {
      expect(l).toMatch(/^\d+ (@[A-Z0-9]+@ )?[A-Z0-9_]+( .*)?$/);
      expect(l.length).toBeLessThan(255);
    }
    // Every pointer resolves.
    const defined = new Set([...out.matchAll(/^0 (@[^@]+@)/gm)].map((m) => m[1]));
    for (const m of out.matchAll(/^[1-9] [A-Z_]+ (@[^@]+@)$/gm)) expect(defined.has(m[1])).toBe(true);
    expect(out).toContain('2 CONT Line two with an @@ sign');
  });

  it('exports only the family component with familyOfId', () => {
    const out = exportGedcom(people, rels, { familyOfId: 'me' });
    expect(out).toContain('Anika');
    expect(out).toContain('Vikram');
    expect(out).not.toContain('Zoya');
    expect(exportGedcom(people, rels)).toContain('Zoya');
  });

  it('round-trips names, genders, dates, details and family structure', () => {
    const back = parseGedcom(exportGedcom(people, rels));
    expect(back.warnings).toEqual([]);
    expect(back.people).toHaveLength(people.length);
    const byName = new Map(back.people.map((p) => [p.firstName, p]));
    const idMap = new Map(people.map((p) => [p.id, byName.get(p.firstName)!.id]));
    for (const p of people) {
      const q = byName.get(p.firstName)!;
      expect([q.middleName, q.lastName, q.nickname, q.gender, q.birthDate, q.deathDate, !!q.deceased])
        .toEqual([p.middleName, p.lastName, p.nickname, p.gender, p.birthDate, p.deathDate, !!p.deceased]);
      expect(q.origin).toEqual(p.origin);
      expect(q.address).toEqual(p.address);
      expect(q.otherNames).toEqual(p.otherNames);
      expect(q.notes).toEqual(p.notes);
      expect(q.occupation).toEqual(p.occupation);
      expect(q.work).toEqual(p.work);
      expect(q.education).toEqual(p.education);
      expect(q.howWeMet).toEqual(p.howWeMet);
      expect(q.phones.map((x) => x.value)).toEqual(p.phones.map((x) => x.value));
      expect(q.emails.map((x) => x.value)).toEqual(p.emails.map((x) => x.value));
      expect([...q.facts].sort((a, b) => a.label.localeCompare(b.label))).toEqual([...p.facts].sort((a, b) => a.label.localeCompare(b.label)));
    }
    const key = (r: { fromId: string; toId: string; type: string; subtype?: string }, map = (x: string) => x) => {
      const [a, b] = [map(r.fromId), map(r.toId)];
      const ends = r.type === 'parent' ? `${a}>${b}` : [a, b].sort().join('|');
      return `${r.type}:${ends}:${r.subtype ?? ''}`;
    };
    const family = rels.filter((r) => r.type === 'parent' || r.type === 'spouse');
    expect(back.relationships.map((r) => key(r)).sort()).toEqual(family.map((r) => key(r, (x) => idMap.get(x)!)).sort());
  });

  it('keeps qualified and unparseable dates', () => {
    const p = [
      mk('a', { firstName: 'Old', birthDate: '1900', facts: [{ label: 'Birth date', value: 'between 1900 and 1905' }] }),
      mk('b', { firstName: 'Vague', facts: [{ label: 'Birth date', value: 'during the monsoon' }] }),
    ];
    const out = exportGedcom(p, []);
    expect(out).toContain('2 DATE BET 1900 AND 1905');
    expect(out).toContain('2 DATE (during the monsoon)');
    // Older imports filled the year from a range; export writes only the range, so re-import drops that year.
    expect(out.match(/2 DATE/g)).toHaveLength(2);
    const back = parseGedcom(out).people;
    expect(back[0].birthDate).toBeUndefined();
    expect(back[0].facts).toEqual([{ label: 'Birth date', value: 'between 1900 and 1905' }]);
    expect(back[1].birthDate).toBeUndefined();
    expect(back[1].facts).toEqual([{ label: 'Birth date', value: 'during the monsoon' }]);
  });

  describe('qualified birth and death dates', () => {
    const indi = (birth: string, death: string) =>
      parseGedcom(['0 HEAD', '0 @I1@ INDI', '1 NAME Kesav /Imaginary/', '1 BIRT', `2 DATE ${birth}`, '1 DEAT', `2 DATE ${death}`, '0 TRLR'].join('\n')).people[0];

    it('QA case: ABT birth keeps the year, BEF death only the fact', () => {
      const p = indi('ABT 1940', 'BEF 2010');
      expect(p.birthDate).toBe('1940');
      expect(p.deathDate).toBeUndefined();
      expect(p.deceased).toBe(true);
      expect(p.facts).toEqual([{ label: 'Birth date', value: 'about 1940' }, { label: 'Death date', value: 'before 2010' }]);
    });

    it.each([
      ['BEF 1940', 'before 1940'],
      ['AFT 1940', 'after 1940'],
      ['BET 1938 AND 1942', 'between 1938 and 1942'],
      ['FROM 1938 TO 1942', 'from 1938 to 1942'],
      ['FROM 1938', 'from 1938'],
      ['TO 1942', 'to 1942'],
    ])('%s fills no date field, keeps the fact, and round-trips', (raw, note) => {
      const p = indi(raw, raw);
      expect(p.birthDate).toBeUndefined();
      expect(p.deathDate).toBeUndefined();
      expect(p.deceased).toBe(true);
      expect(p.facts).toEqual([{ label: 'Birth date', value: note }, { label: 'Death date', value: note }]);
      const out = exportGedcom([p], []);
      expect(out).toContain(`1 BIRT\n2 DATE ${raw}\n`);
      expect(out).toContain(`1 DEAT\n2 DATE ${raw}\n`);
      expect(out.match(/2 DATE/g)).toHaveLength(2);
      expect(out).not.toContain('FACT');
      const back = parseGedcom(out).people[0];
      expect([back.birthDate, back.deathDate, back.deceased, back.facts]).toEqual([undefined, undefined, true, p.facts]);
    });

    it.each([
      ['ABT 1940', 'about 1940'],
      ['CAL 1940', 'calculated 1940'],
      ['EST 1940', 'estimated 1940'],
    ])('%s keeps the year and the fact, and round-trips as one DATE', (raw, note) => {
      const p = indi(raw, raw);
      expect([p.birthDate, p.deathDate]).toEqual(['1940', '1940']);
      expect(p.facts).toEqual([{ label: 'Birth date', value: note }, { label: 'Death date', value: note }]);
      const out = exportGedcom([p], []);
      expect(out).toContain(`1 BIRT\n2 DATE ${raw}\n`);
      expect(out).toContain(`1 DEAT\n2 DATE ${raw}\n`);
      expect(out.match(/2 DATE/g)).toHaveLength(2);
      expect(out).not.toContain('FACT');
      const back = parseGedcom(out).people[0];
      expect([back.birthDate, back.deathDate, back.facts]).toEqual(['1940', '1940', p.facts]);
    });

    it('a date the user changed is written as typed, with the qualifier kept as a fact', () => {
      const p = emptyPerson({ id: 'x', firstName: 'Kesav', birthDate: '1941-02-03', facts: [{ label: 'Birth date', value: 'about 1940' }] });
      const out = exportGedcom([p], []);
      expect(out).toContain('2 DATE 3 FEB 1941');
      const back = parseGedcom(out).people[0];
      expect(back.birthDate).toBe('1941-02-03');
      expect(back.facts).toEqual([{ label: 'Birth date', value: 'about 1940' }]);
    });
  });

  describe('"This is me"', () => {
    it.each(['full', 'tree'] as const)('round-trips via _LINEAGE_ME in %s mode, with the HEAD SUBM kept', (privacy) => {
      const out = exportGedcom(people, rels, { privacy });
      expect(out.match(/^1 _LINEAGE_ME Y$/gm)).toHaveLength(1);
      expect(out).toMatch(/^1 SUBM @U1@$/m);
      expect(out).toMatch(/^0 @U1@ SUBM$/m);
      const back = parseGedcom(out);
      expect(back.people.filter((p) => p.isMe).map((p) => p.firstName)).toEqual(['Anika']);
      expect(back.people.some((p) => p.facts.some((f) => /lineage/i.test(f.label)))).toBe(false);
    });

    it('keeps only the first of several marked people', () => {
      const r = parseGedcom(['0 @A@ INDI', '1 NAME Anu //', '1 _LINEAGE_ME Y', '0 @B@ INDI', '1 NAME Bala //', '1 _LINEAGE_ME Y'].join('\n'));
      expect(r.people.map((p) => !!p.isMe)).toEqual([true, false]);
    });

    it('resolveImportedMe strips isMe when this device already has a "me"', () => {
      const imported = [emptyPerson({ id: 'a', firstName: 'Anu', isMe: true }), emptyPerson({ id: 'b', firstName: 'Bala' })];
      expect(resolveImportedMe(imported, true).some((p) => 'isMe' in p)).toBe(false);
      expect(resolveImportedMe(imported, false).map((p) => !!p.isMe)).toEqual([true, false]);
      expect(imported[0].isMe).toBe(true); // input not mutated
      const two = [emptyPerson({ id: 'a', isMe: true }), emptyPerson({ id: 'b', isMe: true })];
      expect(resolveImportedMe(two, false).filter((p) => p.isMe)).toHaveLength(1);
    });
  });

  it('splits long notes with CONC and rejoins them', () => {
    const long = 'word '.repeat(120).trim();
    const out = exportGedcom([mk('a', { firstName: 'Long', notes: long })], []);
    expect(out).toContain('CONC');
    expect(parseGedcom(out).people[0].notes).toBe(long);
  });

  it('keeps untyped spouse edges untyped and exports partners/separated via _STAT', () => {
    const p = [mk('a', { firstName: 'Hari', gender: 'male' }), mk('b', { firstName: 'Lata', gender: 'female' }),
      mk('c', { firstName: 'Neel', gender: 'male' }), mk('d', { firstName: 'Ira', gender: 'female' })];
    const out = exportGedcom(p, [rel('1', 'b', 'a', 'spouse'), rel('2', 'c', 'd', 'spouse', 'separated')]);
    expect(out).toMatch(/1 HUSB @I1@\n1 WIFE @I2@\n0 /); // male written as HUSB even when stored second
    const back = parseGedcom(out).relationships;
    expect(back.map((r) => r.subtype ?? null).sort()).toEqual([null, 'separated'].sort());
  });

  it('exports explicit sibling groups without parents as a parentless family', () => {
    const p = [mk('a', { firstName: 'Uma' }), mk('b', { firstName: 'Usha' })];
    const back = parseGedcom(exportGedcom(p, [rel('s', 'a', 'b', 'sibling')]));
    expect(back.relationships).toEqual([expect.objectContaining({ type: 'sibling' })]);
  });
  const sibKey = (r: { fromId: string; toId: string; subtype?: string }, names: Map<string, string>) =>
    `${[names.get(r.fromId), names.get(r.toId)].sort().join('|')}:${r.subtype ?? ''}`;
  const roundTrip = (p: Person[], r: Relationship[]) => {
    const back = parseGedcom(exportGedcom(p, r));
    const names = new Map(back.people.map((x) => [x.id, x.firstName]));
    return { back, names, sibs: back.relationships.filter((x) => x.type === 'sibling').map((x) => sibKey(x, names)).sort() };
  };

  it('keeps a parentless full sibling linked to someone with parents (joins their family)', () => {
    const p = [mk('m', { firstName: 'Meena', gender: 'female' }), mk('a', { firstName: 'Anu' }), mk('b', { firstName: 'Bala' }),
      mk('c', { firstName: 'Chitra' })];
    const out = exportGedcom(p, [rel('1', 'm', 'a', 'parent', 'biological'), rel('2', 'b', 'a', 'sibling'), rel('3', 'c', 'b', 'sibling', 'full')]);
    const { back, names } = roundTrip(p, [rel('1', 'm', 'a', 'parent', 'biological'), rel('2', 'b', 'a', 'sibling'), rel('3', 'c', 'b', 'sibling', 'full')]);
    const parentOf = back.relationships.filter((x) => x.type === 'parent').map((x) => `${names.get(x.fromId)}>${names.get(x.toId)}:${x.subtype ?? ''}`).sort();
    // Bala and Chitra (Bala's parentless full sibling) both become Meena's children with Anu's subtype.
    expect(parentOf).toEqual(['Meena>Anu:biological', 'Meena>Bala:biological', 'Meena>Chitra:biological']);
    expect(out).not.toContain('ASSO');
    expect(back.warnings).toEqual([]);
  });

  it('round-trips half and step sibling edges via ASSO/RELA', () => {
    const p = [mk('m', { firstName: 'Meena', gender: 'female' }), mk('a', { firstName: 'Anu' }), mk('h', { firstName: 'Hema' }),
      mk('s', { firstName: 'Sunil' }), mk('x', { firstName: 'Xavi' }), mk('y', { firstName: 'Yamini' }), mk('d', { firstName: 'Dinesh', gender: 'male' })];
    const r = [rel('1', 'm', 'a', 'parent'), rel('2', 'a', 'h', 'sibling', 'half'), rel('3', 's', 'a', 'sibling', 'step'),
      // both have parents but no shared parent: plain sibling edge must survive too
      rel('4', 'd', 'x', 'parent'), rel('5', 'x', 'a', 'sibling'),
      // adoptive sibling of a child with parents
      rel('6', 'y', 'a', 'sibling', 'adoptive')];
    const out = exportGedcom(p, r);
    expect(out).toMatch(/1 ASSO @I\d+@\n2 RELA half-sibling/);
    expect(out).toMatch(/1 ASSO @I\d+@\n2 RELA step-sibling/);
    const { sibs } = roundTrip(p, r);
    expect(sibs).toEqual(['Anu|Hema:half', 'Anu|Sunil:step', 'Anu|Xavi:', 'Anu|Yamini:adoptive'].sort());
  });

  it('imports ASSO sibling associations from other tools and ignores non-sibling ones', () => {
    const r = parseGedcom(['0 @A@ INDI', '1 NAME Anu //', '1 ASSO @B@', '2 RELA Half Brother', '1 ASSO @C@', '2 RELA Sister',
      '1 ASSO @D@', '2 RELA Godfather', '1 ASSO @B@', '2 RELA Brother-in-law', '0 @B@ INDI', '1 NAME Bala //', '1 ASSO @A@', '2 RELA half-sibling',
      '0 @C@ INDI', '1 NAME Chitra //', '0 @D@ INDI', '1 NAME Dinesh //'].join('\n'));
    const names = new Map(r.people.map((x) => [x.id, x.firstName]));
    expect(r.relationships.map((x) => `${x.type}:${sibKey(x, names)}`).sort()).toEqual(['sibling:Anu|Bala:half', 'sibling:Anu|Chitra:']);
    expect(relaToSibling('Step-sister')).toEqual({ subtype: 'step' });
    expect(relaToSibling('full sibling')).toEqual({ subtype: 'full' });
    expect(relaToSibling('Adopted brother')).toEqual({ subtype: 'adoptive' });
    expect(relaToSibling('godsister')).toBeNull();
  });

  describe("privacy: 'tree'", () => {
    const secretPeople: Person[] = [
      mk('g', { firstName: 'Govind', lastName: 'Vermalu', gender: 'male', deceased: true, birthDate: '1920', deathDate: '1990',
        origin: { area: 'Ward 4', city: 'Kothapalle', state: 'Telangana', country: 'India' },
        facts: [{ label: 'Place of death', value: 'Kothapalle' }, { label: 'Cause of death', value: 'Secret illness' }],
        notes: 'Grandpa kept the ledger hidden' }),
      mk('l', { firstName: 'Lakshmi', lastName: 'Vermalu', gender: 'female', birthDate: '1960-02-03', occupation: 'Teacher',
        education: [{ institution: 'Imaginary Arts College', course: 'B.Ed' }],
        phones: [{ label: 'mobile', value: '+1 202-555-0177' }], emails: [{ label: 'home', value: 'lakshmi.secret@example.com' }],
        address: { line: '42 Imaginary Lane', area: 'Fictional Colony', city: 'Pune', state: 'Maharashtra', country: 'India' },
        origin: { area: 'Old Quarter', city: 'Nashik', country: 'India' },
        howWeMet: 'Met at the hidden cafe', metOn: '2001-07-07', appearance: 'Tall, birthmark on cheek',
        facts: [{ label: 'Blood group', value: 'Rare-Z' }], notes: 'Private note about Lakshmi' }),
    ];
    const r = [rel('1', 'g', 'l', 'parent'), rel('2', 'l', 'g', 'sibling', 'step')];
    const out = exportGedcom(secretPeople, r, { privacy: 'tree' });

    it('leaves out contact details, street lines, notes, how-we-met and facts', () => {
      for (const secret of ['202-555-0177', 'lakshmi.secret', 'example.com', '42 Imaginary Lane', 'Private note', 'Grandpa kept',
        'hidden cafe', '2001', 'birthmark', 'Rare-Z', 'Blood group', 'Secret illness', 'PHON', 'EMAIL', 'NOTE', 'ADDR', 'DSCR']) {
        expect(out).not.toContain(secret);
      }
    });

    it('keeps names, dates, town-level places, occupation, education and structure', () => {
      const back = parseGedcom(out);
      const [g, l] = back.people;
      expect(l).toMatchObject({ firstName: 'Lakshmi', lastName: 'Vermalu', gender: 'female', birthDate: '1960-02-03', occupation: 'Teacher',
        education: [{ institution: 'Imaginary Arts College', course: 'B.Ed' }] });
      // Living: city level, no locality.
      expect(l.address).toEqual({ city: 'Pune', state: 'Maharashtra', country: 'India' });
      expect(l.origin).toEqual({ city: 'Nashik', country: 'India' });
      // Deceased: locality kept, place of death kept.
      expect(g.origin).toEqual({ area: 'Ward 4', city: 'Kothapalle', state: 'Telangana', country: 'India' });
      expect(g.facts).toEqual([{ label: 'Place of death', value: 'Kothapalle' }]);
      expect(back.relationships.map((x) => `${x.type}:${x.subtype ?? ''}`).sort()).toEqual(['parent:', 'sibling:step']);
    });

    it("'full' (the default) still includes everything", () => {
      const full = exportGedcom(secretPeople, r, { privacy: 'full' });
      for (const s of ['202-555-0177', 'lakshmi.secret@@example.com', '42 Imaginary Lane', 'Private note', 'hidden cafe', 'Rare-Z']) expect(full).toContain(s);
    });
  });
});
