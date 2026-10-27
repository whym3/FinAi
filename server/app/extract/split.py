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


ROTATIONS = (0, 90, 180, 270)


def clean_rotations(values, pages: int) -> list[int]:
    """One clockwise rotation per page; anything that is not a quarter turn reads as 0."""
    out = []
    for i in range(pages):
        v = values[i] if i < len(values or []) else 0
        out.append(v if v in ROTATIONS else 0)
    return out


def upright_pdf(data: bytes, rotations: list[int]) -> bytes:
    """The same PDF with each page turned so its text reads upright. Returns the input when nothing turns."""
    if not any(rotations or []):
        return data
    r = PdfReader(io.BytesIO(data))
    w = PdfWriter()
    for i, page in enumerate(r.pages):
        deg = rotations[i] if i < len(rotations) else 0
        if deg:
            page.rotate(deg)
        w.add_page(page)
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()
