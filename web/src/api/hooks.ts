// React Query wrappers over the API. Screens only talk to these hooks.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useSession } from '@/app/session'
import * as api from './index'

const useEntityId = () => useSession().entity.id
const LIVE = 30_000  // lists that change as documents arrive and jobs finish

export const useOverview = () => { const e = useEntityId(); return useQuery({ queryKey: ['overview', e], queryFn: () => api.getOverview(e) }) }
export const useFirmOverview = () => useQuery({ queryKey: ['firm'], queryFn: api.getFirmOverview })
export const useCounts = () => { const e = useEntityId(); return useQuery({ queryKey: ['counts', e], queryFn: () => api.getCounts(e), refetchInterval: LIVE }) }
export const useSources = () => { const e = useEntityId(); return useQuery({ queryKey: ['sources', e], queryFn: () => api.getSources(e), refetchInterval: LIVE }) }
export const useNotifications = () => { const e = useEntityId(); return useQuery({ queryKey: ['notifications', e], queryFn: () => api.listNotifications(e), refetchInterval: LIVE }) }
export const useAudit = () => { const e = useEntityId(); return useQuery({ queryKey: ['audit', e], queryFn: () => api.listAudit(e) }) }
export const useSearch = (text: string) => { const e = useEntityId(); return useQuery({ queryKey: ['search', e, text], queryFn: () => api.search(e, text), enabled: text.trim().length >= 2 }) }
export const useEntityUsers = () => { const e = useEntityId(); return useQuery({ queryKey: ['users', e], queryFn: () => api.listUsers(e) }) }
export const useAllUsers = () => useQuery({ queryKey: ['users', 'all'], queryFn: () => api.listUsers() })

export const useIntake = () => { const e = useEntityId(); return useQuery({ queryKey: ['intake', e], queryFn: () => api.listIntake(e), refetchInterval: 10_000 }) }
export const usePOs = (p: { q?: string; plant?: string; vendor?: string; with_docs?: boolean } = {}) => { const e = useEntityId(); return useQuery({ queryKey: ['pos', e, p], queryFn: () => api.listPOs(e, p) }) }
export const usePO = (id: string) => useQuery({ queryKey: ['po', id], queryFn: () => api.getPO(id), refetchInterval: LIVE })
export const useInvoices = () => { const e = useEntityId(); return useQuery({ queryKey: ['invoices', e], queryFn: () => api.listInvoices(e), refetchInterval: LIVE }) }
export const useInvoice = (id: string) => useQuery({ queryKey: ['invoice', id], queryFn: () => api.getInvoice(id) })
export const useExceptions = () => { const e = useEntityId(); return useQuery({ queryKey: ['exceptions', e], queryFn: () => api.listExceptions(e), refetchInterval: LIVE }) }
export const useRules = () => useQuery({ queryKey: ['rules'], queryFn: api.listRules })
export const useGst = (gstin: string) => { const e = useEntityId(); return useQuery({ queryKey: ['gst', e, gstin], queryFn: () => api.getGst(e, gstin) }) }
export const useRuns = () => { const e = useEntityId(); return useQuery({ queryKey: ['runs', e], queryFn: () => api.listRuns(e) }) }
export const useRun = (id: string) => useQuery({ queryKey: ['run', id], queryFn: () => api.getRun(id) })
export const useAp = () => { const e = useEntityId(); return useQuery({ queryKey: ['ap', e], queryFn: () => api.listAp(e) }) }
export const useApprovals = () => { const e = useEntityId(); return useQuery({ queryKey: ['approvals', e], queryFn: () => api.listApprovals(e), refetchInterval: LIVE }) }
export const useVendors = () => { const e = useEntityId(); return useQuery({ queryKey: ['vendors', e], queryFn: () => api.listVendors(e) }) }
export const useVendor = (id: string) => useQuery({ queryKey: ['vendor', id], queryFn: () => api.getVendor(id) })
export const useCustomers = () => { const e = useEntityId(); return useQuery({ queryKey: ['customers', e], queryFn: () => api.listCustomers(e) }) }
export const useAr = () => { const e = useEntityId(); return useQuery({ queryKey: ['ar', e], queryFn: () => api.listAr(e) }) }
export const useBank = () => { const e = useEntityId(); return useQuery({ queryKey: ['bank', e], queryFn: () => api.getBank(e) }) }
export const useTds = () => { const e = useEntityId(); return useQuery({ queryKey: ['tds', e], queryFn: () => api.listTds(e) }) }
export const useMsme = () => { const e = useEntityId(); return useQuery({ queryKey: ['msme', e], queryFn: () => api.listMsme(e) }) }
export const useClose = () => { const e = useEntityId(); return useQuery({ queryKey: ['close', e], queryFn: () => api.listClose(e) }) }
export const useReports = () => useQuery({ queryKey: ['reports'], queryFn: api.listReports })

export const useEntity = (id: string) => useQuery({ queryKey: ['entity', id], queryFn: () => api.getEntity(id), enabled: !!id })
export const useMailboxes = (entityId: string) => useQuery({ queryKey: ['mailboxes', entityId], queryFn: () => api.listMailboxes(entityId), refetchInterval: LIVE, enabled: !!entityId })
export const useMailboxRecent = (id: number) => useQuery({ queryKey: ['mailbox-recent', id], queryFn: () => api.mailboxRecent(id), refetchInterval: LIVE })
export const useIntegrations = () => useQuery({ queryKey: ['integrations'], queryFn: api.getIntegrations, refetchInterval: LIVE })
export const useImports = () => { const e = useEntityId(); return useQuery({ queryKey: ['imports', e], queryFn: () => api.listImports(e), refetchInterval: 5_000 }) }
export const useImportKinds = () => useQuery({ queryKey: ['import-kinds'], queryFn: api.listImportKinds, staleTime: Infinity })
export const useSap = (entityId: string) => useQuery({ queryKey: ['sap', entityId], queryFn: () => api.getSap(entityId), enabled: !!entityId })
export const useAi = () => useQuery({ queryKey: ['ai'], queryFn: api.getAi })

/**
 * Run any API mutation: `act(() => api.x(...), 'Saved')`.
 * shortcut: every success invalidates all queries; scope the keys once lists get big.
 */
export function useAct() {
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: (job: () => Promise<unknown>) => job(),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: Error) => { if (!(e instanceof api.ApiError && e.status === 401)) toast.error(e.message) },
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
