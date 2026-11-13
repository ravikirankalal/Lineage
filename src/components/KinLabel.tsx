import { useCallback } from 'react';
import { useData } from '../lib/data';
import type { FamilyGraph } from '../lib/kinship';
import { regionalTermsFor, type KinLang } from '../lib/kinshipTerms';
import { useKinLang } from '../lib/prefs';

/**
 * Terms per graph, then per "lang:egoId". The graph is rebuilt on every data change, so entries
 * drop out with it; each page computes one map per ego instead of one path search per label.
 */
const termCache = new WeakMap<FamilyGraph, Map<string, Map<string, string>>>();

function termsFor(graph: FamilyGraph, egoId: string, lang: KinLang): Map<string, string> {
  let byEgo = termCache.get(graph);
  if (!byEgo) termCache.set(graph, (byEgo = new Map()));
  const key = `${lang}:${egoId}`;
  let terms = byEgo.get(key);
  if (!terms) byEgo.set(key, (terms = regionalTermsFor(graph, egoId, lang)));
  return terms;
}

/**
 * Returns a lookup for the regional family term (e.g. "Chacha") in the chosen language,
 * or undefined when English is selected or no term exists.
 */
export function useRegionalTerm(): (egoId: string, targetId: string, englishLabel?: string) => string | undefined {
  const { graph } = useData();
  const [lang] = useKinLang();
  return useCallback((egoId: string, targetId: string, englishLabel?: string) => {
    if (lang === 'en' || egoId === targetId) return undefined;
    const t = termsFor(graph, egoId, lang).get(targetId);
    if (!t || (englishLabel && t.trim().toLowerCase() === englishLabel.trim().toLowerCase())) return undefined;
    return t;
  }, [graph, lang]);
}

/**
 * An English kinship label with the regional term after it: "Uncle · Chacha".
 * The term is quieter (lighter colour, normal weight) so it never competes with the label.
 */
export function KinLabel({ label, egoId, targetId, className = '', termClassName = 'font-normal text-stone-500 dark:text-stone-400' }: {
  label: string;
  egoId: string;
  targetId: string;
  className?: string;
  termClassName?: string;
}) {
  const term = useRegionalTerm()(egoId, targetId, label);
  return (
    <span className={className}>
      {label}
      {term && <span className={termClassName}> · {term}</span>}
    </span>
  );
}
