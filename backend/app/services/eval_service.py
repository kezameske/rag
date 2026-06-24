"""Retrieval evaluation framework.

Measures retrieval quality using recall@k and MRR metrics against
a set of question/expected-chunk pairs. Helps tune chunking strategy,
embedding models, hybrid search weights, and reranking.
"""
import json
import logging
from dataclasses import dataclass

from app.db.supabase import get_supabase_client
from app.services.retrieval_service import search_documents

logger = logging.getLogger(__name__)


@dataclass
class EvalCase:
    """A single evaluation case: question + expected relevant content."""
    question: str
    expected_keywords: list[str]  # Keywords that should appear in retrieved chunks
    expected_document: str | None = None  # Optional filename filter


@dataclass
class EvalResult:
    """Result of a single eval case."""
    question: str
    hit: bool  # Did we find a relevant chunk?
    rank: int | None  # Position of first relevant chunk (1-indexed), None if not found
    top_k_contents: list[str]  # Preview of what was retrieved
    expected_keywords: list[str]
    matched_keywords: list[str]


@dataclass
class EvalSummary:
    """Aggregate evaluation metrics."""
    total_cases: int
    hits: int
    recall_at_5: float
    recall_at_10: float
    mrr: float  # Mean Reciprocal Rank
    results: list[EvalResult]


def _check_relevance(content: str, keywords: list[str]) -> list[str]:
    """Check which expected keywords appear in the retrieved content."""
    content_lower = content.lower()
    return [kw for kw in keywords if kw.lower() in content_lower]


async def run_eval(
    user_id: str,
    eval_cases: list[EvalCase],
    top_k: int = 10,
) -> EvalSummary:
    """
    Run retrieval evaluation against a set of test cases.

    For each case, runs the full retrieval pipeline (HyDE + hybrid + rerank)
    and checks if the expected keywords appear in the top-k results.

    Args:
        user_id: User ID to scope the search
        eval_cases: List of evaluation cases
        top_k: Number of results to retrieve per query

    Returns:
        EvalSummary with recall@k and MRR metrics
    """
    results = []
    hits_at_5 = 0
    hits_at_10 = 0
    reciprocal_ranks = []

    for case in eval_cases:
        metadata_filter = None
        if case.expected_document:
            # We can't filter by filename directly in metadata_filter (that's for extracted_metadata)
            # So we just search and check results
            pass

        chunks = await search_documents(
            query=case.question,
            user_id=user_id,
            top_k=top_k,
        )

        # Check each result for relevance
        first_hit_rank = None
        all_matched = []
        for i, chunk in enumerate(chunks):
            content = chunk.get("content", "")
            filename = chunk.get("metadata", {}).get("filename", "")

            # Skip if expecting specific document and this isn't it
            if case.expected_document and case.expected_document.lower() not in filename.lower():
                continue

            matched = _check_relevance(content, case.expected_keywords)
            if matched and first_hit_rank is None:
                first_hit_rank = i + 1  # 1-indexed rank
            all_matched.extend(matched)

        hit = first_hit_rank is not None
        unique_matched = list(set(all_matched))

        if hit:
            reciprocal_ranks.append(1.0 / first_hit_rank)
            if first_hit_rank <= 5:
                hits_at_5 += 1
            if first_hit_rank <= 10:
                hits_at_10 += 1
        else:
            reciprocal_ranks.append(0.0)

        results.append(EvalResult(
            question=case.question,
            hit=hit,
            rank=first_hit_rank,
            top_k_contents=[c.get("content", "")[:100] for c in chunks[:3]],
            expected_keywords=case.expected_keywords,
            matched_keywords=unique_matched,
        ))

    total = len(eval_cases)
    return EvalSummary(
        total_cases=total,
        hits=sum(1 for r in results if r.hit),
        recall_at_5=hits_at_5 / total if total > 0 else 0.0,
        recall_at_10=hits_at_10 / total if total > 0 else 0.0,
        mrr=sum(reciprocal_ranks) / total if total > 0 else 0.0,
        results=results,
    )


async def auto_generate_eval_cases(user_id: str, max_cases: int = 10) -> list[EvalCase]:
    """
    Auto-generate evaluation cases from the user's documents.

    Picks random chunks and uses LLM to generate questions that
    those chunks should answer. This creates ground-truth pairs
    without manual labeling.

    Args:
        user_id: User ID to fetch documents
        max_cases: Maximum number of eval cases to generate

    Returns:
        List of EvalCase objects
    """
    from app.services.langsmith import get_traced_async_openai_client
    from app.routers.settings import decrypt_value

    supabase = get_supabase_client()

    # Get LLM settings
    settings = supabase.table("global_settings").select(
        "llm_model, llm_base_url, llm_api_key"
    ).limit(1).maybe_single().execute()

    data = settings.data if settings else None
    api_key = decrypt_value(data.get("llm_api_key")) if data else None
    if not api_key:
        raise ValueError("LLM not configured")

    client = get_traced_async_openai_client(
        base_url=data.get("llm_base_url") or None,
        api_key=api_key,
    )
    model = data.get("llm_model") or "gpt-4o"

    # Sample chunks from user's documents
    chunks_result = supabase.table("chunks").select(
        "content, metadata"
    ).eq("user_id", user_id).limit(max_cases * 2).execute()

    if not chunks_result.data:
        return []

    # Pick every other chunk for diversity
    sampled = chunks_result.data[::2][:max_cases]

    eval_cases = []
    for chunk in sampled:
        content = chunk["content"][:500]
        filename = chunk.get("metadata", {}).get("filename", "unknown")

        try:
            response = await client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Given a text passage, generate:\n"
                            "1. A natural question that this passage answers\n"
                            "2. 2-3 key terms from the passage that should appear in search results\n\n"
                            "Return JSON: {\"question\": \"...\", \"keywords\": [\"...\"]}"
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"Passage from '{filename}':\n\n{content}",
                    },
                ],
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "eval_case",
                        "strict": True,
                        "schema": {
                            "type": "object",
                            "properties": {
                                "question": {"type": "string"},
                                "keywords": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                },
                            },
                            "required": ["question", "keywords"],
                            "additionalProperties": False,
                        },
                    },
                },
                max_tokens=150,
            )

            raw = json.loads(response.choices[0].message.content)
            eval_cases.append(EvalCase(
                question=raw["question"],
                expected_keywords=raw["keywords"],
                expected_document=filename,
            ))

        except Exception as e:
            logger.warning(f"Failed to generate eval case: {e}")
            continue

    logger.info(f"Generated {len(eval_cases)} eval cases from {len(sampled)} chunks")
    return eval_cases


