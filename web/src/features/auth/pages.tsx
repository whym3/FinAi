import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import QRCode from 'qrcode'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Banner } from '@/components/pravah'
import * as api from '@/api'
import { ApiError } from '@/api/http'
import { AuthShell, Field } from './AuthShell'

function useSubmit<T, A = void>(job: (arg: A) => Promise<T>, onDone: (r: T) => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (arg: A) => {
    setBusy(true); setError(null)
    try { onDone(await job(arg)) } catch (err) { setError(err instanceof ApiError ? err.message : 'Something went wrong') } finally { setBusy(false) }
  }
  const submit = (e?: FormEvent) => { e?.preventDefault(); return run(undefined as A) }
  return { busy, error, submit, run }
}

/** Where to go once the password step is done: the app, or the authenticator step when the server requires it. */
const after = (next: string, from?: string | null) => next === 'mfa_verify' ? '/mfa' : next === 'mfa_enrol' ? '/mfa/enrol' : (from && from.startsWith('/') && !from.startsWith('//') ? from : '/')

export function SetupPage() {
  const nav = useNavigate()
  const status = useQuery({ queryKey: ['auth-status'], queryFn: api.authStatus })
  const [f, setF] = useState({ firm_name: '', firm_short: '', frn: '', name: '', email: '', password: '' })
  const { busy, error, submit } = useSubmit(() => api.setup(f), r => nav(after(r.next), { replace: true }))
  useEffect(() => { if (status.data && !status.data.needsSetup) nav('/login', { replace: true }) }, [status.data, nav])
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <AuthShell title="Set up Pravah" sub="This runs once: your firm and the first admin account. Everyone else is invited from Settings.">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Firm name"><Input value={f.firm_name} onChange={set('firm_name')} placeholder="Mehta & Rao Chartered Accountants" required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Short name"><Input value={f.firm_short} onChange={set('firm_short')} placeholder="Mehta & Rao" required /></Field>
          <Field label="Firm registration no."><Input value={f.frn} onChange={set('frn')} placeholder="Optional" /></Field>
        </div>
        <Field label="Your name"><Input value={f.name} onChange={set('name')} required /></Field>
        <Field label="Work email"><Input type="email" value={f.email} onChange={set('email')} required autoComplete="username" /></Field>
        <Field label="Password" hint="At least 12 characters."><Input type="password" value={f.password} onChange={set('password')} required minLength={12} autoComplete="new-password" /></Field>
        {error && <Banner tone="bad" role="alert">{error}</Banner>}
        <Button variant="default" type="submit" disabled={busy} className="mt-1">Create firm and admin</Button>
      </form>
    </AuthShell>
  )
}

export function LoginPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [sp] = useSearchParams()
  const status = useQuery({ queryKey: ['auth-status'], queryFn: api.authStatus })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, submit } = useSubmit(() => api.login(email, password), r => { qc.clear(); nav(after(r.next, sp.get('from')), { replace: true }) })
  useEffect(() => { if (status.data?.needsSetup) nav('/setup', { replace: true }) }, [status.data, nav])
  return (
    <AuthShell title="Sign in" sub={sp.get('why') === 'expired' ? 'Your session ended. Sign in again.' : undefined} footer={<Link to="/forgot">Forgot your password?</Link>}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Email"><Input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus autoComplete="username" /></Field>
        <Field label="Password"><Input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></Field>
        {error && <Banner tone="bad" role="alert">{error}</Banner>}
        <Button variant="default" type="submit" disabled={busy} className="mt-1">Continue</Button>
      </form>
    </AuthShell>
  )
}

function CodeForm({ onSubmit, busy, error, label }: { onSubmit: (code: string) => void; busy: boolean; error: string | null; label: string }) {
  const [code, setCode] = useState('')
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(code) }} className="flex flex-col gap-3">
      <Field label={label}><Input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" value={code} onChange={e => setCode(e.target.value)} className="font-mono text-base tracking-[.2em]" placeholder="123 456" autoFocus required /></Field>
      {error && <Banner tone="bad" role="alert">{error}</Banner>}
      <Button variant="default" type="submit" disabled={busy || code.replace(/\s/g, '').length < 6}>Verify</Button>
    </form>
  )
}

