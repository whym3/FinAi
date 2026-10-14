"""Runs an import: streams the file, maps columns, upserts records in chunks, records progress and row errors."""
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import audit
from ..domain.link import find_or_create_party, find_po, relink_po
from ..models import CustomerInvoice, CustomerInvoiceLine, EntityPlant, GoodsReceipt, GrLine, Import, Party, PoLine, PurchaseOrder, StockBalance, StockMovement, SupplierInvoice
from ..notify import notify
from .kinds import KINDS, missing_required
from .readers import cell_date, cell_num, cell_str, iter_rows, split_code_name

CHUNK = 500
MAX_ERRORS = 100
CREDIT_MEMO_TYPES = {'ZRE', 'RE', 'G2', 'CR', 'ZCR', 'L2'}


class RowError(Exception):
    pass


def parse_row(kind: str, mapping: dict[str, int], raw: list) -> dict:
    spec = KINDS[kind]['fields']
    out: dict = {}
    for field, idx in mapping.items():
        if field not in spec or idx is None or idx >= len(raw):
            continue
        v = raw[idx]
        t = spec[field][2]
        if t == 'code_name':
            code, name = split_code_name(v)
            base = field  # vendor / customer
            out.setdefault(f'{base}_code', code)
            out.setdefault(f'{base}_name', name)
            continue
        if t == 'num':
            out[field] = cell_num(v)
        elif t == 'int':
            n = cell_num(v)
            out[field] = int(n) if n is not None else None
        elif t == 'date':
            out[field] = cell_date(v)
        elif t == 'code':
            out[field] = cell_str(v)
        else:
            out[field] = cell_str(v)
    for field, (label, required, _) in spec.items():
        if required and out.get(field) in (None, '') and not (field.endswith('_name') and out.get(field.replace('_name', '_code'))):
            raise RowError(f'{label} is empty')
    return out


class Writer:
    """Base: subclasses write one parsed row. Keep per-import caches so 30,000 lines do not mean 30,000 lookups."""

    def __init__(self, db: Session, entity_id: str, import_id: int | None):
        self.db, self.entity_id, self.import_id = db, entity_id, import_id
        self.created = self.updated = 0
        self.seen: set = set()
        self.plants: set[str] = set()

    def write(self, r: dict) -> None:
        raise NotImplementedError

    def finish(self) -> dict:
        for code in self.plants:
            if not self.db.scalar(select(EntityPlant.id).where(EntityPlant.entity_id == self.entity_id, EntityPlant.code == code)):
                self.db.add(EntityPlant(entity_id=self.entity_id, code=code))
        return {}


class PurchaseRegisterWriter(Writer):
    def __init__(self, *a):
        super().__init__(*a)
        self.pos: dict[str, PurchaseOrder] = {}
        self.vendors: dict[str, Party] = {}

    def _vendor(self, code, name) -> Party | None:
        key = code or name
        if not key:
            return None
        if key not in self.vendors:
            self.vendors[key] = find_or_create_party(self.db, self.entity_id, 'vendor', name, None, code, source='import')
        return self.vendors[key]

    def write(self, r: dict) -> None:
        no = r['po_no']
        po = self.pos.get(no)
        if not po:
            po = find_po(self.db, self.entity_id, no)
            if po:
                self.updated += 1
            else:
                po = PurchaseOrder(entity_id=self.entity_id, po_no=no, source='import')
                self.db.add(po)
                self.created += 1
            vendor = self._vendor(r.get('vendor_code'), r.get('vendor_name'))
            po.vendor_id, po.vendor_name = (vendor.id if vendor else po.vendor_id), (vendor.name if vendor else r.get('vendor_name') or po.vendor_name)
            po.date = r.get('doc_date') or po.date
            po.plant, po.doc_type, po.release_state = r.get('plant') or po.plant, r.get('doc_type') or po.doc_type, r.get('release_state') or po.release_state
            po.source, po.import_id = 'import', self.import_id
            po.taxable = po.total = 0
            self.pos[no] = po
            self.db.flush()
        item = r.get('item') or (len(po.lines) + 1) * 10
        line = next((l for l in po.lines if l.item == item), None)
        if not line:
            line = PoLine(item=item)
            po.lines.append(line)
        line.material_code, line.description, line.material_group = r.get('material'), r.get('description') or '', r.get('material_group')
        line.uom, line.qty, line.open_qty = r.get('uom'), r.get('qty') or 0, r.get('open_qty')
        line.rate, line.amount, line.tax_rate = r.get('rate') or 0, r.get('amount') if r.get('amount') is not None else (r.get('qty') or 0) * (r.get('rate') or 0), r.get('tax_rate')
        po.taxable = float(po.taxable or 0) + float(line.amount or 0)
        po.total = po.taxable
        if r.get('plant'):
            self.plants.add(r['plant'])

    def finish(self) -> dict:
        super().finish()
        for po in self.pos.values():
            relink_po(self.db, po)
        return {'headline': f'{len(self.pos):,} purchase orders → Purchase-to-pay', 'created': self.created, 'updated': self.updated}


