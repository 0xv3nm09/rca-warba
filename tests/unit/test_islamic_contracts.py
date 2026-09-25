from rca.domain.islamic_contracts import MURABAHA_FLOW, REQUIRED_RECORD, Murabaha, can_describe_as_sold


def test_promise_stage_is_not_sold():
    assert not can_describe_as_sold(Murabaha.promise_recorded)
    assert not can_describe_as_sold(Murabaha.bank_owns_asset)


def test_sold_only_after_sale_record():
    assert can_describe_as_sold(Murabaha.sold_to_client)
    assert can_describe_as_sold(Murabaha.repaying)
    assert can_describe_as_sold(Murabaha.settled)


def test_flow_has_no_shortcut_past_bank_ownership():
    assert Murabaha.sold_to_client not in MURABAHA_FLOW[Murabaha.promise_recorded]
    assert Murabaha.sold_to_client in MURABAHA_FLOW[Murabaha.bank_owns_asset]


def test_every_active_stage_needs_a_record():
    assert REQUIRED_RECORD[Murabaha.promise_recorded] == "signed_promise"
    assert REQUIRED_RECORD[Murabaha.sold_to_client] == "murabaha_sale_contract"
