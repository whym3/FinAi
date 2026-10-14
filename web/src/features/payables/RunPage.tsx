import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ChevronLeft, Fingerprint, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, Banner, Card, CardBody, CardHeader, Chip, KV, MsmeBadge, PageHeader, Pill, Q, Source, StatusPill, toneIcon, toneText } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useRun } from '@/api/hooks'
import * as api from '@/api'
import { date, dateTime, inr } from '@/lib/format'
import type { PaymentRun } from '@/lib/types'
import { cn } from '@/lib/utils'
import { runStatus } from './PayablesPage'

export default function RunPage() {
  const { runId = '' } = useParams()
  const q = useRun(runId)
  return <Q q={q}>{run => <Run run={run} />}</Q>
}

function Run({ run }: { run: PaymentRun }) {
  const { user, users, entity, readOnly } = useSession()
  const { act, pending } = useAct()
  const [confirm, setConfirm] = useState(false)
  const [back, setBack] = useState(false)
  const [note, setNote] = useState('')
  const next = run.approvers.find(a => a.status === 'pending')
  const nextUser = users.find(u => u.id === next?.userId)
  const mine = run.status === 'awaiting-approval' && next?.userId === user.id && !readOnly
  const released = run.status === 'released'
  const myApproval = run.approvers.find(a => a.userId === user.id && a.status === 'approved')
  const name = (id: string) => users.find(u => u.id === id)

  const actions = (
    <div className="flex flex-col gap-2">
      {mine ? <>
        <Button variant="default" size="lg" className="w-full" disabled={pending} onClick={() => setConfirm(true)}><Fingerprint className="size-5" />Approve {inr(run.net)}</Button>
        <Button size="lg" className="w-full" disabled={pending} onClick={() => setBack(true)}>Send back to {name(run.approvers[0].userId)?.title ?? 'Controller'}</Button>
        <div className="text-center text-[11px] text-text-3">You confirm with your device passkey. The run is released to {run.bank.split(' ')[0]} Bank only after all approvals.</div>
      </> : released ? (
        <Button size="lg" className="w-full" asChild><Link to="/">Back to overview</Link></Button>
      ) : run.status === 'awaiting-approval' ? (
        <div className="text-center text-xs text-text-2">Waiting for <span className="font-medium text-text">{nextUser?.name}</span> ({nextUser?.title}).{readOnly ? ' Your role is read-only.' : ' Switch user from the menu to act as them (demo).'}</div>
      ) : (
        <div className="text-center text-xs text-text-2">{run.status === 'draft' ? 'Draft run. It is proposed in SAP F110 and appears here for approval once the proposal is complete.' : 'Sent back. The Controller revises the proposal in SAP and resubmits it.'}</div>
      )}
    </div>
  )

  return (
    <>
      <div className="hidden md:contents">
        <PageHeader crumbs={[{ label: 'Payables & payment runs', to: '/payables' }, { label: run.id }]} title={'Payment run ' + run.id} badges={<Pill s={runStatus(run)} />}
          sub={`${entity.name} · value date ${date(run.valueDate)} · ${run.bank} ${run.account}`} actions={<Source name="SAP" text={`${run.sapProposal} · 10 min ago`} />} />
      </div>
      <div className="flex items-center gap-1 md:hidden">
        <Button size="icon-lg" asChild aria-label="Back"><Link to="/payables"><ChevronLeft /></Link></Button>
        <div className="flex flex-col"><span className="font-medium">Approve payment run</span><span className="text-[11px] text-text-3">{entity.name}</span></div>
      </div>

      {released && (
        <Banner tone="ok" icon={toneIcon.ok({ size: 20 })} actions={myApproval ? <Button size="sm" disabled={pending} onClick={() => act(() => api.undoRunApproval(run.id), 'Approval withdrawn')}><Undo2 />Back to review</Button> : undefined}>
          <div className="font-semibold">Approved and sent to the bank</div>
          <div className="text-xs text-text-2">{run.bank.split(' ').slice(0, 2).join(' ')} host-to-host · file {run.h2hFile} · value date {date(run.valueDate)}. UTRs will appear here as the bank confirms each payment.</div>
        </Banner>
      )}

      <div className="flex flex-wrap items-start gap-4 pb-56 md:pb-0">
        <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-3 md:gap-4">
          <Card aria-label="Run summary">
            <CardBody className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between"><Chip className="font-mono">{run.id}</Chip><StatusPill tone={released ? 'ok' : mine ? 'warn' : runStatus(run).tone}>{released ? 'Released' : mine ? 'Awaiting you' : runStatus(run).label}</StatusPill></div>
              <div className="mt-1 text-[11px] text-text-2">Net payable</div>
              <div className="text-[30px] leading-9 font-semibold tracking-[-.01em] tabular-nums">{inr(run.net)}</div>
              <div className="text-xs text-text-2">{run.invoices} invoices · {run.vendors} vendors · value date {date(run.valueDate)}</div>
              <div className="text-xs text-text-2">From {run.bank} <span className="font-mono">{run.account}</span></div>
              <div className="mt-1"><Source name="SAP" text={`${run.sapProposal} · 10 min ago`} /></div>
            </CardBody>
          </Card>

          <Card aria-label="Approvers">
            <CardHeader title={`Approvals · ${run.approvers.length} needed`} as="h3"><span className="text-[11px] text-text-3">above ₹5,00,000.00</span></CardHeader>
            <CardBody className="flex flex-col gap-2.5">
              {run.approvers.map(a => {
                const u = name(a.userId)
                return (
                  <div key={a.userId} className="flex items-center gap-2.5">
                    <Avatar id={a.userId} size="lg" />
                    <div className="min-w-0 flex-1"><div className="text-xs font-medium">{a.userId === user.id ? 'You · ' : ''}{u?.name} · {u?.title}</div><div className="text-[11px] text-text-3">{a.at ? `${dateTime(a.at)}${a.via ? ' · ' + a.via : ''}${a.note ? ` · “${a.note}”` : ''}` : a.userId === next?.userId ? 'Next approver · required for this run' : 'Waiting for earlier approval'}</div></div>
                    <StatusPill tone={a.status === 'approved' ? 'ok' : a.status === 'sent-back' ? 'bad' : 'warn'}>{a.status === 'approved' ? 'Approved' : a.status === 'sent-back' ? 'Sent back' : 'Pending'}</StatusPill>
                  </div>
                )
              })}
            </CardBody>
          </Card>

          <Card aria-label="Amounts">
            <CardBody>
              <KV className="grid-cols-[1fr_auto]" items={[
                ['Gross invoices', inr(run.gross), 'text-right tabular-nums'],
                ['TDS deducted', <span className="text-bad">{inr(-run.tds)}</span>, 'text-right tabular-nums'],
                [<span className="font-medium text-text">Net payable</span>, <b>{inr(run.net)}</b>, 'text-right tabular-nums'],
                ...(run.held ? [['Held out of run', <span className="text-text-2">{inr(run.held)}</span>, 'text-right tabular-nums'] as [string, React.ReactNode, string]] : []),
              ]} />
            </CardBody>
          </Card>

          {run.checks.length > 0 && (
            <Card aria-label="Checks">
              <CardHeader title="Checks before release" as="h3"><span className="text-[11px] text-text-3">{run.checks.filter(c => c.tone === 'ok').length} of {run.checks.length} clear</span></CardHeader>
              {run.checks.map(c => { const I = toneIcon[c.tone]; return (
                <div key={c.label} className="flex items-start gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0">
                  <I size={16} className={cn('mt-px', toneText[c.tone])} />
                  <div className="flex-1"><div className="text-xs font-medium">{c.label}</div><div className="text-[11px] text-text-3">{c.sub}</div>{c.source && <div className="mt-1"><Source name={c.source.name} syncKey={c.source.syncKey} /></div>}</div>
                </div>
              ) })}
            </Card>
          )}

          {run.payees.length > 0 && (
            <Card aria-label="Payees">
              <CardHeader title="Largest payees" as="h3"><span className="text-[11px] text-text-3">{run.payees.length} of {run.vendors}</span></CardHeader>
              {run.payees.map(p => (
                <Link key={p.vendorId} to={'/vendors/' + p.vendorId} className="flex min-h-[52px] items-center gap-2.5 border-b border-border px-3 py-2.5 text-text no-underline hover:bg-surface-2 hover:text-text">
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className="text-xs font-medium">{p.name}</span>{p.tag && <MsmeBadge cls={p.tag} />}</div><div className="text-[11px] text-text-3">{p.sub}</div></div>
                  <span className="text-xs font-medium tabular-nums">{inr(p.amount)}</span>
                </Link>
              ))}
              {run.rest.count > 0 && <div className="flex items-center gap-2.5 p-3"><span className="flex-1 text-xs text-acc">{run.rest.count} more vendors</span><span className="text-xs text-text-2 tabular-nums">{inr(run.rest.amount)}</span></div>}
            </Card>
          )}

          {mine && <div><label htmlFor="m-note" className="mb-1 block text-xs font-medium text-text-2">Note <span className="font-normal text-text-3">optional</span></label><Textarea id="m-note" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Visible to the Controller and in the audit log" /></div>}
        </div>

        <div className="fixed inset-x-0 bottom-[68px] z-20 border-t border-border bg-surface px-4 pt-3 pb-4 md:sticky md:top-24 md:bottom-auto md:z-auto md:flex-[1_1_300px] md:rounded-lg md:border md:p-4">
          <div className="mb-3 hidden md:block"><div className="text-[11px] text-text-2">Net payable</div><div className="text-xl font-semibold tabular-nums">{inr(run.net)}</div></div>
          {actions}
        </div>
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader><DialogTitle>Approve {inr(run.net)}?</DialogTitle><DialogDescription>{run.invoices} invoices to {run.vendors} vendors from {run.bank} {run.account}, value date {date(run.valueDate)}.{run.approvers.filter(a => a.status === 'pending').length === 1 ? ' Yours is the last approval: the file goes to the bank immediately.' : ''}</DialogDescription></DialogHeader>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3 text-xs text-text-2"><Fingerprint className="size-8 text-acc" />In production this step asks for your device passkey. The demo confirms directly.</div>
          <DialogFooter><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button variant="default" disabled={pending} onClick={async () => { if (await act(() => api.approveRun(run.id, note), r => r.status === 'released' ? 'Approved and sent to the bank' : 'Approved · waiting for the next approver')) setConfirm(false) }}><Fingerprint />Confirm approval</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={back} onOpenChange={setBack}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send back {run.id}</DialogTitle><DialogDescription>The Controller sees your note and revises the proposal in SAP.</DialogDescription></DialogHeader>
          <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="What needs to change" />
          <DialogFooter><Button variant="ghost" onClick={() => setBack(false)}>Cancel</Button><Button variant="destructive" disabled={!note.trim() || pending} onClick={async () => { if (await act(() => api.sendBackRun(run.id, note), 'Run sent back to the Controller')) setBack(false) }}>Send back</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