class SalesRegisterWriter(Writer):
    def __init__(self, *a):
        super().__init__(*a)
        self.invs: dict[str, CustomerInvoice] = {}
        self.customers: dict[str, Party] = {}

    def _customer(self, r: dict) -> Party | None:
        code, name = r.get('customer_code'), r.get('customer_name')
        key = code or name
        if not key:
            return None
        if key not in self.customers:
            p = find_or_create_party(self.db, self.entity_id, 'customer', name, r.get('customer_gstin'), code, source='import', state=r.get('state'), city=r.get('city'))
            self.customers[key] = p
        return self.customers[key]

    def write(self, r: dict) -> None:
        no = r['invoice_no']
        inv = self.invs.get(no)
        if not inv:
            inv = self.db.scalar(select(CustomerInvoice).where(CustomerInvoice.entity_id == self.entity_id, CustomerInvoice.invoice_no == no))
            if inv:
                self.updated += 1
                inv.lines = []  # replaced by this file's lines
            else:
                inv = CustomerInvoice(entity_id=self.entity_id, invoice_no=no, source='import')
                self.db.add(inv)
                self.created += 1
            cust = self._customer(r)
            inv.customer_id = cust.id if cust else None
            inv.gst_invoice_no, inv.date, inv.sap_doc_type = r.get('gst_invoice_no'), r.get('date'), r.get('doc_type')
            inv.doc_type = 'credit_memo' if (r.get('doc_type') or '').upper() in CREDIT_MEMO_TYPES else 'invoice'
            inv.due_date = inv.date + timedelta(days=cust.credit_days if cust else 30) if inv.date else None
            inv.sales_order, inv.profit_center, inv.recon_account, inv.tax_code = r.get('sales_order'), r.get('profit_center'), r.get('recon_account'), r.get('tax_code')
            inv.state, inv.city, inv.marketing_person, inv.vehicle, inv.gr_no = r.get('state'), r.get('city'), r.get('marketing_person'), r.get('vehicle'), r.get('gr_no')
            inv.taxable = inv.tax = inv.total = 0
            inv.import_id = self.import_id
            self.invs[no] = inv
            self.db.flush()
        taxable, tax = r.get('taxable') or 0, r.get('tax') or 0
        total = r.get('total') if r.get('total') is not None else taxable + tax
        inv.lines.append(CustomerInvoiceLine(material_code=r.get('material'), description=r.get('description') or '', material_group=r.get('material_group'), qty=r.get('qty') or 0,
                                             uom=r.get('uom'), tax_rate=r.get('tax_rate'), taxable=taxable, tax=tax, total=total))
        inv.taxable, inv.tax, inv.total = float(inv.taxable) + taxable, float(inv.tax) + tax, float(inv.total) + total

    def finish(self) -> dict:
        super().finish()
        total = sum(float(i.total) for i in self.invs.values() if i.doc_type == 'invoice')
        return {'headline': f'{len(self.invs):,} invoices (₹{total / 1e7:,.2f} Cr) · {len(self.customers):,} customers → Receivables', 'created': self.created, 'updated': self.updated}


