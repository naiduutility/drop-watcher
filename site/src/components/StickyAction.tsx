/** The bottom bar on long screens: 2px top rule, page-coloured fill, one
 *  full-width primary action within thumb reach. */
export function StickyAction({ hint, children }: { hint?: string; children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-20 border-t-2 border-divider bg-bg px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-[1120px]">
        {hint ? <p className="mb-2 text-[13px] text-neutral-700">{hint}</p> : null}
        {children}
      </div>
    </div>
  );
}
