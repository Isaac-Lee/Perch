import { useEffect, useMemo, useState } from "react";
import { maxColsFor, movePane, reconcile, type DropTarget, type Layout } from "./grid";
import { loadPaneLayout, savePaneLayout } from "./uiSettings";

/** The user's pane arrangement, kept in step with the open panes. The layout is derived on render (so a new
 *  pane is placed in the same render it appears) and written back to state, which pins it against later
 *  width changes. Until there are panes and a measured width (> 0) the stored layout is left alone. */
export function usePaneLayout(paneIds: string[], width: number) {
  const maxCols = maxColsFor(width);
  const ready = paneIds.length > 0 && width > 0; // no reconcile/persist before a real width is measured
  const [stored, setStored] = useState<Layout>(loadPaneLayout);
  const key = paneIds.join("\0");
  const layout = useMemo(() => (ready ? reconcile(stored, paneIds, maxCols) : stored), [stored, key, maxCols, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready && layout !== stored) setStored(layout); }, [layout, stored, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready) savePaneLayout(layout); }, [layout, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (id: string, target: DropTarget) => setStored(movePane(layout, id, target));
  return { layout, move, order: useMemo(() => layout.flat(), [layout]) };
}
