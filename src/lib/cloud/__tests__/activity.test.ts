import { describe, expect, it } from 'vitest';
import { activityByMember, isEdit, summarise, type ActivityEntry } from '../activity';
import type { Write } from '../../store';

const p = (id: string, data = true): Write => ({ coll: 'people', id, data: data ? ({ id } as never) : null });
const r = (id: string, data = true): Write => ({ coll: 'relationships', id, data: data ? ({ id } as never) : null });

describe('activity summary', () => {
  it('counts new, changed and removed people and links', () => {
    const existed = new Set(['old', 'oldrel']);
    const c = summarise([p('new1'), p('new2'), p('old'), r('rel1'), r('oldrel', false), p('never', false)], (w) => existed.has(w.id));
    expect(c).toEqual({ peopleAdded: 2, peopleEdited: 1, peopleRemoved: 0, linksAdded: 1, linksChanged: 0, linksRemoved: 1 });
  });
  it('nothing to log for an empty save or removing something never stored', () => {
    expect(summarise([], () => false)).toBeNull();
    expect(summarise([p('x', false)], () => false)).toBeNull();
  });
  it('adding a person with their link is not an edit; changing or linking existing people is', () => {
    const zero = { peopleAdded: 0, peopleEdited: 0, peopleRemoved: 0, linksAdded: 0, linksChanged: 0, linksRemoved: 0 };
    expect(isEdit({ ...zero, peopleAdded: 1, linksAdded: 1 })).toBe(false);
    expect(isEdit({ ...zero, peopleEdited: 1 })).toBe(true);
    expect(isEdit({ ...zero, linksAdded: 1 })).toBe(true);
    expect(isEdit({ ...zero, peopleAdded: 1, linksRemoved: 1 })).toBe(true);
  });
  it('totals per member', () => {
    const zero = { peopleAdded: 0, peopleEdited: 0, peopleRemoved: 0, linksAdded: 0, linksChanged: 0, linksRemoved: 0 };
    const e = (by: string, at: number, x: object): ActivityEntry => ({ ...zero, id: `${by}${at}`, by, at, ...x });
    const m = activityByMember([e('erin', 1, { peopleAdded: 3, linksAdded: 3 }), e('erin', 5, { peopleEdited: 1 }), e('alice', 2, { peopleRemoved: 1 })]);
    expect(m.get('erin')).toEqual({ peopleAdded: 3, edits: 1, last: 5 });
    expect(m.get('alice')).toEqual({ peopleAdded: 0, edits: 1, last: 2 });
  });
});
