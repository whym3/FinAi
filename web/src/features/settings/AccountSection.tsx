import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody, CardHeader, KV } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct } from '@/api/hooks'
import * as api from '@/api'
import { Field } from './clients/parts'

export function AccountSection() {
  const { user } = useSession()
  const { act, pending } = useAct()
  const [cur, setCur] = useState('')
  const [pw, setPw] = useState('')
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(400px,1fr))] items-start gap-4">
      <Card>
        <CardHeader title="My account" as="h3" />
        <CardBody><KV items={[['Name', user.name], ['Email', user.email ?? ''], ['Authenticator', user.mfaEnabled ? 'Set up' : 'Not set up']]} /></CardBody>
      </Card>
      <Card>
        <CardHeader title="Change password" as="h3" />
        <CardBody className="flex flex-col gap-3">
          <Field label="Current password"><Input type="password" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" /></Field>
          <Field label="New password" hint="At least 12 characters"><Input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" /></Field>
          <Button variant="default" className="self-start" disabled={pending || pw.length < 12 || !cur} onClick={async () => { if (await act(() => api.changePassword(cur, pw), 'Password changed')) { setCur(''); setPw('') } }}>Change password</Button>
        </CardBody>
      </Card>
    </div>
  )
}
