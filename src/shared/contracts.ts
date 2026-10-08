/**
 * Shared contracts between client, server, and (later) the Arch settlement layer.
 * One definition, imported everywhere — never duplicated with drift. The client
 * submits an INPUT STREAM, never a trusted score; the server derives the score.
 */
export type FraudCode =
  | "VERSION_MISMATCH"
  | "SCORE_MISMATCH"
  | "IMPOSSIBLE_TIMING"
  | "IMPOSSIBLE_SPEED"
  | "SUSPICIOUS_INPUT"
  | "INVALID_REPLAY";

export type FraudFlag = { code: FraudCode; detail: string };

/** What a client sends after a run. Untrusted — treat every field as hostile. */
export type RunSubmission = {
  seed: number;
  gameVersion: string;        // must equal the server's canonical RULESET
  scoringVersion?: number;
  inputs: Array<{ tick: number; action: string }>;
  clientScore?: number;       // for cross-check only; never authoritative
  player?: string;            // wallet / account id (opaque here)
  competitionId?: string;
};

export type RunStats = {
  distance: number; collected: number; perfects: number;
  blockRuns: number; flips: number; elapsed: number;
};

/** The server's verdict. `officialScore` is the only score that counts. */
export type ValidationResult = {
  accepted: boolean;
  officialScore: number;
  stats: RunStats;
  flags: FraudFlag[];
};
