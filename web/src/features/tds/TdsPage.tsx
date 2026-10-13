import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Banner, DataTable, KpiCard, PageHeader, Pill, Q, Source } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useTds } from '@/mock/hooks'
import * as api from '@/mock/api'
import { date, daysFromNow, inr } from '@/lib/format'
import type { TdsLine } from '@/lib/types'

export default function TdsPage() {
  const q = useTds()
  const { entity, user, readOnly } = useSession()
  const { act, pending } = useAct()
  const columns = useMemo<ColumnDef<TdsLine, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { accessorKey: 'section', header: 'Section', cell: ({ row: { original: t } }) => <div><div className="font-medium">{t.section}</div><div className="text-[11px] text-text-3">Legacy {t.legacy}</div></div> },
    { accessorKey: 'nature', header: 'Nature of payment' },
    { accessorKey: 'deductee', header: 'Deductee', cell: ({ row: { original: t } }) => <div><div className="font-medium">{t.deductee}</div><div className="font-mono text-[11px] text-text-3">PAN {t.pan}</div></div> },
    { accessorKey: 'date', header: 'Deducted on', cell: ({ getValue }) => date(getValue()) },
    { accessorKey: 'base', header: 'Base', meta: { num: true }, cell: ({ getValue }) => inr(getValue()) },
    { accessorKey: 'rate', header: 'Rate', meta: { num: true }, cell: ({ getValue }) => getValue() + '%' },
    { accessorKey: 'tds', header: 'TDS', meta: { num: true }, cell: ({ getValue }) => <span className="font-medium">{inr(getValue())}</span> },
    { id: 'ch', header: 'Challan', accessorFn: t => t.challan.label, cell: ({ row: { original: t } }) => <Pill s={t.challan} /> },
  ], [])
  return (
    <>
      <PageHeader title="TDS hub" sub="Deductions under the Income-tax Act 2025 (legacy 1961 sections shown) and their deposit." actions={<Source name="TRACES" text="1 day ago" />} />
      <Q q={q}>{lines => {
        const pendingLines = lines.filter(t => t.challan.tone === 'warn')
        const due = pendingLines.reduce((s, t) => s + t.tds, 0)
        return (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              <KpiCard k={{ id: 'due', label: 'To deposit for October', value: due, sub: `${pendingLines.length} deductions · due 07-11-2026`, source: 'SAP', syncKey: 'sap', tone: 'warn', status: `${daysFromNow('2026-11-07')} days left` }} />
              <KpiCard k={{ id: 'q', label: 'Quarterly return 26Q', value: daysFromNow('2027-01-31'), unit: 'days', sub: 'Q3 due 31-01-2027', source: 'TRACES', syncKey: 'sap' }} />
            </div>
            {pendingLines.length > 0 && <Banner tone="info" actions={<Button size="sm" variant="default" disabled={readOnly || pending} onClick={() => act(() => api.generateChallan(entity.id, user.id), r => `Challan 281 drafted for ${inr(r.total)}`)}><FileText />Draft challan 281</Button>}>October deductions total <b>{inr(due)}</b>. Draft the challan here and pay it from the bank portal by 07-11-2026.</Banner>}
            <DataTable id="tds" data={lines} columns={columns} getRowId={t => t.id} toolbar={null}
              footer={<tr><td colSpan={6}>{lines.length} deductions</td><td className="text-right tabular-nums">{inr(lines.reduce((s, t) => s + t.tds, 0))}</td><td /></tr>} />
          </>
        )
      }}</Q>
    </>
  )
}
