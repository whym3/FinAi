import type { ReactNode } from 'react'
import { BrandMark } from '@/layout/Brand'

/** Centred card for sign-in, setup, MFA and invite pages. */
export function AuthShell({ title, sub, children, footer }: { title: string; sub?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-svh items-start justify-center bg-bg px-4 py-10 sm:items-center">
      <div className="w-full max-w-[420px]">
        <div className="mb-5 flex items-center gap-2.5"><BrandMark /><span className="flex flex-col"><span className="text-sm leading-[18px] font-semibold">Pravah</span><span className="text-[11px] leading-[14px] text-text-3">Finance Control</span></span></div>
        <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
          <h1 className="mb-1">{title}</h1>
          {sub && <p className="mb-4 text-xs text-text-2">{sub}</p>}
          {children}
        </div>
        {footer && <div className="mt-4 text-center text-xs text-text-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs font-medium text-text-2">{label}{children}{hint && <span className="text-[11px] font-normal text-text-3">{hint}</span>}</label>
}
