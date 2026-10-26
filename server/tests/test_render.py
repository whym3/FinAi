"""Pages turned upright for the model and the viewer, and evidence crops served per page."""
import hashlib
import io
from datetime import UTC, datetime

from PIL import Image
from pypdf import PdfReader, PdfWriter

from app.extract import render
from app.extract.split import clean_rotations, upright_pdf
from app.models import Entity, SourceDocument


def pdf(*sizes) -> bytes:
    w = PdfWriter()
    for width, height in sizes:
        w.add_blank_page(width=width, height=height)
    b = io.BytesIO()
    w.write(b)
    return b.getvalue()


def jpeg_with_orientation(orientation: int) -> bytes:
    img = Image.new('RGB', (40, 20), 'white')
    exif = img.getexif()
    exif[0x0112] = orientation
    b = io.BytesIO()
    img.save(b, format='JPEG', exif=exif)
    return b.getvalue()


def test_clean_rotations_keeps_only_quarter_turns():
    assert clean_rotations([90, 45, None, 270], 5) == [90, 0, 0, 270, 0]


def test_upright_pdf_turns_only_the_marked_pages():
    data = pdf((200, 100), (200, 100))
    assert upright_pdf(data, [0, 0]) is data
    r = PdfReader(io.BytesIO(upright_pdf(data, [90, 0])))
    assert r.pages[0].rotation == 90 and r.pages[1].rotation == 0


def test_render_page_turns_pdf_pages_and_images():
    data = pdf((200, 100))
    assert render.render_page(data, 'application/pdf', 1, 0, dpi=72).size == (200, 100)
    assert render.render_page(data, 'application/pdf', 1, 90, dpi=72).size == (100, 200)
    jpg = jpeg_with_orientation(6)  # camera held sideways: EXIF says turn 90°
    assert render.render_page(jpg, 'image/jpeg', 1).size == (20, 40)
    sent, mime = render.for_model(jpg, 'image/jpeg', [0])
    assert mime == 'image/png' and Image.open(io.BytesIO(sent)).size == (20, 40)
    plain = jpeg_with_orientation(1)
    assert render.for_model(plain, 'image/jpeg', [0]) == (plain, 'image/jpeg')


def test_crop_pads_and_keeps_a_minimum_height():
    img = Image.new('RGB', (1000, 1000))
    assert render.crop(img, {'x0': 100, 'y0': 500, 'x1': 300, 'y1': 510}).size == (320, 130)
    assert render.crop(img, {'x0': 100, 'y0': 500, 'x1': 300, 'y1': 510}, pad=0).size == (200, 120)


def _doc(db, entity_id, path, data, rotations):
    d = SourceDocument(entity_id=entity_id, channel='Upload', received_at=datetime.now(UTC), filename='p.pdf', mime='application/pdf', size=len(data),
                       sha256=hashlib.sha256(data).hexdigest(), storage_path=str(path), pages=2, kind='goods_receipt', page_rotations=rotations)
    db.add(d)
    db.flush()
    return d


def test_page_and_upright_endpoints(client, db, firm, sign_in, tmp_path):
    f, e, admin = firm
    data = pdf((200, 100), (200, 100))
    path = tmp_path / 'p.pdf'
    path.write_bytes(data)
    d = _doc(db, e.id, path, data, [90, 0])
    assert client.get(f'/api/files/{d.id}/pages/1.png').status_code == 401
    sign_in(admin)
    r = client.get(f'/api/files/{d.id}/pages/1.png?width=100')
    assert r.status_code == 200 and r.headers['content-type'] == 'image/png'
    assert Image.open(io.BytesIO(r.content)).size == (100, 200)  # page 1 is shown upright
    r = client.get(f'/api/files/{d.id}/pages/1.png?box=0,0,500,500&width=200')
    assert r.status_code == 200 and Image.open(io.BytesIO(r.content)).width == 200
    assert client.get(f'/api/files/{d.id}/pages/3.png').status_code == 422
    assert client.get(f'/api/files/{d.id}/pages/1.png?box=0,0,1200,10').status_code == 422
    assert client.get(f'/api/files/{d.id}/pages/1.png?box=a,b,c,d').status_code == 422
    assert client.get(f'/api/files/{d.id}/pages/1.png?width=5000').status_code == 422
    r = client.get(f'/api/files/{d.id}?upright=true')
    assert r.status_code == 200 and PdfReader(io.BytesIO(r.content)).pages[0].rotation == 90
    assert client.get(f'/api/files/{d.id}').content == data  # the original is untouched


def test_page_endpoint_respects_client_access(client, db, firm, sign_in, tmp_path):
    from app.models import User
    f, e, admin = firm
    other = Entity(id='other', firm_id=f.id, legal_name='Other Ltd', short_name='Other', city='', pan='AAACO1234A', status='active')
    db.add(other)
    db.flush()
    data = pdf((200, 100))
    path = tmp_path / 'o.pdf'
    path.write_bytes(data)
    d = _doc(db, other.id, path, data, [0])
    ap = db.query(User).filter_by(email='ap@apollo.in').one()
    sign_in(ap)
    assert client.get(f'/api/files/{d.id}/pages/1.png').status_code == 403
