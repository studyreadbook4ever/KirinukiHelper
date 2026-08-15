from __future__ import annotations

import argparse
import json
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


DECIMAL_PATTERN = re.compile(r"^\d+(?:\.\d+)?$")
TICKS_PER_SECOND = Decimal(60)


def quantize_seconds_to_tick(value: str) -> int:
    text = value.strip()
    if not DECIMAL_PATTERN.fullmatch(text):
        raise ValueError(f"Expected a non-negative decimal number, received: {text}")
    try:
        seconds = Decimal(text)
    except InvalidOperation as error:
        raise ValueError(f"Invalid decimal seconds: {text}") from error
    return int((seconds * TICKS_PER_SECOND).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def main() -> None:
    parser = argparse.ArgumentParser(description="Quantize project-local seconds to exact 60 Hz ticks.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--seconds")
    group.add_argument("--start")
    parser.add_argument("--end")
    arguments = parser.parse_args()

    if arguments.seconds is not None:
        if arguments.end is not None:
            parser.error("--end is valid only with --start")
        print(json.dumps({
            "seconds": arguments.seconds,
            "tick": quantize_seconds_to_tick(arguments.seconds),
            "tickRate": 60,
        }, ensure_ascii=False, separators=(",", ":")))
        return

    if arguments.end is None:
        parser.error("--start requires --end")
    start_tick = quantize_seconds_to_tick(arguments.start)
    end_tick_exclusive = quantize_seconds_to_tick(arguments.end)
    if start_tick >= end_tick_exclusive:
        raise ValueError(
            "Quantization produced an empty or reversed interval; revisit evidence instead of shifting a tick silently"
        )
    print(json.dumps({
        "startSeconds": arguments.start,
        "endSeconds": arguments.end,
        "startTick": start_tick,
        "endTickExclusive": end_tick_exclusive,
        "tickRate": 60,
    }, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
