// React Query wrappers over the mock API. Screens only talk to these hooks.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useSession } from '@/app/session'
import * as api from './api'

const useEntityId = () => useSession().entity.id

export const useOverview = () => { const e = useEntityId(); return useQuery({ queryKey: ['overview', e], queryFn: () => api.getOverview(e) }) }
export const useFirmOverview = () => useQuery({ queryKey: ['firm'], queryFn: api.getFirmOverview })
export const useCounts = () => { const e = useEntityId(); return useQuery({ queryKey: ['counts', e], queryFn: () => api.getCounts(e) }) }
export const useNotifications = () => { const e = useEntityId(); return useQuery({ queryKey: ['notifications', e], queryFn: () => api.listNotifications(e) }) }
export const useAudit = () => { const e = useEntityId(); return useQuery({ queryKey: ['audit', e], queryFn: () => api.listAudit(e) }) }
export const useSearch = (q: string) => { const e = useEntityId(); return useQuery({ queryKey: ['search', e, q], queryFn: () => api.search(e, q), enabled: q.trim().length >= 2 }) }

export const useIntake = () => { const e = useEntityId(); return useQuery({ queryKey: ['intake', e], queryFn: () => api.listIntake(e) }) }
export const usePOs = () => { const e = useEntityId(); return useQuery({ queryKey: ['pos', e], queryFn: () => api.listPOs(e) }) }
export const usePO = (id: string) => useQuery({ queryKey: ['po', id], queryFn: () => api.getPO(id) })
export const useInvoices = () => { const e = useEntityId(); return useQuery({ queryKey: ['invoices', e], queryFn: () => api.listInvoices(e) }) }
export const useInvoice = (id: string) => useQuery({ queryKey: ['invoice', id], queryFn: () => api.getInvoice(id) })
export const useExceptions = () => { const e = useEntityId(); return useQuery({ queryKey: ['exceptions', e], queryFn: () => api.listExceptions(e) }) }
export const useRules = () => useQuery({ queryKey: ['rules'], queryFn: api.listRules })
export const useGst = (gstin: string) => { const e = useEntityId(); return useQuery({ queryKey: ['gst', e, gstin], queryFn: () => api.getGst(e, gstin) }) }
export const useRuns = () => { const e = useEntityId(); return useQuery({ queryKey: ['runs', e], queryFn: () => api.listRuns(e) }) }
export const useRun = (id: string) => useQuery({ queryKey: ['run', id], queryFn: () => api.getRun(id) })
export const useAp = () => { const e = useEntityId(); return useQuery({ queryKey: ['ap', e], queryFn: () => api.listAp(e) }) }
export const useApprovals = () => { const { entity, user } = useSession(); return useQuery({ queryKey: ['approvals', entity.id, user.id], queryFn: () => api.listApprovals(entity.id, user.id) }) }
export const useVendors = () => { const e = useEntityId(); return useQuery({ queryKey: ['vendors', e], queryFn: () => api.listVendors(e) }) }
export const useVendor = (id: string) => useQuery({ queryKey: ['vendor', id], queryFn: () => api.getVendor(id) })
export const useCustomers = () => { const e = useEntityId(); return useQuery({ queryKey: ['customers', e], queryFn: () => api.listCustomers(e) }) }
export const useAr = () => { const e = useEntityId(); return useQuery({ queryKey: ['ar', e], queryFn: () => api.listAr(e) }) }
export const useBank = () => { const e = useEntityId(); return useQuery({ queryKey: ['bank', e], queryFn: () => api.getBank(e) }) }
export const useTds = () => { const e = useEntityId(); return useQuery({ queryKey: ['tds', e], queryFn: () => api.listTds(e) }) }
export const useMsme = () => { const e = useEntityId(); return useQuery({ queryKey: ['msme', e], queryFn: () => api.listMsme(e) }) }
export const useClose = () => { const e = useEntityId(); return useQuery({ queryKey: ['close', e], queryFn: () => api.listClose(e) }) }
export const useReports = () => useQuery({ queryKey: ['reports'], queryFn: api.listReports })

/**
 * Run any API mutation: `act(() => api.x(...), 'Saved')`.
 * shortcut: every success invalidates all queries; fine for a mock, scope the keys when the backend is real.
 */
export function useAct() {
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: (job: () => Promise<unknown>) => job(),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: Error) => toast.error(e.message),
  })
  const act = async <R,>(job: () => Promise<R>, success?: string | ((r: R) => string)): Promise<R | undefined> => {
    try {
      const r = (await m.mutateAsync(job)) as R
      if (success) toast.success(typeof success === 'function' ? success(r) : success)
      return r
    } catch {
      return undefined
    }
  }
  return { act, pending: m.isPending }
}
