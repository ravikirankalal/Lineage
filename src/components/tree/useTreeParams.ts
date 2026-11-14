import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TreeLevel, TreeOrient } from '../../lib/graph/contract';

export type LineageTab = 'tree' | 'relatives' | 'lines';
const LEVELS: TreeLevel[] = ['immediate', 'extended', 'everyone'];
const TABS: LineageTab[] = ['tree', 'relatives', 'lines'];

const PHONE_QUERY = '(max-width: 639px)';

/** True below Tailwind's `sm` breakpoint. Re-renders on change. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_QUERY);
    if (!mq) return;
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

export interface TreeParams {
  tab: LineageTab;
  focus: string;
  level: TreeLevel;
  /** Person whose path from the ego is highlighted ("How are we related?", Find, Show in tree). */
  hl?: string;
  expanded: ReadonlySet<string>;
  /** Generations top to bottom ('down') or left to right ('right'). */
  orient: TreeOrient;
}

/**
 * The tree's view state lives in the hash query (#/family?focus=<id>&level=extended&hl=<id>), so
 * Back/forward step through focus changes and returning from a profile restores the view.
 * Focus and highlight changes push a history entry; tab, level and expand/collapse replace it.
 */
export function useTreeParams(egoId: string, isValid: (id: string) => boolean) {
  const [sp, setSp] = useSearchParams();
  // Default level is chosen once per visit: Immediate on phones, Extended on larger screens.
  const [defaultLevel] = useState<TreeLevel>(() =>
    typeof window !== 'undefined' && window.matchMedia?.(PHONE_QUERY).matches ? 'immediate' : 'extended');
  // Default layout: the cross (father's side left, mother's right, brothers up, sisters down) on tall
  // screens (portrait phones), top to bottom otherwise.
  const [defaultOrient] = useState<TreeOrient>(() =>
    typeof window !== 'undefined' && window.innerHeight > window.innerWidth * 1.2 ? 'cross' : 'down');

  // Keep the Set identity stable while the list is unchanged, so the layout isn't recomputed
  // (and running animations aren't interrupted) on unrelated URL changes.
  const open = sp.get('open') ?? '';
  const expanded = useMemo(() => new Set(open.split(',').filter(isValid)), [open, isValid]);

  const params = useMemo<TreeParams>(() => {
    const f = sp.get('focus');
    const l = sp.get('level') as TreeLevel | null;
    const t = sp.get('tab') as LineageTab | null;
    const hl = sp.get('hl');
    const dir = sp.get('dir');
    return {
      tab: t && TABS.includes(t) ? t : 'tree',
      focus: f && isValid(f) ? f : egoId,
      level: l && LEVELS.includes(l) ? l : defaultLevel,
      hl: hl && isValid(hl) && hl !== egoId ? hl : undefined,
      expanded,
      orient: dir === 'right' || dir === 'down' || dir === 'cross' ? dir : defaultOrient,
    };
  }, [sp, egoId, isValid, defaultLevel, defaultOrient, expanded]);

  const update = useCallback((patch: Partial<{ tab: LineageTab; focus: string; level: TreeLevel; hl: string | null; expanded: ReadonlySet<string>; orient: TreeOrient }>, opts: { push?: boolean } = {}) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      const put = (k: string, v: string | null | undefined) => (v ? next.set(k, v) : next.delete(k));
      if (patch.tab !== undefined) put('tab', patch.tab === 'tree' ? null : patch.tab);
      if (patch.focus !== undefined) put('focus', patch.focus === egoId ? null : patch.focus);
      if (patch.level !== undefined) put('level', patch.level);
      if (patch.hl !== undefined) put('hl', patch.hl);
      if (patch.expanded !== undefined) put('open', [...patch.expanded].join(','));
      if (patch.orient !== undefined) put('dir', patch.orient);
      return next;
    }, { replace: !opts.push });
  }, [setSp, egoId]);

  return [params, update] as const;
}