class StockWriter(Writer):
    def write(self, r: dict) -> None:
        doc, item = r.get('doc_no'), r.get('item')
        row = None
        if doc and item is not None:
            row = self.db.scalar(select(StockMovement).where(StockMovement.entity_id == self.entity_id, StockMovement.doc_no == doc, StockMovement.item == item))
        if row:
            self.updated += 1
        else:
            row = StockMovement(entity_id=self.entity_id)
            self.db.add(row)
            self.created += 1
        row.import_id, row.date, row.plant, row.storage_location = self.import_id, r.get('date'), r.get('plant'), r.get('storage_location')
        row.material_code, row.description, row.movement_type = r.get('material'), r.get('description') or '', r.get('movement_type')
        row.doc_no, row.item, row.reference, row.qty, row.uom, row.value = doc, item, r.get('reference'), r.get('qty') or 0, r.get('uom'), r.get('value')
        if r.get('plant'):
            self.plants.add(r['plant'])

    def finish(self) -> dict:
        super().finish()
        return {'headline': f'{self.created + self.updated:,} stock movements recorded', 'created': self.created, 'updated': self.updated}


class StockSummaryWriter(Writer):
    def __init__(self, *a):
        super().__init__(*a)
        self.closing = 0.0
        self.existing: dict | None = None

    def write(self, r: dict) -> None:
        if self.existing is None:  # one query for the period instead of one per row
            rows = self.db.scalars(select(StockBalance).where(StockBalance.entity_id == self.entity_id, StockBalance.period_to == r['to_date']))
            self.existing = {(b.plant, b.material_code, b.period_from): b for b in rows}
        key = (r['plant'] or '', r['material'], r.get('from_date'))
        b = self.existing.get(key)
        if b:
            self.updated += 1
        else:
            b = StockBalance(entity_id=self.entity_id, plant=key[0], material_code=key[1], period_from=key[2], period_to=r['to_date'])
            self.db.add(b)
            self.existing[key] = b
            self.created += 1
        b.import_id, b.uom = self.import_id, r.get('uom')
        for k in ('opening_qty', 'receipt_qty', 'issue_qty', 'closing_qty', 'opening_value', 'receipt_value', 'issue_value', 'closing_value'):
            setattr(b, k, r.get(k) or 0)
        self.closing += r.get('closing_value') or 0
        if r['plant']:
            self.plants.add(r['plant'])

    def finish(self) -> dict:
        super().finish()
        return {'headline': f'{self.created + self.updated:,} plant-material balances · closing stock ₹{self.closing / 1e7:,.2f} Cr', 'created': self.created, 'updated': self.updated}


class ArOpenItemsWriter(Writer):
    def write(self, r: dict) -> None:
        inv = self.db.scalar(select(CustomerInvoice).where(CustomerInvoice.entity_id == self.entity_id, CustomerInvoice.invoice_no == r['invoice_no']))
        cust = find_or_create_party(self.db, self.entity_id, 'customer', r.get('customer_name'), None, r.get('customer_code'), source='import')
        if not inv:
            inv = CustomerInvoice(entity_id=self.entity_id, invoice_no=r['invoice_no'], source='import', customer_id=cust.id if cust else None, date=r.get('date'), total=r.get('amount') or r['open_amount'])
            self.db.add(inv)
            self.created += 1
        else:
            self.updated += 1
        inv.due_date = r.get('due_date') or inv.due_date
        inv.received = float(inv.total or 0) - float(r['open_amount'])
        inv.import_id = self.import_id

    def finish(self) -> dict:
        return {'headline': f'{self.created + self.updated:,} customer open items applied → Receivables', 'created': self.created, 'updated': self.updated}


