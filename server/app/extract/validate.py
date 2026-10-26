"""Deterministic checks after the model, plus parsers. A failed check lowers confidence so a person must confirm the field (design rule 2).
Every field keeps the model's own confidence in `read`; checks are recomputed from it, so running them again never compounds."""
import re
from datetime import date, datetime, timedelta

from ..validate import GSTIN_RE, check_gstin
from .schemas import BOX_KEYS, FIELD_META, STAMP_KEYS, STAMP_TYPES

LOW = 60  # below the web's 90% "confirm me" line
INVOICE_KINDS = ('invoice', 'invoice_copy', 'credit_note', 'debit_note', 'delivery_challan')
GSTIN_KEYS = ('gstin', 'billTo', 'vendorGstin', 'buyerGstin', 'transporterGstin')
DATE_KEYS = ('invoiceDate', 'poDate', 'grnDate', 'gateEntryDate', 'challanDate', 'lrDate', 'date')
GST_START = date(2017, 7, 1)
PLACEHOLDER_RE = re.compile(r'^(HEADING\s*\d*|N/?A|NIL|NONE|NULL|-+|\.+|_+|:+)$', re.I)
EWB_RE = re.compile(r'^\d{12}$')
IFSC_RE = re.compile(r'^[A-Z]{4}0[A-Z0-9]{6}$')
VEHICLE_RE = re.compile(r'^([A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2})$')
HSN_RE = re.compile(r'^(\d{4}|\d{6}|\d{8})$')
HANDWRITTEN_STAMPS = ('receipt', 'approval', 'handwritten_note')


def to_num(v) -> float | None:
    if v is None or v == '':
        return None
    try:
        return float(str(v).replace(',', '').replace('₹', '').replace('Rs.', '').strip())
    except ValueError:
        m = re.search(r'-?\d[\d,]*\.?\d*', str(v))
        return float(m.group(0).replace(',', '')) if m else None