# ---------------------------------------------------------------------------
# Reference-free generation evaluation (faithfulness / relevance / groundedness).
# Off the hot path — admin eval endpoint only. Raw LLM-as-judge, no RAGAS.
# ---------------------------------------------------------------------------

def _get_eval_client():
    """Build an LLM client + model from global settings for answering/judging."""
    from app.services.langsmith import get_traced_async_openai_client
    from app.routers.settings import decrypt_value

    supabase = get_supabase_client()
    settings = supabase.table("global_settings").select(
        "llm_model, llm_base_url, llm_api_key"
    ).limit(1).maybe_single().execute()
    data = settings.data if settings else None
    api_key = decrypt_value(data.get("llm_api_key")) if data else None
    if not api_key:
        raise ValueError("LLM not configured")
    client = get_traced_async_openai_client(
        base_url=data.get("llm_base_url") or None, api_key=api_key,
    )
    return client, data.get("llm_model") or "gpt-4o"


async def _generate_answer(question: str, context: str) -> str:
    """Answer a question strictly from the provided context (one LLM call)."""
    client, model = _get_eval_client()
    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": (
                "Answer the question using ONLY the provided context. If the context "
                "does not contain the answer, say you don't have enough information."
            )},
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"},
        ],
        max_tokens=300,
        temperature=0.0,
    )
    return (response.choices[0].message.content or "").strip()


async def judge_generation(question: str, context: str, answer: str) -> dict:
    """Reference-free LLM-as-judge scores (0-2 each) for a generated answer."""
    client, model = _get_eval_client()
    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": (
                "You are a strict evaluator of RAG answers. Score 0-2 on each axis:\n"
                "- faithfulness: are the answer's claims supported by the context? "
                "(0 contradicts, 1 partly, 2 fully supported)\n"
                "- answer_relevance: does the answer address the question? "
                "(0 off-topic, 1 partial, 2 directly answers)\n"
                "- groundedness: is the answer free of unsupported/hallucinated claims? "
                "(0 hallucinated, 1 some, 2 fully grounded)\n"
                "Add a one-sentence rationale."
            )},
            {"role": "user", "content": (
                f"Question:\n{question}\n\nContext:\n{context}\n\nAnswer:\n{answer}"
            )},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "generation_score",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "faithfulness": {"type": "integer"},
                        "answer_relevance": {"type": "integer"},
                        "groundedness": {"type": "integer"},
                        "rationale": {"type": "string"},
                    },
                    "required": ["faithfulness", "answer_relevance", "groundedness", "rationale"],
                    "additionalProperties": False,
                },
            },
        },
        max_tokens=200,
        temperature=0.0,
    )
    return json.loads(response.choices[0].message.content)


async def run_generation_eval(user_id: str, max_cases: int = 5) -> dict:
    """End-to-end answer-quality eval: auto questions -> retrieve -> answer -> judge."""
    cases = await auto_generate_eval_cases(user_id, max_cases=max_cases)
    if not cases:
        return {"error": "No documents found to generate eval cases.", "results": []}

    results = []
    for case in cases:
        chunks = await search_documents(case.question, user_id, top_k=5)
        context = "\n\n".join(c.get("content", "") for c in chunks)
        if not context.strip():
            answer = "I don't have enough information."
            score = {
                "faithfulness": 2, "answer_relevance": 0, "groundedness": 2,
                "rationale": "No context retrieved.",
            }
        else:
            answer = await _generate_answer(case.question, context)
            try:
                score = await judge_generation(case.question, context, answer)
            except Exception as e:
                logger.warning(f"Judge failed: {e}")
                continue
        results.append({
            "question": case.question,
            "answer": answer,
            "retrieved": len(chunks),
            "faithfulness": score.get("faithfulness"),
            "answer_relevance": score.get("answer_relevance"),
            "groundedness": score.get("groundedness"),
            "rationale": score.get("rationale"),
        })

    def _avg(key: str) -> float:
        vals = [r[key] for r in results if isinstance(r.get(key), int)]
        return round(sum(vals) / len(vals), 2) if vals else 0.0

    return {
        "total_cases": len(results),
        "avg_faithfulness": _avg("faithfulness"),
        "avg_answer_relevance": _avg("answer_relevance"),
        "avg_groundedness": _avg("groundedness"),
        "results": results,
    }
