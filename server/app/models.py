import datetime as dt
from decimal import Decimal

from sqlalchemy import JSON, BigInteger, Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

J = JSON().with_variant(JSONB(), 'postgresql')
Money = Numeric(18, 2)
Qty = Numeric(18, 3)


def now_col():
    return mapped_column(DateTime(timezone=True), server_default=func.now())


def ts_col():
    return mapped_column(DateTime(timezone=True), nullable=True)


# ---------------- tenancy and people ----------------

class Firm(Base):
    __tablename__ = 'firms'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    short_name: Mapped[str] = mapped_column(String(80))
    frn: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[dt.datetime] = now_col()


class User(Base):
    __tablename__ = 'users'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    firm_id: Mapped[int] = mapped_column(ForeignKey('firms.id'))
    email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    title: Mapped[str] = mapped_column(String(120), default='')
    password_hash: Mapped[str | None] = mapped_column(Text)
    totp_secret_enc: Mapped[str | None] = mapped_column(Text)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    totp_last_counter: Mapped[int] = mapped_column(BigInteger, default=0)  # replay guard
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)  # firm admin: users, integrations, settings
    status: Mapped[str] = mapped_column(String(16), default='invited')  # invited | active | disabled
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[dt.datetime | None] = ts_col()
    last_login_at: Mapped[dt.datetime | None] = ts_col()
    created_at: Mapped[dt.datetime] = now_col()
    entities: Mapped[list['UserEntity']] = relationship(cascade='all, delete-orphan', lazy='selectin')


class UserEntity(Base):
    """Role and approval limit of a user on one client. Partners and admins also see every client of the firm."""
    __tablename__ = 'user_entities'
    __table_args__ = (UniqueConstraint('user_id', 'entity_id'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'))
    role: Mapped[str] = mapped_column(String(32))
    approval_limit: Mapped[Decimal] = mapped_column(Money, default=0)


class Session(Base):
    __tablename__ = 'sessions'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # sha256 of the cookie value
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    mfa_passed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = now_col()
    last_seen_at: Mapped[dt.datetime] = now_col()
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))


class Token(Base):
    """One-time links: invites and password resets."""
    __tablename__ = 'tokens'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))  # invite | reset
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[dt.datetime | None] = ts_col()
    created_by: Mapped[int | None] = mapped_column(Integer)


# ---------------- clients ----------------

class Entity(Base):
    __tablename__ = 'entities'
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    firm_id: Mapped[int] = mapped_column(ForeignKey('firms.id'))
    legal_name: Mapped[str] = mapped_column(String(200))
    short_name: Mapped[str] = mapped_column(String(80))
    city: Mapped[str] = mapped_column(String(80), default='')
    pan: Mapped[str] = mapped_column(String(10))
    tan: Mapped[str | None] = mapped_column(String(10))
    cin: Mapped[str | None] = mapped_column(String(21))
    fy_start_month: Mapped[int] = mapped_column(Integer, default=4)
    einvoice_band: Mapped[str] = mapped_column(String(32), default='above-5cr')
    msme_status: Mapped[str] = mapped_column(String(16), default='none')
    sap_company_code: Mapped[str] = mapped_column(String(10), default='')
    whatsapp: Mapped[str] = mapped_column(String(32), default='')
    status: Mapped[str] = mapped_column(String(16), default='onboarding')
    created_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[dt.datetime] = now_col()
    gstins: Mapped[list['GstRegistration']] = relationship(order_by='GstRegistration.id', cascade='all, delete-orphan', lazy='selectin')
    mailboxes: Mapped[list['Mailbox']] = relationship(order_by='Mailbox.id', lazy='selectin')
    plants: Mapped[list['EntityPlant']] = relationship(order_by='EntityPlant.code', cascade='all, delete-orphan', lazy='selectin')


class GstRegistration(Base):
    __tablename__ = 'gst_registrations'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'))
    gstin: Mapped[str] = mapped_column(String(15), unique=True)
    state_code: Mapped[str] = mapped_column(String(2))
    state: Mapped[str] = mapped_column(String(60))
    place_of_business: Mapped[str] = mapped_column(String(200), default='')
    filing_frequency: Mapped[str] = mapped_column(String(10), default='monthly')
    einvoice_applicable: Mapped[bool] = mapped_column(Boolean, default=True)


