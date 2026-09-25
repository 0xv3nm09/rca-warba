import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import ORJSONResponse

log = structlog.get_logger()


class DomainError(Exception):
    code = "domain_error"
    status = 400

    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class NotFound(DomainError):
    code, status = "not_found", 404


class Forbidden(DomainError):
    code, status = "forbidden", 403


class OutOfScope(DomainError):
    code, status = "out_of_scope", 403


class InvalidTransition(DomainError):
    code, status = "invalid_transition", 409


class NotReady(DomainError):
    code, status = "not_ready", 409


class DependencyUnavailable(DomainError):
    code, status = "dependency_unavailable", 503


class GuardrailBlocked(DomainError):
    code, status = "guardrail_blocked", 422


class RateLimited(DomainError):
    code, status = "rate_limited", 429


def _body(request: Request, code: str, message: str, details: dict | None = None) -> dict:
    return {
        "error": {
            "code": code,
            "message": message,
            "request_id": getattr(request.state, "request_id", "req_unknown"),
            "details": details or {},
        }
    }


def install(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def domain(request: Request, exc: DomainError):
        log.info("domain_error", code=exc.code, request_id=getattr(request.state, "request_id", None))
        return ORJSONResponse(_body(request, exc.code, exc.message, exc.details), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation(request: Request, exc: RequestValidationError):
        return ORJSONResponse(
            _body(request, "validation_error", "Invalid request", {"errors": exc.errors()}),
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def unexpected(request: Request, exc: Exception):
        log.exception("unhandled", request_id=getattr(request.state, "request_id", None))
        return ORJSONResponse(_body(request, "internal_error", "Unexpected error"), status_code=500)
