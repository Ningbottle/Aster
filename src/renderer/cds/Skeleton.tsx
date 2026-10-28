/*
 * Motion based on Caho1/open-claude-ui docs/v2/03 and StatusIndicators.tsx,
 * MIT, commit c1f923ae0051a871941b98a0e2e3183a545e6a85.
 */
import { createContext, useContext } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import './skeleton.css';

export type SkeletonMotion = 'lockstep' | 'wave';

type SkeletonProps = {
  className?: string;
  style?: CSSProperties;
  motion?: SkeletonMotion;
  /** Zero-based position used for the wave's 90ms stagger. */
  index?: number;
};

type SkeletonGroupProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  motion?: SkeletonMotion;
};

const SkeletonGroupMotion = createContext<SkeletonMotion | null>(null);

/** Decorative only; the loading region should provide its own accessible status. */
export function Skeleton({ className = '', style, motion = 'wave', index = 0 }: SkeletonProps) {
  const groupMotion = useContext(SkeletonGroupMotion);
  return <div
    className={`aster-skeleton ${className}`.trim()}
    data-cds="Skeleton"
    data-motion={groupMotion ?? motion}
    data-grouped={groupMotion === 'lockstep' ? '' : undefined}
    style={{ ...style, '--cds-skel-i': index } as CSSProperties}
    aria-hidden="true"
  />;
}

/** The group controls child motion and animates lockstep placeholders as one surface. */
export function SkeletonGroup({ children, className = '', style, motion = 'wave' }: SkeletonGroupProps) {
  return <SkeletonGroupMotion.Provider value={motion}>
    <div className={`aster-skeleton-group ${className}`.trim()} style={style} data-cds="SkeletonGroup" data-motion={motion} aria-hidden="true">
      {children}
    </div>
  </SkeletonGroupMotion.Provider>;
}

/** Compatible with the original single-box sweep. */
export function SkeletonSweep({ className = '' }: { className?: string }) {
  return <Skeleton className={className} motion="wave" />;
}
