import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as api from '@/mock/api'
import type { Entity, Firm, SyncState, User, ExceptionRule } from '@/lib/types'

export interface Session {
  user: User
  entity: Entity
  firm: Firm
  users: User[]
  entities: Entity[]
  sync: SyncState[]
  rules: ExceptionRule[]
  /** 'firm' = the CA firm's all-clients view on Overview. */
  scope: 'entity' | 'firm'
  setUserId: (id: string) => void
  setEntityId: (id: string) => void
  setScope: (s: 'entity' | 'firm') => void
  /** Reporting period label, e.g. 'Oct 2026'. shortcut: the mock serves one period; the label is display-only until the backend filters by it. */
  period: string
  setPeriod: (p: string) => void
  readOnly: boolean
}

const Ctx = createContext<Session | null>(null)

const load = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const save = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* not remembered */ } }

export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const boot = useQuery({ queryKey: ['bootstrap'], queryFn: api.getBootstrap })
  const [userId, setUserId] = useState(() => load('pv-user', 'RK'))
  const [entityId, setEntityId] = useState(() => load('pv-entity', 'meridian'))
  const [scope, setScope] = useState<'entity' | 'firm'>('entity')
  const [period, setPeriod] = useState('Oct 2026')
  useEffect(() => save('pv-user', userId), [userId])
  useEffect(() => save('pv-entity', entityId), [entityId])

  const value = useMemo<Session | null>(() => {
    if (!boot.data) return null
    const { users, entities, firm, sync, rules } = boot.data
    const user = users.find(u => u.id === userId) ?? users[0]
    const entity = entities.find(e => e.id === entityId) ?? entities[0]
    return {
      user, entity, firm, users: users.filter(u => u.id !== 'PV'), entities, sync, rules, scope,
      setUserId, setEntityId: id => { setEntityId(id); setScope('entity') }, setScope, period, setPeriod,
      readOnly: user.role === 'auditor',
    }
  }, [boot.data, userId, entityId, scope, period])

  if (!value) return <>{fallback}</>
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): Session {
  const s = useContext(Ctx)
  if (!s) throw new Error('useSession outside SessionProvider')
  return s
}
