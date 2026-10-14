from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from .. import crypto
from ..auth import audit
from ..imports.run import write_rows
from ..models import Import, SapConnection
from ..notify import notify
from .odata import SapClient

PULLS = {  # object -> (import kind, producer)
    'business_partners': ('vendor_master', lambda c, conn, since: c.business_partners('vendor')),
    'purchase_orders': ('purchase_register', lambda c, conn, since: c.purchase_orders(conn.company_code, since)),
    'goods_receipts': ('grn_list', lambda c, conn, since: c.goods_receipts(since)),
    'ar_open_items': ('ar_open_items', lambda c, conn, since: c.open_items(conn.company_code, 'ar')),
    'ap_open_items': ('ap_open_items', lambda c, conn, since: c.open_items(conn.company_code, 'ap')),
}


def sync_connection(db: Session, conn_id: int) -> None:
    conn = db.get(SapConnection, conn_id)
    if not conn or conn.status != 'active' or not conn.enc_password:
        return
    client = SapClient(conn.host, conn.client, conn.username, crypto.decrypt(conn.enc_password), conn.edition)
    since = (conn.last_sync_at - timedelta(days=1)).date() if conn.last_sync_at else None
    try:
        for obj in conn.objects or []:
            if obj not in PULLS:
                continue
            kind, produce = PULLS[obj]
            imp = Import(entity_id=conn.entity_id, kind=kind, filename=f'SAP OData · {obj}', storage_path='', status='running', created_by=None)
            db.add(imp)
            db.flush()
            res = write_rows(db, conn.entity_id, kind, produce(client, conn, since), imp.id)
            imp.rows_total = imp.rows_done = res['rows']
            imp.rows_created, imp.rows_updated, imp.rows_skipped, imp.errors = res.get('created', 0), res.get('updated', 0), res['skipped'], res['errors']
            imp.summary, imp.status, imp.finished_at = {'headline': res.get('headline', ''), 'source': 'sap'}, 'done', datetime.now(UTC)
        conn.last_sync_at, conn.last_error = datetime.now(UTC), None
        audit(db, None, conn.entity_id, 'SAP sync', conn.host, ', '.join(conn.objects or []))
        db.commit()
    except Exception as e:
        db.rollback()
        conn.status, conn.last_error = 'error', f'{type(e).__name__}: {e}'[:500]
        notify(db, conn.entity_id, 'SAP sync failed', conn.last_error, '/settings/integrations', 'bad')
        db.commit()
        raise
