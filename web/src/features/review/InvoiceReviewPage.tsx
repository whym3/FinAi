import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Eye, Flag, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import {
  Avatar, Banner, Bar, Card, CardBody, CardHeader, Chip, Chk, CompareCell, DocumentDrawer, FindingsTable, Gstin, KV, MsmeBadge, OptionCard, PageHeader, Pill, Q, Restricted, Source, StatusPill,
  OkIcon, WarnIcon, BadIcon, NoneIcon, VerdictList, placeholderPaper,
} from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useIntake, useInvoice, useInvoices, useVendors } from '@/api/hooks'
import * as api from '@/api'
import { VERIFICATION_LABEL, verdictStatus, verificationStatus } from '@/lib/evidence'
import { date, dateTime, daysFromNow, inr } from '@/lib/format'
import type { DecisionKind, EvidenceDoc, Invoice, VerdictAction } from '@/lib/types'
import { cn } from '@/lib/utils'
import { invoiceStatus } from './ReviewQueuePage'

export const REASONS: [string, string][] = [
  ['RT-01', 'Rate above agreed price'], ['FR-02', 'Freight not agreed'], ['HS-03', 'Classification differs'], ['PT-04', 'Payment terms differ'],
  ['GR-05', 'Goods receipt missing'], ['IR-06', 'IRN missing'], ['QT-07', 'Quantity differs'], ['OK-00', 'Matched, no exception'],
]
const OPTS: [DecisionKind, string, string][] = [
  ['approve', 'Approve', 'Post at invoice values'],
  ['note', 'Approve with note', 'Post and record why differences are accepted'],
  ['hold', 'Hold', 'Keep unposted; payment blocked'],
  ['reject', 'Reject', 'Return to vendor; invoice not posted'],
  ['dn', 'Raise debit note', 'Post invoice and recover the differences'],
]
const KIND_LABEL: Record<DecisionKind, string> = { approve: 'Approved', note: 'Approved with note', hold: 'Put on hold', reject: 'Rejected', dn: 'Debit note raised and approved' }

export default function InvoiceReviewPage() {
  const { invoiceId = '' } = useParams()
  const q = useInvoice(invoiceId)
  return <Q q={q}>{inv => <Review key={inv.id + (inv.decision?.at ?? '')} inv={inv} />}</Q>
}