class ApOpenItemsWriter(Writer):
    def write(self, r: dict) -> None:
        vendor = find_or_create_party(self.db, self.entity_id, 'vendor', r.get('vendor_name'), None, r.get('vendor_code'), source='import')
        inv = self.db.scalar(select(SupplierInvoice).where(SupplierInvoice.entity_id == self.entity_id, SupplierInvoice.invoice_no == r['invoice_no'], SupplierInvoice.vendor_id == (vendor.id if vendor else None)))
        if not inv:
            inv = SupplierInvoice(entity_id=self.entity_id, invoice_no=r['invoice_no'], vendor_id=vendor.id if vendor else None, vendor_name=vendor.name if vendor else '', channel='SAP',
                                  date=r.get('date'), total=r.get('amount') or r['open_amount'], status='posted', supplier_gstin=vendor.gstin if vendor else None)
            self.db.add(inv)
            self.created += 1
        else:
            self.updated += 1
        inv.sap_doc_no = r.get('sap_doc') or inv.sap_doc_no
        if float(r['open_amount']) <= 0:
            inv.paid_on = inv.paid_on or date.today()

    def finish(self) -> dict:
        return {'headline': f'{self.created + self.updated:,} vendor open items applied → Payables', 'created': self.created, 'updated': self.updated}


class GrnListWriter(Writer):
    def __init__(self, *a):
        super().__init__(*a)
        self.grns: dict[str, GoodsReceipt] = {}

    def write(self, r: dict) -> None:
        no = r['grn_no']
        g = self.grns.get(no)
        if not g:
            g = self.db.scalar(select(GoodsReceipt).where(GoodsReceipt.entity_id == self.entity_id, GoodsReceipt.grn_no == no))
            if g:
                self.updated += 1
                g.lines = []
            else:
                g = GoodsReceipt(entity_id=self.entity_id, grn_no=no, source='import')
                self.db.add(g)
                self.created += 1
            vendor = find_or_create_party(self.db, self.entity_id, 'vendor', r.get('vendor_name'), None, r.get('vendor_code'), source='import') if (r.get('vendor_code') or r.get('vendor_name')) else None
            g.date, g.po_ref, g.invoice_ref = r.get('date'), r.get('po_no'), r.get('invoice_ref')
            g.vendor_id, g.vendor_name = (vendor.id if vendor else None), (vendor.name if vendor else '')
            po = find_po(self.db, self.entity_id, r.get('po_no'))
            g.po_id = po.id if po else None
            self.grns[no] = g
            self.db.flush()
        g.lines.append(GrLine(po_item=r.get('po_item'), material_code=r.get('material'), description=r.get('description') or '', uom=r.get('uom'), received_qty=r['qty'], accepted_qty=r['qty']))
        if r.get('plant'):
            self.plants.add(r['plant'])

    def finish(self) -> dict:
        super().finish()
        return {'headline': f'{len(self.grns):,} goods receipts → Purchase-to-pay', 'created': self.created, 'updated': self.updated}


class PartyMasterWriter(Writer):
    kind = 'vendor'

    def write(self, r: dict) -> None:
        p = self.db.scalar(select(Party).where(Party.entity_id == self.entity_id, Party.kind == self.kind, Party.code == r['code']))
        if p:
            self.updated += 1
        else:
            p = Party(entity_id=self.entity_id, kind=self.kind, code=r['code'], name=r['name'], source='import')
            self.db.add(p)
            self.created += 1
        p.name = r['name'] or p.name
        for k in ('gstin', 'pan', 'state', 'city', 'email', 'phone', 'udyam'):
            if r.get(k):
                setattr(p, k, r[k])
        if r.get('msme_class'):
            m = r['msme_class'].strip().title()
            p.msme_class = m if m in ('Micro', 'Small', 'Medium') else p.msme_class
        if r.get('payment_terms'):
            p.payment_terms_days = r['payment_terms']
        if r.get('credit_days'):
            p.credit_days = r['credit_days']
        p.source = 'import'

    def finish(self) -> dict:
        return {'headline': f'{self.created + self.updated:,} {self.kind}s updated', 'created': self.created, 'updated': self.updated}


class CustomerMasterWriter(PartyMasterWriter):
    kind = 'customer'


