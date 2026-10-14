"""Deterministic checks after the model. A failed check lowers confidence so a person must confirm the field (design rule 2)."""
from ..validate import check_gstin
from .schema import FIELDS

LOW = 60  # below the web's 90% "confirm me" line


def to_num(v: str | None) -> float | None:
    if v is None:
        return None
    try:
        return float(str(v).replace(',', '').replace('₹', '').strip())
    except ValueError:
        return None


def build_fields(raw: dict) -> list[dict]:
    """Model output → web ExtractedField[] with checks applied."""
    f = raw.get('fields') or {}
    out = {}
    for key, label, mono, num in FIELDS:
        v = (f.get(key) or {}).get('value')
        if v in (None, ''):
            continue
        conf = max(0, min(100, int((f.get(key) or {}).get('confidence') or 0)))
        out[key] = {'key': key, 'label': label, 'value': str(v).strip(), 'confidence': conf, **({'mono': True} if mono else {}), **({'num': True} if num else {})}

    def flag(key: str, tone: str, label: str, lower: bool = True):
        if key in out:
            out[key]['check'] = {'tone': tone, 'label': label}
            if lower:
                out[key]['confidence'] = min(out[key]['confidence'], LOW)

    for key in ('gstin', 'billTo'):
        if key in out:
            g = check_gstin(out[key]['value'].replace(' ', ''))
            if g['errors'] or g['warnings']:
                flag(key, 'bad' if g['errors'] else 'warn', (g['errors'] or g['warnings'])[0])

    nums = {k: to_num(out[k]['value']) if k in out else None for k in ('taxable', 'cgst', 'sgst', 'igst', 'total')}
    if nums['taxable'] is not None and nums['total'] is not None:
        tax = sum(nums[k] or 0 for k in ('cgst', 'sgst', 'igst'))
        diff = nums['total'] - nums['taxable'] - tax
        if abs(diff) > 1:
            # Freight or round-off can explain this, so it is a flag for a person, not a verdict.
            flag('total', 'warn', f'Taxable + tax differs from total by {diff:,.2f}')
        else:
            flag('total', 'ok', 'Taxable + tax = total', lower=False)

    if 'gstin' in out and 'billTo' in out:
        intra = out['gstin']['value'][:2] == out['billTo']['value'][:2]
        if intra and (nums['igst'] or 0) > 0:
            flag('igst', 'warn', 'Same-state supply should carry CGST + SGST, not IGST')
        if not intra and ((nums['cgst'] or 0) > 0 or (nums['sgst'] or 0) > 0):
            flag('cgst', 'warn', 'Inter-state supply should carry IGST, not CGST + SGST')
    return list(out.values())


def build_lines(raw: dict) -> list[dict]:
    lines = []
    for ln in raw.get('lines') or []:
        lines.append({'desc': ln.get('description') or '', 'hsn': ln.get('hsn') or '', 'qty': to_num(ln.get('qty')) or 0, 'unit': ln.get('unit') or '',
                      'rate': to_num(ln.get('rate')) or 0, 'amount': to_num(ln.get('amount')) or 0, 'confidence': int(ln.get('confidence') or 0)})
    return lines
