import { useQueryClient } from '@tanstack/react-query'
import { Moon, RotateCcw, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, Card, CardBody, CardHeader, Chk, KV, PageHeader, Prio, Segmented } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useTheme } from '@/app/theme'
import { useAct, useRules } from '@/mock/hooks'
import * as api from '@/mock/api'
import { inr } from '@/lib/format'
import { toast } from 'sonner'

export default function SettingsPage() {
  const { user, users, entity, setUserId, readOnly } = useSession()
  const { theme, setTheme } = useTheme()
  const rules = useRules().data ?? []
  const { act } = useAct()
  const qc = useQueryClient()
  return (
    <>
      <PageHeader title="Settings" sub={`${entity.name} · signed in as ${user.name}`} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(400px,1fr))] items-start gap-4">
        <Card>
          <CardHeader title="Appearance" as="h3" />
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-center justify-between"><span className="text-xs">Theme</span><Segmented label="Theme" value={theme} onChange={setTheme} options={[{ value: 'light', label: 'Light', icon: <Sun className="size-3.5" /> }, { value: 'dark', label: 'Dark', icon: <Moon className="size-3.5" /> }]} /></div>
            <div className="flex items-center justify-between"><span className="text-xs">Saved table columns and filters</span><Button size="sm" onClick={() => { try { Object.keys(localStorage).filter(k => k.startsWith('pv-cols-') || k === 'pv-overview-hidden').forEach(k => localStorage.removeItem(k)) } catch { /* storage unavailable */ } toast.success('Table layouts reset · reload to apply') }}>Reset</Button></div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="People and approval limits" as="h3"><span className="text-[11px] text-text-3">Act as anyone for the demo</span></CardHeader>
          {users.map(u => (
            <label key={u.id} className="flex cursor-pointer items-center gap-2.5 border-b border-border px-4 py-2 last:border-b-0 hover:bg-surface-2">
              <input type="radio" name="actas" checked={u.id === user.id} onChange={() => setUserId(u.id)} className="accent-[var(--primary)]" />
              <Avatar id={u.id} /><span className="flex-1 text-xs"><span className="font-medium">{u.name}</span> · {u.title}</span>
              <span className="text-[11px] text-text-2 tabular-nums">{u.approvalLimit >= 1e11 ? 'No limit' : u.approvalLimit ? inr(u.approvalLimit) : u.role === 'auditor' ? 'Read-only' : 'Cannot approve'}</span>
            </label>
          ))}
        </Card>
        <Card>
          <CardHeader title="Exception rules" as="h3" />
          {rules.map(r => (
            <label key={r.id} className="flex items-center gap-2.5 border-b border-border px-4 py-2 last:border-b-0">
              <Chk checked={r.enabled} disabled={readOnly} onChange={() => act(() => api.toggleRule(r.id, user.id), `${r.name} ${r.enabled ? 'off' : 'on'}`)} />
              <span className="flex-1 text-xs"><span className="font-medium">{r.name}</span> <span className="text-text-3">· SLA {r.slaDays} d</span></span><Prio p={r.priority} />
            </label>
          ))}
        </Card>
        <Card>
          <CardHeader title="Entity" as="h3" />
          <CardBody className="flex flex-col gap-3">
            <KV items={[['Legal name', entity.name], ['PAN', <span className="font-mono">{entity.pan}</span>], ['GSTINs', entity.gstins.map(g => g.gstin).join(', ')], ['SAP company code', entity.sapCompanyCode], ['Intake email', <span className="font-mono text-[11px]">{entity.intakeEmail}</span>], ['WhatsApp', entity.whatsapp]]} />
            <Button size="sm" className="self-start" onClick={async () => { await api.resetDemo(); qc.invalidateQueries(); toast.success('Demo data reset') }}><RotateCcw />Reset demo data</Button>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
