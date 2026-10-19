'use client';

export interface AttachablePerson {
  uid: string;
  name: string;
  stitchingStyle?: string;
}

/** What a person is called in the picker before anyone has typed their name. */
export const personLabel = (p: AttachablePerson, i: number) => {
  const cleanName = p.name.trim() || `Person ${i + 1}`;
  return p.stitchingStyle?.trim() ? `${cleanName} (${p.stitchingStyle.trim()})` : cleanName;
};

/**
 * Says which person's measurements an order line is stitched to, and lets
 * that be changed. Clicking the line reveals and focuses their measurement input.
 */
export function AttachSizePicker({
  people,
  value,
  onChange,
  onReveal,
  disabled = false,
}: {
  people: AttachablePerson[];
  /** The attached person's uid, or '' for none. */
  value: string;
  onChange: (uid: string) => void;
  /** Go and look at the attached person's measurements. */
  onReveal?: (uid: string) => void;
  disabled?: boolean;
}) {
  const at = people.findIndex((p) => p.uid === value);
  const targetPerson = at >= 0 ? people[at] : null;
  const styleSuffix = targetPerson?.stitchingStyle?.trim() ? ` (${targetPerson.stitchingStyle.trim()})` : '';
  const attached = targetPerson && targetPerson.name.trim() ? `${targetPerson.name.trim()}${styleSuffix}` : null;

  return (
    <div className="relative flex items-center justify-center gap-1.5 max-w-full min-w-0 px-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (onReveal) onReveal(value);
        }}
        title={
          disabled
            ? undefined
            : attached
              ? `Go to ${attached}'s measurements`
              : 'Click to go to measurements for this line'
        }
        className={`min-w-0 flex-1 truncate text-center text-[11px] font-bold transition disabled:cursor-default ${
          attached
            ? 'text-blue-700 hover:text-blue-900 hover:underline'
            : 'text-rose-600 hover:text-rose-800'
        }`}
      >
        {attached ? `${attached} size` : 'Size Not Attached'}
      </button>
      {attached && !disabled && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange('');
          }}
          title="Detach size from this line"
          aria-label="Detach size"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-rose-200 bg-rose-50/50 text-[11px] font-bold text-rose-600 transition hover:border-rose-400 hover:bg-rose-100 hover:text-rose-800"
        >
          ✕
        </button>
      )}
    </div>
  );
}
