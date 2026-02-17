# Progress

Track your progress through the masterclass. Update this file as you complete modules - Claude Code reads this to understand where you are in the project.

## Convention
- `[ ]` = Not started
- `[-]` = In progress
- `[x]` = Completed

## Modules

### Module 1: App Shell + Observability
- [x] Backend Setup - FastAPI skeleton with health endpoint
- [x] Supabase Client - Backend Supabase client wrapper
- [x] Database Schema - threads and messages tables with RLS
- [x] Auth Middleware - JWT verification and /auth/me endpoint
- [x] Frontend Setup - Vite + React + Tailwind + shadcn/ui
- [x] Frontend Supabase Client
- [x] Auth UI - Sign in/sign up forms
- [x] OpenAI Assistant Service - Responses API integration
- [x] Thread API - CRUD endpoints
- [x] Chat API with SSE - Streaming messages
- [x] Thread List UI
- [x] Chat View UI
- [x] Main App Assembly
- [x] LangSmith Tracing

**Status: COMPLETE ✓**

### Module 2: BYO Retrieval + Provider Abstraction
- [x] Phase 1: Provider Abstraction - ChatCompletions API with configurable base_url/api_key
- [x] Phase 2: Database Schema - pgvector extension, documents/chunks tables, RLS, match_chunks function, storage bucket
- [x] Phase 3: Ingestion Pipeline - embedding_service, chunking_service, ingestion_service, documents router
- [x] Phase 4: Retrieval Tool - retrieval_service, tool_executor, RAG_TOOLS definition, tool-calling loop in chat
- [x] Phase 5: Ingestion UI + Realtime - DocumentsPage, DocumentUpload, DocumentList, useRealtimeDocuments hook

**Status: COMPLETE ✓**

### Module 3: Record Manager
- [x] Database migration - content_hash column and index
- [x] Backend deduplication logic in upload endpoint (SHA-256 hashing, 409 for duplicates, auto-replace same filename)
- [x] Pydantic schema and TypeScript types updated
- [x] Frontend duplicate detection UX (yellow warning for duplicates)
- [x] Validation tests added (API-41 to API-44, E2E-28)

**Status: COMPLETE ✓**

### Module 4: Metadata Extraction
- [x] Database migration - extracted_metadata JSONB + metadata_status columns on documents
- [x] Updated match_chunks RPC to accept optional p_metadata_filter param
- [x] New metadata_service.py - LLM extracts title/summary/keywords/document_type/language via structured output
- [x] Ingestion pipeline calls extract_metadata() after chunks stored (non-fatal on error)
- [x] Retrieval accepts metadata_filter param, passed to RPC
- [x] search_documents tool definition updated with optional filters property
- [x] tool_executor parses filters and forwards to search_documents()
- [x] Pydantic schema + TypeScript types updated with extracted_metadata/metadata_status
- [x] DocumentList shows keywords as tags + document_type badge

**Status: COMPLETE ✓**

### Module 5: Multi-Format Support
- [x] HTML extractor (BeautifulSoup, strips scripts/styles/nav)
- [x] CSV extractor (csv module, pipe-separated rows)
- [x] Backend allowed types/extensions updated (.html, .csv)
- [x] Frontend file input accept + ALLOWED_EXTENSIONS updated
- [x] beautifulsoup4 + lxml added to requirements.txt and installed

**Status: COMPLETE ✓**

### Module 6: Hybrid Search & Reranking
- [x] Database migration - fts tsvector column, backfill, trigger, GIN index
- [x] match_chunks_hybrid RPC - combines vector + FTS with Reciprocal Rank Fusion (RRF)
- [x] New reranking_service.py - LLM-based relevance scoring with structured output
- [x] retrieval_service.py updated to use hybrid search with fallback to vector-only
- [x] Fetches 2x candidates then reranks down to top_k

**Status: COMPLETE ✓**

### Module 7: Text-to-SQL Tool
- [x] Database migration - execute_readonly_query RPC (SELECT-only, 5s timeout, 50 row limit)
- [x] New sql_service.py - text_to_sql_query() with schema context, LLM structured output, validation
- [x] query_documents_sql tool definition added to llm_service.py
- [x] tool_executor handles query_documents_sql dispatch
- [x] get_available_tools() function returns dynamic tool set based on user state
- [x] MAX_TOOL_ROUNDS increased to 5 in chat.py

**Status: COMPLETE ✓**

