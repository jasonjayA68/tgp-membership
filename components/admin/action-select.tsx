"use client";

import { useRef } from "react";

import { Select } from "@/components/ui/select";

/**
 * A <select> that submits its enclosing server-action form on change.
 * The server action is passed from the parent Server Component.
 */
export function ActionSelect({
  action,
  name,
  defaultValue,
  options,
  hidden,
  ariaLabel,
  className,
}: {
  action: (formData: FormData) => Promise<void>;
  name: string;
  defaultValue: string;
  options: { value: string; label: string }[];
  hidden: Record<string, string>;
  ariaLabel?: string;
  className?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={action} className={className}>
      {Object.entries(hidden).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <Select
        name={name}
        defaultValue={defaultValue}
        aria-label={ariaLabel}
        onChange={() => formRef.current?.requestSubmit()}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </form>
  );
}
