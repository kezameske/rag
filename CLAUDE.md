# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

RAG app with chat (default) and document ingestion interfaces. Config via env vars, no admin UI.

## Stack
- Frontend: React + Vite + Tailwind + shadcn/ui
- Backend: Python + FastAPI
- Database: Supabase (Postgres, pgvector, Auth, Storage, Realtime)
- LLM: OpenAI (Module 1), OpenRouter (Module 2+)
- Observability: LangSmith

## Rules
- No LangChain, no LangGraph - raw SDK calls only
- Use Pydantic for structured LLM outputs
- All tables need Row-Level Security - users only see their own data
- Stream chat responses via SSE
- Use Supabase Realtime for ingestion status updates
- Module 2+ uses stateless completions - store and send chat history yourself
- Ingestion is manual file upload only - no connectors or automated pipelines

## Architecture

### Backend (`backend/app/`)
- **main.py** - FastAPI app with CORS, global exception handler, router registration
- **config.py** - `Settings` via pydantic-settings, loaded from `backend/.env`, cached with `@lru_cache`
- **dependencies.py** - Auth middleware: `get_current_user` (JWT decode from Supabase token), `get_admin_user` (admin check via `user_profiles` table)
- **db/supabase.py** - Two clients: `get_supabase_client()` (service role, for backend ops) and `get_supabase_anon_client()` (anon key, for user-context ops)

### Routers
- **auth.py** - `/auth/me` endpoint
- **threads.py** - `/threads` CRUD (list, create, get, update, delete)
- **chat.py** - `/threads/{thread_id}/messages` - GET messages + POST with SSE streaming. Has a tool-calling loop (max 3 rounds) that conditionally adds RAG tools only if user has documents
- **documents.py** - `/documents` - upload (multipart), list, delete. Upload triggers background `process_document`
- **settings.py** - `/settings` - global LLM/embedding config (admin-only write, encrypted API keys via Fernet)

### Services
- **llm_service.py** - `astream_chat_response()` using ChatCompletions API with provider abstraction. Reads model/base_url/api_key from `global_settings` table. Defines `RAG_TOOLS` (search_documents function)
- **ingestion_service.py** - `process_document()`: download from Supabase Storage → extract text (txt/md/pdf/docx/xlsx) → chunk → batch embed → store in pgvector
- **chunking_service.py** - Text chunking logic
- **embedding_service.py** - `get_embeddings()` for vectorizing chunks
- **retrieval_service.py** - `search_documents()` for pgvector similarity search
- **tool_executor.py** - Dispatches tool calls from LLM (currently only `search_documents`)

