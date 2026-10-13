import { Avatar, Bar, Card, CardHeader, Chk, PageHeader, Q, StatusPill } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useClose } from '@/mock/hooks'
import * as api from '@/mock/api'
import { date, dateTime, daysFromNow } from '@/lib/format'
import { cn } from '@/lib/utils'

export default function ClosePage() {
  const q = useClose()
  const { user, users, readOnly } = useSession()
  const { act } = useAct()
  return (
    <>
      <PageHeader title="Month-end close · October 2026" sub="Checklist for the October close. September was signed off on 08-10-2026." />
      <Q q={q}>{tasks => {
        const open = tasks.filter(t => t.id !== 'k0')
        const done = open.filter(t => t.done).length
        const areas = [...new Set(open.map(t => t.area))]
        return (
          <>
            <Card>
              <div className="flex flex-wrap items-center gap-4 px-4 py-3">
                <div className="flex-[1_1_240px]"><div className="mb-1 flex justify-between text-xs"><span className="font-medium">{done} of {open.length} tasks done</span><span className="text-text-3">Target close 07-11-2026 · {daysFromNow('2026-11-07')} days</span></div><Bar pct={(done / open.length) * 100} tone={done === open.length ? 'ok' : undefined} /></div>
                <StatusPill tone={done === open.length ? 'ok' : 'warn'}>{done === open.length ? 'Ready for sign-off' : 'In progress'}</StatusPill>
              </div>
            </Card>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4">
              {areas.map(a => {
                const list = open.filter(t => t.area === a)
                return (
                  <Card key={a}>
                    <CardHeader title={a} as="h3"><span className="text-[11px] text-text-3">{list.filter(t => t.done).length} of {list.length}</span></CardHeader>
                    {list.map(t => (
                      <label key={t.id} className="flex cursor-pointer items-start gap-2.5 border-b border-border px-4 py-2.5 last:border-b-0 hover:bg-surface-2">
                        <Chk className="mt-0.5" checked={t.done} disabled={readOnly} onChange={() => act(() => api.toggleCloseTask(t.id, user.id), t.done ? 'Task reopened' : 'Task done')} />
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
