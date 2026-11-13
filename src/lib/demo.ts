import { db } from './db';
import { emptyPerson, newId } from './person';
import type { Gender, Person, Relationship, RelType } from './types';

/** A fictional sample family + friends, for trying the app out. */
export async function loadDemo() {
  const people: Person[] = [];
  const rels: Relationship[] = [];
  const P = (first: string, last: string | undefined, gender: Gender, extra: Partial<Person> = {}) => {
    const p = emptyPerson({ firstName: first, lastName: last, gender, ...extra });
    people.push(p);
    return p.id;
  };
  const R = (fromId: string, toId: string, type: RelType, note?: string) =>
    rels.push({ id: newId(), fromId, toId, type, subtype: type === 'parent' ? 'biological' : type === 'spouse' ? 'married' : undefined, note, createdAt: Date.now() });
  const origin = { area: 'Kothapalli', city: 'Karimnagar', state: 'Telangana', country: 'India' };
  const hyd = (area: string) => ({ area, city: 'Hyderabad', state: 'Telangana', country: 'India' });

  const ggf = P('Narayana', 'Rao', 'male', { birthDate: '1898', deathDate: '1961', deceased: true, origin, occupation: 'Farmer' });
  const ggm = P('Lakshmamma', 'Rao', 'female', { birthDate: '1905', deathDate: '1979', deceased: true, origin });
  const gf = P('Venkata', 'Rao', 'male', { birthDate: '1930', deathDate: '2008', deceased: true, origin, occupation: 'School headmaster', appearance: 'Tall, white dhoti, thick spectacles' });
  const gm = P('Saraswathi', 'Rao', 'female', { birthDate: '1936', deathDate: '2015', deceased: true, origin });
  const mgf = P('Ramaiah', 'Gupta', 'male', { birthDate: '1932', deceased: true, origin: { city: 'Warangal', state: 'Telangana', country: 'India' } });
  const mgm = P('Kamala', 'Gupta', 'female', { birthDate: '1938', origin: { city: 'Warangal', state: 'Telangana', country: 'India' }, address: { city: 'Warangal', country: 'India' } });
  const dad = P('Srinivas', 'Rao', 'male', { birthDate: '1958-03-12', origin, address: hyd('Kukatpally'), occupation: 'Retired bank manager', nickname: 'Seenu' });
  const mom = P('Padma', 'Rao', 'female', { birthDate: '1963-11-20', origin: { city: 'Warangal', state: 'Telangana', country: 'India' }, address: hyd('Kukatpally'), otherNames: 'née Gupta' });
  const uncle = P('Prakash', 'Rao', 'male', { birthDate: '1961', origin, address: { city: 'Karimnagar', state: 'Telangana', country: 'India' }, occupation: 'Runs a fertiliser shop', appearance: 'Big moustache, loud laugh' });
  const aunt = P('Sunitha', 'Rao', 'female', { address: { city: 'Karimnagar', country: 'India' } });
  const cousin = P('Kiran', 'Rao', 'male', { birthDate: '1990-07-04', address: hyd('Madhapur'), work: [{ organization: 'Infosys', role: 'Developer' }] });
  const cousinKid = P('Aarav', 'Rao', 'male', { birthDate: '2020' });
  const mamaji = P('Suresh', 'Gupta', 'male', { birthDate: '1966', address: { city: 'Warangal', country: 'India' }, occupation: 'Lecturer', nickname: 'Suresh mama' });
  const me = P('Ravi', 'Rao', 'male', {
    isMe: true, birthDate: '1988-05-21', origin, address: hyd('Madhapur'),
    education: [{ institution: 'JNTU Hyderabad', course: 'B.Tech CSE', from: '2006', to: '2010' }],
    work: [{ organization: 'Infosys', role: 'Engineer' }],
  });
  const wife = P('Anjali', 'Rao', 'female', { birthDate: '1991-02-14', origin: { city: 'Vijayawada', state: 'Andhra Pradesh', country: 'India' }, address: hyd('Madhapur'), otherNames: 'née Reddy' });
  const fil = P('Mohan', 'Reddy', 'male', { birthDate: '1960', address: { city: 'Vijayawada', country: 'India' } });
  const sis = P('Divya', 'Sharma', 'female', { birthDate: '1985-12-01', address: { city: 'Bengaluru', country: 'India' }, nickname: 'Divi' });
  const bil = P('Amit', 'Sharma', 'male', { address: { city: 'Bengaluru', country: 'India' } });
  const niece = P('Meera', 'Sharma', 'female', { birthDate: '2015' });
  const son = P('Arjun', 'Rao', 'male', { birthDate: '2018-09-09' });
  const daughter = P('Ananya', 'Rao', 'female', { birthDate: '2021-06-30' });

  const f1 = P('Sandeep', 'Kumar', 'male', {
    address: hyd('Madhapur'), education: [{ institution: 'JNTU Hyderabad', course: 'B.Tech ECE', from: '2006', to: '2010' }],
    howWeMet: 'College hostel room-mate', appearance: 'Short, curly hair, always in a cricket jersey', phones: [{ label: 'mobile', value: '+91 98480 00001' }],
  });
  const f2 = P('Farhan', 'Ali', 'male', { address: hyd('Gachibowli'), work: [{ organization: 'Infosys', role: 'Manager' }], howWeMet: 'Team lead at first job' });
  const f3 = P('Priya', 'Nair', 'female', { address: hyd('Madhapur'), howWeMet: 'Neighbour, flat 302', appearance: 'Glasses, walks a golden retriever every morning' });
  const f4 = P('Venu', 'Goud', 'male', { origin, address: { city: 'Karimnagar', country: 'India' }, howWeMet: 'Childhood friend from the village', occupation: 'Teacher' });
  P('Harish', 'Varma', 'male', { education: [{ institution: 'JNTU Hyderabad', from: '2005', to: '2009' }], howWeMet: 'Senior in college' });

  R(ggf, gf, 'parent'); R(ggm, gf, 'parent'); R(ggf, ggm, 'spouse');
  R(gf, dad, 'parent'); R(gm, dad, 'parent'); R(gf, uncle, 'parent'); R(gm, uncle, 'parent'); R(gf, gm, 'spouse');
  R(mgf, mom, 'parent'); R(mgm, mom, 'parent'); R(mgf, mamaji, 'parent'); R(mgm, mamaji, 'parent'); R(mgf, mgm, 'spouse');
  R(uncle, aunt, 'spouse'); R(uncle, cousin, 'parent'); R(aunt, cousin, 'parent'); R(cousin, cousinKid, 'parent');
  R(dad, mom, 'spouse'); R(dad, me, 'parent'); R(mom, me, 'parent'); R(dad, sis, 'parent'); R(mom, sis, 'parent');
  R(sis, bil, 'spouse'); R(sis, niece, 'parent'); R(bil, niece, 'parent');
  R(me, wife, 'spouse'); R(fil, wife, 'parent'); R(me, son, 'parent'); R(wife, son, 'parent'); R(me, daughter, 'parent'); R(wife, daughter, 'parent');
  R(me, f1, 'close_friend', 'Since 2006'); R(me, f2, 'colleague'); R(me, f3, 'neighbor'); R(me, f4, 'friend'); R(f1, f2, 'acquaintance');

  await db.transaction('rw', db.people, db.relationships, async () => {
    await db.people.bulkAdd(people);
    await db.relationships.bulkAdd(rels);
  });
}