### Frontend (`frontend/src/`)
- **App.tsx** - React Router: `/` (chat), `/documents`, `/settings`, `/auth`. All routes except `/auth` require authentication
- **lib/api.ts** - API client with auth header injection. `sendMessage()` handles SSE stream parsing
- **lib/supabase.ts** - Supabase client initialized from VITE_ env vars
- **hooks/useAuth.ts** - Auth state management via Supabase `onAuthStateChange`
- **hooks/useRealtimeDocuments.ts** - Supabase Realtime subscription for document status updates
- **pages/** - ChatPage (thread list + chat view), DocumentsPage (upload + list), SettingsPage

### Database Tables
- `threads` - Chat threads (user_id, title, timestamps)
- `messages` - Chat messages (thread_id, role: user|assistant, content)
- `documents` - Uploaded docs metadata (status: pending|processing|completed|failed, storage_path)
- `chunks` - Document chunks with pgvector embeddings (document_id, content, embedding, metadata)
- `global_settings` - Single-row LLM/embedding config (encrypted API keys)
- `user_profiles` - Admin flag (is_admin)

### Key Data Flow
1. **Chat**: Frontend SSE → `chat.py` loads message history → `llm_service.py` streams ChatCompletions → if tool_calls, `tool_executor.py` runs search → loops back to LLM (max 3 rounds) → saves final response to DB
2. **Ingestion**: Upload → store in Supabase Storage → create document record → `asyncio.create_task(process_document)` → chunk → embed → store vectors → update status (Realtime pushes to frontend)

## Planning
- Save all plans to `.agent/plans/` folder
- Naming convention: `{sequence}.{plan-name}.md` (e.g., `1.auth-setup.md`, `2.document-ingestion.md`)
- Plans should be detailed enough to execute without ambiguity
- Each task in the plan must include at least one validation test to verify it works
- Assess complexity and single-pass feasibility - can an agent realistically complete this in one go?
- Include a complexity indicator at the top of each plan:
  - ✅ **Simple** - Single-pass executable, low risk
  - ⚠️ **Medium** - May need iteration, some complexity
  - 🔴 **Complex** - Break into sub-plans before executing

## Development Flow
1. **Plan** - Create a detailed plan and save it to `.agent/plans/`
2. **Build** - Execute the plan to implement the feature
3. **Validate** - Test and verify the implementation works correctly. Use browser testing where applicable via an appropriate MCP
4. **Iterate** - Fix any issues found during validation

## Managing Services

**Important:** On Windows with MINGW/Git Bash, npm commands produce no output. Always use PowerShell for npm and service commands.

### Service Scripts
All scripts are in the `scripts/` folder. Run with: `powershell -File scripts/<script>.ps1`

| Script | Description |
|--------|-------------|
| `start-all.ps1` | Start both backend and frontend in new windows |
| `start-backend.ps1` | Start backend only (http://localhost:8000) |
| `start-frontend.ps1` | Start frontend only (http://localhost:5173) |
| `stop-all.ps1` | Stop both services |
| `stop-backend.ps1` | Stop backend only |
| `stop-frontend.ps1` | Stop frontend only |
| `restart-all.ps1` | Restart both services |
| `restart-backend.ps1` | Restart backend only |
| `restart-frontend.ps1` | Restart frontend only |

### Quick Commands
```powershell
# Start all services
powershell -File scripts/start-all.ps1

# Restart backend (after code changes)
powershell -File scripts/restart-backend.ps1

# Stop everything
powershell -File scripts/stop-all.ps1
```

### Verify Services
- Backend health: `curl http://localhost:8000/health` should return `{"status":"ok"}`
- Frontend: Open http://localhost:5173 in browser

## Environment Variables
- Backend: `backend/.env` (see `backend/.env.example`) - Supabase keys, LangSmith, encryption key, CORS
- Frontend: `frontend/.env` (see `frontend/.env.example`) - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`
- Python venv: `backend/venv/` (NOT `.venv`)

## Test Credentials
For browser testing and validation:
- **Email:** test@test.com
- **Password:** M+T!kV3v2d_xn/p

For testing the isolation of data between users
- **Email:** test2@test.com
- **Password:** M+T!kV3v2d_xn/p

## Validation Suite

A comprehensive test suite lives at `.agent/validation/full-suite.md`.

**When building new features, you MUST update the validation suite:**
1. Add new API tests (curl-based) for any new or modified endpoints
2. Add new E2E tests (Playwright MCP) for any new UI flows
3. Add fixture files to `.agent/validation/fixtures/` if tests need sample data
4. Update the Results Summary table at the bottom of `full-suite.md` with new section counts
5. Follow the existing test format: `### TEST-ID: Description` with Steps and Acceptance Criteria
6. Maintain test ordering - tests that create data must run before tests that read it
7. Add cleanup steps for any new test data created

**Test ID conventions:**
- API tests: `API-{next-number}` (continue from highest existing)
- E2E tests: `E2E-{next-number}` (continue from highest existing)

## Progress
Check PROGRESS.md for current module status. Update it as you complete tasks.

## Notes
- The Python Virtual Environment is located in the folder /backend/venv/ NOT .venv
- SQL migrations are in `backend/migrations/`, applied via `supabase db push`
- Supabase project ref: `dkbbhbpluvtimzzyavyg`
