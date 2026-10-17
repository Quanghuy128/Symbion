/**
 * agentsPanelSession — browser-only (sessionStorage) memory of which Agents
 * panel view was open for a run, so F5 mid-run restores it (AC-6, plan
 * §10.5). Never touches disk; failures (privacy mode, quota) are ignored.
 */
export interface AgentsPanelSession {
  view: "tree" | "agent";
  agentId?: string;
}

export function agentsPanelSessionKey(runId: string): string {
  return `symbion:agentsPanel:${runId}`;
}

export function readAgentsPanelSession(runId: string | null): AgentsPanelSession | null {
  if (!runId) return null;
  try {
    const raw = window.sessionStorage.getItem(agentsPanelSessionKey(runId));
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== "object" || v === null) return null;
    const o = v as Record<string, unknown>;
    if (o["view"] === "agent" && typeof o["agentId"] === "string") return { view: "agent", agentId: o["agentId"] };
    if (o["view"] === "tree") return { view: "tree" };
    return null;
  } catch {
    return null;
  }
}

export function writeAgentsPanelSession(runId: string | null, s: AgentsPanelSession): void {
  if (!runId) return;
  try {
    window.sessionStorage.setItem(agentsPanelSessionKey(runId), JSON.stringify(s));
  } catch {
    /* best-effort */
  }
}
