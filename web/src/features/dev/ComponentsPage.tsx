import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Amount, Banner, Card, CardBody, CardHeader, Chip, CompareCell, Confidence, Count, EmptyState, ErrorState, ExceptionCard, FieldRow, Freshness, Gstin, KpiCard, MsmeBadge, PageHeader, Prio, Restricted, Segmented, Sk, Sla, Source, StatusPill, TimelineStage, Avatar,
} from '@/components/pravah'
import { useState } from 'react'

/** Living version of the design's "Component set" artboard. */
export default function ComponentsPage() {
  const [seg, setSeg] = useState<'entity' | 'firm'>('entity')
  return (
    <>
      <PageHeader title="Component set" sub="IBM Plex Sans with tabular figures · Plex Mono for GSTIN, PAN, IRN and document numbers · one status system, always icon + text" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(380px,1fr))] gap-4">
        <Card><CardHeader title="Status pill" /><CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2"><StatusPill tone="ok">Matched</StatusPill><StatusPill tone="warn">Within tolerance</StatusPill><StatusPill tone="bad">Mismatch</StatusPill><StatusPill tone="none">Missing</StatusPill><StatusPill tone="acc">Stage / info</StatusPill><StatusPill tone="ok" plain>Plain</StatusPill></div>
          <div className="flex flex-wrap items-center gap-3"><Sla>SLA +3 d</Sla><Prio p="Critical" /><Prio p="High" /><Prio p="Medium" /><Prio p="Low" /></div>
        </CardBody></Card>
        <Card><CardHeader title="Chips" /><CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2"><Source name="SAP" syncKey="sap" /><Source name="GST portal" syncKey="gst" /><Source name="Bank" syncKey="bank" /><Source name="Extracted" text="92%" /></div>
          <div className="flex flex-wrap gap-2"><Freshness k="sap" /><Freshness k="bank" /><Gstin g="27AAACX0000X1Z5" state="27 · Maharashtra" /></div>
          <div className="flex flex-wrap items-center gap-2"><MsmeBadge cls="Micro" udyam /><Chip>GTA · RCM</Chip><Chip acc>Linked</Chip><Count n={9} tone="bad" /><Count n={23} tone="acc" /></div>
          <div className="flex gap-1.5">{['VJ', 'RK', 'PN', 'FS', 'SU'].map(i => <Avatar key={i} id={i} />)}<Avatar id="KM" size="lg" /></div>
        </CardBody></Card>
        <Card><CardHeader title="Buttons & inputs" /><CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2"><Button variant="default"><Check />Confirm</Button><Button>Secondary</Button><Button variant="destructive">Reject</Button><Button variant="ghost">Ghost</Button></div>
          <div className="flex flex-wrap items-center gap-2"><Button size="sm">Small</Button><Button variant="default" size="lg">Approve ₹58,72,450.00</Button></div>
          <Segmented label="Demo" value={seg} onChange={setSeg} options={[{ value: 'entity', label: 'Entity' }, { value: 'firm', label: 'Firm' }]} />
        </CardBody></Card>
        <Card><CardHeader title="KPI card" /><CardBody className="grid grid-cols-2 gap-2.5">
          <KpiCard k={{ id: 'a', label: 'Posted AP outstanding', value: 18704310, sub: '412 invoices', source: 'SAP', syncKey: 'sap' }} />
          <KpiCard k={{ id: 'b', label: 'MSME dues near 45-day limit', value: 730480, sub: '4 invoices', source: 'SAP', syncKey: 'sap', tone: 'warn', status: '2 days' }} />
        </CardBody></Card>
        <Card><CardHeader title="Amounts & confidence" /><CardBody className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-4"><Amount n={105020} /><Amount n={-12390} /><Amount n={0} /><Amount n={4720} delta /><Amount n={1} masked /></div>
          <div className="flex gap-4"><Confidence value={96} /><Confidence value={82} /><Confidence value={64} /></div>
          <FieldRow f={{ key: 'd', label: 'Invoice date', value: '10-10-2026', confidence: 97 }} />
          <FieldRow f={{ key: 'i', label: 'IRN · unconfirmed', value: 'a3f9c2d7…61d7e71c', confidence: 71, mono: true }} />
        </CardBody></Card>
        <Card><CardHeader title="Comparison cell" /><CardBody className="grid grid-cols-5 gap-1">
          <CompareCell c={{ s: 'ok', v: '₹85.00', num: true }} /><CompareCell c={{ s: 'warn', v: '₹8,010.00', d: '+₹360.00', num: true }} /><CompareCell c={{ s: 'bad', v: '₹87.00', d: '+₹2.00/pc', num: true }} /><CompareCell c={{ s: 'none', v: 'Not captured' }} /><CompareCell c={{ s: 'na' }} />
        </CardBody></Card>
      </div>
      <Card><CardHeader title="Timeline stage" /><div className="overflow-auto p-4"><div className="grid min-w-[600px] grid-cols-4">
        <TimelineStage s={{ key: 'grn', name: 'GRN', state: 'done', date: '08-10-2026 16:10', owner: 'Suresh Patil · Stores', ownerId: 'SU', ref: 'GRN 5000098812', docs: [], sla: { tone: 'ok', label: '6 h · SLA 1 d' } }} />
        <TimelineStage s={{ key: 'review', name: 'Invoice review', state: 'cur', date: 'Received 13-10-2026', owner: 'Rohan Kulkarni · AP', ownerId: 'RK', ref: 'SPK/2026-27/0418', docs: [], sla: { tone: 'warn', label: 'Day 1 of 2' } }} />
        <TimelineStage s={{ key: 'payment', name: 'Payment', state: 'blk', date: 'Due 18-10-2026', owner: 'Farah Siddiqui', ownerId: 'FS', ref: 'Vendor 100448', docs: [], sla: { tone: 'bad', label: 'Blocked · bank change' } }} />
        <TimelineStage last s={{ key: 'recon', name: 'Reconciled', state: 'ns', date: 'After bank statement', owner: 'Automatic', ref: 'Clearing doc —', docs: [], sla: { tone: 'none', label: 'Not started' } }} />
      </div></div></Card>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
        <ExceptionCard x={{ id: 'EX-1019', entityId: 'x', type: 'GRN missing', title: 'Invoice received, no goods receipt in SAP', docRef: 'DST/1187', ownerId: 'SU', status: 'open', priority: 'Critical', due: '2026-10-09', createdAt: '2026-10-07', amount: 472000, comments: [], history: [] }} />
        <Card><EmptyState title="Nothing waiting for review">New documents appear here as they arrive.</EmptyState></Card>
        <Card><CardBody className="flex flex-col gap-2" aria-busy="true"><Sk className="w-3/4" /><Sk className="h-5 w-1/2" /><Sk /><Sk className="w-5/6" /></CardBody></Card>
        <Card><ErrorState error={new Error("The sync at 15:12 timed out after 30 s.")} onRetry={() => {}} /></Card>
        <Card><Restricted>Auditor role. Approving payments needs the Controller or CFO role.</Restricted></Card>
      </div>
      <Banner tone="warn"><b>Stale data.</b> Bank feed last synced 26 h ago.</Banner>
    </>
  )
}
