import { describe, expect, it } from 'vitest';
import { peopleApiToPersons, planImport, type PeopleApiPerson } from '../contacts';
import type { GooglePerson } from '../cloud/googleContacts';
import { emptyPerson } from '../person';

// Compile-time guard: the fetcher's GooglePerson must stay assignable to what the mapper reads.
const _fits: (g: GooglePerson[]) => PeopleApiPerson[] = (g) => g;
void _fits;

// Shaped like people.connections.list responses (personFields=names,nicknames,phoneNumbers,...).
// All names, numbers and addresses are invented.
const meta = (primary = false) => ({ metadata: { primary, source: { type: 'CONTACT', id: 'c1' } } });

const FULL: PeopleApiPerson = {
  resourceName: 'people/c1001',
  names: [{ ...meta(true), displayName: 'Asha Rani Verma', givenName: 'Asha', middleName: 'Rani', familyName: 'Verma', unstructuredName: 'Asha Rani Verma' }],
  nicknames: [{ ...meta(true), value: 'Ashu' }],
  phoneNumbers: [
    { ...meta(true), value: '(555) 555-0123', canonicalForm: '+15555550123', type: 'mobile', formattedType: 'Mobile' },
    { ...meta(), value: '555-0145', type: 'home', formattedType: 'Home' },
  ],
  emailAddresses: [
    { ...meta(true), value: 'asha.verma@example.com', type: 'home', formattedType: 'Home' },
    { ...meta(), value: 'asha@work.example.com', type: 'work', formattedType: 'Work' },
  ],
  addresses: [
    { ...meta(), type: 'work', formattedType: 'Work', formattedValue: '1 Office Park\nSpringfield, IL 62701\nUS', streetAddress: '1 Office Park', city: 'Springfield', region: 'IL', postalCode: '62701', countryCode: 'US' },
    { ...meta(true), type: 'home', formattedType: 'Home', streetAddress: '42 Lantern Lane', extendedAddress: 'Apt 3B', city: 'Riverton', region: 'Oregon', postalCode: '97000', country: 'United States', countryCode: 'US' },
  ],
  birthdays: [{ ...meta(true), date: { year: 1988, month: 3, day: 7 } }, { ...meta(), text: '03/07/1988' }],
  organizations: [{ ...meta(true), name: 'Example Widgets', title: 'Product manager', type: 'work' } as never],
  biographies: [{ ...meta(true), value: 'Met at the robotics meetup.', contentType: 'TEXT_PLAIN' } as never],
  urls: [{ ...meta(), value: 'https://asha.example.com', type: 'homePage', formattedType: 'Home Page' }],
  genders: [{ ...meta(true), value: 'female', formattedValue: 'Female' } as never],
  photos: [{ ...meta(true), url: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }],
};

