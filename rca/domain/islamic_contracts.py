from enum import StrEnum


class Murabaha(StrEnum):
    requested = "requested"
    promise_recorded = "promise_recorded"  # client wa'd to purchase
    bank_owns_asset = "bank_owns_asset"  # bank purchase record
    sold_to_client = "sold_to_client"  # sale contract executed
    repaying = "repaying"
    settled = "settled"
    withdrawn = "withdrawn"


MURABAHA_FLOW: dict[Murabaha, set[Murabaha]] = {
    Murabaha.requested: {Murabaha.promise_recorded, Murabaha.withdrawn},
    Murabaha.promise_recorded: {Murabaha.bank_owns_asset, Murabaha.withdrawn},
    Murabaha.bank_owns_asset: {Murabaha.sold_to_client},
    Murabaha.sold_to_client: {Murabaha.repaying},
    Murabaha.repaying: {Murabaha.settled},
}


REQUIRED_RECORD: dict[Murabaha, str] = {
    Murabaha.promise_recorded: "signed_promise",
    Murabaha.bank_owns_asset: "purchase_invoice_or_title",
    Murabaha.sold_to_client: "murabaha_sale_contract",
    Murabaha.settled: "final_repayment_record",
}


def can_describe_as_sold(stage: Murabaha) -> bool:
    """Brief wording guard: never say 'sold' before the sale record exists."""
    return stage in {Murabaha.sold_to_client, Murabaha.repaying, Murabaha.settled}
