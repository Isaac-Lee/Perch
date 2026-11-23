import type { Att } from "./chatSession";
/** Text handed from a fork's source pane to the child pane that opens on the new session. */
export const FOCUS_PANE_EVENT = "perch:focus-pane";
type Prefill = { text: string; send: boolean; attachments?: Att[] };
const pending = new Map<string, Prefill>();
export const setPrefill = (sessionId: string, p: Prefill): void => { pending.set(sessionId, p); };
export function takePrefill(sessionId: string): Prefill | undefined {
  const p = pending.get(sessionId);
  pending.delete(sessionId);
  return p;
}
