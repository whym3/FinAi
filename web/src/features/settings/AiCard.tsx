import { useEffect, useState } from 'react'
import { KeyRound, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody, CardHeader, EmptyState, Segmented, StatusPill } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useAiSettings } from '@/mock/hooks'
import * as api from '@/mock/api'
import { date } from '@/lib/format'
import type { AiProvider } from '@/lib/types'
import { ADMIN, Field, NativeSelect } from './clients/parts'

const NAME: Record<AiProvider, string> = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini' }
const KEY_HINT: Record<AiProvider, string> = { anthropic: 'console.anthropic.com → API keys', openai: 'platform.openai.com → API keys', gemini: 'aistudio.google.com → Get API key' }

/** Which model reads incoming documents. Keys are write-only: the server only ever says whether one is set. */
export function AiCard() {
  const { user, serverOnline } = useSession()
  const q = useAiSettings()
  const { act, pending } = useAct()
  const s = q.data
  const [p, setP] = useState<AiProvider>('anthropic')
  const [key, setKey] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  useEffect(() => { if (s) setP(s.activeProvider) }, [s])
  useEffect(() => { setKey(''); setModels([]); setModel(s?.models[p] ?? '') }, [p, s])
  const canEdit = ADMIN.includes(user.role)

  if (!serverOnline) return <Card><CardHeader title="AI extraction" as="h3" /><EmptyState title="Server offline">Start the backend to configure extraction.</EmptyState></Card>
  if (!s) return null
  const k = s.keys[p]
  return (
    <Card>
      <CardHeader title="AI extraction" as="h3"><span className="text-[11px] text-text-3">Reads emailed invoices into fields</span></CardHeader>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented label="Provider" value={p} onChange={setP} options={(['anthropic', 'openai', 'gemini'] as const).map(v => ({ value: v, label: NAME[v] }))} />
          {s.activeProvider === p ? <StatusPill tone="ok">In use</StatusPill> : <StatusPill tone="none" plain>Not in use</StatusPill>}
        </div>
        <div className="text-[11.5px] text-text-2">
          <KeyRound className="mr-1 inline size-3.5" />
          {k.set ? `API key saved on ${date(k.setOn!)}` : k.fromEnv ? 'Using the key from the server environment' : 'No API key yet'} · get one at {KEY_HINT[p]}
        </div>
        {canEdit && <>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={k.set ? 'Replace API key' : 'API key'} className="min-w-[220px] flex-1"><Input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder={k.set ? '•••••••• saved' : 'Paste key'} /></Field>
            <Button disabled={pending || (!key && !k.set && !k.fromEnv)} onClick={async () => { const r = await act(() => api.testAiKey(p, key || undefined), r => `Key works · ${r.models.length} models`); if (r) { setModels(r.models); if (!model && r.models.length) setModel(r.models[0]) } }}><Sparkles />Test & load models</Button>
          </div>
          <Field label="Model" hint={models.length ? 'From the provider’s live list' : 'Test the key to pick from the live list'}>
            {models.length ? <NativeSelect label="Model" value={model} onChange={setModel} options={models.map(m => [m, m])} />
              : <Input value={model} onChange={e => setModel(e.target.value)} className="font-mono" placeholder="model id" />}
          </Field>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-[var(--primary)]" checked={s.autoExtract} disabled={pending}
            onChange={e => act(() => api.saveAiSettings({ auto_extract: e.target.checked }), e.target.checked ? 'New documents are extracted automatically' : 'Extraction only on request')} />Extract new documents automatically</label>
          <div className="flex justify-end">
            <Button variant="default" disabled={pending || !model} onClick={async () => {
              if (await act(() => api.saveAiSettings({ active_provider: p, models: { [p]: model }, ...(key ? { keys: { [p]: key } } : {}) }), `${NAME[p]} · ${model} is now used for extraction`)) setKey('')
            }}>Use {NAME[p]}</Button>
          </div>
        </>}
        <div className="text-[11px] text-text-3">Each provider needs its own API key; a Claude.ai, ChatGPT or Gemini app subscription cannot be used by other apps. Documents are sent to the provider for reading, and every extracted value stays unconfirmed until a person checks it.</div>
      </CardBody>
    </Card>
  )
}