def to_date(v) -> date | None:
    if not v:
        return None
    s = str(v).strip()
    for fmt in ('%d-%m-%Y', '%d.%m.%Y', '%d/%m/%Y', '%Y-%m-%d', '%d-%m-%y', '%d/%m/%y', '%d %b %Y', '%d %B %Y'):
        try:
            return datetime.strptime(s[:len(fmt) + 4].split('(')[0].strip()[:10 if '%Y' in fmt and ' ' not in fmt else 12], fmt).date()
        except ValueError:
            continue
    m = re.search(r'(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})', s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        y = y + 2000 if y < 100 else y
        try:
            return date(y, mo, d)
        except ValueError:
            return None
    return None


def terms_days(v) -> int | None:
    if not v:
        return None
    m = re.search(r'(\d{1,3})\s*days?', str(v), re.I)
    return int(m.group(1)) if m else None


def norm_vehicle(v) -> str | None:
    return re.sub(r'[^A-Z0-9]', '', str(v).upper()) or None if v else None


def norm_code(v) -> str | None:
    return re.sub(r'\s+', '', str(v)).upper() or None if v else None


_UNITS = {w: i for i, w in enumerate('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split())}
_TENS = {w: (i + 2) * 10 for i, w in enumerate('twenty thirty forty fifty sixty seventy eighty ninety'.split())}
_SCALES = {'thousand': 1_000, 'lakh': 100_000, 'lakhs': 100_000, 'lac': 100_000, 'lacs': 100_000, 'million': 1_000_000, 'crore': 10_000_000, 'crores': 10_000_000}
_FILLER = {'rupees', 'rupee', 'rs', 'inr', 'only', 'and', 'indian', 'amount', 'total', 'of', 'in', 'words', 'the', 'sum', 'invoice', 'value'}


def _words_value(tokens: list[str]) -> int | None:
    total = current = 0
    seen = False
    for t in tokens:
        if t in _UNITS:
            current += _UNITS[t]
        elif t in _TENS:
            current += _TENS[t]
        elif t == 'hundred':
            current = (current or 1) * 100
        elif t in _SCALES:
            total += (current or 1) * _SCALES[t]
            current = 0
        else:
            return None
        seen = True
    return total + current if seen else None


def words_to_number(text: str | None) -> float | None:
    """'Rupees Eighty Five Thousand Five Hundred Fifty Only' → 85550.0, with lakh, crore and paise."""
    if not text:
        return None
    tokens = [t for t in re.sub(r'[^a-z ]', ' ', str(text).lower().replace('-', ' ')).split() if t]
    paise = 0
    if 'paise' in tokens or 'paisa' in tokens:
        i = tokens.index('paise' if 'paise' in tokens else 'paisa')
        after = []
        for t in tokens[i + 1:]:
            if t in _UNITS or t in _TENS:
                after.append(t)
            else:
                break
        before = []
        for t in reversed(tokens[:i]):
            if t in _UNITS or t in _TENS:
                before.insert(0, t)
            else:
                break
        used = after or before
        paise = _words_value(used) or 0
        rest = tokens[:i] + tokens[i + 1:]
        if after:
            rest = tokens[:i] + tokens[i + 1 + len(after):]
        elif before:
            rest = tokens[:i - len(before)] + tokens[i + 1:]
        tokens = rest
    rupees = _words_value([t for t in tokens if t not in _FILLER])
    if rupees is None:
        return None
    return rupees + paise / 100


def is_placeholder(value: str, label: str = '') -> bool:
    v = value.strip()
    if not v or PLACEHOLDER_RE.match(v) or not re.search(r'[A-Za-z0-9]', v):
        return True
    return bool(label) and v.lower().rstrip(':. ') == label.lower()


def clean_box(box, pages: int | None) -> dict | None:
    """A model box in 0-1000 page coordinates, or None when it is incomplete or impossible."""
    if not isinstance(box, dict) or any(not isinstance(box.get(k), int) or isinstance(box.get(k), bool) for k in BOX_KEYS):
        return None
    b = {k: box[k] for k in BOX_KEYS}
    if not (0 <= b['x0'] < b['x1'] <= 1000 and 0 <= b['y0'] < b['y1'] <= 1000 and b['page'] >= 1 and (pages is None or b['page'] <= pages)):
        return None
    return b


def build_fields(kind: str, raw: dict, pages: int | None = None, received: date | None = None) -> list[dict]:
    """Model output → web ExtractedField[] with checks applied."""
    meta = FIELD_META.get(kind, FIELD_META['generic'])
    out: dict[str, dict] = {}
    for key, (label, mono, num) in meta.items():
        cell = raw.get(key) or {}
        v = cell.get('value') if isinstance(cell, dict) else cell
        if v in (None, '') or is_placeholder(str(v), label):
            continue
        conf = max(0, min(100, int((cell.get('confidence') if isinstance(cell, dict) else 0) or 0)))
        out[key] = {'key': key, 'label': label, 'value': str(v).strip(), 'confidence': conf, 'read': conf, **({'mono': True} if mono else {}), **({'num': True} if num else {})}
        box = clean_box(cell.get('box') if isinstance(cell, dict) else None, pages)
        if box:
            out[key]['box'] = box
    fields = list(out.values())
    apply_checks(kind, fields, [], received)
    return fields


def apply_checks(kind: str, fields: list[dict], lines: list[dict], received: date | None = None) -> None:
    """Recompute every field's and line's check and confidence from what was read. Fields a person confirmed keep their confidence."""
    out = {f['key']: f for f in fields}
    for f in fields:
        f.pop('check', None)
        f.pop('blocking', None)
        f.pop('qr', None)
        f['confidence'] = f.get('read', f['confidence'])
    for ln in lines:
        ln.pop('check', None)
        ln['confidence'] = ln.get('read', ln.get('confidence', 0))

    def flag(key: str, tone: str, label: str, lower: bool = True, blocking: bool = False):
        if key in out:
            out[key]['check'] = {'tone': tone, 'label': label}
            if blocking:
                out[key]['blocking'] = True
            if lower and not out[key].get('confirmedBy'):
                out[key]['confidence'] = min(out[key]['confidence'], LOW)

    def line_flag(ln: dict, label: str):
        ln['check'] = {'tone': 'warn', 'label': label}
        ln['confidence'] = min(ln['confidence'], LOW)

    for key in GSTIN_KEYS:
        if key in out:
            g = check_gstin(out[key]['value'].replace(' ', ''))
            if g['errors'] or g['warnings']:
                flag(key, 'bad' if g['errors'] else 'warn', (g['errors'] or g['warnings'])[0], blocking=bool(g['errors']))
            else:
                flag(key, 'ok', 'Valid format and check digit', lower=False)

    if 'supplierPan' in out and 'gstin' in out and GSTIN_RE.match(out['gstin']['value'].replace(' ', '').upper()):
        if out['supplierPan']['value'].replace(' ', '').upper() != out['gstin']['value'].replace(' ', '').upper()[2:12]:
            flag('supplierPan', 'warn', f'PAN inside the GSTIN is {out["gstin"]["value"].replace(" ", "").upper()[2:12]}')
    if 'ewaybill' in out and not EWB_RE.match(re.sub(r'[\s-]', '', out['ewaybill']['value'])):
        flag('ewaybill', 'bad', 'E-way bill number has 12 digits', blocking=True)
    if 'ifsc' in out and not IFSC_RE.match(out['ifsc']['value'].replace(' ', '').upper()):
        flag('ifsc', 'bad', 'IFSC is 4 letters, 0, then 6 letters or digits', blocking=True)
    if 'ackNo' in out and not re.fullmatch(r'\d{12,20}', re.sub(r'\s', '', out['ackNo']['value'])):
        flag('ackNo', 'warn', 'Acknowledgement number is 12 to 20 digits')
    if 'vehicle' in out and not VEHICLE_RE.match(norm_vehicle(out['vehicle']['value']) or ''):
        flag('vehicle', 'warn', 'Not shaped like an Indian vehicle number')
    latest = (received or date.today()) + timedelta(days=1)
    for key in DATE_KEYS:
        if key in out:
            d = to_date(out[key]['value'])
            if d and d < GST_START:
                flag(key, 'warn', 'Date is before GST began (1 July 2017)')
            elif d and d > latest:
                flag(key, 'warn', 'Date is after the document was received')

    if kind in INVOICE_KINDS:
        nums = {k: to_num(out[k]['value']) if k in out else None for k in ('taxable', 'cgst', 'sgst', 'igst', 'freight', 'otherCharges', 'roundOff', 'total')}
        if nums['taxable'] is not None and nums['total'] is not None:
            expected = nums['taxable'] + sum(nums[k] or 0 for k in ('cgst', 'sgst', 'igst', 'freight', 'otherCharges', 'roundOff'))
            diff = nums['total'] - expected
            if abs(diff) > 1:
                flag('total', 'warn', f'Taxable + tax + charges differs from total by {diff:,.2f}')
            else:
                flag('total', 'ok', 'Taxable + tax = total', lower=False)
        if 'gstin' in out and 'billTo' in out:
            intra = out['gstin']['value'][:2] == out['billTo']['value'][:2]
            if intra and (nums['igst'] or 0) > 0:
                flag('igst', 'warn', 'Same-state supply should carry CGST + SGST, not IGST')
            if not intra and ((nums['cgst'] or 0) > 0 or (nums['sgst'] or 0) > 0):
                flag('cgst', 'warn', 'Inter-state supply should carry IGST, not CGST + SGST')
        if 'irn' in out and not re.fullmatch(r'[0-9a-f]{64}', out['irn']['value'].lower()):
            flag('irn', 'bad', 'IRN should be 64 hex characters', blocking=True)
        if 'amountInWords' in out and nums['total'] is not None:
            words = words_to_number(out['amountInWords']['value'])
            if words is None:
                flag('amountInWords', 'warn', 'Amount in words could not be read as a number')
            elif abs(words - nums['total']) > 1:
                flag('amountInWords', 'warn', f'Words say {words:,.2f}')
                flag('total', 'warn', f'Amount in words says {words:,.2f}')
        for ln in lines:
            q, r, a = ln.get('qty') or 0, ln.get('rate') or 0, ln.get('amount') or 0
            if q and r and abs(q * r - a) > max(1.0, abs(a) * 0.005):
                line_flag(ln, f'Qty × rate = {q * r:,.2f}, not {a:,.2f}')
            elif ln.get('hsn') and not HSN_RE.match(re.sub(r'\s', '', str(ln['hsn']))):
                line_flag(ln, 'HSN is 4, 6 or 8 digits')
        if lines and nums['taxable'] is not None:
            total_lines = sum(ln.get('amount') or 0 for ln in lines)
            if abs(total_lines - nums['taxable']) > 1:
                flag('taxable', 'warn', f'Lines add up to {total_lines:,.2f}')
            rated = [ln for ln in lines if ln.get('taxRate') is not None]
            tax = sum(nums[k] or 0 for k in ('cgst', 'sgst', 'igst'))
            if rated and len(rated) == len(lines) and tax:
                expected_tax = sum((ln.get('amount') or 0) * ln['taxRate'] / 100 for ln in lines)
                if abs(expected_tax - tax) > 2:
                    flag('igst' if nums['igst'] else 'cgst', 'warn', f'Line rates give tax of {expected_tax:,.2f}')
    if kind == 'purchase_order':
        for ln in lines:
            q, r, a = ln.get('qty') or 0, ln.get('rate') or 0, ln.get('amount') or 0
            if q and r and a:
                plain, with_tax = q * r, q * r * (1 + (ln.get('taxRate') or 0) / 100)
                if min(abs(plain - a), abs(with_tax - a)) > max(1.0, abs(a) * 0.005):
                    line_flag(ln, f'Qty × rate = {plain:,.2f}, not {a:,.2f}')
    if kind == 'weighbridge':
        g, t, n = (to_num(out[k]['value']) if k in out else None for k in ('grossKg', 'tareKg', 'netKg'))
        if g is not None and t is not None and n is not None:
            flag('netKg', 'ok' if abs(g - t - n) <= 1 else 'warn', 'Gross − tare = net' if abs(g - t - n) <= 1 else f'Gross − tare = {g - t:,.0f}, not {n:,.0f}', lower=abs(g - t - n) > 1)
    for f in fields:
        f['baseConfidence'] = f['confidence']


def blocking_error(kind: str, key: str, value: str) -> str | None:
    """Why a value can never be right for this field (an IRN of 63 characters), or None."""
    meta = FIELD_META.get(kind, FIELD_META['generic']).get(key)
    probe = [{'key': key, 'label': meta[0] if meta else key, 'value': value.strip(), 'confidence': 100, 'read': 100}]
    apply_checks(kind, probe, [])
    return probe[0]['check']['label'] if probe[0].get('blocking') else None


def apply_qr(kind: str, fields: list[dict], lines: list[dict], codes: list[dict]) -> list[dict]:
    """Compare what was read with the signed e-invoice QR; returns the fields, with any the QR alone supplies added."""
    if kind not in INVOICE_KINDS:
        return fields
    qr = next((c['einvoice'] for c in codes or [] if c.get('einvoice')), None)
    if not qr:
        return fields
    out = {f['key']: f for f in fields}
    meta = FIELD_META.get(kind, FIELD_META['invoice'])
    pairs = (('invoiceNo', 'DocNo', 'text'), ('invoiceDate', 'DocDt', 'date'), ('gstin', 'SellerGstin', 'code'), ('billTo', 'BuyerGstin', 'code'),
             ('total', 'TotInvVal', 'num'), ('irn', 'Irn', 'irn'))
    for key, qk, how in pairs:
        qv = qr.get(qk)
        if not qv or key not in meta:
            continue
        f = out.get(key)
        if not f:
            label, mono, num = meta[key]
            shown = to_date(qv).strftime('%d-%m-%Y') if how == 'date' and to_date(qv) else qv
            f = {'key': key, 'label': label, 'value': shown, 'confidence': 99, 'read': 99, 'baseConfidence': 99,
                 'check': {'tone': 'ok', 'label': 'Read from the e-invoice QR code'}, **({'mono': True} if mono else {}), **({'num': True} if num else {})}
            fields.append(f)
            out[key] = f
            continue
        v = f['value']
        if how == 'date':
            same = to_date(v) is not None and to_date(v) == to_date(qv)
        elif how == 'num':
            same = to_num(v) is not None and to_num(qv) is not None and abs(to_num(v) - to_num(qv)) <= 1
        elif how == 'irn':
            same = v.strip().lower() == qv.strip().lower()
        elif how == 'code':
            same = (norm_code(v) or '') == (norm_code(qv) or '')
        else:
            same = (norm_code(v) or '') == (norm_code(qv) or '')
        if same:
            f['check'] = {'tone': 'ok', 'label': 'Matches the e-invoice QR code'}
            if not f.get('confirmedBy'):
                f['confidence'] = max(f['confidence'], 99)
        else:
            f['check'] = {'tone': 'bad', 'label': f'QR code says {qv}'}
            f['qr'] = qv
            if not f.get('confirmedBy'):
                f['confidence'] = min(f['confidence'], LOW)
        f['baseConfidence'] = f['confidence']
    if lines and qr.get('MainHsnCode') and lines[0].get('hsn') and norm_code(lines[0]['hsn']) != norm_code(qr['MainHsnCode']):
        lines[0]['check'] = {'tone': 'warn', 'label': f'QR code says HSN {qr["MainHsnCode"]}'}
        lines[0]['confidence'] = min(lines[0].get('confidence', 0), LOW)
    elif lines and qr.get('ItemCnt') and str(qr['ItemCnt']).isdigit() and int(qr['ItemCnt']) != len(lines):
        lines[0]['check'] = {'tone': 'warn', 'label': f'QR code lists {qr["ItemCnt"]} item(s), {len(lines)} read'}
        lines[0]['confidence'] = min(lines[0].get('confidence', 0), LOW)
    return fields


def assess(kind: str, fields: list[dict], lines: list[dict], codes: list[dict], received: date | None = None) -> list[dict]:
    """All per-document checks, in order: rules, then the e-invoice QR."""
    apply_checks(kind, fields, lines, received)
    return apply_qr(kind, fields, lines, codes)


def build_lines(kind: str, raw: dict, pages: int | None = None) -> list[dict]:
    lines = []
    for ln in raw.get('lines') or []:
        conf = int(ln.get('confidence') or 0)
        if kind == 'goods_receipt':
            row = {'desc': ln.get('description') or '', 'hsn': ln.get('hsn') or '', 'qty': to_num(ln.get('receivedQty')) or 0, 'unit': ln.get('unit') or '',
                   'rate': 0, 'amount': to_num(ln.get('acceptedQty')) or 0, 'confidence': conf, 'read': conf,
                   'poItem': ln.get('poItem'), 'material': ln.get('materialCode'), 'accepted': to_num(ln.get('acceptedQty')), 'rejected': to_num(ln.get('rejectedQty')),
                   'batch': ln.get('batch'), 'storageLoc': ln.get('storageLoc')}
        else:
            row = {'desc': ln.get('description') or '', 'hsn': ln.get('hsn') or '', 'qty': to_num(ln.get('qty')) or 0, 'unit': ln.get('unit') or '',
                   'rate': to_num(ln.get('rate')) or 0, 'amount': to_num(ln.get('amount')) or 0, 'confidence': conf, 'read': conf,
                   'taxRate': to_num(ln.get('taxRate')), 'item': ln.get('item'), 'material': ln.get('materialCode'), 'deliveryDate': ln.get('deliveryDate')}
        box = clean_box(ln.get('box'), pages)
        if box:
            row['box'] = box
        lines.append(row)
    return lines


def build_annotations(raw: dict, pages: int | None = None) -> list[dict]:
    """Stamps and handwritten notes as read; empty ones are dropped."""
    out = []
    for st in raw.get('stamps') or []:
        if not isinstance(st, dict):
            continue
        vals = {k: str(st[k]).strip() for k in STAMP_KEYS if st.get(k) not in (None, '') and not is_placeholder(str(st[k]))}
        if not vals:
            continue
        kind = st.get('type') if st.get('type') in STAMP_TYPES else 'other'
        conf = max(0, min(100, int(st.get('confidence') or 0)))
        if kind in HANDWRITTEN_STAMPS:
            conf = min(conf, 70)
        a = {'type': kind, **{k: vals.get(k) for k in STAMP_KEYS}, 'confidence': conf, 'read': conf, 'baseConfidence': conf}
        box = clean_box(st.get('box'), pages)
        if box:
            a['box'] = box
        out.append(a)
    return out


def values(fields: list[dict]) -> dict[str, str]:
    return {f['key']: f['value'] for f in fields}
