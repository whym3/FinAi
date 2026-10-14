import { Avatar, Bar, Card, CardHeader, Chk, EmptyState, PageHeader, Q, StatusPill } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useClose } from '@/api/hooks'
import * as api from '@/api'
import { date, dateTime, daysFromNow } from '@/lib/format'
import { cn } from '@/lib/utils'

export default function ClosePage() {
  const q = useClose()
  const { users, readOnly, period } = useSession()
  const { act } = useAct()
  return (
    <>
      <PageHeader title={`Month-end close · ${period}`} sub={`Checklist for the ${period} close.`} />
      <Q q={q}>{tasks => {
        const done = tasks.filter(t => t.done).length
        const areas = [...new Set(tasks.map(t => t.area))]
        const target = tasks.map(t => t.due).filter((d): d is string => !!d).sort().at(-1)
        if (!tasks.length) return <Card><EmptyState title="No close checklist yet">Close tasks appear here once they are set up for this client.</EmptyState></Card>
        return (
          <>
            <Card>
              <div className="flex flex-wrap items-center gap-4 px-4 py-3">
                <div className="flex-[1_1_240px]"><div className="mb-1 flex justify-between text-xs"><span className="font-medium">{done} of {tasks.length} tasks done</span>{target && <span className="text-text-3">Target close {date(target)} · {daysFromNow(target)} days</span>}</div><Bar pct={(done / tasks.length) * 100} tone={done === tasks.length ? 'ok' : undefined} /></div>
                <StatusPill tone={done === tasks.length ? 'ok' : 'warn'}>{done === tasks.length ? 'Ready for sign-off' : 'In progress'}</StatusPill>
              </div>
            </Card>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4">
              {areas.map(a => {
                const list = tasks.filter(t => t.area === a)
                return (
                  <Card key={a}>
                    <CardHeader title={a} as="h3"><span className="text-[11px] text-text-3">{list.filter(t => t.done).length} of {list.length}</span></CardHeader>
                    {list.map(t => (
                      <label key={t.id} className="flex cursor-pointer items-start gap-2.5 border-b border-border px-4 py-2.5 last:border-b-0 hover:bg-surface-2">
                        <Chk className="mt-0.5" checked={t.done} disabled={readOnly} onChange={() => act(() => api.toggleCloseTask(t.id), t.done ? 'Task reopened' : 'Task done')} />
                        <span className="min-w-0 flex-1"><span className={cn('text-xs font-medium', t.done && 'text-text-3 line-through')}>{t.task}</span><span className="block text-[11px] text-text-3">{t.done ? `Done ${dateTime(t.doneAt)}` : `Due ${date(t.due)}`} · {users.find(u => u.id === t.ownerId)?.name}</span></span>
                        <Avatar id={t.ownerId} size="sm" />
                      </label>
                    ))}
                  </Card>
                )
              })}
            </div>
          </>
        )
      }}</Q>
    </>
  )
}
