import pytest

from app import crypto
from app.validate import check_gstin


@pytest.mark.parametrize('g', ['27AAPFU0939F1ZV', '29AAGCB7383J1Z4'])  # published real-format GSTINs
def test_gstin_checksum_ok(g):
    r = check_gstin(g)
    assert r['ok'] and not r['warnings'] and r['state'] in ('Maharashtra', 'Karnataka')


def test_gstin_bad_checksum_is_warning_not_error():
    r = check_gstin('27AAPFU0939F1ZA')
    assert r['ok'] and r['warnings']


def test_gstin_pan_mismatch_and_format():
    assert check_gstin('27AAPFU0939F1ZV', pan='AAACM0000M')['errors']
    assert check_gstin('27AAPFU0939F1Z')['errors']
    assert check_gstin('99AAPFU0939F1ZV')['errors']  # unknown state


def test_encrypt_roundtrip_and_tamper():
    t = crypto.encrypt('refresh-token')
    assert t != 'refresh-token' and crypto.decrypt(t) == 'refresh-token'
    s = crypto.sign({'e': 'meridian'})
    assert crypto.unsign(s) == {'e': 'meridian'}
    with pytest.raises(ValueError):
        crypto.unsign(s[:-1] + ('0' if s[-1] != '0' else '1'))