describe('Google People API mapping', () => {
  const [p] = peopleApiToPersons([FULL]);

  it('maps names and nickname', () => {
    expect([p.firstName, p.middleName, p.lastName, p.nickname]).toEqual(['Asha', 'Rani', 'Verma', 'Ashu']);
    expect(p.source).toBe('google');
  });

  it('maps phones (kept as typed) and emails with labels', () => {
    expect(p.phones).toEqual([{ label: 'mobile', value: '(555) 555-0123' }, { label: 'home', value: '555-0145' }]);
    expect(p.emails).toEqual([{ label: 'home', value: 'asha.verma@example.com' }, { label: 'work', value: 'asha@work.example.com' }]);
  });

  it('prefers the home address and keeps others as facts', () => {
    expect(p.address).toEqual({ line: '42 Lantern Lane, Apt 3B, 97000', city: 'Riverton', state: 'Oregon', country: 'United States' });
    expect(p.facts).toContainEqual({ label: 'Address (work)', value: '1 Office Park, Springfield, IL 62701, US' });
  });

  it('maps birthday, work, notes, urls, gender and an inline photo', () => {
    expect(p.birthDate).toBe('1988-03-07');
    expect(p.work).toEqual([{ organization: 'Example Widgets', role: 'Product manager' }]);
    expect(p.notes).toBe('Met at the robotics meetup.');
    expect(p.facts).toContainEqual({ label: 'Website', value: 'https://asha.example.com' });
    expect(p.gender).toBe('female');
    expect(p.photo).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
  });

  it('keeps a birthday without a year as a fact', () => {
    const [q] = peopleApiToPersons([{ resourceName: 'people/c2', names: [{ givenName: 'Bo' }], birthdays: [{ date: { month: 3, day: 12 } }] }]);
    expect(q.birthDate).toBeUndefined();
    expect(q.facts).toEqual([{ label: 'Birthday', value: '12 Mar' }]);
  });

  it('reads the text form of a birthday', () => {
    const [a, b] = peopleApiToPersons([
      { names: [{ givenName: 'Cy' }], birthdays: [{ text: '1975-11-02' }] },
      { names: [{ givenName: 'Di' }], birthdays: [{ text: 'around Diwali' }] },
    ]);
    expect(a.birthDate).toBe('1975-11-02');
    expect(b.facts).toEqual([{ label: 'Birthday', value: 'around Diwali' }]);
  });

  it('falls back to displayName, first address and other genders', () => {
    const [q] = peopleApiToPersons([{
      names: [{ displayName: 'Mei Lin Chen' }],
      addresses: [{ type: 'work', formattedValue: 'Unit 9\nHarbor City' }, { type: 'other', city: 'Lakeside' }],
      genders: [{ value: 'nonbinary' }],
    }]);
    expect([q.firstName, q.lastName]).toEqual(['Mei Lin', 'Chen']);
    expect(q.address).toEqual({ line: 'Unit 9, Harbor City' });
    expect(q.facts).toEqual([{ label: 'Address (other)', value: 'Lakeside' }]);
    expect(q.gender).toBe('other');
  });

  it('skips default photos and https photo URLs', () => {
    const [a, b] = peopleApiToPersons([
      { names: [{ givenName: 'Eli' }], photos: [{ url: 'https://lh3.googleusercontent.com/cm/abc=s100', default: true }] },
      { names: [{ givenName: 'Fay' }], photos: [{ url: 'https://lh3.googleusercontent.com/a/xyz=s100' }] },
    ]);
    expect(a.photo).toBeUndefined();
    expect(b.photo).toBeUndefined();
  });

  it('drops oversized inline photos', () => {
    const [q] = peopleApiToPersons([{ names: [{ givenName: 'Gus' }], photos: [{ url: 'data:image/jpeg;base64,' + 'A'.repeat(300_000) }] }]);
    expect(q.photo).toBeUndefined();
  });

  it('uses the organization, then a phone or email, as the name and skips empty entries', () => {
    const list = peopleApiToPersons([
      { resourceName: 'people/c3', phoneNumbers: [{ value: '555-0177' }] },
      { resourceName: 'people/c4', emailAddresses: [{ value: 'nobody@example.com' }] },
      { resourceName: 'people/c5', organizations: [{ name: 'Example Co' }], photos: [{ url: 'https://x.example/p.jpg', default: true }] },
      { resourceName: 'people/c6' },
    ]);
    expect(list.map((x) => x.firstName)).toEqual(['555-0177', 'nobody@example.com', 'Example Co']);
    expect(list[0].phones[0].label).toBe('phone');
  });

  it('names a business contact after its organization before its phone', () => {
    const [q] = peopleApiToPersons([{
      resourceName: 'people/c7',
      organizations: [{ name: 'Acme Plumbing' }],
      phoneNumbers: [{ value: '(555) 555-0190', canonicalForm: '+15555550190', type: 'work', formattedType: 'Work' }],
    }]);
    expect(q.firstName).toBe('Acme Plumbing');
    expect(q.lastName).toBeUndefined();
    expect(q.work).toEqual([{ organization: 'Acme Plumbing' }]);
  });

  it('keeps phone extensions as typed and falls back to canonicalForm only when the value is empty', () => {
    const [q] = peopleApiToPersons([{
      names: [{ givenName: 'Dana', familyName: 'Okafor' }],
      phoneNumbers: [
        { value: '(555) 555-0142 ext. 204', canonicalForm: '+15555550142', type: 'work', formattedType: 'Work' },
        { value: '555-555-0143 #5', canonicalForm: '+15555550143', type: 'other' },
        { value: '', canonicalForm: '+15555550144', type: 'mobile' },
      ],
    }]);
    expect(q.phones.map((x) => x.value)).toEqual(['(555) 555-0142 ext. 204', '555-555-0143 #5', '+15555550144']);
    // Still matches an existing person by the last 10 digits.
    const existing = emptyPerson({ firstName: 'D', phones: [{ label: 'work', value: '+1 555 555 0144' }] });
    expect(planImport([q], [existing])[0].match?.strength).toBe('strong');
    // The extension is not counted as part of the number when matching.
    const office = emptyPerson({ firstName: 'Dana', lastName: 'Okafor', phones: [{ label: 'work', value: '+1 555 555 0142' }] });
    const [r] = peopleApiToPersons([{ names: [{ givenName: 'Dee' }], phoneNumbers: [{ value: '(555) 555-0142 ext. 204' }] }]);
    expect(planImport([r], [office])[0].match?.person).toBe(office);
  });

  it('merges duplicates within the list', () => {
    const list = peopleApiToPersons([
      { names: [{ givenName: 'Hari', familyName: 'Nair' }], phoneNumbers: [{ value: '+1 555 555 0188' }] },
      { names: [{ givenName: 'Hari' }], phoneNumbers: [{ value: '(555) 555-0188' }], emailAddresses: [{ value: 'hari@example.com' }] },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].lastName).toBe('Nair');
    expect(list[0].emails[0].value).toBe('hari@example.com');
  });

  it('matches existing people in the review plan without overwriting them', () => {
    const existing = emptyPerson({ firstName: 'Asha', notes: 'typed by me', phones: [{ label: 'm', value: '555-555-0123' }] });
    const plan = planImport(peopleApiToPersons([FULL]), [existing]);
    expect(plan).toHaveLength(1);
    expect(plan[0].match).toEqual({ person: existing, strength: 'strong' });
  });

  it('turns HTML biographies into plain text', () => {
    const [q] = peopleApiToPersons([{ names: [{ givenName: 'Ida' }], biographies: [{ value: '<p>Cousin of Raj &amp; Lee</p><p>Loves chess</p>', contentType: 'TEXT_HTML' }] }]);
    expect(q.notes).toBe('Cousin of Raj & Lee\nLoves chess');
  });

  it('tolerates null fields', () => {
    const list = peopleApiToPersons([{ names: [{ givenName: null, familyName: 'Ito', displayName: null }], phoneNumbers: null, birthdays: [{ date: null, text: null }] }]);
    expect(list[0].firstName).toBe('Ito');
    expect(list[0].facts).toEqual([]);
  });
});
