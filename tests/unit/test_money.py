from decimal import Decimal

import pytest

from rca.domain.money import kwd


def test_quantises_to_fils():
    assert kwd("750000") == Decimal("750000.000")
    assert kwd("123.4567") == Decimal("123.457")  # ROUND_HALF_UP


def test_rejects_float():
    with pytest.raises(TypeError):
        kwd(1.5)  # type: ignore[arg-type]


def test_accepts_int_and_decimal():
    assert kwd(5) == Decimal("5.000")
    assert kwd(Decimal("9.99")) == Decimal("9.990")
