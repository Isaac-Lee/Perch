// Wire shapes used by Perch, written by hand from hermes-agent
// apps/shared/src/gateway-contract.generated.ts (MIT). Only the fields we read.
export interface GatewayEvent { type: string; payload?: any; session_id?: string; seq?: number; execution_generation?: number }

/** Result of session.create / session.resume (fields we use). */
export interface SessionSnapshot {
  session_id: string; stored_session_id?: string; running?: boolean; execution_generation?: number; revision?: number;
  messages?: any[]; prompts?: any[]; info?: { model?: string; reasoning_effort?: string };
}
