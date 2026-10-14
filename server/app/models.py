from datetime import datetime

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

J = JSON().with_variant(JSONB(), 'postgresql')


def now_col():
    return mapped_column(DateTime(timezone=True), server_default=func.now())


class User(Base):
    __tablename__ = 'users'
    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(120))
    entity_ids: Mapped[list | str] = mapped_column(J)  # list of entity ids, or 'all'


class Entity(Base):
    __tablename__ = 'entities'
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
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
    created_by: Mapped[str | None] = mapped_column(String(16))
    created_at: Mapped[datetime] = now_col()
    gstins: Mapped[list['GstRegistration']] = relationship(order_by='GstRegistration.id', cascade='all, delete-orphan')
    mailboxes: Mapped[list['Mailbox']] = relationship(order_by='Mailbox.id')


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


class Mailbox(Base):
    __tablename__ = 'mailboxes'
    __table_args__ = (UniqueConstraint('entity_id', 'address'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'))
    provider: Mapped[str] = mapped_column(String(10))  # gmail | outlook
    address: Mapped[str] = mapped_column(String(200))
    enc_refresh_token: Mapped[str | None] = mapped_column(Text)
    cursor: Mapped[str | None] = mapped_column(Text)  # Gmail historyId or Graph deltaLink
    status: Mapped[str] = mapped_column(String(16), default='active')  # active | paused | error | disconnected
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    backfill_days: Mapped[int] = mapped_column(Integer, default=7)
    sender_allow: Mapped[list] = mapped_column(J, default=list)
    sender_block: Mapped[list] = mapped_column(J, default=list)
    connected_by: Mapped[str | None] = mapped_column(String(16))
    created_at: Mapped[datetime] = now_col()


class SourceDocument(Base):
    __tablename__ = 'source_documents'
    __table_args__ = (UniqueConstraint('mailbox_id', 'external_msg_id', 'external_att_id'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'), index=True)
    channel: Mapped[str] = mapped_column(String(16), default='Email')
    mailbox_id: Mapped[int | None] = mapped_column(ForeignKey('mailboxes.id'))
    external_msg_id: Mapped[str | None] = mapped_column(String(200))
    external_att_id: Mapped[str | None] = mapped_column(Text)
    sender: Mapped[str] = mapped_column(String(320), default='')
    subject: Mapped[str] = mapped_column(Text, default='')
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    filename: Mapped[str] = mapped_column(String(300))
    mime: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    storage_path: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default='new')  # web IntakeStatus values
    status_note: Mapped[str | None] = mapped_column(Text)
    duplicate_of: Mapped[int | None] = mapped_column(Integer)
    fields: Mapped[list] = mapped_column(J, default=list)  # web ExtractedField[] after extraction + human edits
    lines: Mapped[list] = mapped_column(J, default=list)  # web DocLine[]
    doc_type: Mapped[str | None] = mapped_column(String(32))
    confirmed_by: Mapped[str | None] = mapped_column(String(16))
    created_at: Mapped[datetime] = now_col()


class Extraction(Base):
    __tablename__ = 'extractions'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey('source_documents.id'), index=True)
    provider: Mapped[str] = mapped_column(String(16))
    model: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(10))  # done | failed
    raw: Mapped[dict | None] = mapped_column(J)
    error: Mapped[str | None] = mapped_column(Text)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = now_col()


class AiSettings(Base):
    __tablename__ = 'ai_settings'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # single row, id=1
    active_provider: Mapped[str] = mapped_column(String(16), default='anthropic')
    models: Mapped[dict] = mapped_column(J, default=dict)  # provider -> model id
    enc_keys: Mapped[dict] = mapped_column(J, default=dict)  # provider -> encrypted key
    keys_set_at: Mapped[dict] = mapped_column(J, default=dict)  # provider -> iso date
    auto_extract: Mapped[bool] = mapped_column(Boolean, default=True)


class Job(Base):
    __tablename__ = 'jobs'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(J)
    run_after: Mapped[datetime] = now_col()
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditLog(Base):
    """Append-only: a database trigger rejects UPDATE and DELETE (Companies Act audit trail)."""
    __tablename__ = 'audit_log'
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    at: Mapped[datetime] = now_col()
    user_id: Mapped[str] = mapped_column(String(16))
    entity_id: Mapped[str | None] = mapped_column(String(40), index=True)
    action: Mapped[str] = mapped_column(String(120))
    target: Mapped[str] = mapped_column(String(200), default='')
    detail: Mapped[str] = mapped_column(Text, default='')
    before: Mapped[dict | None] = mapped_column(J)
    after: Mapped[dict | None] = mapped_column(J)
