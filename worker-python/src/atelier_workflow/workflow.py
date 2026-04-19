import functools
from typing import Any, Callable, Awaitable

def defn(cls):
    """Decorator equivalent of defineWorkflow"""
    @functools.wraps(cls)
    async def wrapper(*args, **kwargs):
        return await cls.run(*args, **kwargs)
    return cls

def workflow(fn: Callable[..., Awaitable[Any]]):
    """Marks a function as a Temporal workflow"""
    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        return await fn(*args, **kwargs)
    wrapper._is_workflow = True
    return wrapper
