import json
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from starlette.responses import StreamingResponse
from datetime import datetime

from app.dependencies import get_approved_user, User
from app.db.supabase import get_supabase_client
from app.models.schemas import MessageCreate, MessageResponse
from app.services.llm_service import astream_chat_response, get_available_tools
from app.services.tool_executor import execute_tool_call

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/threads/{thread_id}", tags=["chat"])

MAX_TOOL_ROUNDS = 5


async def verify_thread_access(thread_id: str, user_id: str) -> dict:
    """Verify the user has access to the thread and return thread data."""
    supabase = get_supabase_client()
    result = supabase.table("threads").select("*").eq("id", thread_id).eq("user_id", user_id).single().execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Thread not found"
        )

    return result.data


def get_thread_messages(thread_id: str) -> list[dict[str, str]]:
    """Get all messages for a thread formatted for the API."""
    supabase = get_supabase_client()
    result = supabase.table("messages").select("role, content").eq("thread_id", thread_id).order("created_at").execute()

    return [{"role": msg["role"], "content": msg["content"]} for msg in result.data]


def user_has_documents(user_id: str) -> bool:
    """Check if user has any completed documents for RAG."""
    supabase = get_supabase_client()
    result = supabase.table("documents").select("id", count="exact").eq(
        "user_id", user_id
    ).eq("status", "completed").execute()
    return (result.count or 0) > 0


@router.get("/messages", response_model=list[MessageResponse])
async def get_messages(
    thread_id: str,
    current_user: User = Depends(get_approved_user)
):
    """Get all messages for a thread from database."""
    await verify_thread_access(thread_id, current_user.id)

    supabase = get_supabase_client()
    result = supabase.table("messages").select("*").eq("thread_id", thread_id).order("created_at").execute()

    return result.data


@router.post("/messages")
async def send_message(
    thread_id: str,
    message_data: MessageCreate,
    current_user: User = Depends(get_approved_user)
):
    """Send a message and stream the assistant's response via SSE."""
    await verify_thread_access(thread_id, current_user.id)
    supabase = get_supabase_client()

    # Store user message in database
    now = datetime.utcnow().isoformat()
    user_message_result = supabase.table("messages").insert({
        "thread_id": thread_id,
        "user_id": current_user.id,
        "role": "user",
        "content": message_data.content,
        "created_at": now,
    }).execute()

    if not user_message_result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save user message"
        )

    # Get full message history for context
    messages = get_thread_messages(thread_id)

    # Get tools dynamically based on user state
    has_docs = user_has_documents(current_user.id)
    tools = get_available_tools(has_docs)
    logger.info(f"Chat: user={current_user.id}, has_docs={has_docs}, tools={len(tools) if tools else 0}")

    async def generate():
        """Generate SSE events with tool-calling loop."""
        full_response = ""
        current_messages = list(messages)
        rounds = 0
        tool_calls_log = []  # Track tool calls for saving

        try:
            while rounds < MAX_TOOL_ROUNDS:
                rounds += 1
                async for event in astream_chat_response(current_messages, tools=tools, user_id=current_user.id):
                    if event["type"] == "text_delta":
                        full_response += event["content"]
                        data = json.dumps({"content": event["content"]})
                        yield f"event: text_delta\ndata: {data}\n\n"

                    elif event["type"] == "tool_calls":
                        tool_calls = event["tool_calls"]

                        # Add assistant message with tool calls
                        current_messages.append({
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": tc["id"],
                                    "type": "function",
                                    "function": {
                                        "name": tc["name"],
                                        "arguments": tc["arguments"],
                                    }
                                }
                                for tc in tool_calls
                            ],
                        })

                        # Execute each tool and add results
                        for tc in tool_calls:
                            if tc["name"] == "analyze_document":
                                # Handle sub-agent specially
                                args = json.loads(tc["arguments"])
                                document_id = args.get("document_id", "")
                                query = args.get("query", "")

                                # Send sub-agent start event
                                yield f"event: sub_agent_start\ndata: {json.dumps({'document_id': document_id, 'query': query})}\n\n"

                                from app.services.sub_agent_service import run_sub_agent
                                sub_result = ""
                                async for sub_event in run_sub_agent(document_id, query, current_user.id):
                                    if sub_event["type"] == "sub_agent_thinking":
                                        yield f"event: sub_agent_thinking\ndata: {json.dumps({'content': sub_event['content']})}\n\n"
                                    elif sub_event["type"] == "sub_agent_result":
                                        sub_result = sub_event["content"]
                                        yield f"event: sub_agent_result\ndata: {json.dumps({'content': sub_result})}\n\n"

                                current_messages.append({
                                    "role": "tool",
                                    "tool_call_id": tc["id"],
                                    "content": sub_result,
                                })
                                tool_calls_log.append({
                                    "name": tc["name"],
                                    "arguments": tc["arguments"],
                                    "result": sub_result[:500],
                                })
                            else:
                                result = await execute_tool_call(tc, current_user.id)
                                current_messages.append({
                                    "role": "tool",
                                    "tool_call_id": tc["id"],
                                    "content": result,
                                })
                                tool_calls_log.append({
                                    "name": tc["name"],
                                    "arguments": tc["arguments"],
                                    "result": result[:500],
                                })

                        # Continue the loop to call LLM again
                        break

                    elif event["type"] == "response_completed":
                        # Save assistant message to database
                        if full_response:
                            msg_data = {
                                "thread_id": thread_id,
                                "user_id": current_user.id,
                                "role": "assistant",
                                "content": full_response,
                                "created_at": datetime.utcnow().isoformat(),
                            }
                            if tool_calls_log:
                                msg_data["tool_calls"] = tool_calls_log

                            supabase.table("messages").insert(msg_data).execute()

                            # Update thread's updated_at
                            supabase.table("threads").update({
                                "updated_at": datetime.utcnow().isoformat()
                            }).eq("id", thread_id).execute()

                        yield f"event: done\ndata: {{}}\n\n"
                        return  # Done, exit the generator

                    elif event["type"] == "error":
                        data = json.dumps({"error": event["error"]})
                        yield f"event: error\ndata: {data}\n\n"
                        return

            # If we exhausted rounds without a final response, send done
            if full_response:
                msg_data = {
                    "thread_id": thread_id,
                    "user_id": current_user.id,
                    "role": "assistant",
                    "content": full_response,
                    "created_at": datetime.utcnow().isoformat(),
                }
                if tool_calls_log:
                    msg_data["tool_calls"] = tool_calls_log
                supabase.table("messages").insert(msg_data).execute()
            yield f"event: done\ndata: {{}}\n\n"

        except Exception as e:
            data = json.dumps({"error": str(e)})
            yield f"event: error\ndata: {data}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )
