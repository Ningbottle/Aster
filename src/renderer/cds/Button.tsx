/* Adapted from Caho1/open-claude-ui, code-examples/CdsButton.tsx, MIT, commit c1f923ae0051a871941b98a0e2e3183a545e6a85. */
import React, { forwardRef } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'brand' | 'onContent' | 'outline';
export type ButtonSize = 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'icon';

export interface CdsButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  isLoading?: boolean;
  indicator?: React.ReactNode;
}

const SIZE_STYLES: Record<ButtonSize, string> = {
  xxs: 'h-5 px-1.5 rounded text-[11px] gap-1',
  xs: 'h-6 px-2 rounded-md text-[12px] gap-1',
  sm: 'h-7 px-2.5 rounded-lg text-[13px] gap-1.5',
  md: 'h-8 px-3.5 rounded-lg text-[14px] gap-1.5',
  lg: 'h-10 px-5 rounded-xl text-[15px] gap-2 font-medium',
  icon: 'size-8 rounded-lg p-0 flex items-center justify-center',
};

const VARIANT_STYLES: Record<ButtonVariant, { text: string; paint: string }> = {
  secondary: {
    text: 'text-neutral-800 dark:text-neutral-200 font-normal',
    paint: 'bg-[var(--cds-fill-secondary,rgba(0,0,0,0.06))] group-hover/btn:bg-[var(--cds-fill-secondary-hover,rgba(0,0,0,0.1))] dark:bg-white/10 dark:hover:bg-white/15 shadow-field',
  },
  primary: { text: 'text-white font-medium', paint: 'bg-clay hover:bg-clay-hover shadow-2xs' },
  ghost: {
    text: 'text-neutral-600 dark:text-neutral-300 font-normal',
    paint: 'bg-transparent group-hover/btn:bg-[var(--cds-fill-ghost-hover,rgba(0,0,0,0.05))] dark:group-hover/btn:bg-white/5',
  },
  danger: { text: 'text-white font-medium', paint: 'bg-red-600 hover:bg-red-700 shadow-2xs' },
  brand: { text: 'text-white font-medium', paint: 'bg-[var(--brand,#c6613f)] hover:bg-clay-hover shadow-2xs' },
  onContent: {
    text: 'text-white font-medium',
    paint: 'bg-[var(--cds-button-on-content,rgba(0,0,0,0.5))] backdrop-blur-md shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)] group-hover/btn:bg-[var(--cds-button-on-content-hover,rgba(0,0,0,0.7))]',
  },
  outline: {
    text: 'text-neutral-700 dark:text-neutral-300 font-normal',
    paint: 'bg-transparent group-hover/btn:bg-neutral-100/60 dark:group-hover/btn:bg-neutral-800/60 border border-neutral-200/90 dark:border-neutral-700/80',
  },
};

export const CdsButton = forwardRef<HTMLButtonElement, CdsButtonProps>(
  ({
    type = 'button',
    variant = 'secondary',
    size = 'md',
    icon,
    iconPosition = 'left',
    isLoading = false,
    indicator,
    disabled = false,
    children,
    className = '',
    ...props
  }, ref) => {
    const isIconOnly = size === 'icon' || (!children && !!icon);
    const variantStyle = VARIANT_STYLES[variant];

    return (
      <button
        ref={ref}
        type={type}
        data-cds="Button"
        disabled={disabled || isLoading}
        className={`group/btn cds-btn-squish relative isolate inline-flex shrink-0 items-center justify-center font-sans select-none cursor-pointer border-0 outline-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-clay/50 disabled:opacity-35 disabled:cursor-not-allowed disabled:pointer-events-none transition-shadow duration-fast ${SIZE_STYLES[size]} ${variantStyle.text} ${className}`}
        {...props}
      >
        <span aria-hidden="true" data-cds-part="paint" className={`absolute inset-0 -z-10 rounded-[inherit] transition-[background-color,box-shadow,color] duration-fast ease-out ${variantStyle.paint}`} />
        {isLoading ? (
          <span className="size-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
        ) : (
          icon && iconPosition === 'left' && <span className="shrink-0 flex items-center justify-center leading-none">{icon}</span>
        )}
        {children && <span className="truncate">{children}</span>}
        {!isLoading && icon && iconPosition === 'right' && !isIconOnly && <span className="shrink-0 flex items-center justify-center leading-none">{icon}</span>}
        {indicator && <span data-cds-part="indicator" className="shrink-0 ml-1">{indicator}</span>}
      </button>
    );
  },
);

CdsButton.displayName = 'CdsButton';
