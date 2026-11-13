import { ArrowLeft, Camera, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { savePerson } from '../lib/db';
import { useData } from '../lib/data';
import { emptyPerson } from '../lib/person';
import type { Gender, Person, Place } from '../lib/types';

export function PersonEditPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { byId, loaded } = useData();
  const existing = id ? byId.get(id) : undefined;
  if (!loaded) return null;
  if (id && !existing) return <p className="p-6 text-stone-500">Person not found.</p>;
  return <Editor key={id ?? 'new'} initial={existing ?? emptyPerson({ isMe: params.get('me') === '1' || undefined })} isNew={!existing} />;
}

async function resizeImage(file: File, size = 320): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const s = Math.min(img.width, img.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Section({ title, children, hint }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="mb-1 mt-0.5 text-sm text-stone-500">{hint}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function Editor({ initial, isNew }: { initial: Person; isNew: boolean }) {
  const nav = useNavigate();
  const { people } = useData();
  const [p, setP] = useState<Person>(initial);
  const [tagInput, setTagInput] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Person>(k: K, v: Person[K]) => setP((x) => ({ ...x, [k]: v }));
  const setPlace = (k: 'origin' | 'address', f: keyof Place, v: string) => setP((x) => ({ ...x, [k]: { ...(x[k] ?? {}), [f]: v || undefined } }));

  // Suggestions from existing data keep "same city / same college" matching consistent.
  const sugg = useMemo(() => {
    const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])].sort();
    return {
      area: uniq(people.flatMap((x) => [x.address?.area, x.origin?.area])),
      city: uniq(people.flatMap((x) => [x.address?.city, x.origin?.city])),
      district: uniq(people.flatMap((x) => [x.address?.district, x.origin?.district])),
      state: uniq(people.flatMap((x) => [x.address?.state, x.origin?.state])),
      country: uniq(people.flatMap((x) => [x.address?.country, x.origin?.country])),
      school: uniq(people.flatMap((x) => x.education.map((e) => e.institution))),
      org: uniq(people.flatMap((x) => x.work.map((w) => w.organization))),
      tags: uniq(people.flatMap((x) => x.tags)),
      lastName: uniq(people.map((x) => x.lastName)),
    };
  }, [people]);

  async function save() {
    if (!p.firstName.trim()) {
      setErr('Please enter at least a first name.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const clean: Person = {
      ...p,
      firstName: p.firstName.trim(),
      phones: p.phones.filter((x) => x.value.trim()),
      emails: p.emails.filter((x) => x.value.trim()),
      work: p.work.filter((x) => x.organization.trim()),
      education: p.education.filter((x) => x.institution.trim()),
      facts: p.facts.filter((x) => x.label.trim() || x.value.trim()),
      tags: [...p.tags, ...tagInput.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean)],
      origin: cleanPlace(p.origin),
      address: cleanPlace(p.address),
    };
    await savePerson(clean);
    nav(`/people/${clean.id}`, { replace: true });
  }

  const genders: [Gender, string][] = [['male', 'Male'], ['female', 'Female'], ['other', 'Other'], ['unknown', 'Not set']];

  const placeFields = (k: 'origin' | 'address') => (
    <div className="grid grid-cols-2 gap-3">
      {k === 'address' && (
        <Field label="Street / house" className="col-span-2">
          <input className="input" value={p.address?.line ?? ''} onChange={(e) => setPlace(k, 'line', e.target.value)} />
        </Field>
      )}
      <Field label={k === 'origin' ? 'Village / area' : 'Area / locality'}>
        <input className="input" list="dl-area" value={p[k]?.area ?? ''} onChange={(e) => setPlace(k, 'area', e.target.value)} />
      </Field>
      <Field label="City / town">
        <input className="input" list="dl-city" value={p[k]?.city ?? ''} onChange={(e) => setPlace(k, 'city', e.target.value)} />
      </Field>
      <Field label="District">
        <input className="input" list="dl-district" value={p[k]?.district ?? ''} onChange={(e) => setPlace(k, 'district', e.target.value)} />
      </Field>
      <Field label="State">
        <input className="input" list="dl-state" value={p[k]?.state ?? ''} onChange={(e) => setPlace(k, 'state', e.target.value)} />
      </Field>
      <Field label="Country" className="col-span-2">
        <input className="input" list="dl-country" value={p[k]?.country ?? ''} onChange={(e) => setPlace(k, 'country', e.target.value)} />
      </Field>
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl">
      {Object.entries(sugg).map(([k, vals]) => (
        <datalist key={k} id={'dl-' + k}>{vals.map((v) => <option key={v} value={v} />)}</datalist>
      ))}

      <div className="sticky top-0 z-20 -mx-4 mb-4 flex items-center gap-2 bg-stone-50/90 px-4 py-2 backdrop-blur dark:bg-stone-950/90 sm:-mx-6 sm:px-6">
        <button className="icon-btn -ml-2" onClick={() => nav(-1)} aria-label="Back"><ArrowLeft size={20} /></button>
        <h1 className="flex-1 truncate text-lg font-semibold">{isNew ? (p.isMe ? 'About you' : 'New person') : 'Edit details'}</h1>
        <button className="btn-primary" onClick={save}>Save</button>
      </div>

      {err && <div className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{err}</div>}

      <div className="space-y-4">
        <Section title="Name">
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => fileRef.current?.click()} className="group relative" aria-label="Change photo">
              <Avatar person={{ ...p, firstName: p.firstName || '?' }} size={76} />
              <span className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-white ring-4 ring-white dark:ring-stone-900"><Camera size={15} /></span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) set('photo', await resizeImage(f)); e.target.value = ''; }} />
            <div className="flex-1 text-sm text-stone-500">
              A face helps memory most. {p.photo && <button className="ml-1 font-medium text-red-600" onClick={() => set('photo', undefined)}>Remove photo</button>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name *"><input autoFocus={isNew} className="input" value={p.firstName} onChange={(e) => set('firstName', e.target.value)} /></Field>
            <Field label="Last name / surname"><input className="input" list="dl-lastName" value={p.lastName ?? ''} onChange={(e) => set('lastName', e.target.value || undefined)} /></Field>
            <Field label="Middle name"><input className="input" value={p.middleName ?? ''} onChange={(e) => set('middleName', e.target.value || undefined)} /></Field>
            <Field label="Nickname / pet name"><input className="input" value={p.nickname ?? ''} onChange={(e) => set('nickname', e.target.value || undefined)} /></Field>
            <Field label="Other names (maiden name, name in native script…)" className="col-span-2">
              <input className="input" value={p.otherNames ?? ''} onChange={(e) => set('otherNames', e.target.value || undefined)} />
            </Field>
          </div>
          <div>
            <span className="label">Gender</span>
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-800">
              {genders.map(([g, l]) => (
                <button key={g} type="button" onClick={() => set('gender', g)}
                  className={`rounded-lg py-2 text-sm font-medium transition ${p.gender === g ? 'bg-white shadow-sm dark:bg-stone-700' : 'text-stone-500'}`}>{l}</button>
              ))}
            </div>
            <p className="mt-1 text-xs text-stone-400">Used for family labels like “uncle” or “aunt”.</p>
          </div>
          <label className="flex items-center gap-3 rounded-xl bg-brand-50/70 px-3 py-2.5 text-sm dark:bg-brand-900/20">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!p.isMe} onChange={(e) => set('isMe', e.target.checked || undefined)} />
            <span><b>This is me</b> — the centre of “My Family”</span>
          </label>
        </Section>

        <Section title="Life">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Born"><input className="input" placeholder="1950 or 1950-08-15" value={p.birthDate ?? ''} onChange={(e) => set('birthDate', e.target.value || undefined)} /></Field>
            <Field label="Died"><input className="input" placeholder="Year or date" value={p.deathDate ?? ''}
              onChange={(e) => setP((x) => ({ ...x, deathDate: e.target.value || undefined, deceased: e.target.value ? true : x.deceased }))} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!p.deceased} onChange={(e) => set('deceased', e.target.checked || undefined)} />
            Passed away
          </label>
        </Section>

        <Section title="How to remember them" hint="The things that help you recognise and place them.">
          <Field label="What they look like">
            <textarea className="input min-h-[80px]" placeholder="Tall, curly hair, glasses, always wears a cap, mole on left cheek…" value={p.appearance ?? ''} onChange={(e) => set('appearance', e.target.value || undefined)} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="How you know them" className="col-span-2">
              <input className="input" placeholder="Met at Ravi’s wedding" value={p.howWeMet ?? ''} onChange={(e) => set('howWeMet', e.target.value || undefined)} />
            </Field>
            <Field label="When"><input className="input" placeholder="2019" value={p.metOn ?? ''} onChange={(e) => set('metOn', e.target.value || undefined)} /></Field>
          </div>
          <Field label="Occupation"><input className="input" placeholder="Teacher, farmer, runs a shop…" value={p.occupation ?? ''} onChange={(e) => set('occupation', e.target.value || undefined)} /></Field>
        </Section>

        <Section title="Contact">
          <LVList label="Phone" items={p.phones} onChange={(v) => set('phones', v)} type="tel" defaultLabel="mobile" />
          <LVList label="Email" items={p.emails} onChange={(v) => set('emails', v)} type="email" defaultLabel="personal" />
        </Section>

        <Section title="Place of origin" hint="Native place / home town / ancestral village.">{placeFields('origin')}</Section>
        <Section title="Lives in">{placeFields('address')}</Section>

        <Section title="Education">
          {p.education.map((e, i) => (
            <Row key={i} onRemove={() => set('education', p.education.filter((_, j) => j !== i))}>
              <input className="input col-span-2" list="dl-school" placeholder="School / college" value={e.institution}
                onChange={(ev) => set('education', p.education.map((x, j) => (j === i ? { ...x, institution: ev.target.value } : x)))} />
              <input className="input" placeholder="Course" value={e.course ?? ''} onChange={(ev) => set('education', p.education.map((x, j) => (j === i ? { ...x, course: ev.target.value || undefined } : x)))} />
              <div className="flex gap-2">
                <input className="input" placeholder="From" value={e.from ?? ''} onChange={(ev) => set('education', p.education.map((x, j) => (j === i ? { ...x, from: ev.target.value || undefined } : x)))} />
                <input className="input" placeholder="To" value={e.to ?? ''} onChange={(ev) => set('education', p.education.map((x, j) => (j === i ? { ...x, to: ev.target.value || undefined } : x)))} />
              </div>
            </Row>
          ))}
          <AddBtn onClick={() => set('education', [...p.education, { institution: '' }])}>Add school or college</AddBtn>
        </Section>

        <Section title="Work">
          {p.work.map((w, i) => (
            <Row key={i} onRemove={() => set('work', p.work.filter((_, j) => j !== i))}>
              <input className="input col-span-2" list="dl-org" placeholder="Company / organisation" value={w.organization}
                onChange={(ev) => set('work', p.work.map((x, j) => (j === i ? { ...x, organization: ev.target.value } : x)))} />
              <input className="input" placeholder="Role" value={w.role ?? ''} onChange={(ev) => set('work', p.work.map((x, j) => (j === i ? { ...x, role: ev.target.value || undefined } : x)))} />
              <div className="flex gap-2">
                <input className="input" placeholder="From" value={w.from ?? ''} onChange={(ev) => set('work', p.work.map((x, j) => (j === i ? { ...x, from: ev.target.value || undefined } : x)))} />
                <input className="input" placeholder="To" value={w.to ?? ''} onChange={(ev) => set('work', p.work.map((x, j) => (j === i ? { ...x, to: ev.target.value || undefined } : x)))} />
              </div>
            </Row>
          ))}
          <AddBtn onClick={() => set('work', [...p.work, { organization: '' }])}>Add workplace</AddBtn>
        </Section>

        <Section title="Anything else" hint="Add any detail: favourite food, kids’ names, gotra, blood group, vehicle…">
          {p.facts.map((f, i) => (
            <Row key={i} onRemove={() => set('facts', p.facts.filter((_, j) => j !== i))}>
              <input className="input" placeholder="Label" value={f.label} onChange={(ev) => set('facts', p.facts.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)))} />
              <input className="input" placeholder="Value" value={f.value} onChange={(ev) => set('facts', p.facts.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)))} />
            </Row>
          ))}
          <AddBtn onClick={() => set('facts', [...p.facts, { label: '', value: '' }])}>Add a detail</AddBtn>
          <div>
            <span className="label">Tags</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {p.tags.map((t) => (
                <span key={t} className="chip">#{t}<button onClick={() => set('tags', p.tags.filter((x) => x !== t))} aria-label={'Remove ' + t}><X size={12} /></button></span>
              ))}
              <input className="input flex-1" list="dl-tags" placeholder="cricket, school, temple… (comma separated)" value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                    e.preventDefault();
                    const t = tagInput.trim().replace(/^#/, '').replace(/,$/, '');
                    if (t && !p.tags.includes(t)) set('tags', [...p.tags, t]);
                    setTagInput('');
                  }
                }} />
            </div>
          </div>
          <Field label="Notes">
            <textarea className="input min-h-[100px]" value={p.notes ?? ''} onChange={(e) => set('notes', e.target.value || undefined)} />
          </Field>
        </Section>

        <button className="btn-primary w-full py-3" onClick={save}>Save</button>
      </div>
    </div>
  );
}

