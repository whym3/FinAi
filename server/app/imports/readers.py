"""Row readers for xlsx, xlsb and csv. Rows come out as lists of raw cell values; dates may be datetimes, Excel serials or strings."""
import csv
import io
import re
from collections.abc import Iterator
from datetime import date, datetime, timedelta
from pathlib import Path


def kind_of(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return {'.xlsx': 'xlsx', '.xlsm': 'xlsx', '.xlsb': 'xlsb', '.csv': 'csv', '.txt': 'csv'}.get(ext, '')


def sheet_names(path: str, filename: str) -> list[str]:
    k = kind_of(filename)
    if k == 'xlsx':
        from openpyxl import load_workbook
        wb = load_workbook(path, read_only=True)
        try:
            return wb.sheetnames
        finally:
            wb.close()
    if k == 'xlsb':
        from pyxlsb import open_workbook
        with open_workbook(path) as wb:
            return list(wb.sheets)
    return ['csv']


def iter_rows(path: str, filename: str, sheet: str | None) -> Iterator[list]:
    k = kind_of(filename)
    if k == 'xlsx':
        from openpyxl import load_workbook
        wb = load_workbook(path, read_only=True, data_only=True)
        try:
            ws = wb[sheet] if sheet and sheet in wb.sheetnames else wb.worksheets[0]
            for row in ws.iter_rows(values_only=True):
                yield list(row)
        finally:
            wb.close()
    elif k == 'xlsb':
        from pyxlsb import open_workbook
        with open_workbook(path) as wb:
            with wb.get_sheet(sheet or 1) as ws:
                for row in ws.rows():
                    yield [c.v for c in row]
    else:
        data = Path(path).read_bytes()
        text = data.decode('utf-8-sig', errors='replace')
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=',;\t|') if text.strip() else csv.excel
        for row in csv.reader(io.StringIO(text), dialect):
            yield row


def _is_text(v) -> bool:
    return isinstance(v, str) and v.strip() != ''


def find_header(rows: list[list]) -> int:
    """Index of the first row that looks like a header: mostly non-empty text cells."""
    best, best_n = 0, 0
    for i, r in enumerate(rows[:30]):
        n = sum(1 for v in r if _is_text(v))
        if n >= 3 and n > best_n and n >= len([v for v in r if v not in (None, '')]) * 0.7:
            best, best_n = i, n
            if n >= 5:
                break
    return best


def header_and_preview(path: str, filename: str, sheet: str | None, n: int = 8) -> tuple[int, list[str], list[list], int]:
    """(header row index, headers, preview rows, total row estimate)."""
    first = []
    total = 0
    for row in iter_rows(path, filename, sheet):
        total += 1
        if len(first) < 40:
            first.append(row)
    h = find_header(first)
    headers = [str(v).strip() if v not in (None, '') else f'Column {i + 1}' for i, v in enumerate(first[h])]
    width = len(headers)
    preview = [[_json(v) for v in (r + [None] * width)[:width]] for r in first[h + 1:h + 1 + n] if any(v not in (None, '') for v in r)]
    return h, headers, preview, max(0, total - h - 1)


def _json(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def cell_date(v) -> date | None:
    if v in (None, ''):
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, (int, float)) and 20000 < v < 80000:  # Excel serial
        return (datetime(1899, 12, 30) + timedelta(days=float(v))).date()
    s = str(v).strip()
    for fmt in ('%Y-%m-%d', '%d-%m-%Y', '%d.%m.%Y', '%d/%m/%Y', '%Y-%m-%dT%H:%M:%S', '%d-%m-%y', '%m/%d/%Y'):
        try:
            return datetime.strptime(s[:19], fmt).date()
        except ValueError:
            continue
    m = re.match(r'(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})', s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return date(y + 2000 if y < 100 else y, mo, d)
        except ValueError:
            return None
    return None


def cell_num(v) -> float | None:
    if v in (None, ''):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(',', '').replace('₹', '').strip()
    if s.endswith('-'):  # SAP trailing minus
        s = '-' + s[:-1]
    try:
        return float(s)
    except ValueError:
        return None


def cell_str(v) -> str | None:
    if v in (None, ''):
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip() or None


def split_code_name(v) -> tuple[str | None, str | None]:
    """'1005750    BLEND COLOURS P' → ('1005750', 'BLEND COLOURS P')."""
    s = cell_str(v)
    if not s:
        return None, None
    m = re.match(r'^(\d{4,12})\s{2,}(.+)$', s) or re.match(r'^(\d{4,12})\s+(.+)$', s)
    if m:
        return m.group(1), m.group(2).strip()
    return (s, None) if s.isdigit() else (None, s)
