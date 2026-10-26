"""Pages as pictures: upright rendering for the model, QR decoding and evidence crops. Originals on disk are never changed."""
import io

import pypdfium2 as pdfium
from PIL import Image, ImageOps

from .split import upright_pdf

RENDERABLE = ('application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/tiff')
MODEL_IMAGES = ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
MAX_PIXELS = 40_000_000  # a page rendered bigger than this is scaled down
_EXIF_ORIENTATION = 0x0112


class RenderError(Exception):
    pass


def _rotate(img: Image.Image, deg: int) -> Image.Image:
    return img.rotate(-deg, expand=True) if deg else img  # PIL turns counter-clockwise


def _open_image(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img.seek(0)
    return ImageOps.exif_transpose(img)


def _needs_transpose(data: bytes) -> bool:
    try:
        return Image.open(io.BytesIO(data)).getexif().get(_EXIF_ORIENTATION, 1) not in (0, 1)
    except Exception:
        return False


def _png(img: Image.Image) -> bytes:
    out = io.BytesIO()
    img.save(out, format='PNG', optimize=True)
    return out.getvalue()


def render_page(data: bytes, mime: str, page_no: int, rotation: int = 0, dpi: int = 200) -> Image.Image:
    """One page (1-based) as an upright RGB image."""
    if mime not in RENDERABLE:
        raise RenderError(f'{mime} has no pages to render')
    try:
        if mime == 'application/pdf':
            pdf = pdfium.PdfDocument(data)
            try:
                if not 1 <= page_no <= len(pdf):
                    raise RenderError(f'Page {page_no} is not in this document')
                page = pdf[page_no - 1]
                w, h = page.get_size()
                scale = dpi / 72
                if w * h * scale * scale > MAX_PIXELS:
                    scale = (MAX_PIXELS / (w * h)) ** 0.5
                img = page.render(scale=scale, rotation=rotation or 0).to_pil()
            finally:
                pdf.close()
        else:
            if page_no != 1:
                raise RenderError(f'Page {page_no} is not in this document')
            img = _rotate(_open_image(data), rotation or 0)
        return img.convert('RGB')
    except RenderError:
        raise
    except Exception as e:
        raise RenderError(f'Page could not be rendered: {type(e).__name__}') from e


def crop(img: Image.Image, box: dict, pad: float = 0.06, min_h: float = 0.12) -> Image.Image:
    """The part of the page inside a 0-1000 box, padded so the value is seen with its surroundings."""
    w, h = img.size
    x0, y0, x1, y1 = (box[k] / 1000 for k in ('x0', 'y0', 'x1', 'y1'))
    x0, x1 = max(0.0, x0 - pad), min(1.0, x1 + pad)
    y0, y1 = max(0.0, y0 - pad), min(1.0, y1 + pad)
    if y1 - y0 < min_h:
        mid = (y0 + y1) / 2
        y0, y1 = max(0.0, mid - min_h / 2), min(1.0, mid + min_h / 2)
    return img.crop((int(x0 * w), int(y0 * h), max(int(x0 * w) + 1, int(x1 * w)), max(int(y0 * h) + 1, int(y1 * h))))


def page_png(data: bytes, mime: str, page_no: int, rotation: int, box: dict | None, width: int) -> bytes:
    img = render_page(data, mime, page_no, rotation, dpi=200)
    if box:
        img = crop(img, box)
    if img.width != width:
        img = img.resize((width, max(1, round(img.height * width / img.width))), Image.LANCZOS)
    return _png(img)


def upright_file(data: bytes, mime: str, rotations: list[int]) -> tuple[bytes, str]:
    """The whole file turned upright for viewing: a PDF with page rotations, or an image as PNG."""
    if mime == 'application/pdf':
        return upright_pdf(data, rotations), mime
    if mime in RENDERABLE and ((rotations and rotations[0]) or _needs_transpose(data)):
        return _png(render_page(data, mime, 1, rotations[0] if rotations else 0)), 'image/png'
    return data, mime


def for_model(data: bytes, mime: str, rotations: list[int]) -> tuple[bytes, str]:
    """What the model is sent: upright pages, and images in a format it reads."""
    if mime == 'application/pdf':
        return upright_pdf(data, rotations), mime
    if mime in RENDERABLE and ((rotations and rotations[0]) or _needs_transpose(data) or mime not in MODEL_IMAGES):
        return _png(render_page(data, mime, 1, rotations[0] if rotations else 0)), 'image/png'
    return data, mime
