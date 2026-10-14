"""Import kinds: target fields, header synonyms, natural keys. Headers are matched after normalising to lowercase alphanumerics."""
import hashlib
import re

# field: (label, required, type) ; type in str | code | num | int | date | code_name
KINDS: dict[str, dict] = {
    'purchase_register': {
        'label': 'Purchase register (PO list)', 'module': 'Purchase-to-pay', 'route': '/p2p', 'date_field': 'doc_date',
        'fields': {
            'po_no': ('PO number', True, 'code'), 'item': ('PO line item', False, 'int'), 'doc_date': ('PO date', False, 'date'), 'plant': ('Plant', False, 'code'),
            'vendor': ('Vendor (code + name)', False, 'code_name'), 'vendor_code': ('Vendor code', False, 'code'), 'vendor_name': ('Vendor name', False, 'str'),
            'material': ('Material code', False, 'code'), 'material_group': ('Material group', False, 'code'), 'description': ('Description', True, 'str'),
            'qty': ('Order quantity', True, 'num'), 'uom': ('Unit', False, 'code'), 'open_qty': ('Still to be delivered', False, 'num'), 'rate': ('Net price', False, 'num'),
            'amount': ('Net order value', False, 'num'), 'release_state': ('Release state', False, 'code'), 'doc_type': ('Document type', False, 'code'), 'tax_rate': ('Tax %', False, 'num'),
        },
        'synonyms': {
            'po_no': ['purchasingdocument', 'purchasingdoc', 'ponumber', 'pono', 'purchaseorder', 'purchaseorderno', 'ebeln', 'podocument'],
            'item': ['item', 'poitem', 'lineitem', 'ebelp', 'itemno'], 'doc_date': ['documentdate', 'podate', 'date', 'orderdate', 'bedat', 'createdon'],
            'plant': ['plant', 'werks', 'plantcode'], 'vendor': ['nameofsupplier', 'supplier', 'vendor', 'suppliername', 'vendorname', 'supplierid'],
            'vendor_code': ['vendorcode', 'suppliercode', 'lifnr', 'supplierno', 'vendorno'], 'vendor_name': ['vendorname1', 'name1'],
            'material': ['material', 'materialcode', 'materialno', 'matnr', 'materialnumber'], 'material_group': ['materialgroup', 'matkl', 'matgroup'],
            'description': ['shorttext', 'description', 'materialdescription', 'itemtext', 'txz01'], 'qty': ['orderquantity', 'quantity', 'qty', 'poquantity', 'menge'],
            'uom': ['orderunit', 'unit', 'uom', 'meins', 'unitofmeasure'], 'open_qty': ['stilltobedeliveredqty', 'stilltobedelivered', 'openqty', 'openquantity', 'pendingqty', 'balanceqty'],
            'rate': ['netprice', 'price', 'rate', 'unitprice', 'netpr'], 'amount': ['netordervalue', 'netvalue', 'amount', 'value', 'ordervalue', 'netwr'],
            'release_state': ['releasestate', 'releasestatus', 'release', 'frgzu'], 'doc_type': ['purchasingdoctype', 'documenttype', 'doctype', 'bsart', 'potype'], 'tax_rate': ['taxrate', 'tax', 'gstrate', 'igst'],
        },
        'key': ['po_no', 'item'],
    },
    'sales_register': {
        'label': 'Sales register (billing)', 'module': 'Receivables', 'route': '/receivables', 'date_field': 'date',
        'fields': {
            'invoice_no': ('Billing document no.', True, 'code'), 'gst_invoice_no': ('GST invoice number', False, 'code'), 'date': ('Invoice date', True, 'date'),
            'doc_type': ('Transaction / billing type', False, 'code'), 'customer_code': ('Customer code', False, 'code'), 'customer_name': ('Customer name', True, 'str'),
            'customer': ('Customer (code + name)', False, 'code_name'), 'state': ('State', False, 'str'), 'city': ('City', False, 'str'), 'sales_order': ('Sales order', False, 'code'),
            'profit_center': ('Profit centre', False, 'code'), 'recon_account': ('Recon account', False, 'str'), 'tax_code': ('Tax code', False, 'code'), 'marketing_person': ('Sales person', False, 'str'),
            'vehicle': ('Vehicle', False, 'code'), 'gr_no': ('GR / LR no.', False, 'code'), 'material': ('Material code', False, 'code'), 'description': ('Description', False, 'str'),
            'material_group': ('Material group', False, 'code'), 'qty': ('Quantity', False, 'num'), 'uom': ('Unit', False, 'code'), 'tax_rate': ('GST %', False, 'num'),
            'taxable': ('Taxable value', True, 'num'), 'tax': ('Tax amount', False, 'num'), 'total': ('Invoice value', False, 'num'), 'customer_gstin': ('Customer GSTIN', False, 'code'),
        },
        'synonyms': {
            'invoice_no': ['invoicenumber', 'billingdocument', 'billingdoc', 'invoiceno', 'vbeln', 'documentno', 'billingdocno'],
            'gst_invoice_no': ['gstinvoicenumber', 'gstinvoiceno', 'einvoiceno', 'irninvoiceno', 'taxinvoiceno'], 'date': ['invoicedate', 'billingdate', 'date', 'fkdat', 'postingdate'],
            'doc_type': ['transactiontype', 'billingtype', 'doctype', 'fkart', 'documenttype'], 'customer_code': ['billtopartycode', 'customercode', 'customerno', 'kunnr', 'soldtoparty', 'billtoparty'],
            'customer_name': ['billtopartyname', 'customername', 'customer', 'name', 'soldtopartyname', 'partyname'], 'customer': ['billtopartycodename'],
            'state': ['billtopartystate', 'state', 'region', 'customerstate'], 'city': ['billtopartycity', 'city'], 'sales_order': ['salesorderno', 'salesorder', 'sono', 'aubel'],
            'profit_center': ['profitcenter', 'profitcentre', 'prctr'], 'recon_account': ['reconaccountdesc', 'reconaccount', 'reconciliationaccount', 'akont'], 'tax_code': ['taxcode', 'mwskz'],
            'marketing_person': ['marketingperson', 'salesperson', 'salesemployee', 'salesrep'], 'vehicle': ['vehiclenumber', 'vehicleno', 'vehicle', 'truckno'], 'gr_no': ['grno', 'lrno', 'lrnumber', 'grnumber'],
            'material': ['materialnumber', 'material', 'materialcode', 'matnr'], 'description': ['materialdescription', 'description', 'itemdescription', 'arktx'],
            'material_group': ['materialgroup', 'submaterialgroup', 'matkl'], 'qty': ['quantityinpc', 'quantity', 'qty', 'billedqty', 'fkimg'], 'uom': ['unit', 'uom'],
            'tax_rate': ['totalgst', 'gstrate', 'taxrate', 'gst'], 'taxable': ['taxablevalueininr', 'taxablevalue', 'netvalue', 'taxableamount', 'basicvalue', 'netwr'],
            'tax': ['totaltaxvalue', 'taxamount', 'taxvalue', 'gstamount', 'mwsbp'], 'total': ['invoicevalueininr', 'invoicevalue', 'totalvalue', 'grossvalue', 'invoiceamount', 'total'],
            'customer_gstin': ['customergstin', 'gstin', 'billtogstin', 'partygstin'],
        },
        'key': ['invoice_no'],
    },
    'stock_movements': {
        'label': 'Stock movements', 'module': 'Purchase-to-pay (GRN checks)', 'route': '/p2p', 'date_field': 'date',
        'fields': {
            'date': ('Posting date', True, 'date'), 'plant': ('Plant', False, 'code'), 'storage_location': ('Storage location', False, 'code'), 'material': ('Material code', True, 'code'),
            'description': ('Description', False, 'str'), 'movement_type': ('Movement type', False, 'code'), 'doc_no': ('Material document', False, 'code'), 'item': ('Item', False, 'int'),
            'reference': ('Reference (PO / order)', False, 'code'), 'qty': ('Quantity', True, 'num'), 'uom': ('Unit', False, 'code'), 'value': ('Amount', False, 'num'),
        },
        'synonyms': {
            'date': ['postingdate', 'date', 'documentdate', 'budat', 'entrydate'], 'plant': ['plant', 'werks'], 'storage_location': ['storagelocation', 'sloc', 'lgort'],
            'material': ['material', 'materialcode', 'materialno', 'matnr', 'itemcode'], 'description': ['materialdescription', 'description', 'maktx', 'itemdescription'],
            'movement_type': ['movementtype', 'mvttype', 'bwart', 'movement'], 'doc_no': ['materialdocument', 'materialdoc', 'documentno', 'mblnr', 'docno'], 'item': ['item', 'zeile', 'lineitem'],
            'reference': ['purchaseorder', 'reference', 'referencedocument', 'ebeln', 'order', 'ponumber'], 'qty': ['quantity', 'qty', 'menge', 'quantityinune', 'receiptqty'],
            'uom': ['unit', 'uom', 'meins', 'baseunit'], 'value': ['amountinlc', 'amount', 'value', 'dmbtr', 'amountinlocalcurrency'],
        },
        'key': ['doc_no', 'item'],
    },
    'stock_summary': {
        'label': 'Stock summary (opening, receipts, issues, closing)', 'module': 'Reports', 'route': '/reports', 'date_field': 'to_date',
        'fields': {
            'plant': ('Plant / valuation area', True, 'code'), 'material': ('Material', True, 'code'), 'from_date': ('From date', False, 'date'), 'to_date': ('To date', True, 'date'),
            'opening_qty': ('Opening stock', False, 'num'), 'receipt_qty': ('Receipt quantity', False, 'num'), 'issue_qty': ('Issue quantity', False, 'num'), 'closing_qty': ('Closing stock', True, 'num'),
            'uom': ('Unit', False, 'code'), 'opening_value': ('Opening value', False, 'num'), 'receipt_value': ('Receipt value', False, 'num'), 'issue_value': ('Issue value', False, 'num'),
            'closing_value': ('Closing value', False, 'num'),
        },
        'synonyms': {
            'plant': ['vala', 'valuationarea', 'plant', 'werks', 'bwkey'], 'material': ['material', 'matnr', 'materialcode'], 'from_date': ['fromdate', 'datefrom', 'startdate'],
            'to_date': ['todate', 'dateto', 'enddate'], 'opening_qty': ['openingstock', 'openingqty', 'openingquantity'], 'receipt_qty': ['totalreceiptqties', 'totalreceiptqty', 'receiptqty', 'receipts'],
            'issue_qty': ['totalissuequantities', 'totalissueqty', 'issueqty', 'issues'], 'closing_qty': ['closingstock', 'closingqty', 'closingquantity'], 'uom': ['bun', 'baseunit', 'unit', 'uom'],
            'opening_value': ['openingvalue'], 'receipt_value': ['totalreceiptvalues', 'receiptvalue'], 'issue_value': ['totalissuevalues', 'issuevalue'], 'closing_value': ['closingvalue'],
        },
        'key': ['plant', 'material', 'from_date', 'to_date'],
    },
    'ar_open_items': {
        'label': 'Customer open items (AR)', 'module': 'Receivables', 'route': '/receivables', 'date_field': 'date',
        'fields': {'customer_code': ('Customer code', True, 'code'), 'customer_name': ('Customer name', False, 'str'), 'invoice_no': ('Document / invoice no.', True, 'code'),
                   'date': ('Document date', False, 'date'), 'due_date': ('Due date', False, 'date'), 'amount': ('Amount', False, 'num'), 'open_amount': ('Open amount', True, 'num'), 'reference': ('Reference', False, 'code')},
        'synonyms': {'customer_code': ['customer', 'customercode', 'kunnr', 'account', 'customerno'], 'customer_name': ['customername', 'name', 'name1'],
                     'invoice_no': ['documentnumber', 'reference', 'invoiceno', 'billingdocument', 'belnr', 'documentno', 'xblnr'], 'date': ['documentdate', 'postingdate', 'bldat', 'date'],
                     'due_date': ['netduedate', 'duedate', 'baselinedate'], 'amount': ['amountindoccurr', 'amount', 'grossamount', 'wrbtr'], 'open_amount': ['openamount', 'amountinlocalcurrency', 'balance', 'dmbtr', 'openbalance'],
                     'reference': ['assignment', 'zuonr', 'text']},
        'key': ['invoice_no'],
    },
    'ap_open_items': {
        'label': 'Vendor open items (AP)', 'module': 'Payables', 'route': '/payables', 'date_field': 'date',
        'fields': {'vendor_code': ('Vendor code', True, 'code'), 'vendor_name': ('Vendor name', False, 'str'), 'invoice_no': ('Reference / invoice no.', True, 'code'),
                   'sap_doc': ('SAP document', False, 'code'), 'date': ('Document date', False, 'date'), 'due_date': ('Due date', False, 'date'), 'amount': ('Amount', False, 'num'), 'open_amount': ('Open amount', True, 'num')},
        'synonyms': {'vendor_code': ['vendor', 'vendorcode', 'lifnr', 'account', 'supplier', 'vendorno'], 'vendor_name': ['vendorname', 'name', 'name1', 'suppliername'],
                     'invoice_no': ['reference', 'invoiceno', 'xblnr', 'invoicenumber', 'referencedocument'], 'sap_doc': ['documentnumber', 'belnr', 'documentno', 'accountingdocument'],
                     'date': ['documentdate', 'bldat', 'invoicedate', 'date'], 'due_date': ['netduedate', 'duedate', 'baselinedate'], 'amount': ['amountindoccurr', 'amount', 'wrbtr', 'grossamount'],
                     'open_amount': ['openamount', 'amountinlocalcurrency', 'dmbtr', 'balance']},
        'key': ['invoice_no'],
    },
    'grn_list': {
        'label': 'Goods receipts (GRN list)', 'module': 'Purchase-to-pay', 'route': '/p2p', 'date_field': 'date',
        'fields': {'grn_no': ('GRN / material document', True, 'code'), 'item': ('Item', False, 'int'), 'date': ('GRN date', False, 'date'), 'po_no': ('PO number', True, 'code'), 'po_item': ('PO item', False, 'int'),
                   'vendor_code': ('Vendor code', False, 'code'), 'vendor_name': ('Vendor name', False, 'str'), 'material': ('Material', False, 'code'), 'description': ('Description', False, 'str'),
                   'qty': ('Quantity', True, 'num'), 'uom': ('Unit', False, 'code'), 'plant': ('Plant', False, 'code'), 'invoice_ref': ('Delivery note / invoice ref', False, 'code')},
        'synonyms': {'grn_no': ['materialdocument', 'grnno', 'grn', 'mblnr', 'documentno', 'goodsreceipt'], 'item': ['item', 'zeile'], 'date': ['postingdate', 'grndate', 'date', 'budat', 'documentdate'],
                     'po_no': ['purchaseorder', 'ponumber', 'pono', 'ebeln', 'purchasingdocument'], 'po_item': ['poitem', 'ebelp', 'purchaseorderitem'], 'vendor_code': ['vendor', 'vendorcode', 'lifnr', 'supplier'],
                     'vendor_name': ['vendorname', 'name', 'suppliername'], 'material': ['material', 'matnr', 'materialcode'], 'description': ['materialdescription', 'description', 'maktx'],
                     'qty': ['quantity', 'qty', 'menge', 'receivedqty'], 'uom': ['unit', 'uom', 'meins'], 'plant': ['plant', 'werks'], 'invoice_ref': ['deliverynote', 'reference', 'xblnr', 'invoiceno', 'challanno']},
        'key': ['grn_no', 'item'],
    },
    'vendor_master': {
        'label': 'Vendor master', 'module': 'Vendors', 'route': '/vendors', 'date_field': None,
        'fields': {'code': ('Vendor code', True, 'code'), 'name': ('Name', True, 'str'), 'gstin': ('GSTIN', False, 'code'), 'pan': ('PAN', False, 'code'), 'state': ('State', False, 'str'), 'city': ('City', False, 'str'),
                   'email': ('Email', False, 'str'), 'phone': ('Phone', False, 'str'), 'msme_class': ('MSME class', False, 'str'), 'udyam': ('Udyam no.', False, 'code'), 'payment_terms': ('Payment terms (days)', False, 'int')},
        'synonyms': {'code': ['vendor', 'vendorcode', 'lifnr', 'supplierno', 'vendorno', 'code'], 'name': ['name', 'name1', 'vendorname', 'suppliername'], 'gstin': ['gstin', 'gstno', 'taxnumber3', 'gstregistration'],
                     'pan': ['pan', 'panno', 'taxnumber1'], 'state': ['state', 'region'], 'city': ['city'], 'email': ['email', 'emailid', 'mail'], 'phone': ['phone', 'mobile', 'telephone', 'contact'],
                     'msme_class': ['msme', 'msmeclass', 'msmecategory', 'msmetype'], 'udyam': ['udyam', 'udyamno', 'udyamregistration', 'msmeno'], 'payment_terms': ['paymentterms', 'terms', 'creditdays', 'zterm']},
        'key': ['code'],
    },
    'customer_master': {
        'label': 'Customer master', 'module': 'Customers', 'route': '/customers', 'date_field': None,
        'fields': {'code': ('Customer code', True, 'code'), 'name': ('Name', True, 'str'), 'gstin': ('GSTIN', False, 'code'), 'pan': ('PAN', False, 'code'), 'state': ('State', False, 'str'), 'city': ('City', False, 'str'),
                   'email': ('Email', False, 'str'), 'phone': ('Phone', False, 'str'), 'credit_days': ('Credit days', False, 'int')},
        'synonyms': {'code': ['customer', 'customercode', 'kunnr', 'customerno', 'code'], 'name': ['name', 'name1', 'customername'], 'gstin': ['gstin', 'gstno', 'taxnumber3'], 'pan': ['pan', 'panno'],
                     'state': ['state', 'region'], 'city': ['city'], 'email': ['email', 'emailid'], 'phone': ['phone', 'mobile', 'telephone'], 'credit_days': ['creditdays', 'paymentterms', 'terms', 'creditperiod']},
        'key': ['code'],
    },
}


