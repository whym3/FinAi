import { Link, useNavigate, useParams } from 'react-router'
import { Building2, Moon, Plus, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, Chk, KV, LineTabs, PageHeader, Prio, Segmented, StatusPill } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useTheme } from '@/app/theme'
import { useAct, useRules } from '@/api/hooks'
import * as api from '@/api'
import { toast } from 'sonner'
import { UsersSection } from './UsersSection'
import { IntegrationsSection } from './IntegrationsSection'
import { AccountSection } from './AccountSection'

const SECTIONS = [['clients', 'Clients'], ['users', 'Users & roles'], ['integrations', 'Integrations'], ['rules', 'Exception rules'], ['firm', 'Firm'], ['account', 'My account'], ['appearance', 'Appearance']] as const
type Section = (typeof SECTIONS)[number][0]

export default function SettingsPage() {
  const { section = 'clients' } = useParams()
  const nav = useNavigate()
  const { user, firm, isAdmin, firmWide } = useSession()
  const canAdmin = isAdmin || firmWide
  const visible = SECTIONS.filter(([k]) => canAdmin || !['users', 'firm'].includes(k))
  const cur = (visible.some(([k]) => k === section) ? section : 'clients') as Section
  return (
    <>
      <PageHeader title="Settings" sub={`${firm.name} · signed in as ${user.name}`} />
      <LineTabs label="Settings sections" value={cur} onChange={v => nav(v === 'clients' ? '/settings' : `/settings/${v}`)} items={visible.map(([k, l]) => ({ value: k as Section, label: l }))} />
      {cur === 'clients' && <ClientsSection />}
      {cur === 'users' && <UsersSection />}
      {cur === 'integrations' && <IntegrationsSection />}
      {cur === 'rules' && <RulesSection />}
      {cur === 'firm' && <FirmSection />}
      {cur === 'account' && <AccountSection />}
      {cur === 'appearance' && <AppearanceSection />}
    </>
  )
}

function ClientsSection() {
  const { entities, isAdmin, firmWide } = useSession()
  return (
    <Card>
      <CardHeader title="Clients" as="h3">
        {(isAdmin || firmWide) && <Button size="sm" variant="default" asChild><Link to="/settings/clients/new"><Plus />Onboard client</Link></Button>}
      </CardHeader>
      {entities.length === 0 && <div className="px-4 py-6 text-center text-xs text-text-3">No clients yet. Onboard the first one: company details, GST registrations, then the invoice mailbox.</div>}
      {entities.map(e => (
        <Link key={e.id} to={`/settings/clients/${e.id}`} className="flex items-center gap-2.5 border-b border-border px-4 py-2.5 last:border-b-0 hover:bg-surface-2">
          <Building2 className="size-4 text-text-3" />
          <span className="min-w-0 flex-1 text-xs"><span className="font-medium">{e.name}</span> <span className="text-text-3">· {e.city || e.pan} · {e.gstins.length} GSTIN{e.gstins.length === 1 ? '' : 's'}</span>
            <span className="block truncate text-[11px] text-text-3">{e.intakeEmail ? `Mailbox ${e.intakeEmail}` : 'No mailbox connected'}</span></span>
          {e.status === 'onboarding' ? <StatusPill tone="warn" plain>Onboarding</StatusPill> : <StatusPill tone="ok" plain>Active</StatusPill>}
        </Link>
      ))}
    </Card>
  )
}

function RulesSection() {
  const { isAdmin, firmWide } = useSession()
  const rules = useRules().data ?? []
  const { act } = useAct()
  return (
    <Card>
      <CardHeader title="Exception rules" as="h3"><span className="text-[11px] text-text-3">What the three-way match raises, and who gets it</span></CardHeader>
      {rules.map(r => (
        <label key={r.id} className="flex items-center gap-2.5 border-b border-border px-4 py-2 last:border-b-0">
          <Chk checked={r.enabled} disabled={!(isAdmin || firmWide)} onChange={() => act(() => api.toggleRule(r), `${r.name} ${r.enabled ? 'off' : 'on'}`)} />
          <span className="flex-1 text-xs"><span className="font-medium">{r.name}</span> <span className="text-text-3">· {r.description} · SLA {r.slaDays} d · to {r.defaultRole}</span></span><Prio p={r.priority} />
        </label>
      ))}
    </Card>
  )
}

function FirmSection() {
  const { firm, entities } = useSession()
  return (
    <Card>
      <CardHeader title="Firm" as="h3" />
      <CardBody><KV items={[['Name', firm.name], ['Short name', firm.short], ['FRN', firm.frn || '—'], ['Clients', String(entities.length)]]} /></CardBody>
    </Card>
  )
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  return (
    <Card>
      <CardHeader title="Appearance" as="h3" />
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center justify-between"><span className="text-xs">Theme</span><Segmented label="Theme" value={theme} onChange={setTheme} options={[{ value: 'light', label: 'Light', icon: <Sun className="size-3.5" /> }, { value: 'dark', label: 'Dark', icon: <Moon className="size-3.5" /> }]} /></div>
        <div className="flex items-center justify-between"><span className="text-xs">Saved table columns and filters</span><Button size="sm" onClick={() => { try { Object.keys(localStorage).filter(k => k.startsWith('pv-cols-') || k === 'pv-overview-hidden').forEach(k => localStorage.removeItem(k)) } catch { /* storage unavailable */ } toast.success('Table layouts reset · reload to apply') }}>Reset</Button></div>
      </CardBody>
    </Card>
  )
}
