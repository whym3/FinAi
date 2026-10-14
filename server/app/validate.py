"""Indian identifier checks. Mirrored in web/src/lib/gstin.ts for instant feedback."""
import re

STATES = {
    '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
    '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland',
    '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
    '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli and Daman and Diu',
    '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
    '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
}
PAN_RE = re.compile(r'^[A-Z]{5}[0-9]{4}[A-Z]$')
TAN_RE = re.compile(r'^[A-Z]{4}[0-9]{5}[A-Z]$')
GSTIN_RE = re.compile(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
CIN_RE = re.compile(r'^([LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}|[A-Z]{3}-[0-9]{4})$')  # CIN or LLPIN
_B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'


def gstin_check_char(first14: str) -> str:
    total = 0
    for i, ch in enumerate(first14):
        p = _B36.index(ch) * (2 if i % 2 else 1)
        total += p // 36 + p % 36
    return _B36[(36 - total % 36) % 36]


def check_gstin(gstin: str, pan: str | None = None) -> dict:
    """Returns {ok, errors, warnings, state_code, state}. A wrong checksum is a warning (test data), not an error."""
    g = gstin.strip().upper()
    errors: list[str] = []
    warnings: list[str] = []
    if not GSTIN_RE.match(g):
        return {'ok': False, 'errors': ['GSTIN must be 15 characters: 2-digit state, PAN, entity no., Z, check digit'], 'warnings': [], 'state_code': g[:2], 'state': None}
    code = g[:2]
    state = STATES.get(code)
    if not state:
        errors.append(f'Unknown state code {code}')
    if pan and g[2:12] != pan.strip().upper():
        errors.append(f'PAN inside GSTIN ({g[2:12]}) does not match the entity PAN')
    if gstin_check_char(g[:14]) != g[14]:
        warnings.append('Check digit does not match: confirm the GSTIN on the GST portal')
    return {'ok': not errors, 'errors': errors, 'warnings': warnings, 'state_code': code, 'state': state}
