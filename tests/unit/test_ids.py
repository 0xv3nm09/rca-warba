from rca.domain.ids import new_id


def test_prefix_and_uniqueness():
    a, b = new_id("fct"), new_id("fct")
    assert a.startswith("fct_") and b.startswith("fct_")
    assert a != b


def test_sortable_by_time():
    ids = [new_id("hov") for _ in range(50)]
    assert ids == sorted(ids)
