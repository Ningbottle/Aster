import type { ContextWindowView } from './usage';
import './context-motion.css';

/**
 * The circle next to the composer is the context-window indicator, not runtime
 * state. It advances only when the host reports session.getStats.contextUsage.
 */
export function ContextRing({ usage, size = 16, className = '', decorative = false }: {
  usage: ContextWindowView;
  size?: number;
  className?: string;
  /** Inside a labelled control or next to a visible percent, the ring adds no second name. */
  decorative?: boolean;
}) {
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const percent = usage.percent;
  return <svg
    className={`context-ring ${className}`}
    width={size}
    height={size}
    viewBox="0 0 36 36"
    role={decorative ? undefined : 'img'}
    aria-hidden={decorative ? 'true' : undefined}
    aria-label={decorative ? undefined : usage.title}
    focusable="false"
  >
    {!decorative && <title>{usage.title}</title>}
    <g className="context-ring-hover">
      <circle className="context-ring-glow" cx="18" cy="18" r={radius} fill="none" stroke="var(--ring-progress, #657f9c)" strokeWidth="6" aria-hidden="true" />
      <circle cx="18" cy="18" r={radius} fill="none" stroke="var(--ring-track, #d8d1c2)" strokeWidth="3.6" />
      {percent !== null && percent > 0 && <circle
      cx="18"
      cy="18"
      r={radius}
      fill="none"
      stroke="var(--ring-progress, #657f9c)"
      strokeWidth="3.6"
      strokeLinecap="round"
      strokeDasharray={`${circumference * percent / 100} ${circumference}`}
      transform="rotate(-90 18 18)"
      />}
    </g>
  </svg>;
}
