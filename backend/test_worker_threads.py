"""
Background sweeps use synchronous database calls. Run on the API's own event loop, each query froze
every request for as long as it waited on the network. The termination and recording workers must
therefore run a sweep off the API's loop thread (as the reminder worker already does).
"""
import asyncio
import threading

from app.core.config import settings
from app.services import meeting_termination, recording_providers


def _run_worker(worker, patch_target, monkeypatch, summary):
    seen = {}

    async def fake_sweep(db, *a, **k):
        seen["thread"] = threading.get_ident()
        seen["loop_thread_is_main"] = threading.current_thread() is threading.main_thread()
        return summary

    monkeypatch.setattr(*patch_target, fake_sweep)

    async def go():
        stop = asyncio.Event()
        task = asyncio.create_task(worker(stop))
        for _ in range(100):
            if "thread" in seen:
                break
            await asyncio.sleep(0.05)
        stop.set()
        await asyncio.wait_for(task, timeout=5)
        return threading.get_ident()

    loop_thread = asyncio.run(go())
    return seen, loop_thread


def test_termination_sweep_runs_off_the_api_loop_thread(monkeypatch):
    monkeypatch.setattr(settings, "TERMINATION_POLL_SECONDS", 1, raising=False)
    seen, loop_thread = _run_worker(
        meeting_termination.termination_worker, (meeting_termination, "run_due_terminations"),
        monkeypatch, {"terminated": 0, "failed": 0, "already_ended": 0},
    )
    assert "thread" in seen, "the sweep never ran"
    assert seen["thread"] != loop_thread


def test_recording_sweep_runs_off_the_api_loop_thread(monkeypatch):
    monkeypatch.setattr(settings, "RECORDING_POLL_SECONDS", 30, raising=False)
    seen, loop_thread = _run_worker(
        recording_providers.recording_worker, (recording_providers, "process_due_recordings"),
        monkeypatch, {"scanned": 0},
    )
    assert "thread" in seen, "the sweep never ran"
    assert seen["thread"] != loop_thread
