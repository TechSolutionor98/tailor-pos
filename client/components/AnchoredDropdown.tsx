'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';



/**
 * A dropdown that cannot be clipped by whatever it sits inside.
 *
 * Suggestion lists live inside scrolling containers — the order items table
 * and each person's materials table are both `overflow-x-auto`, which makes
 * them a clipping context. An absolutely positioned panel is then trapped and
 * cut off inside the scroll box. So the panel is rendered through a portal on
 * `document.body` and positioned with `fixed` coordinates taken from the
 * anchor, which no ancestor's overflow can touch.
 */
export function AnchoredDropdown({
  anchorRef,
  open,
  width = 288,
  direction = 'down',
  align = 'left',
  children,
  panelRef,
}: {
  anchorRef: React.RefObject<HTMLElement>;
  open: boolean;
  /** Preferred width in px; trimmed to fit narrow screens. */
  width?: number;
  /** 'down' forces the panel to strictly open downwards below the anchor. */
  direction?: 'down' | 'auto';
  /** 'left' aligns to anchor's left edge; 'right' aligns to anchor's right edge. */
  align?: 'left' | 'right';
  children: React.ReactNode;
  /** So the owner can tell a click on the panel from a click outside it. */
  panelRef?: React.RefObject<HTMLDivElement>;
}) {
  const [mounted, setMounted] = useState(false);
  /**
   * Either a top or a bottom, never both: a panel that opens upwards has to
   * be pinned by its own lower edge, because its height is not known until it
   * has rendered. Pinning it by the top and subtracting a guess is what made
   * it open over the field it belongs to.
   */
  const [box, setBox] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = panelRef ?? ownRef;

  // Portals need a DOM; nothing renders during the server pass.
  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open || !mounted) return;

    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gutter = 8;
      const w = Math.min(width, window.innerWidth - gutter * 2);
      // Keep the panel on screen when the field sits near the right edge.
      const targetLeft = align === 'right' ? r.right - w : r.left;
      const left = Math.max(gutter, Math.min(targetLeft, window.innerWidth - w - gutter));
      const below = window.innerHeight - r.bottom;
      const above = r.top;
      // Strictly open downwards by default unless direction is set to 'auto'.
      const flip = direction === 'auto' && below < 220 && above > below;
      // Never taller than the room it has, so the last row is always reachable.
      const maxHeight = Math.max(120, (flip ? above : below) - gutter * 2);
      setBox(
        flip
          ? { bottom: window.innerHeight - r.top + 4, left, width: w, maxHeight }
          : { top: r.bottom + 4, left, width: w, maxHeight },
      );
    };

    place();
    // `true` catches scrolling of the inner containers, not just the window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, mounted, anchorRef, width, direction, align]);

  if (!open || !mounted || !box) return null;

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: box.left,
        width: box.width,
        maxHeight: Math.min(box.maxHeight, 320),
        ...(box.top !== undefined ? { top: box.top } : { bottom: box.bottom }),
      }}
      className="z-[120] overflow-y-auto overflow-x-hidden rounded-xl border border-ink-200 bg-white shadow-pop"
    >
      {children}
    </div>,
    document.body,
  );
}