function Review({ inv }: { inv: Invoice }) {
  const { user, users, readOnly, approvalLimit } = useSession()
  const vendor = useVendors().data?.find(v => v.id === inv.vendorId)
  const queue = (useInvoices().data ?? []).filter(i => i.status === 'needs-decision' || i.id === inv.id)
  const intake = useIntake().data?.find(d => d.id === inv.intakeId)
  const nav = useNavigate()
  const { act, pending } = useAct()
  const [onlyDiff, setOnlyDiff] = useState(false)
  const [docOpen, setDocOpen] = useState<number | null>(null)

  const dnTotal = inv.dnLines.reduce((s, l) => s + l.taxable + l.gst, 0)
  const defaultKind: DecisionKind = inv.draft?.kind ?? (inv.flags.length === 0 ? 'approve' : inv.dnLines.length ? 'dn' : 'hold')
  const [kind, setKind] = useState<DecisionKind>(defaultKind)
  const defaultReasons = (k: DecisionKind) => inv.draft?.kind === k ? inv.draft.reasons : k === 'approve' && !inv.flags.length ? ['OK-00'] : k === 'dn' ? inv.flags.filter(f => f.amount > 0).map(f => f.reason) : []
  const [reasons, setReasons] = useState<string[]>(() => defaultReasons(defaultKind))
  const [note, setNote] = useState(inv.draft?.note ?? '')
  const noteRequired = kind === 'note' || kind === 'hold' || kind === 'reject'
  const overLimit = (kind === 'approve' || kind === 'note' || kind === 'dn') && inv.total > approvalLimit
  const canDecide = !readOnly && approvalLimit > 0 && inv.status === 'needs-decision'
  const valid = reasons.length > 0 && (!noteRequired || note.trim().length > 0) && (kind !== 'dn' || inv.dnLines.length > 0)
  const pos = queue.findIndex(i => i.id === inv.id)
  const next = queue.filter(i => i.id !== inv.id && i.status === 'needs-decision')[0]

  const submitLabel = { approve: 'Approve invoice', note: 'Approve with note', hold: 'Put on hold', reject: 'Reject invoice', dn: `Raise debit note ${inr(dnTotal)} and approve` }[kind]
  const submit = async () => {
    if (!valid || pending) return
    const r = await act(() => api.submitDecision(inv.id, kind, reasons, note), r => r.decision?.secondApproverNeeded ? `Decision saved · sent to a second approver` : `${inv.invoiceNo}: ${KIND_LABEL[kind].toLowerCase()}`)
    if (r && next) nav('/review/' + next.id)
  }
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canDecide) { e.preventDefault(); submit() } }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  const rows = onlyDiff ? inv.rows.filter(r => r.cells.some(c => c.s === 'bad' || c.s === 'warn' || c.s === 'none')) : inv.rows
  const docs = useMemo<EvidenceDoc[]>(() => {
    const p = intake?.paper
    return [{ id: 'inv', title: inv.docTitle, number: inv.invoiceNo, date: date(inv.date), source: inv.channel === 'SAP' ? 'SAP' : 'Extracted', linkedBy: 'Auto-linked', check: invoiceStatus(inv), paper: p ?? placeholderPaper({ title: inv.docTitle, number: inv.invoiceNo, date: date(inv.date), source: inv.channel }) }]
  }, [intake, inv])
  const firstDiffTotal = inv.flags.reduce((s, f) => s + f.amount, 0)
  const toIntake = (docId: string, extra: string) => nav(`/intake?tab=all&doc=${docId}${extra}`)
  const onVerdict = (a: VerdictAction) => {
    if (a.kind === 'field') toIntake(a.docId, a.key ? `&field=${a.key}` : '')
    else if (a.kind === 'annotation') toIntake(a.docId, `&note=${a.index}`)
    else if (a.kind === 'flag' && a.exceptionId) nav(`/exceptions?ex=${a.exceptionId}`)
    else if (a.kind === 'verify') act(() => api.verifyInvoice(inv.id), 'Verification queued')
    else if (a.kind === 'setup') nav(a.to)
  }

  return (
    <>
      <PageHeader crumbs={[{ label: 'Invoice review', to: '/review' }, { label: inv.invoiceNo }]} title={'Invoice ' + inv.invoiceNo}
        badges={<><Pill s={invoiceStatus(inv)} />{inv.flags.length > 0 && <Chip><Flag className="size-3" />{inv.flags.length} flag{inv.flags.length > 1 ? 's' : ''}</Chip>}</>}
        meta={<>
          <Link to={'/vendors/' + inv.vendorId} className="font-medium text-text">{vendor?.name}</Link>
          {vendor && <Gstin g={vendor.gstin} state={`${vendor.gstin.slice(0, 2)} · Maharashtra`} />}
          {vendor?.msme && <MsmeBadge cls={vendor.msme} />}
          <span>Total <span className="font-medium text-text">{inr(inv.total)}</span></span>
          <span>Dated {date(inv.date)} · received {date(inv.receivedAt)} by {inv.channel.toLowerCase()}</span>
          {inv.poId && <Link to={'/p2p/' + inv.poId}>PO {inv.poId}</Link>}{inv.grnId && <><span>·</span><span>GRN {inv.grnId}</span></>}
        </>}
        actions={<>
          <Button onClick={() => setDocOpen(0)}><Eye />Open document</Button>
          <Button size="icon" className="border-border-2 bg-surface" aria-label="Previous invoice" disabled={pos <= 0} onClick={() => nav('/review/' + queue[pos - 1].id)}><ChevronLeft /></Button>
          <span className="text-[11px] text-text-3">{pos + 1} of {queue.length}</span>
          <Button size="icon" className="border-border-2 bg-surface" aria-label="Next invoice" disabled={pos >= queue.length - 1} onClick={() => nav('/review/' + queue[pos + 1].id)}><ChevronRight /></Button>
        </>} />

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[2_1_760px] flex-col gap-4">
          <Card aria-label="Verdict">
            <CardHeader title="Verdict"><Pill s={verdictStatus(inv.verdict)} /></CardHeader>
            {!inv.verdict
              ? <CardBody className="text-xs text-text-2">Not checked yet. Read the documents again from the Intake inbox to compare them and verify with GST systems.</CardBody>
              : inv.verdict.state === 'clean'
                ? <CardBody className="flex items-center gap-2 text-xs text-ok"><OkIcon />All documents agree and every check passed: ready to approve.</CardBody>
                : inv.verdict.state === 'pending' && !inv.verdict.items.length
                  ? <CardBody className="text-xs text-text-2">Still reading documents or waiting for GST systems; this updates on its own.</CardBody>
                  : null}
            {inv.verdict && <VerdictList verdict={inv.verdict} disabled={readOnly || pending} onAction={onVerdict} />}
          </Card>

          <Card aria-label="Flags">
            <CardHeader title={inv.flags.length ? `${inv.flags.length} difference${inv.flags.length > 1 ? 's' : ''} to decide` : 'No differences'}>
              <span className="text-xs text-text-2">{firstDiffTotal ? <>Net <span className="font-medium text-text">{inr(dnTotal || firstDiffTotal)}</span> above PO incl. GST · </> : null}Pravah flags, you decide</span>
            </CardHeader>
            {inv.flags.length ? (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] [&>div]:border-r [&>div]:border-b [&>div]:border-border">
                {inv.flags.map(f => (
                  <div key={f.id} className="flex gap-2.5 px-4 py-2.5">
                    <Flag className="mt-0.5 size-4 flex-none text-bad" />
                    <div className="flex flex-col gap-0.5"><span className="font-medium">{f.title}</span><span className="text-[11px] text-text-2">{f.detail}</span><span className="text-[11px] text-text-3">{f.usual}{f.exceptionId && <> · <Link to={'/exceptions?ex=' + f.exceptionId}>{f.exceptionId}</Link></>}</span></div>
                  </div>
                ))}
              </div>
            ) : <CardBody className="flex items-center gap-2 text-xs text-ok"><OkIcon />All fields agree across negotiated terms, PO, goods receipt and invoice.</CardBody>}
          </Card>

          <Card aria-label="Three-way match comparison">
            <CardHeader title="Three-way match">
              <span className="flex flex-wrap gap-3 text-[11px] text-text-2">
                <span className="flex items-center gap-1"><OkIcon className="text-ok" />Matched</span><span className="flex items-center gap-1"><WarnIcon className="text-warn" />Within tolerance</span>
                <span className="flex items-center gap-1"><BadIcon className="text-bad" />Differs</span><span className="flex items-center gap-1"><NoneIcon className="text-none" />Missing</span>
              </span>
              <label className="flex items-center gap-1.5 text-[11px] text-text-2"><Chk checked={onlyDiff} onChange={e => setOnlyDiff(e.target.checked)} />Only rows with differences</label>
            </CardHeader>
            <div className="overflow-auto">
              <table className="w-full border-separate border-spacing-0 text-[12.5px] leading-[17px]">
                <thead>
                  <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-[1] [&>th]:border-b [&>th]:border-border [&>th]:bg-surface-2 [&>th]:px-2.5 [&>th]:py-2 [&>th]:text-left [&>th]:align-bottom [&>th]:text-[11.5px] [&>th]:text-text-2">
                    <th className="w-[140px]">Field</th>
                    {inv.heads.map(h => <th key={h.title}><div className="text-xs text-text">{h.title}</div><div className="font-mono font-normal">{h.ref}</div><div className="mt-[3px]"><Source name={h.source} text={h.when} /></div></th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.field}>
                      <td className="border-b border-border px-2.5 py-2 align-top font-medium whitespace-nowrap text-text-2">{r.field}</td>
                      {r.cells.map((c, i) => <td key={i} className="border-b border-l border-border p-0 align-top"><CompareCell c={c} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {(inv.consistency?.length ?? 0) > 0 && (
            <Card aria-label="Documents agree">
              <CardHeader title="Do the documents agree?"><span className="text-[11px] text-text-2">Invoice, PO, GRN, transport papers, stamps and the e-invoice QR</span></CardHeader>
              <FindingsTable findings={inv.consistency!} onOpen={(docId, key) => toIntake(docId, key ? `&field=${key}` : '')} />
            </Card>
          )}

          <Card aria-label="Decision" className="border-border-2">
            <CardHeader title="Decision"><span className="flex items-center gap-1.5 text-xs text-text-2"><Avatar id={inv.decision?.byId ?? user.id} />{users.find(u => u.id === (inv.decision?.byId ?? user.id))?.name} · {users.find(u => u.id === (inv.decision?.byId ?? user.id))?.title}{!inv.decision && approvalLimit > 0 && approvalLimit < 1e11 && ` · approval limit ${inr(approvalLimit)}`}</span></CardHeader>
            {inv.decision ? <DecisionSummary inv={inv} /> : !canDecide ? (
              <Restricted>{readOnly ? 'Your role is read-only. Decisions need an AP executive, Controller or CFO.' : `${user.title}s cannot decide on invoices. Switch to an AP executive, Controller or CFO from the user menu.`}</Restricted>
            ) : (
              <CardBody className="flex flex-wrap gap-5">
                <div className="flex flex-[1_1_260px] flex-col gap-1.5" role="radiogroup" aria-label="Decision">
                  {OPTS.map(([k, t, d]) => <OptionCard key={k} name="decision" checked={kind === k} title={t} desc={d} disabled={k === 'dn' && !inv.dnLines.length} onChange={() => { setKind(k); setReasons(defaultReasons(k)) }} />)}
                </div>
                <div className="flex min-w-0 flex-[2_1_380px] flex-col gap-3">
                  <div>
                    <div className="mb-1 text-xs font-medium text-text-2">Reason code <span className="text-bad">*</span> <span className="font-normal text-text-3">required for every decision</span></div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button className="w-full justify-between font-normal" aria-label="Reason code"><span className={cn('truncate', !reasons.length && 'text-text-3')}>{reasons.length ? reasons.map(r => `${r} · ${REASONS.find(x => x[0] === r)?.[1]}`).join('  +  ') : 'Choose a reason code'}</span><ChevronDown className="text-text-3" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
                        {REASONS.map(([c, l]) => <DropdownMenuCheckboxItem key={c} checked={reasons.includes(c)} onSelect={e => e.preventDefault()} onCheckedChange={on => setReasons(on ? [...reasons, c] : reasons.filter(x => x !== c))}><span className="font-mono text-[11px]">{c}</span> {l}</DropdownMenuCheckboxItem>)}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {kind === 'dn' && (
                    <div className="overflow-hidden rounded-lg border border-border">
                      <table className="w-full border-separate border-spacing-0 text-[12.5px] [&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5 [&_th]:border-b [&_th]:border-border [&_th]:bg-surface-2 [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-left [&_th]:text-[11.5px] [&_th]:font-semibold [&_th]:text-text-2">
                        <thead><tr><th>Debit note · draft</th><th className="text-right!">Taxable</th><th className="text-right!">GST 18%</th><th className="text-right!">Total</th></tr></thead>
                        <tbody>{inv.dnLines.map(l => <tr key={l.text}><td>{l.text}</td><td className="text-right tabular-nums">{inr(l.taxable)}</td><td className="text-right tabular-nums">{inr(l.gst)}</td><td className="text-right tabular-nums">{inr(l.taxable + l.gst)}</td></tr>)}</tbody>
                        <tfoot className="[&_td]:border-b-0 [&_td]:bg-surface-2 [&_td]:font-semibold"><tr><td>Debit note</td><td className="text-right">{inr(inv.dnLines.reduce((s, l) => s + l.taxable, 0))}</td><td className="text-right">{inr(inv.dnLines.reduce((s, l) => s + l.gst, 0))}</td><td className="text-right">{inr(dnTotal)}</td></tr></tfoot>
                      </table>
                      <div className="border-t border-border px-2.5 py-2 text-[11px] text-text-2">Invoice posts in SAP at {inr(inv.total)} with the debit note against it — net payable <span className="font-medium text-text">{inr(inv.total - dnTotal)}</span>{Math.abs(inv.total - dnTotal - (inv.taxable - inv.dnLines.reduce((s, l) => s + l.taxable, 0)) * 1.18) < 1 ? ', equal to the PO' : ''}. Other flags are sent to the vendor with the note.</div>
                    </div>
                  )}
                  <div>
                    <label htmlFor="note" className="mb-1 block text-xs font-medium text-text-2">Note to file {noteRequired ? <><span className="text-bad">*</span> <span className="font-normal text-text-3">required for this decision</span></> : <span className="font-normal text-text-3">optional</span>}</label>
                    <Textarea id="note" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Why this decision; visible in the audit log" aria-invalid={noteRequired && !note.trim() ? true : undefined} />
                  </div>
                  <Banner tone={overLimit ? 'warn' : 'info'} icon={<Users className="size-4" />} className="py-2">
                    {overLimit
                      ? <>This invoice is {inr(inv.total)}, above your limit of {inr(approvalLimit)}. After you submit, a Controller or CFO must approve it before it posts.</>
                      : <>Amounts above <span className="font-medium">{inr(approvalLimit)}</span> need a second approver (Controller or CFO). This invoice is {inr(inv.total)}, so your decision is final and is logged with the evidence above.</>}
                  </Banner>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="default" disabled={!valid || pending} onClick={submit}><Check />{submitLabel}</Button>
                    <Button disabled={pending} onClick={() => act(() => api.saveDraft(inv.id, { kind, reasons, note }), 'Draft saved')}>Save draft</Button>
                    <span className="text-[11px] text-text-3">Ctrl Enter to submit · next invoice opens automatically</span>
                  </div>
                </div>
              </CardBody>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          <Card aria-label="GST verification">
            <CardHeader title="GST verification"><Source name="GST portal" text="via Vayana" /></CardHeader>
            <CardBody className="flex flex-col gap-2.5">
              {(inv.verifications?.length ?? 0) === 0
                ? <span className="text-xs text-text-2">{inv.verdict?.items.some(i => i.action?.kind === 'setup' && i.action.to === '/settings/integrations')
                  ? <>Not connected. <Link to="/settings/integrations">Connect Vayana</Link> to check GSTIN status, the signed e-invoice and the e-way bill.</>
                  : 'No checks have run for this invoice yet.'}</span>
                : inv.verifications!.map(v => (
                  <div key={v.id} className="flex flex-col gap-0.5">
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium">{VERIFICATION_LABEL[v.kind]}</span><Pill s={verificationStatus(v)} /></div>
                    <span className="font-mono text-[11px] break-all text-text-3">{v.ref}</span>
                    {v.message && <span className="text-[11px] text-text-2">{v.message}</span>}
                    {v.checkedAt && <span className="text-[11px] text-text-3">Checked {dateTime(v.checkedAt)}</span>}
                  </div>
                ))}
              {!readOnly && inv.status === 'needs-decision' && !inv.verdict?.items.some(i => i.action?.kind === 'setup' && i.action.to === '/settings/integrations') && (
                <div><Button size="sm" disabled={pending} onClick={() => act(() => api.verifyInvoice(inv.id), 'Verification queued')}>Verify again</Button></div>
              )}
            </CardBody>
          </Card>
          <Card aria-label="TDS">
            <CardHeader title="TDS"><Source name="SAP" text="vendor master" /></CardHeader>
            <CardBody>
              <KV items={[
                ['Nature of payment', <span className="font-medium">{inv.tds.nature}</span>],
                ['Section', <><span className="font-medium">{inv.tds.section}</span><div className="text-[11px] text-text-3">{inv.tds.legacy}</div></>],
                ['Threshold', <>{inv.tds.threshold}<div className="text-[11px] text-text-3">{inv.tds.crossed}</div></>],
                ['Rate', <>{inv.tds.rate} <span className="text-[11px] text-ok">· PAN operative</span></>],
                ['Base, excl. GST', inr(inv.tds.base), 'text-right tabular-nums'],
                ['TDS amount', <b>{inr(inv.tds.amount)}</b>, 'text-right tabular-nums'],
              ]} />
              <div className="mt-2.5 text-[11px] text-text-3">{inv.tds.note}</div>
            </CardBody>
          </Card>
          <Card aria-label="Input tax credit">
            <CardHeader title="Input tax credit"><Source name="GST portal" syncKey="gst" /></CardHeader>
            <CardBody className="flex flex-col gap-2.5">
              <div><Pill s={inv.itc.status} /></div>
              <KV items={[
                ['ITC on invoice', inr(inv.itc.onInvoice), 'text-right tabular-nums'],
                ...(inv.dnLines.length ? [['Claimable after DN', inr(inv.itc.afterDn), 'text-right tabular-nums'] as [string, string, string]] : []),
                ['IMS', <>{inv.itc.ims}<div className="text-[11px] text-text-3">{inv.itc.imsNote}</div></>],
                ['Expected in 2B', inv.itc.expected],
                ['180-day payment', inv.itc.pay180],
                ['Section 16(4)', inv.itc.s164],
                ['Supplier filing', <span className="flex items-center gap-1 text-[11px] font-medium text-ok"><OkIcon size={12} />{inv.itc.filing}</span>],
              ]} />
            </CardBody>
          </Card>
          {inv.msme && (
            <Card aria-label="MSME">
              <CardHeader title="MSME">{vendor?.msme && <MsmeBadge cls={vendor.msme} udyam />}</CardHeader>
              <CardBody className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between"><span className="text-xs text-text-2">45-day countdown</span><span><span className="text-[22px] font-semibold">{daysFromNow(inv.msme.payBy)}</span> <span className="text-xs text-text-2">days left</span></span></div>
                <Bar pct={((45 - daysFromNow(inv.msme.payBy)) / 45) * 100} tone={daysFromNow(inv.msme.payBy) <= 7 ? 'bad' : 'ok'} />
                <div className="flex justify-between text-[11px] text-text-3"><span>Accepted {date(inv.msme.acceptedOn)} (GRN)</span><span>Pay by {date(inv.msme.payBy)}</span></div>
                <div className="mt-1 text-[11px] text-text-2">Recommended payment date <span className="font-medium text-text">{date(inv.msme.recommended)}</span> — {inv.msme.note}</div>
                {vendor?.udyamVerifiedOn && <div><Source name="Udyam" text={'verified ' + date(vendor.udyamVerifiedOn)} /></div>}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
      <DocumentDrawer docs={docs} index={docOpen} onIndex={setDocOpen} kicker={inv.poId ? 'linked to PO ' + inv.poId : undefined} />
    </>
  )
}

function DecisionSummary({ inv }: { inv: Invoice }) {
  const { user, users, readOnly, approvalLimit } = useSession()
  const { act, pending } = useAct()
  const d = inv.decision!
  const by = users.find(u => u.id === d.byId)
  const canSecond = d.secondApproverNeeded && !readOnly && d.byId !== user.id && approvalLimit >= inv.total
  return (
    <CardBody className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2"><StatusPill tone={d.kind === 'hold' || d.kind === 'reject' ? 'bad' : 'ok'}>{KIND_LABEL[d.kind]}</StatusPill><span className="text-xs text-text-2">by {by?.name} · {dateTime(d.at)}</span></div>
      <KV items={[
        ['Reason codes', d.reasons.map(r => `${r} · ${REASONS.find(x => x[0] === r)?.[1]}`).join(', ')],
        ['Note to file', d.note || <span className="text-text-3">—</span>],
        ...(d.debitNote ? [['Debit note', <><span className="font-mono">{d.debitNote.no}</span> · {inr(d.debitNote.total)} <span className="text-[11px] text-text-3">({inr(d.debitNote.taxable)} + GST {inr(d.debitNote.gst)})</span></>] as [string, React.ReactNode]] : []),
        ['Second approver', d.secondApproverNeeded ? <StatusPill tone="warn">Pending · Controller or CFO</StatusPill> : <span className="text-text-2">Not needed or done</span>],
      ]} />
      {d.secondApproverNeeded && (canSecond
        ? <div className="flex gap-2"><Button variant="default" disabled={pending} onClick={() => act(() => api.confirmSecondApproval(inv.id), 'Second approval recorded · invoice posts')}><Check />Approve as second approver</Button></div>
        : <Banner tone="info" icon={<Users className="size-4" />}>Waiting for a Controller or CFO with a limit of at least {inr(inv.total)}. They see it in Approvals.</Banner>)}
    </CardBody>
  )
}
