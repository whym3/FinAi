// Fetch wrapper for the FastAPI server (proxied at /api by Vite and nginx).
export class ApiError extends Error {}

let userId = 'RK'
/** shortcut: the server trusts this header (dev auth) until SSO lands. Set by SessionProvider on every user switch. */
export const setApiUser = (id: string) => { userId = id }
export const apiUser = () => userId

export async function http<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  let r: Response
  try {
    r = await fetch('/api' + path, {
      ...rest,
      headers: { 'X-User-Id': userId, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
  } catch {
    throw new ApiError('The Pravah server is not reachable. Start it with `docker compose up`.')
  }
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    const d = body?.detail
    throw new ApiError(typeof d === 'string' ? d : Array.isArray(d) ? d.map((x: { msg: string; loc: string[] }) => `${x.loc.at(-1)}: ${x.msg}`).join('; ') : `Server error ${r.status}`)
  }
  return r.status === 204 ? (undefined as T) : r.json()
}