### Module 8: Sub-Agents
- [x] Database migration - tool_calls JSONB column on messages table
- [x] New sub_agent_service.py - loads all chunks, calls LLM with full document context
- [x] analyze_document tool definition added to llm_service.py
- [x] chat.py handles analyze_document specially with sub-agent SSE events
- [x] Tool calls logged and saved to messages.tool_calls JSONB
- [x] Frontend api.ts - onSubAgentStart/Thinking/Result callbacks, new SSE event parsing
- [x] ChatView.tsx - collapsible sub-agent panel (blue left border) with thinking/result states
- [x] TypeScript types updated - tool_calls on Message, ToolCall interface, DocumentMetadata interface

**Status: COMPLETE ✓**

### Module 9: Query Transformation (HyDE)
- [x] New query_transform_service.py - HyDE hypothetical passage generation + query expansion
- [x] retrieval_service.py updated - embeds HyDE passage instead of raw query for vector search
- [x] Original query preserved for FTS keyword matching
- [x] Graceful fallback if HyDE fails

**Status: COMPLETE ✓**

### Module 10: Contextual Chunk Embeddings
- [x] ingestion_service.py updated - generates document-level context sentence via LLM
- [x] Context prepended to chunks before embedding (raw content stored for display)
- [x] doc_context saved in chunk metadata for debugging
- [x] Non-fatal: falls back to plain embeddings if context generation fails

**Status: COMPLETE ✓**

### Module 11: Retrieval Evaluation Framework
- [x] New eval_service.py - EvalCase/EvalResult/EvalSummary dataclasses, run_eval(), auto_generate_eval_cases()
- [x] New routers/eval.py - POST /eval/run (auto-generate + evaluate), POST /eval/run-custom
- [x] Admin-only endpoints, measures recall@5, recall@10, MRR
- [x] Registered in main.py

**Status: COMPLETE ✓**

## Validation Summary
- [x] Supabase project linked via CLI (project ref: dkbbhbpluvtimzzyavyg)
- [x] SQL migration applied via `supabase db push`
- [x] Backend venv created and dependencies installed
- [x] Backend server running (health endpoint validated)
- [x] Frontend .env file created
- [x] Frontend npm install completed
- [x] Frontend dev server verified working
- [x] Service startup scripts created (`scripts/start-*.ps1`)
- [x] Playwright MCP configured for browser testing
- [x] Auth flow tested - Sign in/sign up working
- [x] Thread creation and chat tested - Messages streaming correctly
- [x] LangSmith tracing configured (verify traces in LangSmith dashboard)

## Module 2 Validation
- [x] Database migrations applied (pgvector, documents, chunks tables, storage bucket)
- [x] Backend starts with new LLM service (ChatCompletions API)
- [x] Documents page accessible with upload zone and document list
- [x] File upload works (.txt/.md), status updates in real-time via Supabase Realtime
- [x] Ingestion pipeline: upload → chunk → embed → store in pgvector
- [x] RAG retrieval: chat calls search_documents tool, retrieves relevant chunks, cites sources
- [x] Tool-calling loop with max 3 rounds works correctly

### Validation Suite
- [x] Test fixture files created (.agent/validation/fixtures/)
- [x] Full validation suite written (.agent/validation/full-suite.md)
- [x] 36 API tests (curl-based) covering health, auth, threads, chat, documents, settings, errors
- [x] 23 E2E browser tests (Playwright MCP) covering auth, chat, navigation, documents, RAG, isolation
- [x] Cleanup section to reset state after test runs
- [x] CLAUDE.md updated with test suite maintenance instructions for future agents

**Status: COMPLETE**

## Modules 4-11 Validation
- [x] Migrations applied (M4, M6, M7, M8 via SQL Editor)
- [x] Dependencies installed (beautifulsoup4, lxml)
- [ ] Upload HTML/CSV files → verify processing (M5)
- [ ] Check extracted metadata on documents (M4)
- [ ] Chat with metadata filters (M4)
- [ ] Verify hybrid search + reranking in backend logs (M6)
- [ ] Chat "how many documents?" → SQL tool (M7)
- [ ] Chat "summarize [doc]" → sub-agent (M8)
- [ ] Verify sub-agent panel in frontend (M8)
- [ ] Verify HyDE transformation in backend logs (M9)
- [ ] Re-upload document → check contextual embeddings in chunk metadata (M10)
- [ ] POST /eval/run → verify recall@k and MRR metrics (M11)

## Notes
- Test user created: test@test.com (see CLAUDE.md for credentials)
- Migration updated to use `gen_random_uuid()` instead of `uuid_generate_v4()`
- All core Module 1 functionality validated and working

## Service URLs
- **Frontend:** http://localhost:5173
- **Backend:** http://localhost:8000
- **Backend Health:** http://localhost:8000/health

## Windows/MINGW Notes
- npm commands produce no output in MINGW/Git Bash
- Always use PowerShell for npm and service commands
- See `scripts/` folder for ready-to-use startup scripts
- CLAUDE.md has been updated with service startup instructions
