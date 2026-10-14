import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Check, Database, Download, FileSpreadsheet, RefreshCw, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Banner, Card, CardBody, CardHeader, EmptyState, Freshness, PageHeader, Q, StatusPill } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useImportKinds, useImports, useIntegrations, useSources } from '@/api/hooks'
import * as api from '@/api'
import { dateTime, int } from '@/lib/format'
import { downloadCsv } from '@/lib/csv'
import type { ImportKind, ImportRun, Tone } from '@/lib/types'
import { cn } from '@/lib/utils'
import { NativeSelect } from '@/features/settings/clients/parts'

const STATUS: Record<ImportRun['status'], [Tone, string]> = { detected: ['warn', 'Needs mapping'], queued: ['acc', 'Queued'], running: ['acc', 'Running'], done: ['ok', 'Done'], failed: ['bad', 'Failed'] }

export default function ImportsPage() {
  const { entity, readOnly } = useSession()
  const q = useImports()
  const kinds = useImportKinds().data ?? []
  const { act, pending } = useAct()
  const [openId, setOpenId] = useState<number | null>(null)
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const open = q.data?.find(i => i.id === openId)

  async function drop(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      const r = await act(() => api.uploadImport(entity.id, f), r => r.kind ? `${f.name}: looks like a ${kinds.find(k => k.kind === r.kind)?.label.toLowerCase() ?? r.kind}` : `${f.name}: could not tell the kind, map it by hand`)
      if (r) setOpenId(r.id)
    }
  }

  return (
    <>
      <PageHeader title="Imports" sub={`SAP exports and other spreadsheets for ${entity.shortName} · purchase and sales registers, stock movements, open items, masters`} />
      {!readOnly && (
        <div role="button" tabIndex={0} aria-label="Upload a spreadsheet"
          onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); drop(e.dataTransfer.files) }}
          onClick={() => inputRef.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
          className={cn('flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-5 py-7 text-center transition-colors', drag ? 'border-acc bg-acc-weak' : 'border-border-2 bg-surface hover:bg-surface-2')}>
          <span className="grid size-11 place-items-center rounded-full bg-surface-2 text-text-2"><Upload className="size-5" /></span>
          <div className="text-sm font-medium">Drop an .xlsx, .xlsb or .csv here, or click to choose</div>
          <div className="max-w-[560px] text-[11.5px] text-text-3">Pravah reads the header row, works out what the file is, suggests a column mapping and remembers it for next month. Re-importing the same period updates records instead of duplicating them.</div>
          <input ref={inputRef} type="file" accept=".xlsx,.xlsb,.xlsm,.csv" multiple hidden onChange={e => { if (e.target.files) drop(e.target.files); e.target.value = '' }} />
        </div>
      )}

      {open && <MappingCard imp={open} kinds={kinds} onClose={() => setOpenId(null)} />}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title="History" as="h3"><span className="text-[11px] text-text-3">Latest first</span></CardHeader>
          <Q q={q}>{list => list.length === 0 ? <EmptyState title="Nothing imported yet" icon={<FileSpreadsheet className="size-5" />}>Start with the purchase register (PO list) and the sales register exported from SAP.</EmptyState> : (
            <div className="divide-y divide-border">
              {list.map(i => {
                const [tone, label] = STATUS[i.status]
                const pct = i.rowsTotal ? Math.min(100, Math.round((i.rowsDone / i.rowsTotal) * 100)) : 0
                return (
                  <div key={i.id} className="flex flex-col gap-1.5 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <FileSpreadsheet className="size-4 text-text-3" />
                      <div className="mr-auto min-w-0">
                        <div className="truncate text-xs font-medium">{i.filename} <span className="font-normal text-text-3">· {kinds.find(k => k.kind === i.kind)?.label ?? i.kind ?? 'unknown kind'}</span></div>
                        <div className="text-[11px] text-text-3">{dateTime(i.createdAt)}{i.periodFrom ? ` · ${i.periodFrom} → ${i.periodTo}` : ''}{i.sheet ? ` · sheet ${i.sheet}` : ''}</div>
                      </div>
                      <StatusPill tone={tone}>{label}</StatusPill>
                      {i.status === 'detected' && <Button size="sm" onClick={() => setOpenId(i.id)}>Map and run</Button>}
                      {(i.status === 'done' || i.status === 'failed') && !readOnly && <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => api.rerunImport(i.id), 'Import queued again')}><RefreshCw />Rerun</Button>}
                    </div>
                    {(i.status === 'running' || i.status === 'queued') && <div className="h-1.5 w-full overflow-hidden rounded bg-surface-3"><div className="h-full bg-acc transition-[width]" style={{ width: `${pct}%` }} /></div>}
                    {i.status === 'done' && <div className="text-[11.5px] text-text-2">{i.summary.headline} · {int(i.rowsTotal)} rows read, {int(i.rowsCreated)} new, {int(i.rowsUpdated)} updated{i.rowsSkipped ? `, ${int(i.rowsSkipped)} skipped` : ''}{i.summary.route && <> · <Link to={i.summary.route}>Open {i.summary.module}</Link></>}</div>}
                    {i.status === 'failed' && i.errors[0] && <Banner tone="bad">{i.errors[0].message}</Banner>}
                    {i.errors.length > 0 && i.status === 'done' && <details className="text-[11.5px]"><summary className="cursor-pointer text-warn">{i.errors.length} row{i.errors.length > 1 ? 's' : ''} skipped</summary>
                      <ul className="mt-1 max-h-40 overflow-auto font-mono text-[11px]">{i.errors.map((e, k) => <li key={k}>Row {e.row}: {e.message}</li>)}</ul>
                      <Button size="xs" className="mt-1" onClick={() => downloadCsv(`import-${i.id}-errors.csv`, ['Row', 'Message'], i.errors.map(e => [e.row, e.message]))}><Download />Download errors</Button></details>}
                  </div>
                )
              })}
            </div>
          )}</Q>
        </Card>
        <SourcesPanel />
      </div>
    </>
  )
}