def norm(h: str) -> str:
    return re.sub(r'[^a-z0-9]', '', str(h).lower())


def fingerprint(headers: list[str]) -> str:
    return hashlib.sha256('|'.join(norm(h) for h in headers).encode()).hexdigest()


def auto_map(kind: str, headers: list[str]) -> dict[str, int]:
    spec = KINDS[kind]
    normed = [norm(h) for h in headers]
    mapping: dict[str, int] = {}
    used: set[int] = set()
    for field, syns in spec['synonyms'].items():
        for s in syns:
            for i, h in enumerate(normed):
                if i not in used and h == s:
                    mapping[field] = i
                    used.add(i)
                    break
            if field in mapping:
                break
    for field, syns in spec['synonyms'].items():  # looser: header contains the synonym
        if field in mapping:
            continue
        for s in syns:
            for i, h in enumerate(normed):
                if i not in used and len(s) >= 5 and s in h:
                    mapping[field] = i
                    used.add(i)
                    break
            if field in mapping:
                break
    return mapping


def detect(headers: list[str]) -> tuple[str | None, float, dict[str, int]]:
    """Best kind for these headers: (kind or None, score, mapping)."""
    best: tuple[str | None, float, dict] = (None, 0.0, {})
    for kind, spec in KINDS.items():
        m = auto_map(kind, headers)
        req = [f for f, (_, required, _) in spec['fields'].items() if required]
        req_ok = all(f in m or (f in ('vendor_code', 'vendor_name') and 'vendor' in m) or (f in ('customer_code', 'customer_name') and 'customer' in m) for f in req)
        score = len(m) / max(6, len(spec['fields'])) + (0.5 if req_ok else 0)
        if score > best[1]:
            best = (kind, score, m)
    kind, score, m = best
    return (kind if score >= 0.6 else None), round(score, 2), m


def missing_required(kind: str, mapping: dict[str, int]) -> list[str]:
    spec = KINDS[kind]
    out = []
    for f, (label, required, _) in spec['fields'].items():
        if not required or f in mapping:
            continue
        if f in ('vendor_code', 'vendor_name') and 'vendor' in mapping:
            continue
        if f in ('customer_code', 'customer_name') and 'customer' in mapping:
            continue
        out.append(label)
    return out


def describe(kind: str) -> dict:
    spec = KINDS[kind]
    return {'kind': kind, 'label': spec['label'], 'module': spec['module'], 'route': spec['route'],
            'fields': [{'key': f, 'label': l, 'required': r, 'type': t} for f, (l, r, t) in spec['fields'].items()]}
