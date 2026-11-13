/**
 * GEDCOM 5.5.1 import and export. Everything runs on the device.
 *
 * Import maps INDI/FAM records onto Person + parent/spouse/sibling edges, with fresh ids.
 * Export writes a lineage-linked GEDCOM 5.5.1 file. Families (FAM) are rebuilt by grouping each
 * child's parent edges into parent pairs.
 */
import { FamilyGraph } from './kinship';
import { emptyPerson, newId, parsePartialDate } from './person';
import type { Fact, Gender, ParentSubtype, Person, Place, Relationship, SpouseSubtype } from './types';

export type ParsedRelationship = Omit<Relationship, 'createdAt'>;

export interface GedcomImport {
  people: Person[];
  relationships: ParsedRelationship[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Line structure

interface Node {
  level: number;
  xref?: string;
  tag: string;
  value: string;
  children: Node[];
}

const LINE_RE = /^\s*(\d{1,2})[ \t]+(?:(@[^@\s]+@)[ \t]+)?([A-Za-z0-9_]+)(?:[ \t](.*))?$/;

/** Parse lines into a record tree, folding CONT/CONC into the parent's value. */
function parseTree(text: string, warn: (w: string) => void): Node[] {
  const roots: Node[] = [];
  const stack: Node[] = [];
  let bad = 0;
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const m = raw.match(LINE_RE);
    if (!m) {
      bad++;
      continue;
    }
    const level = +m[1];
    const tag = m[3].toUpperCase();
    const value = m[4] ?? '';
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    if (tag === 'CONT' || tag === 'CONC') {
      if (parent) parent.value += (tag === 'CONT' ? '\n' : '') + value;
      continue;
    }
    if (level > 0 && !parent) {
      bad++;
      continue;
    }
    const node: Node = { level, xref: m[2], tag, value, children: [] };
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  if (bad) warn(`Skipped ${bad} line${bad === 1 ? '' : 's'} that were not valid GEDCOM.`);
  return roots;
}

const child = (n: Node | undefined, tag: string) => n?.children.find((c) => c.tag === tag);
const children = (n: Node | undefined, tag: string) => n?.children.filter((c) => c.tag === tag) ?? [];
/** Text value of a node: trimmed, with GEDCOM's escaped "@@" turned back into "@". */
const text = (n: Node | undefined) => (n?.value ?? '').replace(/@@/g, '@').trim();
const sub = (n: Node | undefined, tag: string) => text(child(n, tag));
const isPointer = (v: string) => /^@[^@\s]+@$/.test(v.trim());

// ---------------------------------------------------------------------------
// Dates

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_ALIASES: Record<string, number> = { SEPT: 9 };
function monthIndex(s: string): number | undefined {
  const u = s.toUpperCase().replace(/\.$/, '');
  if (MONTH_ALIASES[u]) return MONTH_ALIASES[u];
  const i = MONTHS.indexOf(u.slice(0, 3));
  // Accept "MAR" and full English names ("March"), but not random words starting with a month.
  if (i < 0) return undefined;
  const full = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'][i];
  return u.length === 3 || u === full ? i + 1 : undefined;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Parse one exact GEDCOM date ("12 MAR 1958", "MAR 1958", "1958", "1720/21") to YYYY[-MM[-DD]]. */
function parseExact(s: string): string | undefined {
  const t = s.trim().replace(/^@#DGREGORIAN@\s*/i, '');
  let m = t.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/); // ISO, written by some tools
  if (m) return m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
  m = t.match(/^(?:(\d{1,2})\s+)?([A-Za-z]+\.?)\s+(\d{3,4})(?:\/\d{2})?$/);
  if (m) {
    const mon = monthIndex(m[2]);
    if (!mon) return undefined;
    const y = pad(+m[3], 4);
    if (!m[1]) return `${y}-${pad(mon)}`;
    const d = +m[1];
    if (d < 1 || d > 31) return undefined;
    return `${y}-${pad(mon)}-${pad(d)}`;
  }
  m = t.match(/^(\d{3,4})(?:\/\d{2})?$/);
  if (m) return pad(+m[1], 4);
  return undefined;
}

const QUALIFIERS: Record<string, string> = {
  ABT: 'about', CAL: 'calculated', EST: 'estimated', BEF: 'before', AFT: 'after', INT: 'interpreted as',
};

/** Human form of a GEDCOM date for facts: month names in title case. */
function humanDate(s: string): string {
  return s.trim().replace(/\b([A-Z]{3})\b/g, (w) => (MONTHS.includes(w) ? w[0] + w.slice(1).toLowerCase() : w));
}

export interface ParsedDate {
  /** YYYY, YYYY-MM or YYYY-MM-DD, when something usable was found. */
  date?: string;
  /** Human description of a qualified or unparseable date, to keep as a fact. */
  note?: string;
}

/** Parse a GEDCOM DATE value. Qualified dates give the year plus a note; unparseable ones only a note. */
export function parseGedcomDate(raw: string): ParsedDate {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return {};
  const exact = parseExact(s);
  if (exact) return { date: exact };
  const year = (d: string | undefined) => d?.slice(0, 4);
  let m = s.match(/^(ABT|CAL|EST|BEF|AFT|INT)\.? (.+?)(?: \((.*)\))?$/i);
  if (m) {
    const d = parseExact(m[2]);
    if (d) {
      const q = QUALIFIERS[m[1].toUpperCase()];
      return { date: year(d), note: `${q} ${humanDate(m[2])}${m[3] ? ` (${m[3]})` : ''}` };
    }
  }
  m = s.match(/^BET (.+) AND (.+)$/i);
  if (m) {
    const a = parseExact(m[1]);
    const b = parseExact(m[2]);
    if (a && b) return { date: year(a), note: `between ${humanDate(m[1])} and ${humanDate(m[2])}` };
  }
  m = s.match(/^FROM (.+?)(?: TO (.+))?$/i);
  if (m) {
    const a = parseExact(m[1]);
    const b = m[2] ? parseExact(m[2]) : undefined;
    if (a && (!m[2] || b)) return { date: year(a), note: `from ${humanDate(m[1])}${m[2] ? ` to ${humanDate(m[2])}` : ''}` };
  }
  m = s.match(/^TO (.+)$/i);
  if (m) {
    const a = parseExact(m[1]);
    if (a) return { date: year(a), note: `to ${humanDate(m[1])}` };
  }
  m = s.match(/^\((.*)\)$/); // date phrase
  return { note: m ? m[1].trim() : s };
}

/** YYYY[-MM[-DD]] → GEDCOM date. */
export function formatGedcomDate(iso: string): string | undefined {
  const { y, m, d } = parsePartialDate(iso);
  if (!y) return undefined;
  if (m && (m < 1 || m > 12)) return String(y);
  if (m && d) return `${d} ${MONTHS[m - 1]} ${y}`;
  if (m) return `${MONTHS[m - 1]} ${y}`;
  return String(y);
}

/** Turn a stored date note ("about 1900", "between 1890 and 1900") back into a GEDCOM date. */
function noteToGedcomDate(note: string): string {
  const up = (x: string) => x.trim().toUpperCase();
  const valid = (x: string) => parseExact(x) !== undefined;
  for (const [k, q] of Object.entries(QUALIFIERS)) {
    if (note.toLowerCase().startsWith(q + ' ')) {
      const rest = note.slice(q.length + 1);
      const m = rest.match(/^(.+?)(?: \((.*)\))?$/)!;
      if (valid(m[1])) return `${k} ${up(m[1])}${m[2] ? ` (${m[2]})` : ''}`;
    }
  }
  let m = note.match(/^between (.+) and (.+)$/i);
  if (m && valid(m[1]) && valid(m[2])) return `BET ${up(m[1])} AND ${up(m[2])}`;
  m = note.match(/^from (.+?)(?: to (.+))?$/i);
  if (m && valid(m[1]) && (!m[2] || valid(m[2]))) return `FROM ${up(m[1])}${m[2] ? ` TO ${up(m[2])}` : ''}`;
  m = note.match(/^to (.+)$/i);
  if (m && valid(m[1])) return `TO ${up(m[1])}`;
  if (valid(note)) return up(note);
  return `(${note.replace(/[()]/g, '')})`;
}

// ---------------------------------------------------------------------------
// Places

const COUNTRIES = new Set(
  [
    'india', 'bharat', 'pakistan', 'bangladesh', 'nepal', 'sri lanka', 'bhutan', 'myanmar', 'burma', 'china',
    'usa', 'u.s.a.', 'us', 'united states', 'united states of america', 'america', 'canada', 'mexico',
    'uk', 'u.k.', 'united kingdom', 'england', 'scotland', 'wales', 'ireland', 'northern ireland', 'great britain',
    'australia', 'new zealand', 'singapore', 'malaysia', 'indonesia', 'philippines', 'japan', 'south korea',
    'uae', 'united arab emirates', 'saudi arabia', 'qatar', 'oman', 'kuwait', 'bahrain', 'iran', 'israel',
    'germany', 'france', 'italy', 'spain', 'portugal', 'netherlands', 'belgium', 'switzerland', 'austria',
    'sweden', 'norway', 'denmark', 'finland', 'poland', 'russia', 'ukraine', 'greece', 'turkey',
    'south africa', 'kenya', 'tanzania', 'uganda', 'nigeria', 'egypt', 'mauritius', 'fiji',
    'brazil', 'argentina', 'chile', 'colombia', 'peru', 'trinidad and tobago', 'guyana', 'suriname', 'jamaica',
  ],
);
const isCountry = (s: string) => COUNTRIES.has(s.trim().toLowerCase());

/**
 * Split a GEDCOM place ("Village, District, State, Country") from the right. Components are
 * positional (empty jurisdictions like ", , Ohio, USA" are allowed). With fewer than four parts the
 * last one is only treated as a country when it is a known country name.
 */
export function splitPlace(raw: string): Place | undefined {
  const parts = raw.split(',').map((x) => x.trim());
  if (!parts.some(Boolean)) return undefined;
  const n = parts.length;
  const pl: Place = {};
  const set = (k: keyof Place, v: string | undefined) => {
    if (v) pl[k] = v;
  };
  if (n >= 4) {
    set('country', parts[n - 1]);
    set('state', parts[n - 2]);
    set('district', parts[n - 3]);
    set('city', parts[n - 4]);
    set('area', parts.slice(0, n - 4).filter(Boolean).join(', '));
  } else if (n === 3) {
    if (isCountry(parts[2])) {
      set('city', parts[0]);
      set('state', parts[1]);
      set('country', parts[2]);
    } else {
      set('city', parts[0]);
      set('district', parts[1]);
      set('state', parts[2]);
    }
  } else if (n === 2) {
    set('city', parts[0]);
    set(isCountry(parts[1]) ? 'country' : 'state', parts[1]);
  } else {
    set(isCountry(parts[0]) ? 'country' : 'city', parts[0]);
  }
  return Object.keys(pl).length ? pl : undefined;
}

/** Inverse of splitPlace: positional so it re-imports into the same fields. */
export function joinPlace(pl?: Place): string {
  if (!pl) return '';
  const c = (x?: string) => (x ?? '').replace(/,/g, ' ').trim();
  const area = c(pl.area);
  let parts: string[];
  if (area) parts = [area, c(pl.city), c(pl.district), c(pl.state), c(pl.country)];
  else if (pl.country) parts = [c(pl.city), c(pl.district), c(pl.state), c(pl.country)];
  else if (pl.state) parts = [c(pl.city), c(pl.district), c(pl.state)];
  else if (pl.district) parts = [c(pl.city), c(pl.district), ''];
  else parts = [c(pl.city)];
  if (!parts.some(Boolean)) return '';
  return parts.join(', ');
}

/** Fill gaps in `pl` from a GEDCOM ADDR structure. */
function addrToPlace(addr: Node | undefined, pl: Place = {}): Place {
  if (!addr) return pl;
  const line = [text(addr).split('\n')[0], sub(addr, 'ADR1'), sub(addr, 'ADR2')].filter(Boolean);
  const fill = (k: keyof Place, v: string) => {
    if (v && !pl[k]) pl[k] = v;
  };
  fill('city', sub(addr, 'CITY'));
  fill('state', sub(addr, 'STAE'));
  fill('country', sub(addr, 'CTRY'));
  // Only use the free-text line when it adds something beyond city/state/country.
  const known = new Set([pl.city, pl.state, pl.country].filter(Boolean).map((x) => x!.toLowerCase()));
  const extra = [...new Set(line)].filter((x) => !known.has(x.toLowerCase()));
  fill('line', extra.join(', '));
  return pl;
}

// ---------------------------------------------------------------------------
// Facts

/** INDI tags kept as facts. Events get "value, date, place" as the fact value. */
const FACT_TAGS: Record<string, string> = {
  RELI: 'Religion', NATI: 'Nationality', TITL: 'Title', CAST: 'Caste', _GOTRA: 'Gotra', NCHI: 'Number of children',
  NMR: 'Number of marriages', PROP: 'Property', IDNO: 'ID number', NPFX: 'Name prefix', NSFX: 'Name suffix',
  BAPM: 'Baptism', CHR: 'Christening', CHRA: 'Adult christening', BURI: 'Burial', CREM: 'Cremation', ADOP: 'Adoption',
  BARM: 'Bar mitzvah', BASM: 'Bat mitzvah', BLES: 'Blessing', CONF: 'Confirmation', FCOM: 'First communion',
  ORDN: 'Ordination', NATU: 'Naturalisation', EMIG: 'Emigration', IMMI: 'Immigration', CENS: 'Census',
  PROB: 'Probate', WILL: 'Will', GRAD: 'Graduation', RETI: 'Retirement', _MILT: 'Military service',
  _MILI: 'Military service', _MDCL: 'Medical', _HEIG: 'Height', _WEIG: 'Weight', _DCAUSE: 'Cause of death',
  _NAMS: 'Namesake', _ELEC: 'Elected', _EMPLOY: 'Employment', _DEG: 'Degree', _CAST: 'Caste', _KULDEVTA: 'Kuldevta',
};
const LABEL_TO_TAG: Record<string, string> = {};
for (const [tag, label] of Object.entries(FACT_TAGS)) if (!LABEL_TO_TAG[label.toLowerCase()]) LABEL_TO_TAG[label.toLowerCase()] = tag;
// Event tags are written back as plain FACTs: their value carries date/place text that would not re-parse cleanly.
const ATTRIBUTE_TAGS = new Set(['RELI', 'NATI', 'TITL', 'CAST', '_GOTRA', 'NCHI', 'NMR', 'PROP']);

/** Underscore tags that are app bookkeeping, never facts. */
const IGNORED_CUSTOM = new Set([
  '_UID', '_UPD', '_PRIM', '_TYPE', '_FREL', '_MREL', '_PHOTO', '_FSFTID', '_APID', '_LINK', '_CREAT', '_CRE',
  '_DATE', '_MTTAG', '_PRIV', '_PRIVATE', '_FLGS', '_TODO', '_AKA', '_MARNM', '_RNAME', '_SCBK', '_PPEXCLUDE', '_WEBTAG',
]);

function eventValue(n: Node): string {
  const v = text(n);
  const parts = [v && v !== 'Y' ? v : '', sub(n, 'TYPE') && n.tag !== 'EVEN' && n.tag !== 'FACT' ? sub(n, 'TYPE') : ''];
  const d = sub(n, 'DATE');
  if (d) parts.push(humanDate(d));
  const pl = sub(n, 'PLAC');
  if (pl) parts.push(pl);
  return parts.filter(Boolean).join(', ');
}

function titleCase(tag: string) {
  const w = tag.replace(/^_+/, '').replace(/_/g, ' ').toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

// ---------------------------------------------------------------------------
// Relationship subtypes

function pediToSubtype(v: string): ParentSubtype | undefined {
  const s = v.trim().toLowerCase();
  if (['birth', 'natural', 'biological', 'bio'].includes(s)) return 'biological';
  if (s.startsWith('adopt')) return 'adoptive';
  if (s.startsWith('foster')) return 'foster';
  if (s.startsWith('step')) return 'step';
  return undefined;
}

function statToSubtype(v: string): SpouseSubtype | undefined {
  const s = v.trim().toLowerCase();
  if (!s) return undefined;
  if (s.startsWith('divorc')) return 'divorced';
  if (s.startsWith('separat')) return 'separated';
  if (s.startsWith('widow')) return 'widowed';
  if (s.includes('partner') || s.includes('never married') || s.includes('unmarried') || s.includes('friend')) return 'partner';
  if (s.startsWith('married') || s === 'spouse') return 'married';
  return undefined;
}

// ---------------------------------------------------------------------------
// Import

const UNKNOWN_NAMES = new Set(['', '?', '??', '???', '_', '__', '___', '____', '_____', 'nn', 'n.n.', 'n n', 'unknown', 'unk']);
const known = (s?: string) => (s && !UNKNOWN_NAMES.has(s.trim().toLowerCase()) ? s.trim() : undefined);

function applyName(p: Person, node: Node) {
  const raw = text(node);
  const m = raw.match(/^([^/]*)(?:\/([^/]*)\/?)?(.*)$/)!;
  const given = sub(node, 'GIVN') || m[1].trim();
  const surname = sub(node, 'SURN') || (m[2] ?? '').trim();
  const words = (known(given) ?? '').split(/\s+/).filter(Boolean);
  p.firstName = words[0] ?? 'Unknown';
  if (words.length > 1) p.middleName = words.slice(1).join(' ');
  if (known(surname)) p.lastName = known(surname);
  const nick = sub(node, 'NICK');
  if (nick) p.nickname = nick;
  const suffix = sub(node, 'NSFX') || m[3].trim();
  if (suffix) p.facts.push({ label: 'Name suffix', value: suffix });
  const prefix = sub(node, 'NPFX');
  if (prefix) p.facts.push({ label: 'Name prefix', value: prefix });
}

/** Another name for the person (maiden, married, alias, other script) as "Name (type)". */
function otherName(node: Node): string | undefined {
  const raw = text(node).replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
  const name = raw || [sub(node, 'GIVN'), sub(node, 'SURN')].filter(Boolean).join(' ');
  if (!known(name)) return undefined;
  const type = sub(node, 'TYPE').toLowerCase();
  return type && type !== 'aka' && type !== 'also known as' ? `${name} (${type})` : name;
}

function addFact(p: Person, f: Fact) {
  if (!f.value) return;
  if (!p.facts.some((x) => x.label === f.label && x.value === f.value)) p.facts.push(f);
}

function setDate(p: Person, field: 'birthDate' | 'deathDate', raw: string) {
  if (!raw) return;
  const { date, note } = parseGedcomDate(raw);
  if (date && !p[field]) p[field] = date;
  if (note) addFact(p, { label: field === 'birthDate' ? 'Birth date' : 'Death date', value: note });
}

function yearRange(raw: string): { from?: string; to?: string } {
  const years = [...raw.matchAll(/\b(\d{4})\b/g)].map((m) => m[1]);
  if (!years.length) return {};
  if (/^\s*FROM\b/i.test(raw) || /^\s*BET\b/i.test(raw)) return { from: years[0], to: years[1] };
  if (/^\s*TO\b/i.test(raw)) return { to: years[0] };
  return { to: years[0] };
}

interface IndiInfo {
  person: Person;
  /** famXref → subtype from FAMC PEDI */
  pedi: Map<string, ParentSubtype>;
  /** famXref → which parents adopted (ADOP FAMC ADOP HUSB|WIFE|BOTH) */
  adop: Map<string, 'HUSB' | 'WIFE' | 'BOTH'>;
  famc: string[];
  fams: string[];
}

function readIndi(node: Node, notes: Map<string, string>, warn: (w: string) => void): IndiInfo {
  const p = emptyPerson({ source: 'manual' });
  const info: IndiInfo = { person: p, pedi: new Map(), adop: new Map(), famc: [], fams: [] };
  const noteTexts: string[] = [];
  const others: string[] = [];
  const occupations: string[] = [];
  let named = false;

  const readContact = (n: Node) => {
    for (const ph of children(n, 'PHON')) if (text(ph) && !p.phones.some((x) => x.value === text(ph))) p.phones.push({ label: 'mobile', value: text(ph) });
    for (const em of [...children(n, 'EMAIL'), ...children(n, '_EMAIL')]) {
      if (text(em) && !p.emails.some((x) => x.value === text(em))) p.emails.push({ label: 'home', value: text(em) });
    }
  };
  const readNote = (n: Node) => {
    const v = text(n);
    if (isPointer(v)) {
      const t = notes.get(v);
      if (t === undefined) warn(`A note (${v}) was referenced but not found.`);
      else if (t) noteTexts.push(t);
    } else if (v) noteTexts.push(v);
  };

  readContact(node);
  for (const c of node.children) {
    switch (c.tag) {
      case 'NAME':
        if (!named) {
          applyName(p, c);
          named = true;
        } else {
          const o = otherName(c);
          if (o) others.push(o);
        }
        for (const v of [...children(c, 'ROMN'), ...children(c, 'FONE'), ...children(c, '_MARNM'), ...children(c, '_AKA')]) {
          const o = otherName(v);
          if (o) others.push(o);
        }
        break;
      case 'SEX': {
        const s = text(c).toUpperCase();
        p.gender = (s === 'M' ? 'male' : s === 'F' ? 'female' : s === 'X' ? 'other' : 'unknown') as Gender;
        break;
      }
      case 'BIRT': {
        setDate(p, 'birthDate', sub(c, 'DATE'));
        const pl = sub(c, 'PLAC');
        if (pl && !p.origin) p.origin = splitPlace(pl);
        break;
      }
      case 'DEAT': {
        p.deceased = true;
        setDate(p, 'deathDate', sub(c, 'DATE'));
        addFact(p, { label: 'Place of death', value: sub(c, 'PLAC') });
        addFact(p, { label: 'Cause of death', value: sub(c, 'CAUS') });
        break;
      }
      case 'OCCU': {
        const role = text(c);
        const org = sub(c, 'AGNC') || sub(c, 'CORP');
        if (org) {
          const { from, to } = yearRange(sub(c, 'DATE'));
          p.work.push({ organization: org, ...(role ? { role } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) });
        } else if (role) occupations.push(role);
        break;
      }
      case 'EDUC': {
        const course = text(c);
        const inst = sub(c, 'AGNC') || sub(c, 'CORP') || sub(c, 'PLAC') || course;
        if (!inst) break;
        const { from, to } = yearRange(sub(c, 'DATE'));
        p.education.push({
          institution: inst,
          ...(course && course !== inst ? { course } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        });
        break;
      }
      case 'DSCR':
        if (text(c)) p.appearance = p.appearance ? `${p.appearance}\n${text(c)}` : text(c);
        break;
      case 'NOTE':
        readNote(c);
        break;
      case 'RESI': {
        const pl = sub(c, 'PLAC');
        const place = addrToPlace(child(c, 'ADDR'), (pl && splitPlace(pl)) || {});
        // A later RESI is usually more recent; keep the last one that has a place.
        if (Object.keys(place).length) p.address = place;
        readContact(c);
        const addr = child(c, 'ADDR');
        if (addr) readContact(addr);
        break;
      }
      case 'ADDR': {
        const place = addrToPlace(c, p.address ?? {});
        if (Object.keys(place).length) p.address = place;
        readContact(c);
        break;
      }
      case 'FAMC': {
        const f = text(c);
        if (!isPointer(f)) break;
        info.famc.push(f);
        const pedi = pediToSubtype(sub(c, 'PEDI'));
        if (pedi) info.pedi.set(f, pedi);
        break;
      }
      case 'FAMS':
        if (isPointer(text(c))) info.fams.push(text(c));
        break;
      case 'FACT':
      case 'EVEN': {
        const label = sub(c, 'TYPE') || (c.tag === 'FACT' ? 'Fact' : 'Event');
        const value = eventValue(c);
        if (label.toLowerCase() === 'how we met' && value && !p.howWeMet) p.howWeMet = value;
        else if (label.toLowerCase() === 'met on' && value && !p.metOn) p.metOn = value;
        else if (label === 'Birth date' && !p.birthDate) setDate(p, 'birthDate', noteToGedcomDate(value));
        else if (label === 'Death date' && !p.deathDate) setDate(p, 'deathDate', noteToGedcomDate(value));
        else addFact(p, { label, value });
        break;
      }
      default: {
        if (c.tag === 'ADOP') {
          const fc = child(c, 'FAMC');
          if (fc && isPointer(text(fc))) {
            const who = sub(fc, 'ADOP').toUpperCase();
            info.adop.set(text(fc), who === 'HUSB' || who === 'WIFE' ? who : 'BOTH');
          }
        }
        const label = FACT_TAGS[c.tag];
        if (label) addFact(p, { label, value: eventValue(c) || 'Yes' });
        else if (c.tag.startsWith('_') && !IGNORED_CUSTOM.has(c.tag) && text(c) && !isPointer(text(c))) {
          addFact(p, { label: titleCase(c.tag), value: eventValue(c) });
        }
      }
    }
  }
  if (!named) p.firstName = 'Unknown';
  if (occupations.length) p.occupation = occupations.join('; ');
  if (others.length) p.otherNames = [...new Set(others)].join(', ');
  if (noteTexts.length) p.notes = noteTexts.join('\n\n');
  return info;
}

/** Parse a GEDCOM 5.5/5.5.1 file into new people and family edges (fresh ids, nothing merged). */
export function parseGedcom(input: string): GedcomImport {
  const warnings: string[] = [];
  const warn = (w: string) => {
    if (!warnings.includes(w)) warnings.push(w);
  };
  const roots = parseTree(input, warn);

  const head = roots.find((r) => r.tag === 'HEAD');
  const charset = sub(head, 'CHAR').toUpperCase();
  if (charset === 'ANSEL') warn('This file uses the old ANSEL character set. It was read as UTF-8, so some accented letters may look wrong.');
  else if (charset === 'UNICODE' && /\u0000/.test(input)) warn('This file is UTF-16 and could not be read correctly.');
  if (!head && roots.length) warn('The file has no GEDCOM header; reading it anyway.');

  const notes = new Map<string, string>();
  for (const r of roots) if (r.tag === 'NOTE' && r.xref) notes.set(r.xref, text(r));

  const indis = new Map<string, IndiInfo>();
  const people: Person[] = [];
  for (const r of roots) {
    if (r.tag !== 'INDI') continue;
    const info = readIndi(r, notes, warn);
    people.push(info.person);
    if (r.xref) {
      if (indis.has(r.xref)) warn(`Two people share the id ${r.xref}; links go to the first one.`);
      else indis.set(r.xref, info);
    }
  }
  if (!people.length) warn('No people were found in this file.');

  const rels: ParsedRelationship[] = [];
  const parentKey = new Map<string, ParsedRelationship>();
  const spouseKey = new Set<string>();
  const siblingKey = new Set<string>();
  let missing = 0;

  const idOf = (xref: string): string | undefined => {
    const i = indis.get(xref);
    if (!i) missing++;
    return i?.person.id;
  };
  const addParent = (from: string, to: string, subtype?: ParentSubtype) => {
    if (from === to) return;
    const k = `${from}>${to}`;
    const existing = parentKey.get(k);
    if (existing) {
      if (!existing.subtype && subtype) existing.subtype = subtype;
      return;
    }
    const r: ParsedRelationship = { id: newId(), fromId: from, toId: to, type: 'parent', ...(subtype ? { subtype } : {}) };
    parentKey.set(k, r);
    rels.push(r);
  };
  const addSpouse = (a: string, b: string, subtype?: SpouseSubtype, note?: string) => {
    if (a === b) return;
    const k = [a, b].sort().join('|');
    if (spouseKey.has(k)) return;
    spouseKey.add(k);
    rels.push({ id: newId(), fromId: a, toId: b, type: 'spouse', ...(subtype ? { subtype } : {}), ...(note ? { note } : {}) });
  };
  const addSibling = (a: string, b: string) => {
    if (a === b) return;
    const k = [a, b].sort().join('|');
    if (siblingKey.has(k)) return;
    siblingKey.add(k);
    rels.push({ id: newId(), fromId: a, toId: b, type: 'sibling' });
  };

  const fams = new Map<string, Node>();
  for (const r of roots) if (r.tag === 'FAM' && r.xref) fams.set(r.xref, r);

  // Members per family: FAM record plus back-links from INDI FAMC/FAMS (many files only have one side).
  const famMembers = new Map<string, { husb?: string; wife?: string; chil: { xref: string; node?: Node }[] }>();
  const membersOf = (f: string) => {
    let m = famMembers.get(f);
    if (!m) famMembers.set(f, (m = { chil: [] }));
    return m;
  };
  for (const [fx, fam] of fams) {
    const m = membersOf(fx);
    const h = sub(fam, 'HUSB');
    const w = sub(fam, 'WIFE');
    if (isPointer(h)) m.husb = h;
    if (isPointer(w)) m.wife = w;
    for (const c of children(fam, 'CHIL')) if (isPointer(text(c))) m.chil.push({ xref: text(c), node: c });
  }
  for (const [ix, info] of indis) {
    for (const f of info.famc) {
      if (!fams.has(f)) continue;
      const m = membersOf(f);
      if (!m.chil.some((c) => c.xref === ix)) m.chil.push({ xref: ix });
    }
    for (const f of info.fams) {
      if (!fams.has(f)) continue;
      const m = membersOf(f);
      if (m.husb === ix || m.wife === ix) continue;
      const g = info.person.gender;
      if (g === 'male' && !m.husb) m.husb = ix;
      else if (g === 'female' && !m.wife) m.wife = ix;
      else if (!m.husb) m.husb = ix;
      else if (!m.wife) m.wife = ix;
    }
  }
  const dangling = [...indis.values()].flatMap((i) => [...i.famc, ...i.fams]).filter((f) => !fams.has(f)).length;

  for (const [fx, m] of famMembers) {
    const fam = fams.get(fx)!;
    const h = m.husb ? idOf(m.husb) : undefined;
    const w = m.wife ? idOf(m.wife) : undefined;
    if (h && w) {
      let st: SpouseSubtype | undefined;
      if (child(fam, 'DIV')) st = 'divorced';
      else st = statToSubtype(sub(fam, '_STAT') || sub(fam, '_STATUS')) ?? (child(fam, 'MARR') ? 'married' : undefined);
      const marr = child(fam, 'MARR');
      const famNotes: string[] = [];
      for (const n of children(fam, 'NOTE')) {
        const v = text(n);
        const t = isPointer(v) ? notes.get(v) : v;
        if (t) famNotes.push(t);
      }
      const when = [sub(marr, 'DATE') && humanDate(sub(marr, 'DATE')), sub(marr, 'PLAC')].filter(Boolean).join(', ');
      if (when) famNotes.unshift(`Married ${when}`);
      addSpouse(h, w, st, famNotes.join('\n') || undefined);
    }
    const kidIds: string[] = [];
    for (const c of m.chil) {
      const kid = idOf(c.xref);
      if (!kid) continue;
      kidIds.push(kid);
      const info = indis.get(c.xref)!;
      const base = info.pedi.get(fx);
      const adop = info.adop.get(fx);
      const forParent = (role: 'HUSB' | 'WIFE'): ParentSubtype | undefined => {
        const rel = c.node && sub(c.node, role === 'HUSB' ? '_FREL' : '_MREL');
        const fromRel = rel ? pediToSubtype(rel) : undefined;
        if (fromRel) return fromRel;
        if (adop && (adop === 'BOTH' || adop === role)) return 'adoptive';
        return base;
      };
      if (h) addParent(h, kid, forParent('HUSB'));
      if (w) addParent(w, kid, forParent('WIFE'));
    }
    // Children of a family with no recorded parents are still siblings of each other.
    if (!h && !w) for (let i = 1; i < kidIds.length; i++) addSibling(kidIds[0], kidIds[i]);
  }
  if (missing) warn(`${missing} family link${missing === 1 ? '' : 's'} pointed to people not in the file and were skipped.`);
  if (dangling) warn(`${dangling} link${dangling === 1 ? '' : 's'} pointed to families not in the file and were skipped.`);

  // Drop parent edges that would make someone their own ancestor.
  const cyc = dropCycles(rels);
  if (cyc) warn(`Skipped ${cyc} parent link${cyc === 1 ? '' : 's'} that would make someone their own ancestor.`);

  return { people, relationships: rels.filter((r) => !(r as { _drop?: boolean })._drop).map(strip), warnings };
}

function strip(r: ParsedRelationship): ParsedRelationship {
  const { _drop, ...rest } = r as ParsedRelationship & { _drop?: boolean };
  void _drop;
  return rest;
}

/** Mark parent edges that close a cycle (iterative DFS colouring). Returns how many were marked. */
function dropCycles(rels: ParsedRelationship[]): number {
  const out = new Map<string, ParsedRelationship[]>();
  for (const r of rels) if (r.type === 'parent') (out.get(r.fromId) ?? out.set(r.fromId, []).get(r.fromId)!).push(r);
  const state = new Map<string, 1 | 2>();
  let dropped = 0;
  for (const start of out.keys()) {
    if (state.has(start)) continue;
    const stack: { id: string; i: number }[] = [{ id: start, i: 0 }];
    state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const edges = out.get(top.id) ?? [];
      if (top.i >= edges.length) {
        state.set(top.id, 2);
        stack.pop();
        continue;
      }
      const e = edges[top.i++];
      const s = state.get(e.toId);
      if (s === 1) {
        (e as { _drop?: boolean })._drop = true;
        dropped++;
      } else if (!s) {
        state.set(e.toId, 1);
        stack.push({ id: e.toId, i: 0 });
      }
    }
  }
  return dropped;
}

/** Decode file bytes: UTF-16 by BOM, UTF-8 otherwise, falling back to Windows-1252 for invalid UTF-8. */
export function decodeGedcom(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8);
  } catch {
    return new TextDecoder('windows-1252').decode(u8);
  }
}

// ---------------------------------------------------------------------------
// Export

class Writer {
  lines: string[] = [];
  /** Write a line; long or multi-line values are split with CONT/CONC. "@" is escaped unless it's a pointer. */
  line(level: number, tag: string, value?: string, opts: { xref?: string; pointer?: boolean } = {}) {
    const head = `${level}${opts.xref ? ` ${opts.xref}` : ''} ${tag}`;
    if (value === undefined || value === '') {
      this.lines.push(head);
      return;
    }
    const v = opts.pointer ? value : value.replace(/@/g, '@@');
    const paras = v.replace(/\r\n?/g, '\n').split('\n');
    paras.forEach((para, i) => {
      const chunks = chunk(para, 200);
      chunks.forEach((c, j) => {
        if (i === 0 && j === 0) this.lines.push(`${head} ${c}`);
        else if (j === 0) this.lines.push(c ? `${level + 1} CONT ${c}` : `${level + 1} CONT`);
        else this.lines.push(`${level + 1} CONC ${c}`);
      });
    });
  }
}

/** Split text for CONC without breaking next to a space (some readers trim) or inside a surrogate pair. */
function chunk(s: string, max: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > max) {
    let cut = max;
    while (cut > max / 2 && (rest[cut] === ' ' || rest[cut - 1] === ' ' || /[\uDC00-\uDFFF]/.test(rest[cut]))) cut--;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  out.push(rest);
  return out;
}

const SEX: Record<Gender, string> = { male: 'M', female: 'F', other: 'U', unknown: 'U' };
const PEDI: Partial<Record<ParentSubtype, string>> = { biological: 'birth', adoptive: 'adopted', foster: 'foster' };
const FREL: Record<ParentSubtype, string> = { biological: 'Natural', adoptive: 'Adopted', foster: 'Foster', step: 'Step' };

interface Fam {
  xref: string;
  husb?: string;
  wife?: string;
  spouse?: Relationship;
  /** child id → (parent id → subtype) */
  kids: Map<string, Map<string, ParentSubtype | undefined>>;
}

/**
 * Export people and family edges as GEDCOM 5.5.1. With `familyOfId`, only that person's
 * family-connected component is written (friends and other social links are never exported).
 */
export function exportGedcom(people: Person[], rels: Relationship[], opts: { familyOfId?: string } = {}): string {
  let list = people;
  if (opts.familyOfId) {
    const comp = new FamilyGraph(people, rels).familyComponent(opts.familyOfId);
    list = people.filter((p) => comp.has(p.id));
  }
  const ids = new Set(list.map((p) => p.id));
  const fam = rels.filter((r) => ids.has(r.fromId) && ids.has(r.toId) && r.fromId !== r.toId);
  const byId = new Map(list.map((p) => [p.id, p]));
  const xrefOf = new Map(list.map((p, i) => [p.id, `@I${i + 1}@`]));

  // --- Families: group each child's parent edges by parent pair.
  const spouseOf = new Map<string, Relationship>();
  const pairKey = (a?: string, b?: string) => [a ?? '', b ?? ''].sort().join('|');
  for (const r of fam) if (r.type === 'spouse') spouseOf.set(pairKey(r.fromId, r.toId), r);
  const parentsOf = new Map<string, Relationship[]>();
  for (const r of fam) if (r.type === 'parent') (parentsOf.get(r.toId) ?? parentsOf.set(r.toId, []).get(r.toId)!).push(r);

  const fams = new Map<string, Fam>();
  const famFor = (a?: string, b?: string): Fam => {
    const k = pairKey(a, b);
    let f = fams.get(k);
    if (!f) {
      const [husb, wife] = orderCouple(a, b, byId);
      f = { xref: '', husb, wife, kids: new Map() };
      fams.set(k, f);
    }
    return f;
  };
  for (const [kid, edges] of parentsOf) {
    const remaining = [...edges];
    const groups: Relationship[][] = [];
    // Pair parents of this child who are partners of each other first.
    for (let i = 0; i < remaining.length; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        if (spouseOf.has(pairKey(remaining[i].fromId, remaining[j].fromId))) {
          groups.push([remaining[i], remaining[j]]);
          remaining.splice(j, 1);
          remaining.splice(i, 1);
          i = -1;
          break;
        }
      }
    }
    // Two leftover parents (e.g. no spouse edge recorded) are one family; otherwise each is a single parent.
    if (remaining.length === 2) groups.push(remaining.splice(0, 2));
    for (const e of remaining) groups.push([e]);
    for (const g of groups) {
      const f = famFor(g[0].fromId, g[1]?.fromId);
      const m = f.kids.get(kid) ?? new Map<string, ParentSubtype | undefined>();
      for (const e of g) m.set(e.fromId, e.subtype as ParentSubtype | undefined);
      f.kids.set(kid, m);
    }
  }
  for (const r of fam) if (r.type === 'spouse') famFor(r.fromId, r.toId).spouse = r;

  // Explicit full/adoptive sibling groups with no recorded parents become parentless families.
  const parentless = new Map<string, string>();
  const findRoot = (x: string): string => {
    const p = parentless.get(x) ?? x;
    return p === x ? x : findRoot(p);
  };
  for (const r of fam) {
    if (r.type !== 'sibling' || r.subtype === 'step' || r.subtype === 'half') continue;
    if (parentsOf.has(r.fromId) || parentsOf.has(r.toId)) continue;
    const a = findRoot(r.fromId);
    const b = findRoot(r.toId);
    if (!parentless.has(a)) parentless.set(a, a);
    if (!parentless.has(b)) parentless.set(b, b);
    if (a !== b) parentless.set(a, b);
  }
  const sibGroups = new Map<string, string[]>();
  for (const x of parentless.keys()) (sibGroups.get(findRoot(x)) ?? sibGroups.set(findRoot(x), []).get(findRoot(x))!).push(x);
  let sibN = 0;
  for (const members of sibGroups.values()) {
    if (members.length < 2) continue;
    fams.set(`~sib${sibN++}`, { xref: '', kids: new Map(members.map((m) => [m, new Map()])) });
  }

  const famList = [...fams.values()];
  famList.forEach((f, i) => (f.xref = `@F${i + 1}@`));
  const famc = new Map<string, Fam[]>();
  const famsOf = new Map<string, Fam[]>();
  for (const f of famList) {
    for (const k of f.kids.keys()) (famc.get(k) ?? famc.set(k, []).get(k)!).push(f);
    for (const s of [f.husb, f.wife]) if (s) (famsOf.get(s) ?? famsOf.set(s, []).get(s)!).push(f);
  }

  const w = new Writer();
  const now = new Date();
  w.line(0, 'HEAD');
  w.line(1, 'SOUR', 'LINEAGE');
  w.line(2, 'NAME', 'Lineage');
  w.line(1, 'DATE', `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`);
  w.line(1, 'SUBM', '@U1@', { pointer: true });
  w.line(1, 'GEDC');
  w.line(2, 'VERS', '5.5.1');
  w.line(2, 'FORM', 'LINEAGE-LINKED');
  w.line(1, 'CHAR', 'UTF-8');
  w.line(0, 'SUBM', undefined, { xref: '@U1@' });
  w.line(1, 'NAME', 'Lineage user');

  for (const p of list) writeIndi(w, p, xrefOf.get(p.id)!, famc.get(p.id) ?? [], famsOf.get(p.id) ?? []);

  for (const f of famList) {
    w.line(0, 'FAM', undefined, { xref: f.xref });
    if (f.husb) w.line(1, 'HUSB', xrefOf.get(f.husb), { pointer: true });
    if (f.wife) w.line(1, 'WIFE', xrefOf.get(f.wife), { pointer: true });
    const st = f.spouse?.subtype as SpouseSubtype | undefined;
    if (st && st !== 'partner') w.line(1, 'MARR', 'Y');
    if (st === 'divorced') w.line(1, 'DIV', 'Y');
    if (st && st !== 'married' && st !== 'divorced') w.line(1, '_STAT', st === 'partner' ? 'Partners' : st[0].toUpperCase() + st.slice(1));
    if (f.spouse?.note) w.line(1, 'NOTE', f.spouse.note);
    for (const [kid, subs] of f.kids) {
      w.line(1, 'CHIL', xrefOf.get(kid), { pointer: true });
      if (!usePedi(subs)) {
        for (const [parent, st2] of subs) {
          if (!st2) continue;
          w.line(2, parent === f.husb ? '_FREL' : '_MREL', FREL[st2]);
        }
      }
    }
  }
  w.line(0, 'TRLR');
  return w.lines.join('\n') + '\n';
}

/** PEDI can be used when every parent in the family has the same, PEDI-expressible subtype. */
function usePedi(subs: Map<string, ParentSubtype | undefined>): string | undefined | false {
  const vals = [...new Set(subs.values())];
  if (vals.length > 1) return false;
  const v = vals[0];
  if (v === undefined) return undefined; // nothing to say, nothing to write
  return PEDI[v] ?? false;
}

function orderCouple(a: string | undefined, b: string | undefined, byId: Map<string, Person>): [string | undefined, string | undefined] {
  if (!b) {
    const g = a ? byId.get(a)?.gender : undefined;
    return g === 'female' ? [undefined, a] : [a, undefined];
  }
  const ga = byId.get(a!)?.gender;
  const gb = byId.get(b)?.gender;
  // HUSB is the male partner, WIFE the female one; otherwise keep the given order.
  if ((ga === 'female' && gb !== 'female') || (gb === 'male' && ga !== 'male')) return [b, a];
  return [a, b];
}

function writeIndi(w: Writer, p: Person, xref: string, famc: Fam[], fams: Fam[]) {
  w.line(0, 'INDI', undefined, { xref });
  const given = [p.firstName, p.middleName].map((x) => x?.trim()).filter(Boolean).join(' ');
  const surname = (p.lastName ?? '').replace(/\//g, ' ').trim();
  w.line(1, 'NAME', `${given.replace(/\//g, ' ')} /${surname}/`.trim());
  if (given) w.line(2, 'GIVN', given);
  if (surname) w.line(2, 'SURN', surname);
  if (p.nickname) w.line(2, 'NICK', p.nickname);
  for (const o of (p.otherNames ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    w.line(1, 'NAME', o.replace(/\//g, ' '));
    w.line(2, 'TYPE', 'aka');
  }
  w.line(1, 'SEX', SEX[p.gender] ?? 'U');

  const facts = [...p.facts];
  const takeFact = (label: string) => {
    const i = facts.findIndex((f) => f.label === label);
    return i >= 0 ? facts.splice(i, 1)[0].value : undefined;
  };
  const dateFor = (iso: string | undefined, label: string): string | undefined => {
    const note = facts.find((f) => f.label === label)?.value;
    if (note) {
      const ged = noteToGedcomDate(note);
      const parsed = parseGedcomDate(ged).date;
      // Prefer the qualified original when it still agrees with the stored date.
      if (!iso || (parsed && parsed.slice(0, 4) === iso.slice(0, 4) && iso.length === 4)) {
        takeFact(label);
        return ged;
      }
    }
    return iso ? formatGedcomDate(iso) : undefined;
  };

  const birth = dateFor(p.birthDate, 'Birth date');
  const origin = joinPlace(p.origin);
  if (birth || origin) {
    w.line(1, 'BIRT');
    if (birth) w.line(2, 'DATE', birth);
    if (origin) w.line(2, 'PLAC', origin);
  }
  const death = dateFor(p.deathDate, 'Death date');
  if (p.deceased || death) {
    const place = takeFact('Place of death');
    const cause = takeFact('Cause of death');
    w.line(1, 'DEAT', death || place || cause ? undefined : 'Y');
    if (death) w.line(2, 'DATE', death);
    if (place) w.line(2, 'PLAC', place);
    if (cause) w.line(2, 'CAUS', cause);
  }
  if (p.occupation) w.line(1, 'OCCU', p.occupation);
  for (const j of p.work) {
    if (!j.organization && !j.role) continue;
    w.line(1, 'OCCU', j.role || undefined);
    if (j.organization) w.line(2, 'AGNC', j.organization);
    const d = range(j.from, j.to);
    if (d) w.line(2, 'DATE', d);
  }
  for (const e of p.education) {
    if (!e.institution) continue;
    w.line(1, 'EDUC', e.course || undefined);
    w.line(2, 'AGNC', e.institution);
    const d = range(e.from, e.to);
    if (d) w.line(2, 'DATE', d);
  }
  if (p.appearance) w.line(1, 'DSCR', p.appearance);

  const addr = p.address;
  const place = joinPlace(addr);
  if (place || addr?.line || p.phones.length || p.emails.length) {
    w.line(1, 'RESI');
    if (addr?.line) w.line(2, 'ADDR', addr.line);
    if (place) w.line(2, 'PLAC', place);
    for (const ph of p.phones) if (ph.value) w.line(2, 'PHON', ph.value);
    for (const em of p.emails) if (em.value) w.line(2, 'EMAIL', em.value);
  }
  for (const f of facts) {
    if (!f.value && !f.label) continue;
    const tag = LABEL_TO_TAG[f.label.toLowerCase()];
    if (tag && ATTRIBUTE_TAGS.has(tag)) w.line(1, tag, f.value);
    else {
      w.line(1, 'FACT', f.value);
      w.line(2, 'TYPE', f.label || 'Fact');
    }
  }
  if (p.howWeMet) {
    w.line(1, 'FACT', p.howWeMet);
    w.line(2, 'TYPE', 'How we met');
  }
  if (p.metOn) {
    w.line(1, 'FACT', p.metOn);
    w.line(2, 'TYPE', 'Met on');
  }
  if (p.notes) w.line(1, 'NOTE', p.notes);
  for (const f of famc) {
    w.line(1, 'FAMC', f.xref, { pointer: true });
    const pedi = usePedi(f.kids.get(p.id)!);
    if (pedi) w.line(2, 'PEDI', pedi);
  }
  for (const f of fams) w.line(1, 'FAMS', f.xref, { pointer: true });
}

function range(from?: string, to?: string): string | undefined {
  const y = (s?: string) => s?.match(/\d{4}/)?.[0];
  const a = y(from);
  const b = y(to);
  if (a && b) return `FROM ${a} TO ${b}`;
  if (a) return `FROM ${a}`;
  if (b) return b;
  return undefined;
}
