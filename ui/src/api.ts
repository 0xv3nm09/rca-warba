// In Vite dev the /api prefix is proxied to :8000; the built bundle is served by the API itself.
export const API = import.meta.env.DEV ? "/api" : "";

export interface Evidence {
  source_system: string;
  record_id: string;
  record_version: number;
  span_start: number;
  span_end: number;
  quote: string;
  as_of: string;
  lang: string;
}

export interface Fact {
  fact_id: string;
  kind: string;
  text: string;
  amount_kwd: string | null;
  due_date: string | null;
  label: string;
  confidence: number;
  material: boolean;
  evidence: Evidence[];
  reasons: string[];
}

export interface Commitment {
  commitment_id: string;
  description: string;
  promised_by: string;
  promised_to: string | null;
  kind: string;
  due_date: string | null;
  owner: string | null;
  state: string;
  evidence: Evidence[];
}

export interface Entity {
  entity_id: string;
  legal_name_en: string | null;
  role: string | null;
  cr_number: string | null;
}

export interface ClientFile {
  group_id: string;
  group_name: string | null;
  as_of: string;
  entities: Entity[];
  facts: Fact[];
  commitments: Commitment[];
  open_conflicts: number;
}

export interface BoardItem {
  handover_id: string;
  group_id: string;
  from_rm: string;
  to_rm: string;
  status: string;
  effective_date: string;
  kind: string;
  blocking: string[];
  blocking_count: number;
  open_items: number;
  next_due: string | null;
}

export interface HandoverItem {
  item_id: string;
  kind: string;
  status: string;
  owner: string | null;
  due_date: string | null;
  question_text: string | null;
  why_asked: string | null;
  failure_point: string | null;
  answer_text: string | null;
  ref_id: string | null;
}

export interface HandoverDetail {
  handover_id: string;
  group_id: string;
  from_rm: string;
  to_rm: string;
  status: string;
  items: HandoverItem[];
}

export interface AskResult {
  answer: string;
  label: string;
  confidence: number;
  citations: Evidence[];
  reasons: string[];
}

let token: string | null = localStorage.getItem("rca_token");
export let currentUser: string = localStorage.getItem("rca_user") || "";
export let currentGroup: string | null = localStorage.getItem("rca_group");

export function setAuth(t: string, user: string, group: string | null) {
  token = t;
  currentUser = user;
  currentGroup = group;
  localStorage.setItem("rca_token", t);
  localStorage.setItem("rca_user", user);
  if (group) localStorage.setItem("rca_group", group);
}

export function clearAuth() {
  token = null;
  localStorage.removeItem("rca_token");
  localStorage.removeItem("rca_user");
  localStorage.removeItem("rca_group");
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw { status: res.status, ...data };
  return data as T;
}

export const api = {
  login: (user: string, group: string | null) =>
    call<{ session_token: string }>("POST", "/auth/dev-login", { user, group }),
  board: () => call<{ transfers: BoardItem[] }>("GET", "/handovers"),
  file: (groupId: string) => call<ClientFile>("GET", `/groups/${groupId}/file`),
  ask: (groupId: string, question: string) =>
    call<AskResult>("POST", `/groups/${groupId}/ask`, { question, lang: "en" }),
  handover: (id: string) => call<HandoverDetail>("GET", `/handovers/${id}`),
  questions: (id: string) =>
    call<{ questions: { question_id: string; text: string; why_asked: string; failure_point: string }[] }>(
      "GET",
      `/handovers/${id}/questions`
    ),
  answerQuestion: (hid: string, question_id: string, answer: string, confidence_note?: string) =>
    call("POST", `/handovers/${hid}/answers`, { question_id, answer, confidence_note }),
  accept: (hid: string, accepted: string[], returned: string[], note?: string) =>
    call("POST", `/handovers/${hid}/accept`, {
      accepted_item_ids: accepted,
      returned_item_ids: returned,
      note,
    }),
  assign: (hid: string, itemId: string, owner: string, due_date?: string) =>
    call("POST", `/handovers/${hid}/exceptions/${itemId}/assign`, { owner, due_date }),
  close: (hid: string) => call<{ closed: boolean }>("POST", `/handovers/${hid}/close`),
  auditVerify: () => call<{ chain_valid: boolean }>("GET", "/admin/audit/verify"),
};
