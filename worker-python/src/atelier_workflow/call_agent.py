from typing import Any, Dict

async def call_agent(agent_name: str, input: Dict[str, Any]) -> Dict[str, Any]:
    """Invokes a named agent via Temporal activity."""
    return {'output': f'Agent {agent_name} response', 'agentName': agent_name}
