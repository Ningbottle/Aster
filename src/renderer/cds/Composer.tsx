// Adapted from Caho1/open-claude-ui ChatComposer.tsx (MIT), c1f923a.
// Slots replace demo attachments/models with Aster's real Pi controls.
import { forwardRef, type ReactNode } from 'react';

export const ComposerFrame = forwardRef<HTMLDivElement, { disabled: boolean; children: ReactNode }>(
  ({ disabled, children }, ref) => <div ref={ref} data-cds="ChatComposer"
    className={`composer relative flex w-full flex-col bg-[var(--cds-surface-3)] transition-shadow duration-200 ${disabled ? 'disabled' : ''}`}>
    {children}
  </div>,
);
ComposerFrame.displayName = 'ComposerFrame';
