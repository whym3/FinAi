import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, PageHeader, Q } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useReports } from '@/api/hooks'
import * as api from '@/api'
import { dateTime } from '@/lib/format'

export default function ReportsPage() {
  const q = useReports()
  const { entity } = useSession()
  return (
    <>
      <PageHeader title="Reports" sub={`Statutory, tax and management reports for ${entity.name}.`} />
      <Q q={q}>{reports => (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-4">
          {[...new Set(reports.map(r => r.group))].map(g => (
            <Card key={g}>
              <CardHeader title={g} as="h3" />
              {reports.filter(r => r.group === g).map(r => (
                <div key={r.id} className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
                  <div className="min-w-0 flex-1"><div className="text-xs font-medium">{r.name}</div><div className="text-[11px] text-text-2">{r.description}</div><div className="mt-0.5 text-[11px] text-text-3">{r.format}{r.lastRun ? ` · last run ${dateTime(r.lastRun)}` : ''}</div></div>
                  <Button size="sm" onClick={() => window.open(api.reportUrl(r.id, entity.id), '_blank', 'noopener')}><Download />Download</Button>
                </div>
              ))}
            </Card>
          ))}
        </div>
      )}</Q>
    </>
  )
}
