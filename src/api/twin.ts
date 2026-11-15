/** Twin Backend v0.1. All calls use an authenticated same-origin gateway. */
export type Dilemma = {
  id: string;
  /** The situation, in the person's terms. Named `text` by the service; this said `question`,
   *  which typechecked against nothing and would have rendered as blank. */
  text: string;
  options: { id: string; label: string }[];
};
export type RegistrationForm = {
  copy: Record<string, string>;
  field_suggestions: string[];
  years_bands: string[];
  age_bands: string[];
  dilemmas: Dilemma[];
};
export type RegistrationDraft = {
  display_name: string;
  about: string;
  years_in_field?: string;
  age_band?: string;
  background?: string;
  dilemmas: Record<string, string>;
  current_thing?: string;
  quiet_text?: string;
  timezone: string;
};
export type TwinIdentity = {
  nostr_pubkey: string;
  npub: string;
  eth_address: string;
  chain_id: number | null;
  key_custody: string;
  wallet_state: string;
};
export type Stage = {
  level: number;
  name: string;
  can_assert: boolean;
  says: string;
  next_step?: string;
};
export type Retelling = {
  heard: string;
  roles: { id: string; label: string; stance: string; loud_when: string }[];
  promise: string;
};
export type TwinCreated = {
  twin_id: string;
  identity: TwinIdentity;
  ontology_version: number;
  stage: Stage;
  review_at: string;
  retelling: Retelling;
  quiet_understood: string;
  quiet_hours: { from: string; to: string; days: number[] }[];
};
export type MaterialAsk = {
  ask_id: string;
  question: string;
  why: string;
  options: { id: string; label: string }[];
};
export type TickResult = {
  twin_id: string;
  spoke: unknown | null;
  reason?: string;
  stage: Stage;
  material_ask?: MaterialAsk;
};
/** One entry in the thread. The thread is built from the ledger, never from a display copy. */
export type ThreadMessage =
  | { kind: "said_by_user"; at: string; text: string }
  /** A reply with nothing sealed behind it: there was no claim to make, or it was handed
   *  something it cannot open. Not a judgment, so it carries no stake, date or seal. */
  | {
      kind: "replied_by_twin";
      at: string;
      text: string;
      why_not: "acknowledgement" | "path" | "link";
    }
  | {
      kind: "said_by_twin";
      at: string;
      text: string;
      judgment_id: string;
      tone: string;
      confidence: number;
      confidence_state: string;
      due_at: string | null;
      seal_hash: string;
      settlement: { outcome: string; correct: boolean; at: string } | null;
    }
  | {
      kind: "asked_by_twin";
      at: string;
      ask_id: string;
      text: string;
      why: string;
      options: string[];
      answer: string | null;
      answered_at: string | null;
      actions: { id: string; label: string }[] | null;
    };
/** What it worked out during your quiet hours and could not say then. */
export type WhileAway = {
  count: number;
  /** The whole lead sentence, already written by the service. */
  lead: string;
  judgment_id: string;
  conclusion: string;
  confidence: number;
};
export type Thread = {
  twin_id: string;
  messages: ThreadMessage[];
  while_you_were_away: WhileAway | null;
  /** Judgments it made today and chose not to say. The silence is part of the record. */
  held_today: number;
  stage: Stage;
};
export type DomainRecord = {
  domain: string;
  judged: number;
  settled: number;
  correct: number;
  hit_rate: number | null;
  /** Of the ones it actually said out loud. Scoring only these is what rewards staying quiet. */
  spoke: { settled: number; correct: number; hit_rate: number | null };
  /** The counterweight: judgments it swallowed, and how many were right anyway. */
  held_back: { count: number; right_anyway: number; note: string };
  ece: number | null;
  calibration_state: "provisional" | "calibrated";
  curve: { raw: number; calibrated: number }[];
  qualified_to_advise: boolean;
  threshold: { min_settled: number; max_ece: number };
};
export type TwinRecord = {
  twin_id: string;
  stage: Stage;
  domains: DomainRecord[];
  /** Must be 0. Anything else means it let a commitment come due in silence. */
  overdue_unsettled: number;
};
export class TwinRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function twinClient({
  getToken,
  base = "/api/twin",
  fetcher = fetch,
}: {
  getToken: () => Promise<string | null>;
  base?: string;
  fetcher?: typeof fetch;
}) {
  if (!base.startsWith("/") || base.startsWith("//"))
    throw new Error("Twin gateway must be same-origin");
  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const token = await getToken();
    if (!token) throw new TwinRequestError("Sign in to continue", 401);
    const response = await fetcher(`${base}${path}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw new TwinRequestError(
        response.status === 501
          ? "Service offline"
          : response.status === 401
            ? "Session expired. Sign in again."
            : "Unable to finish. Keep your draft and try again.",
        response.status,
      );
    const type = response.headers.get("content-type") || "";
    if (!type.includes("application/json"))
      throw new TwinRequestError("Unexpected response from the service", 502);
    return response.json() as Promise<T>;
  }
  return {
    registrationForm: (signal?: AbortSignal) =>
      request<RegistrationForm>(
        "/v1/registration/form",
        "GET",
        undefined,
        signal,
      ),
    create: (draft: RegistrationDraft, signal?: AbortSignal) =>
      request<TwinCreated>("/v1/twins", "POST", draft, signal),
    get: (id: string, signal?: AbortSignal) =>
      request<{
        twin_id: string;
        identity: TwinIdentity;
        stage: Stage;
        ontology_review: { due: boolean; at: string };
        daily_speak_cap: number;
      }>(`/v1/twins/${encodeURIComponent(id)}`, "GET", undefined, signal),
    tick: (id: string, signal?: AbortSignal) =>
      request<TickResult>(
        `/v1/twins/${encodeURIComponent(id)}/tick`,
        "POST",
        {},
        signal,
      ),
    tell: (id: string, text: string, signal?: AbortSignal) =>
      request<{
        twin_id: string;
        reply: string;
        heard: string;
        ontology_version: number;
        rewrote_ontology: boolean;
      }>(`/v1/twins/${encodeURIComponent(id)}/tell`, "POST", { text }, signal),
    /** The conversation screen. Everything the twin wants is an ask, and asks live here. */
    messages: (id: string, signal?: AbortSignal) =>
      request<Thread>(
        `/v1/twins/${encodeURIComponent(id)}/messages`,
        "GET",
        undefined,
        signal,
      ),
    /** The single way to answer anything the twin asked, whatever kind of ask it was. */
    answerAsk: (askId: string, answer: string, signal?: AbortSignal) =>
      request<{ ask_id: string; accepted: boolean; effect: string | null }>(
        `/v1/asks/${encodeURIComponent(askId)}/answer`,
        "POST",
        { answer },
        signal,
      ),
    /** The track-record screen: settled counts, calibration, and what it held back. */
    record: (id: string, signal?: AbortSignal) =>
      request<TwinRecord>(
        `/v1/twins/${encodeURIComponent(id)}/record`,
        "GET",
        undefined,
        signal,
      ),
    /** An observer reporting a situation it saw. Not a message from the person. */
    observe: (
      input: { twin_id: string; state_text: string; features?: Record<string, unknown> },
      signal?: AbortSignal,
    ) => request<unknown>("/v1/contexts", "POST", input, signal),
  };
}