function MappingCard({ imp, kinds, onClose }: { imp: ImportRun; kinds: ImportKind[]; onClose: () => void }) {
  const { act, pending } = useAct()
  const [kind, setKind] = useState(imp.kind ?? '')
  const [sheet, setSheet] = useState(imp.sheet ?? '')
  const [mapping, setMapping] = useState<Record<string, number>>(imp.mapping ?? {})
  const [remember, setRemember] = useState(true)
  const [preview, setPreview] = useState<{ rows: Record<string, unknown>[]; errors: { row: number; message: string }[]; missing: string[] } | null>(null)
  useEffect(() => { setKind(imp.kind ?? ''); setSheet(imp.sheet ?? ''); setMapping(imp.mapping ?? {}) }, [imp.id, imp.kind, imp.sheet, imp.mapping])
  const spec = kinds.find(k => k.kind === kind)
  const missing = useMemo(() => spec ? spec.fields.filter(f => f.required && mapping[f.key] === undefined && !(f.key.endsWith('_name') && mapping[f.key.replace('_name', '')] !== undefined) && !(f.key.endsWith('_code') && mapping[f.key.replace('_code', '')] !== undefined)).map(f => f.label) : [], [spec, mapping])
  const used = new Set(Object.values(mapping))
  if (imp.status !== 'detected' && imp.status !== 'failed') return null
  return (
    <Card>
      <CardHeader title={`Map ${imp.filename}`} as="h3">
        <span className="text-[11px] text-text-3">{int(imp.rowsTotal)} rows{imp.summary.remembered ? ' · layout remembered from an earlier import' : imp.summary.score ? ` · detection confidence ${Math.round(imp.summary.score * 100)}%` : ''}</span>
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}><X /></Button>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-text-2">What is this file?<NativeSelect label="Import kind" value={kind} onChange={v => { setKind(v); setPreview(null); const k = kinds.find(x => x.kind === v); if (k && v !== imp.kind) setMapping({}) }} options={[['', 'Choose…'], ...kinds.map(k => [k.kind, k.label] as [string, string])]} /></label>
          {imp.sheets.length > 1 && <label className="flex flex-col gap-1 text-xs font-medium text-text-2">Sheet<NativeSelect label="Sheet" value={sheet} onChange={async v => { setSheet(v); const r = await act(() => api.previewImport(imp.id, { kind: kind || 'purchase_register', sheet: v, mapping: {} })); if (r?.import) setMapping(r.import.mapping) }} options={imp.sheets.map(s => [s, s])} /></label>}
          <span className="text-[11px] text-text-3">{spec ? `Lands in ${spec.module}` : ''}</span>
        </div>
        {spec && (
          <div className="overflow-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead><tr className="bg-surface-2 text-left text-[11px] text-text-2"><th className="px-2.5 py-1.5">Pravah field</th><th className="px-2.5 py-1.5">Column in the file</th><th className="px-2.5 py-1.5">Sample</th></tr></thead>
              <tbody>
                {spec.fields.map(f => (
                  <tr key={f.key} className="border-t border-border">
                    <td className="px-2.5 py-1.5">{f.label}{f.required && <span className="text-bad"> *</span>}<span className="ml-1 text-[10px] text-text-3">{f.type}</span></td>
                    <td className="px-2.5 py-1">
                      <select aria-label={f.label} value={mapping[f.key] ?? ''} onChange={e => { const v = e.target.value; setMapping(m => { const n = { ...m }; if (v === '') delete n[f.key]; else n[f.key] = Number(v); return n }); setPreview(null) }}
                        className={cn('h-7 w-full max-w-[320px] rounded-md border bg-surface px-2 text-xs', mapping[f.key] === undefined && f.required ? 'border-bad' : 'border-border-2')}>
                        <option value="">— not in this file —</option>
                        {imp.headers.map((h, i) => <option key={i} value={i} disabled={used.has(i) && mapping[f.key] !== i}>{h}</option>)}
                      </select>
                    </td>
                    <td className="max-w-[260px] truncate px-2.5 py-1 font-mono text-[11px] text-text-3">{mapping[f.key] !== undefined ? String(imp.preview[0]?.[mapping[f.key]] ?? '') : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {missing.length > 0 && <Banner tone="warn">Still needed: {missing.join(', ')}</Banner>}
        {preview && (
          <div className="overflow-auto rounded-md border border-border">
            <div className="bg-surface-2 px-2.5 py-1.5 text-[11px] font-semibold text-text-2">Parsed preview · first {preview.rows.length} rows{preview.errors.length ? ` · ${preview.errors.length} would be skipped` : ''}</div>
            <table className="w-full text-[11px]"><tbody>
              {preview.rows.map((r, i) => <tr key={i} className="border-t border-border">{Object.entries(r).filter(([, v]) => v !== null && v !== undefined).slice(0, 10).map(([k, v]) => <td key={k} className="px-2 py-1 whitespace-nowrap"><span className="text-text-3">{k}</span> {String(v)}</td>)}</tr>)}
              {preview.errors.map((e, i) => <tr key={'e' + i} className="border-t border-border text-bad"><td className="px-2 py-1" colSpan={10}>Row {e.row}: {e.message}</td></tr>)}
            </tbody></table>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!spec || pending} onClick={async () => { const r = await act(() => api.previewImport(imp.id, { kind, sheet, mapping })); if (r) setPreview(r) }}>Preview</Button>
          <Button variant="default" disabled={!spec || pending || missing.length > 0} onClick={async () => { if (await act(() => api.runImport(imp.id, { kind, sheet, mapping, remember }), 'Import started')) { toast.info('Progress shows in the history below'); onClose() } }}><Check />Run import</Button>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-[var(--primary)]" checked={remember} onChange={e => setRemember(e.target.checked)} />Remember this layout for next time</label>
        </div>
      </CardBody>
    </Card>
  )
}

function SourcesPanel() {
  const { entity } = useSession()
  const sources = useSources().data ?? []
  const integ = useIntegrations().data
  const imports = (integ?.imports ?? []).filter(i => i.entityId === entity.id)
  return (
    <Card>
      <CardHeader title="Data sources" as="h3"><Database className="size-4 text-text-3" /></CardHeader>
      <div className="divide-y divide-border text-xs">
        {sources.map(s => (
          <div key={s.key} className="flex items-center justify-between gap-2 px-4 py-2.5">
            <span className="flex flex-col"><span className="font-medium">{s.system}</span><span className="text-[11px] text-text-3">{s.at ? `Last ${dateTime(s.at)}${s.detail ? ' · ' + s.detail : ''}` : s.error ?? 'Not connected'}</span></span>
            <Freshness k={s.key} />
          </div>
        ))}
        {imports.length > 0 && <div className="px-4 py-2.5">
          <div className="mb-1 text-[11px] font-semibold text-text-2">Last import per kind</div>
          {imports.map(i => <div key={i.kind} className="flex justify-between gap-2 py-0.5 text-[11.5px]"><span>{i.kind.replace(/_/g, ' ')}</span><span className="text-text-3">{i.periodFrom ? `${i.periodFrom} → ${i.periodTo} · ` : ''}{dateTime(i.finishedAt)}</span></div>)}
        </div>}
        <div className="px-4 py-2.5 text-[11px] text-text-3">GST portal and bank connections come later; their screens read what the registers already hold. <Link to="/settings/integrations">Integrations</Link></div>
      </div>
    </Card>
  )
}