export function MfaPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { busy, error, run } = useSubmit((code: string) => api.mfaVerify(code), () => { qc.clear(); nav('/', { replace: true }) })
  return (
    <AuthShell title="Enter your code" sub="Open your authenticator app and type the 6-digit code for Pravah." footer={<Link to="/login">Back to sign in</Link>}>
      <CodeForm label="Authenticator code" busy={busy} error={error} onSubmit={run} />
    </AuthShell>
  )
}

export function MfaEnrolPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [enrol, setEnrol] = useState<{ secret: string; otpauth: string } | null>(null)
  const [qr, setQr] = useState('')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    api.mfaEnrol().then(async r => { setEnrol(r); setQr(await QRCode.toDataURL(r.otpauth, { margin: 1, width: 196 })) }).catch(e => setErr(e.message))
  }, [])
  const { busy, error, run } = useSubmit((code: string) => api.mfaConfirm(code), () => { qc.clear(); nav('/', { replace: true }) })
  return (
    <AuthShell title="Set up your authenticator" sub="Pravah needs a second factor for everyone. Scan this with Google Authenticator, Microsoft Authenticator, 1Password or Authy, then enter the code it shows.">
      {err && <Banner tone="bad" role="alert">{err}</Banner>}
      {enrol && (
        <div className="mb-4 flex flex-col items-center gap-2">
          {qr && <img src={qr} alt="QR code for the authenticator app" width={196} height={196} className="rounded-md border border-border bg-white p-1" />}
          <details className="text-[11px] text-text-3"><summary className="cursor-pointer">Can't scan? Enter the key by hand</summary><code className="mt-1 block font-mono text-xs break-all text-text">{enrol.secret}</code></details>
        </div>
      )}
      <CodeForm label="Code from the app" busy={busy} error={error} onSubmit={run} />
    </AuthShell>
  )
}

export function ForgotPage() {
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const { busy, error, submit } = useSubmit(() => api.forgotPassword(email), () => setDone(true))
  return (
    <AuthShell title="Reset your password" footer={<Link to="/login">Back to sign in</Link>}>
      {done ? <Banner tone="ok">If that address has an account, a reset link is on its way. It is valid for 2 hours. If the firm has not set up email, ask your admin for the link.</Banner> : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Email"><Input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus /></Field>
          {error && <Banner tone="bad" role="alert">{error}</Banner>}
          <Button variant="default" type="submit" disabled={busy}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  )
}

export function ResetPage() {
  const { token = '' } = useParams()
  const nav = useNavigate()
  const [password, setPassword] = useState('')
  const { busy, error, submit } = useSubmit(() => api.resetPassword(token, password), () => nav('/login', { replace: true }))
  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="New password" hint="At least 12 characters"><Input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={12} required autoFocus autoComplete="new-password" /></Field>
        {error && <Banner tone="bad" role="alert">{error}</Banner>}
        <Button variant="default" type="submit" disabled={busy}>Save and sign in</Button>
      </form>
    </AuthShell>
  )
}

export function InvitePage() {
  const { token = '' } = useParams()
  const nav = useNavigate()
  const info = useQuery({ queryKey: ['invite', token], queryFn: () => api.inviteInfo(token), retry: false })
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  useEffect(() => { if (info.data) setName(info.data.name) }, [info.data])
  const { busy, error, submit } = useSubmit(() => api.acceptInvite(token, name, password), r => nav(after(r.next), { replace: true }))
  if (info.error) return <AuthShell title="Invite not valid"><Banner tone="bad">{(info.error as Error).message}</Banner></AuthShell>
  return (
    <AuthShell title={info.data ? `Join ${info.data.firm}` : 'Join Pravah'} sub={info.data && <>Your account is <b>{info.data.email}</b>. Choose a password.</>}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Your name"><Input value={name} onChange={e => setName(e.target.value)} required /></Field>
        <Field label="Password" hint="At least 12 characters"><Input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={12} required autoComplete="new-password" /></Field>
        {error && <Banner tone="bad" role="alert">{error}</Banner>}
        <Button variant="default" type="submit" disabled={busy || !info.data}>Create account</Button>
      </form>
    </AuthShell>
  )
}
