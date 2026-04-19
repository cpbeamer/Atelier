import asyncio
from typing import Any, Dict

_milestone_results: Dict[str, Dict[str, Any]] = {}

async def milestone(name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Blocks until a human decision is received."""
    milestone_id = f"{name}-{hash(str(payload))}"
    _milestone_results[milestone_id] = None

    while _milestone_results.get(milestone_id) is None:
        await asyncio.sleep(1)

    return _milestone_results.pop(milestone_id)
