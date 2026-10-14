from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import approval_limit, current_user, require_entity, role_on
from ..db import get_db
from ..models import ExceptionItem, Party, SupplierInvoice, User
from ..serialize import exception_out, f, invoice_out

router = APIRouter(prefix='/api', tags=['approvals'])


@router.get('/approvals')
def list_approvals(entity: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    require_entity(u, entity)
    lim = approval_limit(u, entity)
    invs = [i for i in db.scalars(select(SupplierInvoice).where(SupplierInvoice.entity_id == entity, SupplierInvoice.decision.is_not(None)))
            if (i.decision or {}).get('secondApproverNeeded') and (i.decision or {}).get('byId') != str(u.id) and lim >= f(i.total)]
    vendors = {p.id: p for p in db.scalars(select(Party).where(Party.id.in_([i.vendor_id for i in invs if i.vendor_id])))} if invs else {}
    role = role_on(u, entity)
    exs = [x for x in db.scalars(select(ExceptionItem).where(ExceptionItem.entity_id == entity, ExceptionItem.status == 'awaiting-approval'))
           if x.owner_id == u.id or role in ('cfo', 'controller', 'partner')]
    return {'runs': [], 'invoices': [invoice_out(i, vendors.get(i.vendor_id)) for i in invs], 'exceptions': [exception_out(x) for x in exs]}
