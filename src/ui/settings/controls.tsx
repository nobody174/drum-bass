import type { ComponentChildren } from "preact";

export function Toggle(props: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="set-row">
      <span class="set-text">
        <span class="set-label">{props.label}</span>
        {props.hint && <span class="set-hint">{props.hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        class="set-switch"
        checked={props.checked}
        onChange={(e) => props.onChange((e.currentTarget as HTMLInputElement).checked)}
      />
    </label>
  );
}

/** A labelled segmented choice (reuses the app-wide .seg style). */
export function Choice<T extends string | number>(props: {
  label: string;
  hint?: ComponentChildren;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div class="set-row set-row-col">
      <span class="set-text">
        <span class="set-label">{props.label}</span>
        {props.hint && <span class="set-hint">{props.hint}</span>}
      </span>
      <div class="seg" role="group" aria-label={props.label}>
        {props.options.map((o) => (
          <button key={String(o.value)} type="button" aria-pressed={props.value === o.value} onClick={() => props.onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
