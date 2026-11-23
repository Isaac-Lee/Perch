/** Text handed from a fork's source pane to the child pane that opens on the new session. */
export const FOCUS_PANE_EVENT = "perch:focus-pane";
const pending = new Map<string, { text: string; send: boolean }>();
export const setPrefill = (sessionId: string, p: { text: string; send: boolean }): void => { pending.set(sessionId, p); };
export function takePrefill(sessionId: string): { text: string; send: boolean } | undefined {
  const p = pending.get(sessionId);
  pending.delete(sessionId);
  return p;
}
