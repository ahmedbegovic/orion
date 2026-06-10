"""Model downloads and HF cache management.

Downloads run through the JobRegistry; Electron main polls GET /jobs/{id} and
reads job.data {repo_id, bytes_done, bytes_total} for byte-level progress.
All weights live in the shared HF cache (~/.cache/huggingface/hub).
"""

from __future__ import annotations

import threading
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from huggingface_hub import (
    CacheNotFound,
    HfApi,
    scan_cache_dir,
    snapshot_download,
    try_to_load_from_cache,
)
from pydantic import BaseModel
from tqdm.auto import tqdm as base_tqdm

from ..jobs import Job, registry

router = APIRouter(prefix="/models", tags=["models"])


class DownloadRequest(BaseModel):
    repo_id: str


class DownloadCancelled(Exception):
    """Raised from tqdm.update() to abort an in-flight snapshot download."""


def _human_gb(done: int, total: Optional[int]) -> str:
    gb = 1024**3
    if total:
        return f"{done / gb:.1f} / {total / gb:.1f} GB"
    return f"{done / gb:.1f} GB"


def _job_tqdm(job: Job) -> type[base_tqdm]:
    """tqdm subclass that funnels snapshot_download progress into `job`.

    snapshot_download aggregates all per-file bars into one byte-unit bar built
    from this class (and one file-count bar, which we ignore). Raising from
    update() aborts the download; partial files resume natively on retry.
    """

    # update() is called concurrently from snapshot_download's worker threads
    # (one shared byte bar, max_workers=8) and `+=` on a dict item is not
    # atomic — serialize the counter or increments get lost.
    lock = threading.Lock()

    class JobTqdm(base_tqdm):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self._bytes_bar = kwargs.get("unit") == "B"
            kwargs["disable"] = True  # progress goes to the job, not stderr
            super().__init__(*args, **kwargs)

        def update(self, n: float | None = 1) -> Any:
            if job.cancel_event.is_set():
                raise DownloadCancelled(job.data.get("repo_id", ""))
            if self._bytes_bar and n:
                with lock:
                    data = job.data
                    data["bytes_done"] += int(n)
                    total = data["bytes_total"]
                    job.progress = min(data["bytes_done"] / total, 1.0) if total else -1.0
                    job.detail = _human_gb(data["bytes_done"], total)
            return super().update(n)

    return JobTqdm


def _run_download(job: Job, repo_id: str) -> Optional[dict[str, Any]]:
    # Total size up-front from file metadata; None-safe (sizes can be missing).
    info = HfApi().model_info(repo_id, files_metadata=True)
    siblings = [s for s in (info.siblings or []) if s.size is not None]
    total = sum(s.size for s in siblings) if siblings else None
    job.data["bytes_total"] = total
    if total is None:
        job.progress = -1.0  # indeterminate
    else:
        # Files completed on a previous attempt are short-circuited inside
        # hf_hub_download and never reach the progress bar — seed them here so
        # a resumed download doesn't sit below 100% while finishing.
        done = sum(
            s.size
            for s in siblings
            if isinstance(try_to_load_from_cache(repo_id, s.rfilename, revision=info.sha), str)
        )
        if done:
            job.data["bytes_done"] = done
            job.progress = min(done / total, 1.0)
            job.detail = _human_gb(done, total)
    try:
        path = snapshot_download(repo_id, tqdm_class=_job_tqdm(job))
    except DownloadCancelled:
        return None  # runner marks the job cancelled; partials stay resumable
    return {"path": path}


@router.post("/download")
def start_download(body: DownloadRequest) -> dict[str, str]:
    job = registry.start(
        "model-download",
        lambda job: _run_download(job, body.repo_id),
        data={"repo_id": body.repo_id, "bytes_done": 0, "bytes_total": None},
    )
    return {"job_id": job.id}


@router.get("/local")
def local_models() -> dict[str, list[dict[str, Any]]]:
    try:
        cache = scan_cache_dir()
    except CacheNotFound:
        return {"models": []}
    models = [
        {
            "repo_id": repo.repo_id,
            "size_bytes": repo.size_on_disk,
            "last_modified_ms": int(repo.last_modified * 1000) if repo.last_modified else None,
        }
        for repo in cache.repos
        if repo.repo_type == "model"
    ]
    models.sort(key=lambda m: m["repo_id"])
    return {"models": models}


@router.get("/search")
def search_models(q: str) -> dict[str, list[dict[str, Any]]]:
    # expand: the list endpoint omits lastModified unless asked explicitly.
    results = HfApi().list_models(
        filter="mlx",
        search=q,
        sort="downloads",
        limit=30,
        expand=["downloads", "likes", "lastModified"],
    )
    return {
        "results": [
            {
                "repo_id": m.id,
                "downloads": m.downloads or 0,
                "likes": m.likes or 0,
                "last_modified_ms": int(m.last_modified.timestamp() * 1000) if m.last_modified else None,
            }
            for m in results
        ]
    }


@router.delete("/{repo_id:path}")
def delete_model(repo_id: str) -> dict[str, bool]:
    # Deleting underneath an in-flight snapshot_download corrupts the cache
    # and crashes the worker — the partial repo is already visible to the UI.
    if registry.find_running("model-download", repo_id=repo_id) is not None:
        raise HTTPException(
            status_code=409, detail="a download for this model is in progress — cancel it first"
        )
    try:
        cache = scan_cache_dir()
    except CacheNotFound as exc:
        raise HTTPException(status_code=404, detail="no such model in cache") from exc
    repo = next(
        (r for r in cache.repos if r.repo_type == "model" and r.repo_id == repo_id), None
    )
    if repo is None:
        raise HTTPException(status_code=404, detail="no such model in cache")
    cache.delete_revisions(*(rev.commit_hash for rev in repo.revisions)).execute()
    return {"ok": True}
