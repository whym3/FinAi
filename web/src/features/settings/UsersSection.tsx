import { useState } from 'react'
import { Copy, Plus, RefreshCw, ShieldOff, UserX } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Avatar, Banner, Card, CardHeader, StatusPill } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useAllUsers } from '@/api/hooks'
import * as api from '@/api'
import type { Assignment } from '@/api'
import { dateTime, inr } from '@/lib/format'
import type { User } from '@/lib/types'
import { Field, NativeSelect } from './clients/parts'

const ROLES: [string, string][] = [['partner', 'Partner (all clients, signs off)'], ['manager', 'CA manager / staff (all clients)'], ['cfo', 'Client CFO'], ['controller', 'Finance controller'],
  ['ap', 'AP executive'], ['ar', 'AR executive'], ['gst', 'GST analyst'], ['procurement', 'Procurement'], ['stores', 'Stores / gate'], ['auditor', 'Auditor (read-only)']]

function AssignmentEditor({ rows, set }: { rows: Assignment[]; set: (r: Assignment[]) => void }) {
  const { entities } = useSession()
  const upd = (i: number, p: Partial<Assignment>) => set(rows.map((r, j) => (j === i ? { ...r, ...p } : r)))
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
          <Field label="Client"><NativeSelect label="Client" value={r.entity_id} onChange={v => upd(i, { entity_id: v })} options={entities.map(e => [e.id, e.shortName])} /></Field>
          <Field label="Role"><NativeSelect label="Role" value={r.role} onChange={v => upd(i, { role: v })} options={ROLES} /></Field>
          <Field label="Approves up to ₹" hint="0 = cannot approve"><Input type="number" min={0} step={100000} value={r.approval_limit} onChange={e => upd(i, { approval_limit: Number(e.target.value) })} className="w-[140px]" /></Field>
          <Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => set(rows.filter((_, j) => j !== i))}><UserX /></Button>
        </div>
      ))}
      <Button size="sm" className="self-start" onClick={() => set([...rows, { entity_id: entities[0]?.id ?? '', role: 'ap', approval_limit: 0 }])}><Plus />Add client access</Button>
    </div>
  )
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { act, pending } = useAct()
  const [f, setF] = useState({ email: '', name: '', title: '', is_admin: false })
  const [rows, setRows] = useState<Assignment[]>([])
  const [link, setLink] = useState<string | null>(null)
  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) setLink(null) }}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader><DialogTitle>Invite a user</DialogTitle><DialogDescription>They get a link to set a password and an authenticator. Roles are per client.</DialogDescription></DialogHeader>
        {link ? <Banner tone="ok" actions={<Button size="sm" onClick={() => { navigator.clipboard?.writeText(link); toast.success('Link copied') }}><Copy />Copy link</Button>}>Email is not set up on the server, so send this link yourself (valid 3 days):<br /><code className="text-[11px] break-all">{link}</code></Banner> : (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Work email"><Input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
              <Field label="Title" hint="Shown next to their name"><Input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="AP executive" /></Field>
              <label className="flex items-center gap-2 self-end pb-2 text-xs"><input type="checkbox" className="accent-[var(--primary)]" checked={f.is_admin} onChange={e => setF({ ...f, is_admin: e.target.checked })} />Firm admin (users, integrations, settings)</label>
            </div>
            <AssignmentEditor rows={rows} set={setRows} />
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{link ? 'Done' : 'Cancel'}</Button>
          {!link && <Button variant="default" disabled={pending || !f.email || f.name.length < 2} onClick={async () => {
            const r = await act(() => api.inviteUser({ ...f, assignments: rows }), r => r.link ? 'Invite created' : `Invite emailed to ${f.email}`)
            if (r) { if (r.link) setLink(r.link); else onOpenChange(false) }
          }}>Send invite</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditDialog({ u, onOpenChange }: { u: User | null; onOpenChange: (o: boolean) => void }) {
  const { act, pending } = useAct()
  const [rows, setRows] = useState<Assignment[]>(() => (u?.assignments ?? []).map(a => ({ entity_id: a.entityId, role: a.role, approval_limit: a.approvalLimit })))
  const [admin, setAdmin] = useState(u?.isAdmin ?? false)
  if (!u) return null
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader><DialogTitle>{u.name}</DialogTitle><DialogDescription>{u.email}</DialogDescription></DialogHeader>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-[var(--primary)]" checked={admin} onChange={e => setAdmin(e.target.checked)} />Firm admin</label>
        <AssignmentEditor rows={rows} set={setRows} />
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="default" disabled={pending} onClick={async () => { if (await act(() => api.updateUser(u.id, { is_admin: admin, assignments: rows }), 'Access saved')) onOpenChange(false) }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function UsersSection() {
  const { user: me, entities } = useSession()
  const q = useAllUsers()
  const { act } = useAct()
  const [invite, setInvite] = useState(false)
  const [edit, setEdit] = useState<User | null>(null)
  const name = (id: string) => entities.find(e => e.id === id)?.shortName ?? id
  return (
    <Card>
      <CardHeader title="Users & roles" as="h3"><Button size="sm" variant="default" onClick={() => setInvite(true)}><Plus />Invite user</Button></CardHeader>
      {(q.data ?? []).map(u => (
        <div key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 last:border-b-0">
          <Avatar id={u.id} />
          <div className="min-w-[200px] flex-1">
            <div className="text-xs font-medium">{u.name} {u.isAdmin && <span className="ml-1 rounded-sm bg-acc-weak px-1 text-[10px] text-acc">admin</span>}</div>
            <div className="text-[11px] text-text-3">{u.email}{u.title ? ` · ${u.title}` : ''}{u.lastLoginAt ? ` · last sign-in ${dateTime(u.lastLoginAt)}` : ''}</div>
            <div className="text-[11px] text-text-2">{(u.assignments ?? []).map(a => `${name(a.entityId)}: ${a.role}${a.approvalLimit ? ` (up to ${inr(a.approvalLimit)})` : ''}`).join(' · ') || (u.isAdmin ? 'All clients' : 'No client access')}</div>
          </div>
          <StatusPill tone={u.status === 'active' ? 'ok' : u.status === 'invited' ? 'warn' : 'none'} plain>{u.status === 'active' ? 'Active' : u.status === 'invited' ? 'Invited' : 'Disabled'}</StatusPill>
          <div className="flex gap-1">
            <Button size="sm" onClick={() => setEdit(u)}>Access</Button>
            {u.status === 'invited' && <Button size="sm" onClick={async () => { const r = await act(() => api.reinviteUser(u.id), r => r.link ? 'Invite link ready' : 'Invite re-sent'); if (r?.link) { navigator.clipboard?.writeText(r.link); toast.info('Invite link copied') } }}><RefreshCw />Re-invite</Button>}
            {u.status === 'active' && u.id !== me.id && <Button size="sm" variant="ghost" onClick={() => act(() => api.resetUserMfa(u.id), 'Authenticator reset · they enrol again at next sign-in')}><ShieldOff />Reset MFA</Button>}
            {u.id !== me.id && (u.status === 'disabled'
              ? <Button size="sm" onClick={() => act(() => api.updateUser(u.id, { status: 'active' }), 'Account enabled')}>Enable</Button>
              : u.status === 'active' && <Button size="sm" variant="ghost" onClick={() => act(() => api.updateUser(u.id, { status: 'disabled' }), 'Account disabled')}><UserX />Disable</Button>)}
          </div>
        </div>
      ))}
      <InviteDialog open={invite} onOpenChange={setInvite} />
      {edit && <EditDialog key={edit.id} u={edit} onOpenChange={() => setEdit(null)} />}
    </Card>
  )
}
