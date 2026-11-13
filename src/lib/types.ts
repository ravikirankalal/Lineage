export type Gender = 'male' | 'female' | 'other' | 'unknown';

export interface LabeledValue {
  label: string; // e.g. "mobile", "work", "home"
  value: string;
}

export interface Place {
  area?: string; // neighbourhood / locality / village
  city?: string; // city / town
  district?: string;
  state?: string;
  country?: string;
  line?: string; // street / house details
}

export interface Education {
  institution: string;
  course?: string;
  from?: string; // year
  to?: string; // year
}

export interface Work {
  organization: string;
  role?: string;
  from?: string;
  to?: string;
}

export interface Fact {
  label: string;
  value: string;
}

export interface Person {
  id: string;
  isMe?: boolean;
  firstName: string;
  middleName?: string;
  lastName?: string;
  nickname?: string;
  otherNames?: string; // maiden name, aliases, names in another script
  gender: Gender;
  birthDate?: string; // YYYY, YYYY-MM or YYYY-MM-DD
  deathDate?: string;
  deceased?: boolean;
  phones: LabeledValue[];
  emails: LabeledValue[];
  origin?: Place; // place of origin / native place / home town
  address?: Place; // where they live now
  appearance?: string; // how they look
  howWeMet?: string;
  metOn?: string;
  occupation?: string;
  work: Work[];
  education: Education[];
  facts: Fact[];
  tags: string[];
  notes?: string;
  photo?: string; // small data URL
  source?: 'manual' | 'vcard' | 'csv' | 'picker';
  createdAt: number;
  updatedAt: number;
}

/** Family edges. `parent`: fromId is a parent of toId. Others are symmetric. */
export type FamilyType = 'parent' | 'spouse' | 'sibling';
export type SocialType =
  | 'close_friend'
  | 'friend'
  | 'colleague'
  | 'classmate'
  | 'neighbor'
  | 'acquaintance'
  | 'other';
export type RelType = FamilyType | SocialType;

export type ParentSubtype = 'biological' | 'adoptive' | 'step' | 'foster';
export type SpouseSubtype = 'married' | 'partner' | 'divorced' | 'separated' | 'widowed';
export type SiblingSubtype = 'full' | 'half' | 'step' | 'adoptive';

export interface Relationship {
  id: string;
  fromId: string;
  toId: string;
  type: RelType;
  subtype?: ParentSubtype | SpouseSubtype | SiblingSubtype;
  note?: string;
  createdAt: number;
  /** Last change (ms). Added in DB version 2; rows written before that, and rows from old backups,
   * may lack it. Readers must fall back to `createdAt`. */
  updatedAt?: number;
}

/** The two synced tables. */
export type TableName = 'people' | 'relationships';

/** A local record of a deletion, so sync can propagate it (DB version 2). Holds no personal data. */
export interface Tombstone {
  id: string; // id of the deleted person/relationship
  table: TableName;
  deletedAt: number;
}

/** Key-value store for sync bookkeeping (DB version 2). */
export interface MetaRow {
  key: string;
  value: unknown;
}

export const FAMILY_TYPES: FamilyType[] = ['parent', 'spouse', 'sibling'];

export function isFamilyType(t: RelType): t is FamilyType {
  return t === 'parent' || t === 'spouse' || t === 'sibling';
}

export const SOCIAL_LABELS: Record<SocialType, string> = {
  close_friend: 'Close friend',
  friend: 'Friend',
  colleague: 'Colleague',
  classmate: 'Classmate',
  neighbor: 'Neighbour',
  acquaintance: 'Acquaintance',
  other: 'Knows',
};
