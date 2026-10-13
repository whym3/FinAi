import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type RowData, type RowSelectionState, type SortingState, type VisibilityState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { Card, EmptyState, Filters, Spacer } from './layout'

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    num?: boolean
    className?: string
    /** Hidden until the user turns it on in the column chooser. */
    hidden?: boolean
    label?: string
  }
}

export const th = 'sticky top-0 z-[1] border-b border-border bg-surface-2 px-2.5 py-2 text-left text-[11.5px] font-semibold whitespace-nowrap text-text-2'
export const td = 'border-b border-border px-2.5 py-2 align-middle'
export const tableCls = 'w-full border-separate border-spacing-0 text-[12.5px] leading-[18px]'
export const Chk = ({ className, ...p }: React.ComponentProps<'input'>) => <input type="checkbox" className={cn('size-[15px] cursor-pointer accent-[var(--primary)] align-middle disabled:cursor-not-allowed', className)} {...p} />

const load = (k: string) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') } catch { return null } }

export interface DataTableProps<T> {
  /** Stable id; column choices are remembered per table. */
  id: string
  data: T[]
  columns: ColumnDef<T, any>[] // eslint-disable-line @typescript-eslint/no-explicit-any
  getRowId: (r: T) => string
  selectable?: boolean
  onRowClick?: (r: T) => void
  activeId?: string
  maxHeight?: number | string
  dense?: boolean
  toolbar?: ReactNode
  bulk?: (rows: T[], clear: () => void) => ReactNode
  footer?: ReactNode
  cardFooter?: ReactNode
  empty?: ReactNode
  initialSort?: SortingState
  rowClassName?: (r: T) => string | undefined
  bare?: boolean
}

export function DataTable<T>({ id, data, columns, getRowId, selectable, onRowClick, activeId, maxHeight, dense, toolbar, bulk, footer, cardFooter, empty, initialSort, rowClassName, bare }: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSort ?? [])
  const [selection, setSelection] = useState<RowSelectionState>({})
  const [visibility, setVisibility] = useState<VisibilityState>(() => load('pv-cols-' + id) ?? Object.fromEntries(columns.filter(c => c.meta?.hidden).map(c => [c.id ?? (c as { accessorKey?: string }).accessorKey, false])))
  useEffect(() => { try { localStorage.setItem('pv-cols-' + id, JSON.stringify(visibility)) } catch { /* not remembered */ } }, [id, visibility])

  const cols = useMemo<ColumnDef<T, any>[]>(() => selectable ? [{ // eslint-disable-line @typescript-eslint/no-explicit-any
    id: '_sel', enableSorting: false, enableHiding: false, meta: { className: 'w-9 text-center' },
    header: ({ table }) => <Chk aria-label="Select all" checked={table.getIsAllRowsSelected()} ref={el => { if (el) el.indeterminate = table.getIsSomeRowsSelected() }} onChange={table.getToggleAllRowsSelectedHandler()} />,
    cell: ({ row }) => <Chk aria-label="Select row" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} onClick={e => e.stopPropagation()} />,
  }, ...columns] : columns, [columns, selectable])

  const table = useReactTable({
    data, columns: cols, getRowId: r => getRowId(r),
    state: { sorting, rowSelection: selection, columnVisibility: visibility },
    onSortingChange: setSorting, onRowSelectionChange: setSelection, onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), enableRowSelection: selectable,
  })
  const selected = table.getSelectedRowModel().rows.map(r => r.original)
  const hideable = table.getAllLeafColumns().filter(c => c.getCanHide() && c.id !== '_sel')
  const visibleCount = hideable.filter(c => c.getIsVisible()).length

  const chooser = (
    <Popover>
      <PopoverTrigger asChild><Button size="sm"><Columns3 />Columns · {visibleCount} of {hideable.length}</Button></PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1.5">
        <div className="px-2 py-1 text-[11px] font-medium text-text-3">Columns</div>
        {hideable.map(c => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[12.5px] hover:bg-surface-2">
            <Chk checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} />{c.columnDef.meta?.label ?? (typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id)}
          </label>
        ))}
        <div className="mt-1 flex justify-between border-t border-border px-1 pt-1.5">
          <Button size="sm" variant="ghost" onClick={() => table.resetColumnVisibility()}>Reset</Button>
          <Button size="sm" variant="ghost" onClick={() => table.toggleAllColumnsVisible(true)}>Show all</Button>
        </div>
      </PopoverContent>
    </Popover>
  )

  const rows = table.getRowModel().rows
  const tbl = (
    <div className="relative overflow-auto" style={{ maxHeight }}>
      <table className={tableCls}>
        <thead>
          {table.getHeaderGroups().map(hg => (
            <tr key={hg.id}>
              {hg.headers.map(h => {
                const m = h.column.columnDef.meta
                const sort = h.column.getIsSorted()
                return (
                  <th key={h.id} className={cn(th, m?.num && 'text-right', m?.className)} aria-sort={sort ? (sort === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {h.isPlaceholder ? null : h.column.getCanSort() ? (
                      <button type="button" onClick={h.column.getToggleSortingHandler()} className={cn('inline-flex cursor-pointer items-center gap-1 hover:text-text', m?.num && 'flex-row-reverse')}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sort === 'asc' ? <ArrowUp className="size-3" /> : sort === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map(r => {
            const active = activeId === r.id
            return (
              <tr key={r.id} onClick={onRowClick ? () => onRowClick(r.original) : undefined}
                className={cn('group', onRowClick && 'cursor-pointer', rowClassName?.(r.original))}
                aria-selected={active || r.getIsSelected() || undefined}>
                {r.getVisibleCells().map((c, i) => {
                  const m = c.column.columnDef.meta
                  return (
                    <td key={c.id} className={cn(td, dense && 'py-1.5', m?.num && 'text-right whitespace-nowrap tabular-nums', m?.className, 'group-hover:bg-surface-2', (active || r.getIsSelected()) && 'bg-acc-weak group-hover:bg-acc-weak', active && i === 0 && 'shadow-[inset_2px_0_0_var(--primary)]')}>
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  )
                })}
              </tr>
            )
          })}
          {!rows.length && <tr><td colSpan={table.getVisibleLeafColumns().length}>{empty ?? <EmptyState title="Nothing here">No rows match these filters.</EmptyState>}</td></tr>}
        </tbody>
        {footer && <tfoot className="[&_td]:border-b-0 [&_td]:bg-surface-2 [&_td]:px-2.5 [&_td]:py-2 [&_td]:font-semibold">{footer}</tfoot>}
      </table>
    </div>
  )

  return (
    <>
      {toolbar !== undefined && <Filters>{toolbar}<Spacer />{chooser}</Filters>}
      {bulk && selected.length > 0 && bulk(selected, () => setSelection({}))}
      {bare ? tbl : <Card>{tbl}{cardFooter}</Card>}
    </>
  )
}
