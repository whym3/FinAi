import hashlib
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import WORK_ROLES, audit, current_user, require_entity, require_role
from ..config import settings
from ..db import get_db
from ..imports.kinds import KINDS, auto_map, describe, detect, fingerprint, missing_required
from ..imports.readers import cell_date, header_and_preview, kind_of, sheet_names
from ..imports.run import parse_row
from ..models import Import, ImportLayout, Job, User
from ..serialize import import_out

router = APIRouter(prefix='/api', tags=['imports'])
IMPORT_ROLES = WORK_ROLES | {'ar'}


def get_import(db: Session, u: User, imp_id: int) -> Import:
    imp = db.get(Import, imp_id)
    if not imp:
        raise HTTPException(404, 'Import not found')
    require_entity(u, imp.entity_id)
    return imp


@router.get('/import-kinds')
def kinds(_: User = Depends(current_user)):
    return [describe(k) for k in KINDS]


@router.get('/imports')
def list_imports(entity: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    return [import_out(i) for i in db.scalars(select(Import).where(Import.entity_id == entity).order_by(Import.id.desc()).limit(100))]


@router.get('/imports/{imp_id}')
def read_import(imp_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    return import_out(get_import(db, u, imp_id))


def _inspect(imp: Import, db: Session, sheet: str | None = None) -> None:
    sheets = sheet_names(imp.storage_path, imp.filename)
    imp.sheets = sheets
    # the sheet with the most rows is the data; pivots are small
    best, best_rows = sheet or sheets[0], -1
    if not sheet and len(sheets) > 1:
        for s in sheets:
            try:
                _, _, _, n = header_and_preview(imp.storage_path, imp.filename, s)
            except Exception:
                continue
            if n > best_rows:
                best, best_rows = s, n
    imp.sheet = best
    h, headers, preview, total = header_and_preview(imp.storage_path, imp.filename, best)
    imp.headers, imp.preview, imp.rows_total = headers, preview, total
    imp.summary = {**(imp.summary or {}), 'headerRow': h}
    kind, score, mapping = detect(headers)
    fp = fingerprint(headers)
    layout = db.scalar(select(ImportLayout).where(ImportLayout.entity_id == imp.entity_id, ImportLayout.fingerprint == fp))
    if layout:
        kind, mapping = layout.kind, layout.mapping
        imp.summary['remembered'] = True
    imp.kind, imp.mapping = kind, mapping
    imp.summary['score'] = score
    imp.summary['missing'] = missing_required(kind, mapping) if kind else []


@router.post('/imports/upload', status_code=201)
async def upload(entity: str, request: Request, file: UploadFile = File(...), u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    require_role(u, entity, IMPORT_ROLES, 'import data')
    name = file.filename or 'import'
    if not kind_of(name):
        raise HTTPException(422, 'Upload an .xlsx, .xlsb or .csv file')
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f'Larger than {settings.max_upload_mb} MB')
    sha = hashlib.sha256(data).hexdigest()
    path = Path(settings.storage_dir) / entity / 'imports' / f'{sha}{Path(name).suffix.lower()}'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    imp = Import(entity_id=entity, filename=name, storage_path=str(path), size=len(data), created_by=u.id, status='detected')
    db.add(imp)
    db.flush()
    try:
        _inspect(imp, db)
    except Exception as e:
        imp.status, imp.errors = 'failed', [{'row': 0, 'message': f'Could not read the file: {e}'[:300]}]
    audit(db, u.id, entity, 'Uploaded import file', name, f'{imp.kind or "unknown kind"} · {imp.rows_total:,} rows', request=request)
    db.commit()
    return import_out(imp)


class MappingIn(BaseModel):
    kind: str
    sheet: str | None = None
    mapping: dict[str, int]
    remember: bool = True


@router.post('/imports/{imp_id}/preview')
def preview(imp_id: int, body: MappingIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Parsed first rows under a candidate mapping, so the user sees dates and amounts before running."""
    imp = get_import(db, u, imp_id)
    if body.kind not in KINDS:
        raise HTTPException(422, 'Unknown import kind')
    if body.sheet and body.sheet != imp.sheet:
        _inspect(imp, db, body.sheet)
        imp.mapping = auto_map(body.kind, imp.headers)
        db.commit()
        return {'import': import_out(imp), 'rows': [], 'missing': missing_required(body.kind, imp.mapping)}
    rows, errors = [], []
    for i, raw in enumerate(imp.preview):
        try:
            r = parse_row(body.kind, body.mapping, [cell_date(v) if isinstance(v, str) and len(v) == 10 and v[4] == '-' else v for v in raw])
            rows.append({k: (v.isoformat() if hasattr(v, 'isoformat') else v) for k, v in r.items()})
        except Exception as e:
            errors.append({'row': i + 1, 'message': str(e)})
    return {'rows': rows, 'errors': errors, 'missing': missing_required(body.kind, body.mapping)}


@router.post('/imports/{imp_id}/run')
def run(imp_id: int, body: MappingIn, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    imp = get_import(db, u, imp_id)
    require_role(u, imp.entity_id, IMPORT_ROLES, 'import data')
    if imp.status in ('queued', 'running'):
        raise HTTPException(409, 'This import is already running')
    if body.kind not in KINDS:
        raise HTTPException(422, 'Unknown import kind')
    miss = missing_required(body.kind, body.mapping)
    if miss:
        raise HTTPException(422, 'Map these columns first: ' + ', '.join(miss))
    if body.sheet and body.sheet != imp.sheet:
        _inspect(imp, db, body.sheet)
    imp.kind, imp.mapping, imp.status, imp.errors = body.kind, body.mapping, 'queued', []
    if body.remember:
        fp = fingerprint(imp.headers)
        layout = db.scalar(select(ImportLayout).where(ImportLayout.entity_id == imp.entity_id, ImportLayout.kind == body.kind, ImportLayout.fingerprint == fp))
        if layout:
            layout.mapping = body.mapping
        else:
            db.add(ImportLayout(entity_id=imp.entity_id, kind=body.kind, fingerprint=fp, mapping=body.mapping))
    db.add(Job(kind='import', payload={'import_id': imp.id}))
    audit(db, u.id, imp.entity_id, 'Started import', imp.filename, f'{KINDS[body.kind]["label"]} · sheet {imp.sheet}', request=request)
    db.commit()
    return import_out(imp)


@router.post('/imports/{imp_id}/rerun')
def rerun(imp_id: int, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    imp = get_import(db, u, imp_id)
    require_role(u, imp.entity_id, IMPORT_ROLES, 'import data')
    if imp.status in ('queued', 'running') or not imp.kind:
        raise HTTPException(409, 'Cannot rerun this import')
    imp.status, imp.errors, imp.rows_done = 'queued', [], 0
    db.add(Job(kind='import', payload={'import_id': imp.id}))
    audit(db, u.id, imp.entity_id, 'Re-ran import', imp.filename, request=request)
    db.commit()
    return import_out(imp)
