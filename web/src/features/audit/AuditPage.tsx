import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DataTable, PageHeader, Person, Q } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAudit } from '@/api/hooks'
import { dateTime } from '@/lib/format'
import { downloadCsv } from '@/lib/csv'
import type { AuditEntry } from '@/lib/types'

export default function AuditPage() {
  const q = useAudit()
  const { users, entity } = useSession()
  const [s, setS] = useState('')
  const columns = useMemo<ColumnDef<AuditEntry, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { accessorKey: 'at', header: 'When', cell: ({ getValue }) => <span className="whitespace-nowrap">{dateTime(getValue())}</span> },
    { accessorKey: 'userId', header: 'Who', cell: ({ getValue }) => <Person id={getValue()} /> },
    { accessorKey: 'action', header: 'Action', cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
    { accessorKey: 'target', header: 'On', cell: ({ getValue }) => <span className="font-mono text-xs">{getValue()}</span> },
    { accessorKey: 'detail', header: 'Detail', cell: ({ getValue }) => <span className="text-xs text-text-2">{getValue()}</span> },
  ], [])
  return (
    <>
      <PageHeader title="Audit log" sub="Every action in Pravah with who, when and the evidence it referred to. Entries cannot be edited." />
      <Q q={q}>{entries => {
        const list = entries.filter(e => !s || [e.action, e.target, e.detail, users.find(u => u.id === e.userId)?.name].some(x => x?.toLowerCase().includes(s.toLowerCase())))
        return <DataTable id="audit" data={list} columns={columns} getRowId={e => e.id} initialSort={[{ id: 'at', desc: true }]}
          toolbar={<><Input className="h-7 w-64 text-xs" placeholder="Filter by person, action or document" value={s} onChange={e => setS(e.target.value)} aria-label="Filter audit log" /><Button size="sm" onClick={() => downloadCsv(`audit-${entity.id}.csv`, ['When', 'Who', 'Action', 'On', 'Detail'], list.map(e => [dateTime(e.at), users.find(u => u.id === e.userId)?.name ?? e.userId, e.action, e.target, e.detail]))}><Download />Export</Button></>} />
      }}</Q>
    </>
  )
}
