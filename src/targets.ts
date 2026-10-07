/** Exact provider/model selection; pure and safe for concurrent calls, never throws. */
export function isTarget(providerId: string, modelId: string): boolean {
  return providerId === "github-copilot" && (modelId === "gpt-6.1-sol" || modelId === "gpt-6-luna")
}
