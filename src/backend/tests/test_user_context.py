"""Focused regression tests for request user-context isolation."""

import asyncio
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.user_context import (
    get_current_user_id,
    reset_user_id,
    reset_user_id_token,
    set_current_user_id,
)


def test_reset_clears_a_previously_set_user_id():
    set_current_user_id("user-a")
    reset_user_id()
    with pytest.raises(RuntimeError, match="No user context set"):
        get_current_user_id()


def test_token_reset_restores_nested_user_and_direct_reset_clears_it():
    set_current_user_id("user-a")
    token = set_current_user_id("user-b")
    reset_user_id_token(token)
    assert get_current_user_id() == "user-a"
    reset_user_id()
    with pytest.raises(RuntimeError, match="No user context set"):
        get_current_user_id()


def test_clean_context_raises_and_repeated_resets_are_harmless():
    reset_user_id()
    reset_user_id()
    with pytest.raises(RuntimeError, match="No user context set"):
        get_current_user_id()


def test_context_isolation_across_tasks_and_threads():
    reset_user_id()
    set_current_user_id("parent")

    async def task_context():
        assert get_current_user_id() == "parent"
        set_current_user_id("task")
        assert get_current_user_id() == "task"
        reset_user_id()
        with pytest.raises(RuntimeError, match="No user context set"):
            get_current_user_id()

    asyncio.run(task_context())
    assert get_current_user_id() == "parent"

    def thread_context():
        with pytest.raises(RuntimeError, match="No user context set"):
            get_current_user_id()
        set_current_user_id("thread")
        assert get_current_user_id() == "thread"
        reset_user_id()

    with ThreadPoolExecutor(max_workers=1) as executor:
        executor.submit(thread_context).result()
    assert get_current_user_id() == "parent"
    reset_user_id()
