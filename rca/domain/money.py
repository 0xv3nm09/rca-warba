from decimal import ROUND_HALF_UP, Decimal

FILS = Decimal("0.001")


def kwd(value: str | int | Decimal) -> Decimal:
    """Parse and quantise a KWD amount. Never accepts floats."""
    if isinstance(value, float):
        raise TypeError("Use str or Decimal for money, never float")
    return Decimal(value).quantize(FILS, rounding=ROUND_HALF_UP)
