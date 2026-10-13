import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { PageSkeleton } from '@/components/pravah'
import { SessionProvider } from '@/app/session'
import { router } from '@/app/router'
import './index.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SessionProvider fallback={<div className="p-6"><PageSkeleton /></div>}>
          <RouterProvider router={router} />
        </SessionProvider>
        <Toaster position="bottom-right" richColors closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
