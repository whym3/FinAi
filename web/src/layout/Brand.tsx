import { cn } from '@/lib/utils'

export function BrandMark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <span aria-hidden className={cn('grid flex-none place-items-center rounded-[7px] bg-acc text-on-acc', className)} style={{ width: size, height: size }}>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M3 8c3-3 6-3 9 0s6 3 9 0" /><path d="M3 16c3-3 6-3 9 0s6 3 9 0" /></svg>
    </span>
  )
}
