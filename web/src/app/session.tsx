import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '@/api'
import { AUTH_EVENT } from '@/api/http'
import type { Entity, Me, RoleKey, SyncState, User } from '@/lib/types'

export interface Session {
  user: User
  firm: Me['firm']
  entities: Entity[]
  entity: Entity
  /** Role and approval limit on the current entity. */
  role: RoleKey | null
  approvalLimit: number
  readOnly: boolean
  isAdmin: boolean
  firmWide: boolean
  /** People who can act on the current entity (for owner pickers, avatars). */
  users: User[]
  /** Data-source freshness for the top bar. */
  sync: SyncState[]
  scope: 'entity' | 'firm'
  setEntityId: (id: string) => void
  setScope: (s: 'entity' | 'firm') => void
  /** Reporting period label, e.g. 'Oct 2026'. shortcut: display-only until lists filter by it. */
  period: string
  setPeriod: (p: string) => void
  signOut: () => Promise<void>
  refresh: () => void
}

const Ctx = createContext<Session | null>(null)
const load = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const save = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* not remembered */ } }
const periodLabel = (d: Date) => d.toLocaleString('en-IN', { month: 'short', year: 'numeric' })

/** Boots from /api/auth/me. Children render only when signed in; `onUnauthenticated` is told why (unauthenticated | mfa_required | mfa_enrol). */
export function SessionProvider({ children, fallback, onUnauthenticated }: { children: ReactNode; fallback: ReactNode; onUnauthenticated: (why: string) => void }) {
  const qc = useQueryClient()
  const meQ = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false, staleTime: 5 * 60_000 })
  const [entityId, setEntityIdState] = useState(() => load('pv-entity', ''))
  const [scope, setScope] = useState<'entity' | 'firm'>('entity')
  const [period, setPeriod] = useState(() => periodLabel(new Date()))
  useEffect(() => { if (entityId) save('pv-entity', entityId) }, [entityId])
  useEffect(() => {
    const on = (e: Event) => onUnauthenticated((e as CustomEvent).detail)
    window.addEventListener(AUTH_EVENT, on)
    return () => window.removeEventListener(AUTH_EVENT, on)
  }, [onUnauthenticated])
  useEffect(() => { if (meQ.error) onUnauthenticated((meQ.error as Error).message.includes('sign in') ? 'unauthenticated' : 'unauthenticated') }, [meQ.error, onUnauthenticated])

  const me = meQ.data
  const entity = useMemo(() => me ? (me.entities.find(e => e.id === entityId) ?? me.entities[0]) : undefined, [me, entityId])
  const usersQ = useQuery({ queryKey: ['users', entity?.id], queryFn: () => api.listUsers(entity!.id), enabled: !!entity })
  const sourcesQ = useQuery({ queryKey: ['sources', entity?.id], queryFn: () => api.getSources(entity!.id), enabled: !!entity, refetchInterval: 30_000 })
  const signOut = useCallback(async () => { await api.logout().catch(() => undefined); qc.clear(); onUnauthenticated('unauthenticated') }, [qc, onUnauthenticated])
  const refresh = useCallback(() => { qc.invalidateQueries({ queryKey: ['me'] }) }, [qc])

  const value = useMemo<Session | null>(() => {
    if (!me) return null
    const ent = entity ?? { id: '', name: 'No client yet', shortName: 'No client', city: '', pan: '', gstins: [], sapCompanyCode: '', risk: 'Low', riskScore: 0, intakeEmail: '', whatsapp: '' } as Entity
    const access = me.access[ent.id]
    return {
      user: me.user, firm: me.firm, entities: me.entities, entity: ent, role: (access?.role ?? null) as RoleKey | null, approvalLimit: access?.approvalLimit ?? 0,
      readOnly: access?.role === 'auditor', isAdmin: me.user.isAdmin ?? false, firmWide: me.firmWide,
      users: usersQ.data ?? [me.user], sync: sourcesQ.data ?? [], scope,
      setEntityId: id => { setEntityIdState(id); setScope('entity') }, setScope, period, setPeriod, signOut, refresh,
    }
  }, [me, entity, usersQ.data, sourcesQ.data, scope, period, signOut, refresh])

  if (!value) return <>{fallback}</>
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): Session {
  const s = useContext(Ctx)
  if (!s) throw new Error('useSession outside SessionProvider')
  return s
}
