// Fetch wrapper for the FastAPI server (same origin: Vite proxy in dev, nginx in production).
// Auth is a session cookie; every mutating call carries X-Pravah so cross-site forms cannot forge it.
export class ApiError extends Error {
  status: number
  constructor(message: string, status = 0) { super(message); this.status = status }
}

/** Fired on 401 so the session provider can send the person to /login. */
export const AUTH_EVENT = 'pv-auth'

export async function http<T>(path: string, init: RequestInit & { json?: unknown; form?: FormData } = {}): Promise<T> {
  const { json, form, ...rest } = init
  let r: Response
  try {
    r = await fetch('/api' + path, {
      ...rest,
      credentials: 'same-origin',
      headers: { 'X-Pravah': '1', ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : form ?? rest.body,
    })
  } catch {
    throw new ApiError('The Pravah server is not reachable.', 0)
  }
  if (r.status === 401) {
    const body = await r.json().catch(() => ({}))
    window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: body?.detail ?? 'unauthenticated' }))
    throw new ApiError('Please sign in again.', 401)
  }
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    const d = body?.detail
    throw new ApiError(typeof d === 'string' ? d : Array.isArray(d) ? d.map((x: { msg: string; loc: string[] }) => `${x.loc.at(-1)}: ${x.msg}`).join('; ') : `Server error ${r.status}`, r.status)
  }
  if (r.status === 204) return undefined as T
  return r.json()
}

export const q = (o: Record<string, string | number | boolean | undefined | null>) =>
  '?' + Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