WRITERS = {'purchase_register': PurchaseRegisterWriter, 'sales_register': SalesRegisterWriter, 'stock_movements': StockWriter, 'stock_summary': StockSummaryWriter, 'ar_open_items': ArOpenItemsWriter,
           'ap_open_items': ApOpenItemsWriter, 'grn_list': GrnListWriter, 'vendor_master': PartyMasterWriter, 'customer_master': CustomerMasterWriter}


def write_rows(db: Session, entity_id: str, kind: str, rows, import_id: int | None = None, mapping: dict[str, int] | None = None, progress=None) -> dict:
    """Shared by file imports and SAP sync. `rows` yields parsed dicts (mapping None) or raw lists (mapping given)."""
    w = WRITERS[kind](db, entity_id, import_id)
    errors, n, skipped, dates = [], 0, 0, []
    date_field = KINDS[kind]['date_field']
    for i, raw in enumerate(rows):
        n += 1
        try:
            r = parse_row(kind, mapping, raw) if mapping is not None else raw
            if date_field and r.get(date_field):
                dates.append(r[date_field])
            w.write(r)
        except RowError as e:
            skipped += 1
            if len(errors) < MAX_ERRORS:
                errors.append({'row': i + 1, 'message': str(e)})
        except Exception as e:
            skipped += 1
            if len(errors) < MAX_ERRORS:
                errors.append({'row': i + 1, 'message': f'{type(e).__name__}: {e}'[:200]})
            db.rollback()
        if n % CHUNK == 0:
            db.commit()
            if progress:
                progress(n)
    summary = w.finish()
    db.commit()
    return {**summary, 'rows': n, 'skipped': skipped, 'errors': errors, 'period_from': min(dates) if dates else None, 'period_to': max(dates) if dates else None}


def run_import(db: Session, import_id: int) -> None:
    imp = db.get(Import, import_id)
    if not imp or imp.status not in ('queued', 'running'):
        return
    if imp.kind not in WRITERS:
        imp.status, imp.errors = 'failed', [{'row': 0, 'message': f'Import kind {imp.kind} is not supported yet'}]
        db.commit()
        return
    miss = missing_required(imp.kind, imp.mapping)
    if miss:
        imp.status, imp.errors = 'failed', [{'row': 0, 'message': 'Map these columns first: ' + ', '.join(miss)}]
        db.commit()
        return
    imp.status, imp.rows_done, imp.errors = 'running', 0, []
    db.commit()
    header_idx = int(imp.summary.get('headerRow', 0))

    def rows():
        for i, row in enumerate(iter_rows(imp.storage_path, imp.filename, imp.sheet)):
            if i <= header_idx or not any(v not in (None, '') for v in row):
                continue
            yield row

    def progress(n):
        imp.rows_done = n
        db.commit()

    try:
        res = write_rows(db, imp.entity_id, imp.kind, rows(), imp.id, imp.mapping, progress)
    except Exception as e:
        db.rollback()
        imp.status, imp.errors, imp.finished_at = 'failed', [{'row': 0, 'message': f'{type(e).__name__}: {e}'[:300]}], datetime.now(UTC)
        db.commit()
        raise
    imp.rows_total, imp.rows_done, imp.rows_skipped = res['rows'], res['rows'], res['skipped']
    imp.rows_created, imp.rows_updated, imp.errors = res.get('created', 0), res.get('updated', 0), res['errors']
    imp.period_from, imp.period_to = res.get('period_from'), res.get('period_to')
    imp.summary = {**imp.summary, 'headline': res.get('headline', ''), 'module': KINDS[imp.kind]['module'], 'route': KINDS[imp.kind]['route']}
    imp.status, imp.finished_at = ('done' if not (res['skipped'] and res['skipped'] == res['rows']) else 'failed'), datetime.now(UTC)
    audit(db, imp.created_by, imp.entity_id, 'Imported ' + KINDS[imp.kind]['label'], imp.filename, f'{res["rows"]:,} rows · {res.get("created", 0):,} new · {res.get("updated", 0):,} updated · {res["skipped"]:,} skipped')
    notify(db, imp.entity_id, 'Import finished', f'{imp.filename}: {imp.summary["headline"]}', '/imports', 'ok' if not res['skipped'] else 'warn')
    db.commit()
