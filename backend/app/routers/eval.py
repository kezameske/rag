"""Retrieval evaluation endpoint (admin-only)."""
from dataclasses import asdict
from fastapi import APIRouter, Depends

from app.dependencies import get_admin_user, User
from app.services.eval_service import (
    run_eval,
    auto_generate_eval_cases,
    EvalCase,
)

router = APIRouter(prefix="/eval", tags=["eval"])


@router.post("/run")
async def run_evaluation(
    current_user: User = Depends(get_admin_user),
):
    """
    Auto-generate eval cases from user's documents and run retrieval evaluation.

    Returns recall@5, recall@10, MRR, and per-case results.
    Admin-only endpoint.
    """
    # Auto-generate eval cases
    eval_cases = await auto_generate_eval_cases(current_user.id, max_cases=10)

    if not eval_cases:
        return {
            "error": "No documents found to generate eval cases. Upload documents first."
        }

    # Run evaluation
    summary = await run_eval(current_user.id, eval_cases)

    return {
        "total_cases": summary.total_cases,
        "hits": summary.hits,
        "recall_at_5": round(summary.recall_at_5, 3),
        "recall_at_10": round(summary.recall_at_10, 3),
        "mrr": round(summary.mrr, 3),
        "results": [asdict(r) for r in summary.results],
    }


@router.post("/run-custom")
async def run_custom_evaluation(
    cases: list[dict],
    current_user: User = Depends(get_admin_user),
):
    """
    Run evaluation with custom test cases.

    Body: [{"question": "...", "expected_keywords": ["..."], "expected_document": "filename.pdf"}]
    """
    eval_cases = [
        EvalCase(
            question=c["question"],
            expected_keywords=c["expected_keywords"],
            expected_document=c.get("expected_document"),
        )
        for c in cases
    ]

    summary = await run_eval(current_user.id, eval_cases)

    return {
        "total_cases": summary.total_cases,
        "hits": summary.hits,
        "recall_at_5": round(summary.recall_at_5, 3),
        "recall_at_10": round(summary.recall_at_10, 3),
        "mrr": round(summary.mrr, 3),
        "results": [asdict(r) for r in summary.results],
    }
