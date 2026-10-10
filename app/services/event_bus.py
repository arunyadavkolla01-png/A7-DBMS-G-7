import json
import logging
from datetime import datetime, timezone
from app.config import settings

logger = logging.getLogger(__name__)

MODE = settings.EVENT_BUS_MODE.lower()
BROKER = settings.KAFKA_BROKER
TOPIC = settings.KAFKA_TOPIC

_producer = None


async def _get_producer():
    global _producer
    if _producer is None:
        from aiokafka import AIOKafkaProducer
        _producer = AIOKafkaProducer(
            bootstrap_servers=BROKER,
            acks="all",
            enable_idempotence=True,
            compression_type="gzip",
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            key_serializer=lambda k: k.encode("utf-8") if k else None,
            request_timeout_ms=10000,
            retry_backoff_ms=200,
        )
        await _producer.start()
        logger.info("[kafka] producer connected → %s", BROKER)
    return _producer


async def publish(event_type: str, payload: dict) -> None:
    envelope = {
        "event_type":  event_type,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "payload":     payload,
    }

    if MODE == "off":
        logger.info("[event-bus OFF] %s", event_type)
        return

    if MODE == "http":
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5) as c:
                await c.post(settings.NOTIFY_URL, json=envelope)
        except Exception as e:
            logger.warning("event-bus HTTP failed: %s", e)
        return

    try:
        producer = await _get_producer()
        key = str(payload.get("user_id") or payload.get("booking_id") or "")
        await producer.send_and_wait(TOPIC, value=envelope, key=key or None)
    except Exception as e:
        logger.warning("event-bus Kafka failed: %s", e)


async def shutdown():
    global _producer
    if _producer is not None:
        try:
            await _producer.stop()
        finally:
            _producer = None