class EntityPlant(Base):
    __tablename__ = 'entity_plants'
    __table_args__ = (UniqueConstraint('entity_id', 'code'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'))
    code: Mapped[str] = mapped_column(String(10))
    name: Mapped[str] = mapped_column(String(80), default='')
    source: Mapped[str] = mapped_column(String(16), default='import')


class Mailbox(Base):
    __tablename__ = 'mailboxes'
    __table_args__ = (UniqueConstraint('entity_id', 'address'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'))
    provider: Mapped[str] = mapped_column(String(10))
    address: Mapped[str] = mapped_column(String(200))
    enc_refresh_token: Mapped[str | None] = mapped_column(Text)
    cursor: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default='active')
    last_sync_at: Mapped[dt.datetime | None] = ts_col()
    last_error: Mapped[str | None] = mapped_column(Text)
    backfill_days: Mapped[int] = mapped_column(Integer, default=7)
    sender_allow: Mapped[list] = mapped_column(J, default=list)
    sender_block: Mapped[list] = mapped_column(J, default=list)
    connected_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[dt.datetime] = now_col()


class SapConnection(Base):
    __tablename__ = 'sap_connections'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'), unique=True)
    edition: Mapped[str] = mapped_column(String(20), default='private-cloud')  # public-cloud | private-cloud | on-premise
    host: Mapped[str] = mapped_column(String(300), default='')
    client: Mapped[str] = mapped_column(String(3), default='')
    company_code: Mapped[str] = mapped_column(String(10), default='')
    plant_mapping: Mapped[dict] = mapped_column(J, default=dict)
    username: Mapped[str] = mapped_column(String(120), default='')
    enc_password: Mapped[str | None] = mapped_column(Text)
    objects: Mapped[list] = mapped_column(J, default=list)  # purchase_orders, goods_receipts, supplier_invoices, business_partners, ar_open_items, ap_open_items
    schedule_minutes: Mapped[int] = mapped_column(Integer, default=60)
    status: Mapped[str] = mapped_column(String(16), default='draft')  # draft | active | paused | error
    last_test_at: Mapped[dt.datetime | None] = ts_col()
    last_test_result: Mapped[str | None] = mapped_column(Text)
    last_sync_at: Mapped[dt.datetime | None] = ts_col()
    last_error: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[dt.datetime] = now_col()


class AiSetting(Base):
    """Which model reads documents. One row for the deployment; falls back to ANTHROPIC_API_KEY when empty."""
    __tablename__ = 'ai_settings'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(20), default='anthropic')  # anthropic | openai
    model: Mapped[str] = mapped_column(String(80), default='')
    enc_api_key: Mapped[str | None] = mapped_column(Text)
    last_test_at: Mapped[dt.datetime | None] = ts_col()
    last_test_result: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[dt.datetime] = now_col()


# ---------------- documents ----------------

class SourceDocument(Base):
    __tablename__ = 'source_documents'
    __table_args__ = (UniqueConstraint('mailbox_id', 'external_msg_id', 'external_att_id'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'), index=True)
    channel: Mapped[str] = mapped_column(String(16), default='Email')  # Email | Upload | WhatsApp | Post | SAP
    mailbox_id: Mapped[int | None] = mapped_column(ForeignKey('mailboxes.id'))
    external_msg_id: Mapped[str | None] = mapped_column(String(200))
    external_att_id: Mapped[str | None] = mapped_column(Text)
    sender: Mapped[str] = mapped_column(String(320), default='')
    subject: Mapped[str] = mapped_column(Text, default='')
    received_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    uploaded_by: Mapped[int | None] = mapped_column(Integer)
    filename: Mapped[str] = mapped_column(String(300))
    mime: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    storage_path: Mapped[str] = mapped_column(Text)
    pages: Mapped[int] = mapped_column(Integer, default=1)
    # A multi-document PDF is a bundle: its parts carry bundle_id and page_from/page_to; the bundle row itself has kind='bundle'.
    kind: Mapped[str] = mapped_column(String(24), default='unknown')
    bundle_id: Mapped[int | None] = mapped_column(ForeignKey('source_documents.id'), index=True)
    page_from: Mapped[int | None] = mapped_column(Integer)
    page_to: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default='new')  # new | review | linked | duplicate | notfinance | rejected
    status_note: Mapped[str | None] = mapped_column(Text)
    duplicate_of: Mapped[int | None] = mapped_column(Integer)
    fields: Mapped[list] = mapped_column(J, default=list)  # web ExtractedField[]
    lines: Mapped[list] = mapped_column(J, default=list)  # web DocLine[]
    data: Mapped[dict] = mapped_column(J, default=dict)  # normalised header values by kind
    confirmed_by: Mapped[int | None] = mapped_column(Integer)
    po_id: Mapped[int | None] = mapped_column(ForeignKey('purchase_orders.id'))
    grn_id: Mapped[int | None] = mapped_column(ForeignKey('goods_receipts.id'))
    invoice_id: Mapped[int | None] = mapped_column(ForeignKey('supplier_invoices.id'))
    dispatch_id: Mapped[int | None] = mapped_column(ForeignKey('dispatch_docs.id'))
    created_at: Mapped[dt.datetime] = now_col()


class Extraction(Base):
    __tablename__ = 'extractions'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey('source_documents.id'), index=True)
    step: Mapped[str] = mapped_column(String(16), default='extract')  # classify | extract
    model: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(10))
    raw: Mapped[dict | None] = mapped_column(J)
    error: Mapped[str | None] = mapped_column(Text)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = now_col()


# ---------------- parties and purchase-to-pay ----------------

class Party(Base):
    """Vendor or customer master. `code` is the client's own (SAP) number when known."""
    __tablename__ = 'parties'
    __table_args__ = (Index('ix_parties_entity_code', 'entity_id', 'code'), Index('ix_parties_entity_gstin', 'entity_id', 'gstin'))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'))
    kind: Mapped[str] = mapped_column(String(10))  # vendor | customer
    code: Mapped[str | None] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200))
    pan: Mapped[str | None] = mapped_column(String(10))
    gstin: Mapped[str | None] = mapped_column(String(15))
    state: Mapped[str | None] = mapped_column(String(60))
    city: Mapped[str | None] = mapped_column(String(80))
    address: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(40))
    msme_class: Mapped[str | None] = mapped_column(String(10))  # Micro | Small | Medium
    udyam: Mapped[str | None] = mapped_column(String(30))
    payment_terms_days: Mapped[int] = mapped_column(Integer, default=30)
    credit_days: Mapped[int] = mapped_column(Integer, default=30)
    bank: Mapped[dict | None] = mapped_column(J)
    tags: Mapped[list] = mapped_column(J, default=list)
    tds_section: Mapped[str | None] = mapped_column(String(60))
    gstin_status: Mapped[str] = mapped_column(String(12), default='Unknown')
    blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(12), default='extracted')  # extracted | import | sap | manual
    extra: Mapped[dict] = mapped_column(J, default=dict)
    created_at: Mapped[dt.datetime] = now_col()
    updated_at: Mapped[dt.datetime] = now_col()


