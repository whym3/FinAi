"""SAP S/4HANA OData (V2) client over the standard APIs. Read-only.
shortcut: untested against a live system until a client grants access; shapes follow the public API documentation."""
from collections.abc import Iterator
from datetime import date, datetime
import re

import httpx

SERVICES = {
    'business_partner': 'API_BUSINESS_PARTNER',
    'purchase_order': 'API_PURCHASEORDER_PROCESS_SRV',
    'material_document': 'API_MATERIAL_DOCUMENT_SRV',
    'supplier_invoice': 'API_SUPPLIERINVOICE_PROCESS_SRV',
    'accounting_items': 'API_OPLACCTGDOCITEMCUBE_SRV',
}
OBJECTS = ['purchase_orders', 'goods_receipts', 'supplier_invoices', 'business_partners', 'ar_open_items', 'ap_open_items']


def _odata_date(v) -> date | None:
    """'/Date(1725148800000)/' or ISO."""
    if not v:
        return None
    m = re.match(r'/Date\((-?\d+)', str(v))
    if m:
        return datetime.utcfromtimestamp(int(m.group(1)) / 1000).date()
    try:
        return datetime.fromisoformat(str(v)[:19]).date()
    except ValueError:
        return None


class SapClient:
    def __init__(self, host: str, client: str, username: str, password: str, edition: str = 'private-cloud', timeout: float = 60):
        self.base = host.rstrip('/')
        self.client = client
        self.http = httpx.Client(auth=(username, password), timeout=timeout, headers={'Accept': 'application/json'})

    def _url(self, service: str, path: str) -> str:
        return f'{self.base}/sap/opu/odata/sap/{service}/{path}'

    def get(self, service: str, path: str, params: dict | None = None) -> dict:
        p = {'$format': 'json', **(params or {})}
        if self.client:
            p['sap-client'] = self.client
        r = self.http.get(self._url(service, path), params=p)
        r.raise_for_status()
        return r.json()

    def pages(self, service: str, entity_set: str, params: dict | None = None, page: int = 500) -> Iterator[dict]:
        skip = 0
        while True:
            j = self.get(service, entity_set, {**(params or {}), '$top': page, '$skip': skip})
            results = j.get('d', {}).get('results', j.get('value', []))
            yield from results
            if len(results) < page:
                break
            skip += page

    def test(self) -> tuple[bool, str]:
        try:
            r = self.http.get(self._url(SERVICES['business_partner'], '$metadata'), params={'sap-client': self.client} if self.client else None)
        except httpx.HTTPError as e:
            return False, f'Could not reach {self.base}: {e}'
        if r.status_code == 401:
            return False, 'SAP rejected the user name or password'
        if r.status_code == 403:
            return False, 'The communication user has no authorisation for API_BUSINESS_PARTNER'
        if r.status_code >= 400:
            return False, f'SAP answered {r.status_code} for $metadata'
        return True, 'Connected: API_BUSINESS_PARTNER metadata read'

    # ---- pulls, each yielding rows in the import-kind field names so the same writers apply ----

    def purchase_orders(self, company_code: str, since: date | None = None) -> Iterator[dict]:
        flt = f"CompanyCode eq '{company_code}'" if company_code else None
        if since:
            flt = (flt + ' and ' if flt else '') + f"CreationDate ge datetime'{since.isoformat()}T00:00:00'"
        for po in self.pages(SERVICES['purchase_order'], 'A_PurchaseOrder', {'$filter': flt, '$expand': 'to_PurchaseOrderItem'} if flt else {'$expand': 'to_PurchaseOrderItem'}):
            items = po.get('to_PurchaseOrderItem', {}).get('results', po.get('to_PurchaseOrderItem', []))
            for it in items:
                yield {'po_no': po['PurchaseOrder'], 'item': int(it.get('PurchaseOrderItem') or 0), 'doc_date': _odata_date(po.get('PurchaseOrderDate') or po.get('CreationDate')),
                       'plant': it.get('Plant'), 'vendor_code': po.get('Supplier'), 'vendor_name': None, 'material': it.get('Material'), 'material_group': it.get('MaterialGroup'),
                       'description': it.get('PurchaseOrderItemText') or '', 'qty': float(it.get('OrderQuantity') or 0), 'uom': it.get('PurchaseOrderQuantityUnit'),
                       'open_qty': None, 'rate': float(it.get('NetPriceAmount') or 0) / float(it.get('NetPriceQuantity') or 1), 'amount': float(it.get('NetAmount') or 0),
                       'release_state': po.get('ReleaseIsNotCompleted') and 'XX' or 'XXX', 'doc_type': po.get('PurchaseOrderType'), 'tax_rate': None}

    def goods_receipts(self, since: date | None = None) -> Iterator[dict]:
        flt = "GoodsMovementType eq '101'" + (f" and PostingDate ge datetime'{since.isoformat()}T00:00:00'" if since else '')
        for it in self.pages(SERVICES['material_document'], 'A_MaterialDocumentItem', {'$filter': flt}):
            yield {'grn_no': it['MaterialDocument'], 'item': int(it.get('MaterialDocumentItem') or 0), 'date': _odata_date(it.get('PostingDate')), 'po_no': it.get('PurchaseOrder'),
                   'po_item': int(it.get('PurchaseOrderItem') or 0) or None, 'vendor_code': it.get('Supplier'), 'vendor_name': None, 'material': it.get('Material'),
                   'description': it.get('MaterialDocumentItemText') or '', 'qty': float(it.get('QuantityInEntryUnit') or 0), 'uom': it.get('EntryUnit'), 'plant': it.get('Plant'),
                   'invoice_ref': it.get('DeliveryDocument') or it.get('ReferenceDocument')}

    def business_partners(self, kind: str = 'vendor') -> Iterator[dict]:
        role = 'FLVN00' if kind == 'vendor' else 'FLCU00'
        for bp in self.pages(SERVICES['business_partner'], 'A_BusinessPartner', {'$filter': f"BusinessPartnerCategory eq '2'", '$expand': 'to_BusinessPartnerRole,to_BusinessPartnerTax,to_BusinessPartnerAddress'}):
            roles = {r.get('BusinessPartnerRole') for r in bp.get('to_BusinessPartnerRole', {}).get('results', [])}
            if role not in roles:
                continue
            taxes = {t.get('BPTaxType'): t.get('BPTaxNumber') for t in bp.get('to_BusinessPartnerTax', {}).get('results', [])}
            addr = (bp.get('to_BusinessPartnerAddress', {}).get('results') or [{}])[0]
            yield {'code': bp['BusinessPartner'], 'name': bp.get('BusinessPartnerFullName') or bp.get('OrganizationBPName1') or '', 'gstin': taxes.get('IN3'), 'pan': taxes.get('IN2'),
                   'state': addr.get('Region'), 'city': addr.get('CityName'), 'email': None, 'phone': None, 'msme_class': None, 'udyam': None, 'payment_terms': None, 'credit_days': None}

    def open_items(self, company_code: str, side: str) -> Iterator[dict]:
        """side 'ar' (customers) or 'ap' (suppliers) from the accounting document item cube."""
        flt = f"CompanyCode eq '{company_code}' and ClearingDate eq null and " + ("Customer ne ''" if side == 'ar' else "Supplier ne ''")
        for it in self.pages(SERVICES['accounting_items'], 'A_OperationalAcctgDocItemCube', {'$filter': flt}):
            amt = float(it.get('AmountInCompanyCodeCurrency') or 0)
            if side == 'ar':
                yield {'customer_code': it.get('Customer'), 'customer_name': it.get('CustomerName'), 'invoice_no': it.get('DocumentReferenceID') or it.get('AccountingDocument'),
                       'date': _odata_date(it.get('DocumentDate')), 'due_date': _odata_date(it.get('NetDueDate')), 'amount': abs(amt), 'open_amount': abs(amt), 'reference': it.get('AssignmentReference')}
            else:
                yield {'vendor_code': it.get('Supplier'), 'vendor_name': it.get('SupplierName'), 'invoice_no': it.get('DocumentReferenceID') or it.get('AccountingDocument'),
                       'sap_doc': it.get('AccountingDocument'), 'date': _odata_date(it.get('DocumentDate')), 'due_date': _odata_date(it.get('NetDueDate')), 'amount': abs(amt), 'open_amount': abs(amt)}
