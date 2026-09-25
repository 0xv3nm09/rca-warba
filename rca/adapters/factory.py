from rca.settings import get_settings


def adapters() -> list:
    if get_settings().adapters == "dummy":
        from rca.adapters.dummy import DummyCore, DummyCRM, DummyECM, DummyMail

        return [DummyCRM(), DummyCore(), DummyECM(), DummyMail()]
    raise NotImplementedError("Real adapters are wired during the Warba sandbox phase (read-only)")
