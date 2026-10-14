"""Deterministic checks after the model, plus parsers. A failed check lowers confidence so a person must confirm the field (design rule 2)."""
import re
from datetime import date, datetime

from ..validate import check_gstin
from .schemas import FIELD_META

LOW = 60  # below the web's 90% "confirm me" line


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


def build_fields(kind: str, raw: dict) -> list[dict]:
    """Model output → web ExtractedField[] with checks applied."""
    meta = FIELD_META.get(kind, FIELD_META['generic'])
    out: dict[str, dict] = {}
    for key, (label, mono, num) in meta.items():
        cell = raw.get(key) or {}
        v = cell.get('value') if isinstance(cell, dict) else cell
        if v in (None, ''):
            continue
        conf = max(0, min(100, int((cell.get('confidence') if isinstance(cell, dict) else 0) or 0)))
        out[key] = {'key': key, 'label': label, 'value': str(v).strip(), 'confidence': conf, **({'mono': True} if mono else {}), **({'num': True} if num else {})}

    def flag(key: str, tone: str, label: str, lower: bool = True):
        if key in out:
            out[key]['check'] = {'tone': tone, 'label': label}
            if lower:
                out[key]['confidence'] = min(out[key]['confidence'], LOW)

    for key in ('gstin', 'billTo', 'vendorGstin', 'buyerGstin', 'transporterGstin'):
        if key in out:
            g = check_gstin(out[key]['value'].replace(' ', ''))
            if g['errors'] or g['warnings']:
                flag(key, 'bad' if g['errors'] else 'warn', (g['errors'] or g['warnings'])[0])
            else:
                flag(key, 'ok', 'Valid format and check digit', lower=False)

    if kind in ('invoice', 'invoice_copy', 'credit_note', 'debit_note', 'delivery_challan'):
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
            flag('irn', 'warn', 'IRN should be 64 hex characters')
    if kind == 'weighbridge':
        g, t, n = (to_num(out[k]['value']) if k in out else None for k in ('grossKg', 'tareKg', 'netKg'))
        if g is not None and t is not None and n is not None:
            flag('netKg', 'ok' if abs(g - t - n) <= 1 else 'warn', 'Gross − tare = net' if abs(g - t - n) <= 1 else f'Gross − tare = {g - t:,.0f}, not {n:,.0f}', lower=abs(g - t - n) > 1)
    return list(out.values())


def build_lines(kind: str, raw: dict) -> list[dict]:
    lines = []
    for ln in raw.get('lines') or []:
        if kind == 'goods_receipt':
            lines.append({'desc': ln.get('description') or '', 'hsn': ln.get('hsn') or '', 'qty': to_num(ln.get('receivedQty')) or 0, 'unit': ln.get('unit') or '',
                          'rate': 0, 'amount': to_num(ln.get('acceptedQty')) or 0, 'confidence': int(ln.get('confidence') or 0),
                          'poItem': ln.get('poItem'), 'material': ln.get('materialCode'), 'accepted': to_num(ln.get('acceptedQty')), 'rejected': to_num(ln.get('rejectedQty')),
                          'batch': ln.get('batch'), 'storageLoc': ln.get('storageLoc')})
        else:
            lines.append({'desc': ln.get('description') or '', 'hsn': ln.get('hsn') or '', 'qty': to_num(ln.get('qty')) or 0, 'unit': ln.get('unit') or '',
                          'rate': to_num(ln.get('rate')) or 0, 'amount': to_num(ln.get('amount')) or 0, 'confidence': int(ln.get('confidence') or 0),
                          'taxRate': to_num(ln.get('taxRate')), 'item': ln.get('item'), 'material': ln.get('materialCode'), 'deliveryDate': ln.get('deliveryDate')})
    return lines


def values(fields: list[dict]) -> dict[str, str]:
    return {f['key']: f['value'] for f in fields}