class PurchaseOrder(Base):
    __tablename__ = 'purchase_orders'
    __table_args__ = (UniqueConstraint('entity_id', 'po_no'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'), index=True)
    po_no: Mapped[str] = mapped_column(String(20))
    vendor_id: Mapped[int | None] = mapped_column(ForeignKey('parties.id'))
    vendor_name: Mapped[str] = mapped_column(String(200), default='')
    date: Mapped[dt.date | None] = mapped_column(Date)
    plant: Mapped[str | None] = mapped_column(String(10))
    doc_type: Mapped[str | None] = mapped_column(String(10))
    release_state: Mapped[str | None] = mapped_column(String(10))
    buyer: Mapped[str | None] = mapped_column(String(120))
    payment_terms_days: Mapped[int | None] = mapped_column(Integer)
    freight_terms: Mapped[str | None] = mapped_column(String(120))
    delivery_terms: Mapped[str | None] = mapped_column(String(120))
    taxable: Mapped[Decimal] = mapped_column(Money, default=0)
    tax: Mapped[Decimal] = mapped_column(Money, default=0)
    total: Mapped[Decimal] = mapped_column(Money, default=0)
    source: Mapped[str] = mapped_column(String(12), default='import')
    source_doc_id: Mapped[int | None] = mapped_column(Integer)
    import_id: Mapped[int | None] = mapped_column(Integer)
    negotiation: Mapped[dict | None] = mapped_column(J)
    created_at: Mapped[dt.datetime] = now_col()
    updated_at: Mapped[dt.datetime] = now_col()
    lines: Mapped[list['PoLine']] = relationship(order_by='PoLine.item', cascade='all, delete-orphan', lazy='selectin')


class PoLine(Base):
    __tablename__ = 'po_lines'
    __table_args__ = (UniqueConstraint('po_id', 'item'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    po_id: Mapped[int] = mapped_column(ForeignKey('purchase_orders.id'))
    item: Mapped[int] = mapped_column(Integer, default=10)
    material_code: Mapped[str | None] = mapped_column(String(40))
    description: Mapped[str] = mapped_column(Text, default='')
    material_group: Mapped[str | None] = mapped_column(String(40))
    hsn: Mapped[str | None] = mapped_column(String(10))
    uom: Mapped[str | None] = mapped_column(String(10))
    qty: Mapped[Decimal] = mapped_column(Qty, default=0)
    open_qty: Mapped[Decimal | None] = mapped_column(Qty)  # still to be delivered, from SAP
    rate: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=0)
    tax_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    amount: Mapped[Decimal] = mapped_column(Money, default=0)
    delivery_date: Mapped[dt.date | None] = mapped_column(Date)


class GoodsReceipt(Base):
    __tablename__ = 'goods_receipts'
    __table_args__ = (UniqueConstraint('entity_id', 'grn_no'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'), index=True)
    grn_no: Mapped[str] = mapped_column(String(20))
    date: Mapped[dt.date | None] = mapped_column(Date)
    po_id: Mapped[int | None] = mapped_column(ForeignKey('purchase_orders.id'))
    po_ref: Mapped[str | None] = mapped_column(String(20))
    vendor_id: Mapped[int | None] = mapped_column(ForeignKey('parties.id'))
    vendor_name: Mapped[str] = mapped_column(String(200), default='')
    gate_entry_no: Mapped[str | None] = mapped_column(String(20))
    gate_entry_date: Mapped[dt.date | None] = mapped_column(Date)
    challan_no: Mapped[str | None] = mapped_column(String(40))
    challan_date: Mapped[dt.date | None] = mapped_column(Date)
    invoice_ref: Mapped[str | None] = mapped_column(String(40))
    invoice_date: Mapped[dt.date | None] = mapped_column(Date)
    lr_no: Mapped[str | None] = mapped_column(String(40))
    lr_date: Mapped[dt.date | None] = mapped_column(Date)
    transporter: Mapped[str | None] = mapped_column(String(120))
    vehicle: Mapped[str | None] = mapped_column(String(20))
    ewaybill: Mapped[str | None] = mapped_column(String(20))
    source: Mapped[str] = mapped_column(String(12), default='extracted')
    source_doc_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[dt.datetime] = now_col()
    lines: Mapped[list['GrLine']] = relationship(order_by='GrLine.id', cascade='all, delete-orphan', lazy='selectin')


class GrLine(Base):
    __tablename__ = 'gr_lines'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    grn_id: Mapped[int] = mapped_column(ForeignKey('goods_receipts.id'))
    po_item: Mapped[int | None] = mapped_column(Integer)
    material_code: Mapped[str | None] = mapped_column(String(40))
    description: Mapped[str] = mapped_column(Text, default='')
    hsn: Mapped[str | None] = mapped_column(String(10))
    uom: Mapped[str | None] = mapped_column(String(10))
    received_qty: Mapped[Decimal] = mapped_column(Qty, default=0)
    accepted_qty: Mapped[Decimal] = mapped_column(Qty, default=0)
    rejected_qty: Mapped[Decimal] = mapped_column(Qty, default=0)
    batch: Mapped[str | None] = mapped_column(String(40))
    storage_location: Mapped[str | None] = mapped_column(String(20))


class DispatchDoc(Base):
    """Lorry receipt, consignment note, weighbridge ticket, gate entry / unloading sheet, e-way bill, delivery challan."""
    __tablename__ = 'dispatch_docs'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'), index=True)
    kind: Mapped[str] = mapped_column(String(24))
    number: Mapped[str | None] = mapped_column(String(40))
    date: Mapped[dt.date | None] = mapped_column(Date)
    transporter: Mapped[str | None] = mapped_column(String(120))
    vehicle: Mapped[str | None] = mapped_column(String(20))
    consignor: Mapped[str | None] = mapped_column(String(200))
    consignee: Mapped[str | None] = mapped_column(String(200))
    packages: Mapped[Decimal | None] = mapped_column(Qty)
    gross_wt: Mapped[Decimal | None] = mapped_column(Qty)
    tare_wt: Mapped[Decimal | None] = mapped_column(Qty)
    net_wt: Mapped[Decimal | None] = mapped_column(Qty)
    freight_basis: Mapped[str | None] = mapped_column(String(20))  # paid | to-pay
    freight_amount: Mapped[Decimal | None] = mapped_column(Money)
    invoice_ref: Mapped[str | None] = mapped_column(String(40))
    po_ref: Mapped[str | None] = mapped_column(String(20))
    ewaybill: Mapped[str | None] = mapped_column(String(20))
    po_id: Mapped[int | None] = mapped_column(ForeignKey('purchase_orders.id'))
    grn_id: Mapped[int | None] = mapped_column(ForeignKey('goods_receipts.id'))
    source_doc_id: Mapped[int | None] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(J, default=dict)
    created_at: Mapped[dt.datetime] = now_col()


class SupplierInvoice(Base):
    __tablename__ = 'supplier_invoices'
    __table_args__ = (UniqueConstraint('entity_id', 'supplier_gstin', 'invoice_no'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'), index=True)
    vendor_id: Mapped[int | None] = mapped_column(ForeignKey('parties.id'))
    vendor_name: Mapped[str] = mapped_column(String(200), default='')
    invoice_no: Mapped[str] = mapped_column(String(40))
    date: Mapped[dt.date | None] = mapped_column(Date)
    received_at: Mapped[dt.datetime] = now_col()
    channel: Mapped[str] = mapped_column(String(16), default='Upload')
    supplier_gstin: Mapped[str | None] = mapped_column(String(15))
    bill_to_gstin: Mapped[str | None] = mapped_column(String(15))
    irn: Mapped[str | None] = mapped_column(String(64))
    ack_no: Mapped[str | None] = mapped_column(String(30))
    ewaybill: Mapped[str | None] = mapped_column(String(20))
    vehicle: Mapped[str | None] = mapped_column(String(20))
    transporter: Mapped[str | None] = mapped_column(String(120))
    place_of_supply: Mapped[str | None] = mapped_column(String(60))
    po_ref: Mapped[str | None] = mapped_column(String(20))
    po_id: Mapped[int | None] = mapped_column(ForeignKey('purchase_orders.id'))
    grn_id: Mapped[int | None] = mapped_column(ForeignKey('goods_receipts.id'))
    source_doc_id: Mapped[int | None] = mapped_column(Integer)
    taxable: Mapped[Decimal] = mapped_column(Money, default=0)
    cgst: Mapped[Decimal] = mapped_column(Money, default=0)
    sgst: Mapped[Decimal] = mapped_column(Money, default=0)
    igst: Mapped[Decimal] = mapped_column(Money, default=0)
    freight: Mapped[Decimal] = mapped_column(Money, default=0)
    other_charges: Mapped[Decimal] = mapped_column(Money, default=0)
    round_off: Mapped[Decimal] = mapped_column(Money, default=0)
    total: Mapped[Decimal] = mapped_column(Money, default=0)
    payment_terms_days: Mapped[int | None] = mapped_column(Integer)
    reverse_charge: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(16), default='needs-decision')
    match: Mapped[dict] = mapped_column(J, default=dict)  # {heads, rows, flags} as the web expects
    dn_lines: Mapped[list] = mapped_column(J, default=list)
    draft: Mapped[dict | None] = mapped_column(J)
    decision: Mapped[dict | None] = mapped_column(J)
    sap_doc_no: Mapped[str | None] = mapped_column(String(20))
    paid_on: Mapped[dt.date | None] = mapped_column(Date)
    utr: Mapped[str | None] = mapped_column(String(30))
    created_at: Mapped[dt.datetime] = now_col()
    updated_at: Mapped[dt.datetime] = now_col()
    lines: Mapped[list['InvoiceLine']] = relationship(order_by='InvoiceLine.line_no', cascade='all, delete-orphan', lazy='selectin')


class InvoiceLine(Base):
    __tablename__ = 'invoice_lines'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey('supplier_invoices.id'))
    line_no: Mapped[int] = mapped_column(Integer, default=1)
    description: Mapped[str] = mapped_column(Text, default='')
    hsn: Mapped[str | None] = mapped_column(String(10))
    qty: Mapped[Decimal] = mapped_column(Qty, default=0)
    uom: Mapped[str | None] = mapped_column(String(10))
    rate: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=0)
    taxable: Mapped[Decimal] = mapped_column(Money, default=0)
    tax_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    po_item: Mapped[int | None] = mapped_column(Integer)


# ---------------- receivables and stock (from imports) ----------------

class CustomerInvoice(Base):
    __tablename__ = 'customer_invoices'
    __table_args__ = (UniqueConstraint('entity_id', 'invoice_no'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'), index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey('parties.id'), index=True)
    invoice_no: Mapped[str] = mapped_column(String(20))
    gst_invoice_no: Mapped[str | None] = mapped_column(String(30))
    doc_type: Mapped[str] = mapped_column(String(16), default='invoice')  # invoice | credit_memo
    sap_doc_type: Mapped[str | None] = mapped_column(String(10))
    date: Mapped[dt.date | None] = mapped_column(Date)
    due_date: Mapped[dt.date | None] = mapped_column(Date)
    sales_order: Mapped[str | None] = mapped_column(String(20))
    profit_center: Mapped[str | None] = mapped_column(String(20))
    recon_account: Mapped[str | None] = mapped_column(String(60))
    tax_code: Mapped[str | None] = mapped_column(String(10))
    state: Mapped[str | None] = mapped_column(String(60))
    city: Mapped[str | None] = mapped_column(String(80))
    marketing_person: Mapped[str | None] = mapped_column(String(120))
    vehicle: Mapped[str | None] = mapped_column(String(20))
    gr_no: Mapped[str | None] = mapped_column(String(40))
    taxable: Mapped[Decimal] = mapped_column(Money, default=0)
    tax: Mapped[Decimal] = mapped_column(Money, default=0)
    total: Mapped[Decimal] = mapped_column(Money, default=0)
    received: Mapped[Decimal] = mapped_column(Money, default=0)
    status: Mapped[str] = mapped_column(String(16), default='open')
    follow_up: Mapped[dict | None] = mapped_column(J)
    source: Mapped[str] = mapped_column(String(12), default='import')
    import_id: Mapped[int | None] = mapped_column(Integer)
    extra: Mapped[dict] = mapped_column(J, default=dict)
    created_at: Mapped[dt.datetime] = now_col()
    lines: Mapped[list['CustomerInvoiceLine']] = relationship(cascade='all, delete-orphan', lazy='selectin')


class CustomerInvoiceLine(Base):
    __tablename__ = 'customer_invoice_lines'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey('customer_invoices.id'))
    material_code: Mapped[str | None] = mapped_column(String(40))
    description: Mapped[str] = mapped_column(Text, default='')
    material_group: Mapped[str | None] = mapped_column(String(40))
    qty: Mapped[Decimal] = mapped_column(Qty, default=0)
    uom: Mapped[str | None] = mapped_column(String(10))
    tax_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    taxable: Mapped[Decimal] = mapped_column(Money, default=0)
    tax: Mapped[Decimal] = mapped_column(Money, default=0)
    total: Mapped[Decimal] = mapped_column(Money, default=0)
    extra: Mapped[dict] = mapped_column(J, default=dict)


class StockMovement(Base):
    __tablename__ = 'stock_movements'
    __table_args__ = (Index('ix_stock_entity_doc', 'entity_id', 'doc_no', 'item'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'), index=True)
    import_id: Mapped[int | None] = mapped_column(Integer)
    date: Mapped[dt.date | None] = mapped_column(Date)
    plant: Mapped[str | None] = mapped_column(String(10))
    storage_location: Mapped[str | None] = mapped_column(String(20))
    material_code: Mapped[str | None] = mapped_column(String(40))
    description: Mapped[str] = mapped_column(Text, default='')
    movement_type: Mapped[str | None] = mapped_column(String(10))
    doc_no: Mapped[str | None] = mapped_column(String(20))
    item: Mapped[int | None] = mapped_column(Integer)
    reference: Mapped[str | None] = mapped_column(String(40))
    qty: Mapped[Decimal] = mapped_column(Qty, default=0)
    uom: Mapped[str | None] = mapped_column(String(10))
    value: Mapped[Decimal | None] = mapped_column(Money)
    extra: Mapped[dict] = mapped_column(J, default=dict)


class StockBalance(Base):
    """Stock summary for a period per plant and material (SAP MB5B-style export)."""
    __tablename__ = 'stock_balances'
    __table_args__ = (UniqueConstraint('entity_id', 'plant', 'material_code', 'period_from', 'period_to'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'), index=True)
    import_id: Mapped[int | None] = mapped_column(Integer)
    plant: Mapped[str] = mapped_column(String(10), default='')
    material_code: Mapped[str] = mapped_column(String(40))
    period_from: Mapped[dt.date | None] = mapped_column(Date)
    period_to: Mapped[dt.date | None] = mapped_column(Date)
    uom: Mapped[str | None] = mapped_column(String(10))
    opening_qty: Mapped[Decimal] = mapped_column(Qty, default=0)
    receipt_qty: Mapped[Decimal] = mapped_column(Qty, default=0)
    issue_qty: Mapped[Decimal] = mapped_column(Qty, default=0)
    closing_qty: Mapped[Decimal] = mapped_column(Qty, default=0)
    opening_value: Mapped[Decimal] = mapped_column(Money, default=0)
    receipt_value: Mapped[Decimal] = mapped_column(Money, default=0)
    issue_value: Mapped[Decimal] = mapped_column(Money, default=0)
    closing_value: Mapped[Decimal] = mapped_column(Money, default=0)


# ---------------- control ----------------

class ExceptionRule(Base):
    __tablename__ = 'exception_rules'
    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    type: Mapped[str] = mapped_column(String(32))
    description: Mapped[str] = mapped_column(Text, default='')
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    priority: Mapped[str] = mapped_column(String(10), default='Medium')
    sla_days: Mapped[int] = mapped_column(Integer, default=3)
    default_role: Mapped[str] = mapped_column(String(32), default='ap')  # who it is assigned to by default


class ExceptionItem(Base):
    __tablename__ = 'exceptions'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'), index=True)
    rule_id: Mapped[str | None] = mapped_column(String(24))
    type: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(200))
    doc_ref: Mapped[str] = mapped_column(String(80), default='')
    doc_route: Mapped[str | None] = mapped_column(String(120))
    owner_id: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default='open')
    status_note: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(String(10), default='Medium')
    due: Mapped[dt.date | None] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Money, default=0)
    snoozed_until: Mapped[dt.date | None] = mapped_column(Date)
    resolved_at: Mapped[dt.datetime | None] = ts_col()
    resolution: Mapped[str | None] = mapped_column(Text)
    evidence: Mapped[dict | None] = mapped_column(J)
    evidence_note: Mapped[str | None] = mapped_column(Text)
    sources: Mapped[list] = mapped_column(J, default=list)
    checklist: Mapped[list | None] = mapped_column(J)
    blocks: Mapped[dict | None] = mapped_column(J)
    history: Mapped[list] = mapped_column(J, default=list)
    invoice_id: Mapped[int | None] = mapped_column(Integer, index=True)
    po_id: Mapped[int | None] = mapped_column(Integer)
    vendor_id: Mapped[int | None] = mapped_column(Integer)
    flag_key: Mapped[str | None] = mapped_column(String(40))  # which match row raised it
    created_at: Mapped[dt.datetime] = now_col()
    comments: Mapped[list['ExceptionComment']] = relationship(order_by='ExceptionComment.id', cascade='all, delete-orphan', lazy='selectin')


class ExceptionComment(Base):
    __tablename__ = 'exception_comments'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    exception_id: Mapped[int] = mapped_column(ForeignKey('exceptions.id'))
    user_id: Mapped[int] = mapped_column(Integer)
    at: Mapped[dt.datetime] = now_col()
    text: Mapped[str] = mapped_column(Text)


class Notification(Base):
    __tablename__ = 'notifications'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str | None] = mapped_column(String(40), index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, index=True)  # null = everyone on the entity
    at: Mapped[dt.datetime] = now_col()
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default='')
    route: Mapped[str] = mapped_column(String(200), default='/')
    tone: Mapped[str] = mapped_column(String(8), default='none')
    read_by: Mapped[list] = mapped_column(J, default=list)


class CloseTask(Base):
    __tablename__ = 'close_tasks'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'), index=True)
    period: Mapped[str] = mapped_column(String(7))  # YYYY-MM
    area: Mapped[str] = mapped_column(String(40))
    task: Mapped[str] = mapped_column(String(200))
    owner_id: Mapped[int | None] = mapped_column(Integer)
    due: Mapped[dt.date | None] = mapped_column(Date)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    done_at: Mapped[dt.datetime | None] = ts_col()
    done_by: Mapped[int | None] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(Text)


class AppSetting(Base):
    """Per-firm or per-entity settings (tolerances, calendar overrides); scope '' = firm-wide."""
    __tablename__ = 'app_settings'
    __table_args__ = (UniqueConstraint('scope', 'key'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scope: Mapped[str] = mapped_column(String(40), default='')
    key: Mapped[str] = mapped_column(String(60))
    value: Mapped[dict] = mapped_column(J, default=dict)


# ---------------- imports and jobs ----------------

class Import(Base):
    __tablename__ = 'imports'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'), index=True)
    kind: Mapped[str | None] = mapped_column(String(32))
    filename: Mapped[str] = mapped_column(String(300))
    storage_path: Mapped[str] = mapped_column(Text)
    size: Mapped[int] = mapped_column(BigInteger, default=0)
    sheet: Mapped[str | None] = mapped_column(String(120))
    sheets: Mapped[list] = mapped_column(J, default=list)
    headers: Mapped[list] = mapped_column(J, default=list)
    preview: Mapped[list] = mapped_column(J, default=list)  # first rows as read
    mapping: Mapped[dict] = mapped_column(J, default=dict)  # target field -> source column index
    period_from: Mapped[dt.date | None] = mapped_column(Date)
    period_to: Mapped[dt.date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(12), default='detected')  # detected | queued | running | done | failed
    rows_total: Mapped[int] = mapped_column(Integer, default=0)
    rows_done: Mapped[int] = mapped_column(Integer, default=0)
    rows_created: Mapped[int] = mapped_column(Integer, default=0)
    rows_updated: Mapped[int] = mapped_column(Integer, default=0)
    rows_skipped: Mapped[int] = mapped_column(Integer, default=0)
    errors: Mapped[list] = mapped_column(J, default=list)
    summary: Mapped[dict] = mapped_column(J, default=dict)
    created_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[dt.datetime] = now_col()
    finished_at: Mapped[dt.datetime | None] = ts_col()


class ImportLayout(Base):
    __tablename__ = 'import_layouts'
    __table_args__ = (UniqueConstraint('entity_id', 'kind', 'fingerprint'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'))
    kind: Mapped[str] = mapped_column(String(32))
    fingerprint: Mapped[str] = mapped_column(String(64))
    mapping: Mapped[dict] = mapped_column(J, default=dict)
    updated_at: Mapped[dt.datetime] = now_col()


class Job(Base):
    __tablename__ = 'jobs'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(J)
    run_after: Mapped[dt.datetime] = now_col()
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text)
    done_at: Mapped[dt.datetime | None] = ts_col()


class AuditLog(Base):
    """Append-only: a database trigger rejects UPDATE and DELETE (Companies Act audit trail)."""
    __tablename__ = 'audit_log'
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    at: Mapped[dt.datetime] = now_col()
    user_id: Mapped[int | None] = mapped_column(Integer)  # null = system
    entity_id: Mapped[str | None] = mapped_column(String(40), index=True)
    action: Mapped[str] = mapped_column(String(120))
    target: Mapped[str] = mapped_column(String(200), default='')
    detail: Mapped[str] = mapped_column(Text, default='')
    before: Mapped[dict | None] = mapped_column(J)
    after: Mapped[dict | None] = mapped_column(J)
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))
