'use client';

import type { Ref } from 'react';

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  inputRef?: Ref<HTMLInputElement>;
  maxLength?: number;
  /** Enter key action, e.g. a search that needs a request. */
  onEnter?: () => void;
  /** Shown at the right end, e.g. a submit button. */
  trailing?: React.ReactNode;
};

/** The app's search pill with magnifier icon. 16 px text so iOS does not zoom in on focus. */
export function SearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  inputRef,
  maxLength = 100,
  onEnter,
  trailing,
}: Props) {
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-full bg-white py-0.5 pr-1.5 pl-5 ring-1 ring-line focus-within:ring-2 focus-within:ring-ink">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="shrink-0 text-mist"
        aria-hidden
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        value={value}
        maxLength={maxLength}
        enterKeyHint="search"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-11 w-full bg-transparent text-[16px] outline-none placeholder:text-mist"
      />
      {trailing}
    </div>
  );
}
