import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Check, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Banner, Confidence, DataTable, KpiCard, PageHeader, Pill, Q, Source, useStale } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useBank } from '@/mock/hooks'
import * as api from '@/mock/api'
import { ago, date, dateTime, inr } from '@/lib/format'
import type { BankLine } from '@/lib/types'
import { cn } from '@/lib/utils'

export default function BankPage() {
  const q = useBank()
  const { user, readOnly } = useSession()
  const { act, pending } = useAct()
  const { stale, at } = useStale('bank')
  const columns = useMemo<ColumnDef<BankLine, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => date(getValue()) },
    { accessorKey: 'narration', header: 'Narration', cell: ({ row: { original: l } }) => <div><div className="font-mono text-xs">{l.narration}</div><div className="text-[11px] text-text-3">{l.ref}</div></div> },
    { accessorKey: 'amount', header: 'Amount', meta: { num: true }, cell: ({ getValue }) => <span className={cn(getValue() < 0 ? 'text-bad' : 'text-ok')}>{inr(getValue())}</span> },
    { accessorKey: 'suggestion', header: 'Suggested match', cell: ({ row: { original: l } }) => l.suggestion ? <div className="flex flex-col gap-0.5"><span className="text-xs">{l.suggestion}</span><Confidence value={l.confidence} /></div> : <span className="text-[11px] text-text-3">No match found</span> },
    { id: 'st', header: 'Status', accessorFn: l => l.status.label, cell: ({ row: { original: l } }) => <Pill s={l.status} /> },
    { id: 'act', header: '', enableSorting: false, cell: ({ row: { original: l } }) => l.status.tone === 'ok' ? null : (
      <span className="flex gap-1">
        {l.suggestion && <Button size="sm" disabled={readOnly} onClick={() => act(() => api.matchBankLine(l.id, true, user.id), 'Matched')}><Check />Match</Button>}
        {l.suggestion && <Button size="icon-sm" aria-label="Reject suggestion" disabled={readOnly} onClick={() => act(() => api.matchBankLine(l.id, false, user.id), 'Suggestion rejected')}><X /></Button>}
      </span>
    ) },
  ], [readOnly]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHeader title="Bank" sub="Balances and statement lines from the bank feed, matched to SAP documents." actions={<><Source name="Bank" syncKey="bank" /><Button disabled={pending || readOnly} onClick={() => act(() => api.retrySync('bank', user.id), 'Bank feed synced')}><RefreshCw className={cn(pending && 'animate-spin')} />Sync now</Button></>} />
      {stale && <Banner tone="warn"><b>Bank feed is stale.</b> Last statement {dateTime(at)} ({ago(at)}). HDFC host-to-host has not sent a statement since; balances below may be out of date.</Banner>}
      <Q q={q}>{({ accounts, lines }) => (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {accounts.map(a => <KpiCard key={a.id} k={{ id: a.id, label: `${a.bank} ${a.account} · ${a.type}`, value: a.balance, sub: `${a.unreconciled} unreconciled lines`, source: 'Bank', syncKey: 'bank' }} />)}
          </div>
          <DataTable id="bank-lines" data={lines} columns={columns} getRowId={l => l.id} initialSort={[{ id: 'date', desc: true }]} toolbar={<span className="text-xs text-text-2">{lines.filter(l => l.status.tone !== 'ok').length} lines to reconcile</span>} />
        </>
      )}</Q>
    </>
  )
}
