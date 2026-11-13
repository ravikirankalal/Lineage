import { useCallback } from 'react';
import { useData } from '../lib/data';
import { regionalTerm } from '../lib/kinshipTerms';
import { useKinLang } from '../lib/prefs';

/**
 * Returns a lookup for the regional family term (e.g. "Chacha") in the chosen language,
 * or undefined when English is selected or no term exists.
 */
export function useRegionalTerm(): (egoId: string, targetId: string, englishLabel?: string) => string | undefined {
  const { graph } = useData();
  const [lang] = useKinLang();
  return useCallback((egoId: string, targetId: string, englishLabel?: string) => {
    if (lang === 'en' || egoId === targetId) return undefined;
    const t = regionalTerm(graph, egoId, targetId, lang);
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
