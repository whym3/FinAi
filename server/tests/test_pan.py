"""The PAN a model reads back is untrusted; link._pan_from must never hand the DB an over-long value."""
from app.domain.link import _pan_from


def test_pan_from_keeps_a_real_pan():
    assert _pan_from('AABCZ1559P', '27AABCZ1559P1ZN') == 'AABCZ1559P'
    assert _pan_from(' aabcz1559p ', None) == 'AABCZ1559P'


def test_pan_from_falls_back_to_the_gstin_when_the_read_pan_is_wrong():
    # what gpt-6-luna actually returned: the GSTIN's first 11 characters, one too long for the column
    assert _pan_from('AABCZ1559P1', '27AABCZ1559P1ZN') == 'AABCZ1559P'


def test_pan_from_gives_up_rather_than_storing_rubbish():
    assert _pan_from(None, None) is None
    assert _pan_from('n/a', 'not-a-gstin') is None
    assert _pan_from('', '') is None


def test_pan_from_never_exceeds_the_column():
    for pan in ('AABCZ1559P1', 'A' * 50, '12345', None):
        for gstin in ('27AABCZ1559P1ZN', 'rubbish', None):
            out = _pan_from(pan, gstin)
            assert out is None or len(out) == 10
