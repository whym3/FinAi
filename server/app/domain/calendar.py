"""Indian statutory calendar defaults. Editable overrides can live in app_settings later."""
from datetime import date, timedelta


def _next_monthly(today: date, day: int) -> date:
    y, m = (today.year, today.month + 1) if today.month < 12 else (today.year + 1, 1)
    d = date(y, m, min(day, 28))
    return d if d >= today else _next_monthly(d, day)


def _next_in(today: date, candidates: list[tuple[int, int]]) -> date:
    opts = [date(today.year + dy, m, d) for dy in (0, 1) for m, d in candidates]
    return min(x for x in opts if x >= today)


def deadlines(entity_id: str, today: date) -> list[dict]:
    items = [
        ('msme1', 'MSME Form 1', 'Half-yearly return of dues to micro and small suppliers outstanding beyond 45 days', _next_in(today, [(4, 30), (10, 31)]), 30, '/msme'),
        ('tds', 'TDS deposit', 'Deposit of tax deducted last month (challan 281)', _next_monthly(today, 7), 15, '/tds'),
        ('gstr1', 'GSTR-1', 'Outward supplies of last month', _next_monthly(today, 11), 15, '/gst'),
        ('gstr2b', 'GSTR-2B available', 'Act on IMS before the statement is generated', _next_monthly(today, 14), 15, '/gst'),
        ('gstr3b', 'GSTR-3B', 'Monthly summary return and tax payment', _next_monthly(today, 20), 20, '/gst'),
        ('tdsq', 'Quarterly TDS return', 'Form 26Q / 27Q for the last quarter', _next_in(today, [(7, 31), (10, 31), (1, 31), (5, 31)]), 45, '/tds'),
    ]
    out = []
    for key, name, what, due, window, link in sorted(items, key=lambda x: x[3]):
        left = (due - today).days
        tone = 'bad' if left <= 3 else 'warn' if left <= 10 else 'none'
        out.append({'id': f'{entity_id}-{key}', 'entityId': entity_id, 'name': name, 'what': what, 'due': due.isoformat(), 'windowDays': window,
                    'status': {'tone': tone, 'label': 'Not started'}, 'link': link})
    return out
