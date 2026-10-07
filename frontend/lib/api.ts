export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function request<T>(path: string, token: string | null, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API}${path}`, { method, signal, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(typeof data.detail === "string" ? data.detail : response.status === 422 ? "Vérifie les champs du formulaire." : "Une erreur est survenue.", response.status);
  }
  return response.status === 204 ? undefined as T : response.json();
}
export type User = { id: number; name: string; email: string };
export type Session = { access_token: string; user: User };
export type Workspace = { id: number; name: string; role: string };
export type Project = { id: number; workspace_id: number; name: string; description: string | null };
export type Member = User & { role: string };
export type Column = { id: number; name: string; position: number };
export type Task = { id: number; project_id: number; column_id: number; title: string; description: string | null; priority: string; due_date: string | null; assignee_id: number | null };
export type Board = { project: Project; columns: Column[]; tasks: Task[]; stats: { total: number; done: number; overdue: number } };
