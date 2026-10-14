import io

from pypdf import PdfReader, PdfWriter


def page_count(data: bytes, mime: str) -> int:
    if mime != 'application/pdf':
        return 1
    try:
        return len(PdfReader(io.BytesIO(data)).pages)
    except Exception:
        return 1


def slice_pdf(data: bytes, page_from: int, page_to: int) -> bytes:
    """1-based inclusive page range → a new PDF."""
    r = PdfReader(io.BytesIO(data))
    w = PdfWriter()
    for i in range(max(1, page_from) - 1, min(page_to, len(r.pages))):
        w.add_page(r.pages[i])
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()
