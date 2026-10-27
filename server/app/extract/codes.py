"""QR codes on the paper. The e-invoice QR is a JWT signed by the IRP: its payload carries the invoice's key facts exactly,
so they are compared with what the model read. Its signature is checked by the GSP (domain/verify.py), not here."""
import base64
import json
import logging

import zxingcpp

from .render import RENDERABLE, RenderError, render_page

log = logging.getLogger('pravah.extract')
EINVOICE_KEYS = ('SellerGstin', 'BuyerGstin', 'DocTyp', 'DocNo', 'DocDt', 'TotInvVal', 'ItemCnt', 'MainHsnCode', 'Irn', 'IrnDt')
MAX_PAGES = 20
MAX_TEXT = 8000
_BINARIZERS = (zxingcpp.Binarizer.LocalAverage, zxingcpp.Binarizer.GlobalHistogram)


def _b64(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + '=' * (-len(part) % 4))


def parse_einvoice(text: str) -> dict | None:
    """The signed QR's invoice facts, or None when the text is not an e-invoice JWT."""
    parts = (text or '').strip().split('.')
    if len(parts) != 3:
        return None
    try:
        payload = json.loads(_b64(parts[1]))
        data = payload.get('data', payload) if isinstance(payload, dict) else None
        if isinstance(data, str):
            data = json.loads(data)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict) or not data.get('Irn') or not data.get('SellerGstin'):
        return None
    return {k: (str(data[k]).strip() if data.get(k) is not None else None) for k in EINVOICE_KEYS}


def decode(data: bytes, mime: str, pages: int, rotations: list[int]) -> list[dict]:
    """Every QR code on every page, read from upright renders: [{page, text, einvoice}]."""
    if mime not in RENDERABLE:
        return []
    found: list[dict] = []
    for n in range(1, min(pages, MAX_PAGES) + 1):
        rot = rotations[n - 1] if n - 1 < len(rotations) else 0
        try:
            img = render_page(data, mime, n, rot, dpi=300).convert('L')
        except RenderError as e:
            log.warning('QR scan skipped page %s: %s', n, e)
            continue
        seen: set[str] = set()
        for b in _BINARIZERS:
            try:
                results = zxingcpp.read_barcodes(img, formats=zxingcpp.BarcodeFormat.QRCode, binarizer=b, try_rotate=True, try_downscale=True)
            except Exception as e:
                log.warning('QR scan failed on page %s: %s', n, e)
                break
            for r in results:
                text = (r.text or '')[:MAX_TEXT]
                if text and text not in seen:
                    seen.add(text)
                    found.append({'page': n, 'text': text, 'einvoice': parse_einvoice(text)})
    return found


def einvoice_of(codes: list[dict] | None) -> tuple[dict, str] | None:
    """The first e-invoice QR among the codes: (facts, signed text)."""
    for c in codes or []:
        if c.get('einvoice'):
            return c['einvoice'], c['text']
    return None
