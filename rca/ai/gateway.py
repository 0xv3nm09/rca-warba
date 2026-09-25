"""Model gateway: the only module that talks to models.

Two kinds of route:
- base_url == "local" or a model name starting with "dummy": deterministic
  in-process providers (rules extractor, scripted drafter/classifier). Zero
  network, zero downloads - the whole stack runs anywhere.
- anything else: an OpenAI-compatible endpoint (Ollama, vLLM, managed) via
  the official `openai` client. Switching is a .env change only.
"""

import asyncio
import hashlib
import json
import re
import time
from typing import TypeVar

import openai
import structlog
from pydantic import BaseModel, ValidationError
from tenacity import AsyncRetrying, retry_if_exception_type, stop_after_attempt, wait_random_exponential

from rca.ai import extract_rules
from rca.ai.guards import Ctx, input_guard, output_guard
from rca.app.errors import DependencyUnavailable
from rca.settings import get_settings

log = structlog.get_logger()
M = TypeVar("M", bound=BaseModel)
TRANSIENT = (
    openai.RateLimitError,
    openai.APITimeoutError,
    openai.APIConnectionError,
    openai.InternalServerError,
)


class CircuitBreaker:
    def __init__(self, threshold: int = 5, cooldown: int = 30):
        self.fail, self.threshold, self.cooldown, self.open_until = 0, threshold, cooldown, 0.0

    def is_open(self) -> bool:
        return time.monotonic() < self.open_until

    def ok(self) -> None:
        self.fail = 0

    def bad(self) -> None:
        self.fail += 1
        if self.fail >= self.threshold:
            self.open_until = time.monotonic() + self.cooldown


_PASSAGE_RE = re.compile(r'<passage id="([^"]+)">\n?(.*?)\n?</passage>', re.DOTALL)
_LANG_RE = re.compile(r"Passage language: (\w+)")


def _dummy_extract(user: str) -> str:
    pm = _PASSAGE_RE.search(user)
    passage = pm.group(2) if pm else user
    lang = "ar" if (lm := _LANG_RE.search(user)) and lm.group(1) == "ar" else "en"
    claims = extract_rules.extract_claims_rules(passage, lang)
    return json.dumps({"claims": [c.model_dump(mode="json") for c in claims]})


def _dummy_route(route: str, system: str, user: str) -> str:
    """Deterministic providers. Draft/classify payloads are OUR JSON, not untrusted text."""
    if route == "extract":
        return _dummy_extract(user)
    try:
        payload = json.loads(user)
    except json.JSONDecodeError:
        payload = {"sentences": [user]}
    if route == "classify":
        return json.dumps(payload.get("classify_result", {"intent": "fact", "steps": []}))
    # draft: join the sentences the service assembled from verified evidence
    return json.dumps({"text": "\n".join(payload.get("sentences", []))})


def _strip_think(text: str) -> str:
    """Reasoning models (qwen3, deepseek-r1) emit <think> blocks; they are not JSON."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    text = text.strip()
    if text.startswith("{"):
        return text
    # Fall back to the first JSON object in the reply.
    m = re.search(r"\{.*\}", text, re.DOTALL)
    return m.group(0) if m else text


class ModelGateway:
    def __init__(self):
        s = get_settings()
        self.s = s
        self.routes = s.routes()
        self.sem = {r: asyncio.Semaphore(s.llm_max_concurrency) for r in self.routes}
        self.breakers = {r: CircuitBreaker() for r in self.routes}

    def _is_dummy(self, route_name: str) -> bool:
        r = self.routes[route_name]
        return r.base_url == "local" or r.model.startswith("dummy")

    async def _raw(self, route_name: str, messages: list[dict], temperature: float) -> str:
        if self._is_dummy(route_name):
            return _dummy_route(route_name, messages[0]["content"], messages[1]["content"])
        route = self.routes[route_name]
        key = self.s.llm_api_key.get_secret_value() if self.s.llm_api_key else "not-needed"
        client = openai.AsyncOpenAI(
            base_url=route.base_url, api_key=key, timeout=self.s.llm_timeout_s, max_retries=0
        )
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(self.s.llm_max_retries),
            wait=wait_random_exponential(multiplier=1, max=20),
            retry=retry_if_exception_type(TRANSIENT),
            reraise=True,
        ):
            with attempt:
                async with self.sem[route_name]:
                    resp = await client.chat.completions.create(
                        model=route.model,
                        messages=messages,
                        temperature=temperature,
                        response_format={"type": "json_object"},
                    )
        return _strip_think(resp.choices[0].message.content or "")

    async def complete_json(
        self,
        *,
        route: str,
        system: str,
        user: str,
        schema: type[M],
        ctx: Ctx,
        temperature: float = 0.0,
        max_repairs: int = 2,
    ) -> M:
        input_guard(user, ctx)
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        prompt_hash = hashlib.sha256((system + user).encode()).hexdigest()[:16]
        br = self.breakers[route]
        if br.is_open():
            raise DependencyUnavailable("Model temporarily unavailable")
        for attempt in range(max_repairs + 1):
            t0 = time.perf_counter()
            try:
                text = await self._raw(route, messages, temperature)
                br.ok()
            except TRANSIENT as e:
                br.bad()
                log.warning("llm_transient_exhausted", route=route, err=type(e).__name__)
                raise DependencyUnavailable("Model call failed") from e
            log.info(
                "model_call",
                route=route,
                prompt_hash=prompt_hash,
                latency_s=round(time.perf_counter() - t0, 3),
                attempt=attempt,
            )
            try:
                out = schema.model_validate_json(text)
                if route == "draft":
                    output_guard(text, ctx)
                return out
            except ValidationError as ve:
                if attempt == max_repairs or self._is_dummy(route):
                    raise
                messages += [
                    {"role": "assistant", "content": text},
                    {
                        "role": "user",
                        "content": "The JSON did not match the schema. Errors: "
                        f"{ve.errors(include_url=False)[:5]}. Return only corrected JSON.",
                    },
                ]
        raise RuntimeError("unreachable")