function Row({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  return (
    <div className="flex gap-2">
      <div className="grid flex-1 grid-cols-2 gap-2">{children}</div>
      <button className="icon-btn shrink-0 text-stone-400 hover:text-red-600" onClick={onRemove} aria-label="Remove"><Trash2 size={17} /></button>
    </div>
  );
}

function AddBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300">
      <Plus size={16} /> {children}
    </button>
  );
}

function LVList({ label, items, onChange, type, defaultLabel }: {
  label: string;
  items: { label: string; value: string }[];
  onChange: (v: { label: string; value: string }[]) => void;
  type: string;
  defaultLabel: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex gap-2">
          <input className="input w-28 shrink-0" value={it.label} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <input className="input" type={type} placeholder={label} value={it.value} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
          <button className="icon-btn shrink-0 text-stone-400 hover:text-red-600" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={17} /></button>
        </div>
      ))}
      <AddBtn onClick={() => onChange([...items, { label: defaultLabel, value: '' }])}>Add {label.toLowerCase()}</AddBtn>
    </div>
  );
}

/** Trim a place's fields; drop it entirely when nothing is filled in. */
function cleanPlace(pl?: Place): Place | undefined {
  if (!pl) return undefined;
  const out: Place = {};
  for (const [k, v] of Object.entries(pl) as [keyof Place, string | undefined][]) {
    const t = typeof v === 'string' ? v.trim() : '';
    if (t) out[k] = t;
  }
  return Object.keys(out).length ? out : undefined;
}
