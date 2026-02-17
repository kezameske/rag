# Full Validation Suite

## Execution Instructions

### Prerequisites
- Backend running at http://localhost:8000
- Frontend running at http://localhost:5173
- Supabase project accessible

### Obtaining JWT Tokens

To authenticate API calls, obtain JWT tokens via Supabase GoTrue auth endpoint:

```bash
# Get token for User 1 (test@test.com)
curl -s -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"M+T!kV3v2d_xn/p"}' | jq -r '.access_token'

# Get token for User 2 (test2@test.com)
curl -s -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"email":"test2@test.com","password":"M+T!kV3v2d_xn/p"}' | jq -r '.access_token'
```

**Note:** Replace `${SUPABASE_URL}` and `${SUPABASE_ANON_KEY}` with values from `backend/.env`.

### Variable Tracking

Throughout the suite, track these variables:
- `$TOKEN1` - JWT for test@test.com
- `$TOKEN2` - JWT for test2@test.com
- `$THREAD_ID` - ID of created test thread
- `$THREAD_ID_2` - ID of second test thread (for delete test)
- `$DOC_ID` - ID of uploaded test document
- `$DOC_ID_MD` - ID of uploaded markdown document
- `$RAG_DOC_ID` - ID of uploaded RAG test document

### Test Ordering

Tests are ordered by dependency. Execute in sequence:
1. Health & Auth (no dependencies)
2. Thread CRUD (creates threads used later)
3. Data Isolation (uses threads from step 2)
4. Chat/Messages (uses thread from step 2)
5. Documents (independent, creates docs)
6. Settings & Admin (tests admin guard and global settings)
7. Error Handling (independent)
8. Cleanup (removes all test data)

### Timeout Guidance
- Standard API calls: 5 seconds
- SSE streaming: 30 seconds for first event, 60 seconds total
- Document ingestion (status → completed): 30 seconds
- Playwright page loads: 10 seconds

---

## API Tests (curl-based)

### Health & Auth

#### API-01: Health endpoint returns OK
**Steps:**
```bash
curl -s http://localhost:8000/health
```
**Acceptance Criteria:** Response is `{"status":"ok"}` with HTTP 200.

---

#### API-02: Unauthenticated request rejected
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/threads
```
**Acceptance Criteria:** HTTP status code is `403` (no Authorization header).

---

#### API-03: Invalid token rejected
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/threads \
  -H "Authorization: Bearer invalid-token-abc123"
```
**Acceptance Criteria:** HTTP status code is `401` or `403`.

---

#### API-04: Valid token accepted
**Steps:**
```bash
curl -s http://localhost:8000/auth/me \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** Response contains `"email":"test@test.com"` and HTTP 200.

---

### Thread CRUD

#### API-05: Create thread with default title
**Steps:**
```bash
curl -s -X POST http://localhost:8000/threads \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{}'
```
**Acceptance Criteria:** HTTP 201. Response contains `"title":"New Chat"`, has `id`, `user_id`, `created_at`, `updated_at` fields. Save `id` as `$THREAD_ID`.

---

#### API-06: Create thread with custom title
**Steps:**
```bash
curl -s -X POST http://localhost:8000/threads \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Thread for Deletion"}'
```
**Acceptance Criteria:** HTTP 201. Response contains `"title":"Test Thread for Deletion"`. Save `id` as `$THREAD_ID_2`.

---

#### API-07: List threads returns created threads
**Steps:**
```bash
curl -s http://localhost:8000/threads \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP 200. Response is a JSON array containing at least 2 threads. Both `$THREAD_ID` and `$THREAD_ID_2` are present.

---

#### API-08: Get single thread by ID
**Steps:**
```bash
curl -s http://localhost:8000/threads/$THREAD_ID \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP 200. Response `id` matches `$THREAD_ID`, `title` is `"New Chat"`.

---

#### API-09: Update thread title
**Steps:**
```bash
curl -s -X PATCH http://localhost:8000/threads/$THREAD_ID \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"title":"Updated Test Thread"}'
```
**Acceptance Criteria:** HTTP 200. Response contains `"title":"Updated Test Thread"`.

---

#### API-10: Verify updated title persists
**Steps:**
```bash
curl -s http://localhost:8000/threads/$THREAD_ID \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP 200. `title` is `"Updated Test Thread"`.

---

#### API-11: Delete thread
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X DELETE http://localhost:8000/threads/$THREAD_ID_2 \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP status code is `204`.

---

### Data Isolation

#### API-12: User 2 cannot list User 1's threads
**Steps:**
```bash
curl -s http://localhost:8000/threads \
  -H "Authorization: Bearer $TOKEN2"
```
**Acceptance Criteria:** HTTP 200. Response array does NOT contain `$THREAD_ID`. (User 2 sees only their own threads or empty array.)

---

#### API-13: User 2 cannot get User 1's thread by ID
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/threads/$THREAD_ID \
  -H "Authorization: Bearer $TOKEN2"
```
**Acceptance Criteria:** HTTP status code is `404`.

---

#### API-14: User 2 cannot update User 1's thread
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X PATCH http://localhost:8000/threads/$THREAD_ID \
  -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hacked"}'
```
**Acceptance Criteria:** HTTP status code is `404`.

---

#### API-15: User 2 cannot delete User 1's thread
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X DELETE http://localhost:8000/threads/$THREAD_ID \
  -H "Authorization: Bearer $TOKEN2"
```
**Acceptance Criteria:** HTTP status code is `404`.

---

### Chat / Messages

#### API-16: Empty thread has no messages
**Steps:**
```bash
curl -s http://localhost:8000/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP 200. Response is an empty JSON array `[]`.

---

#### API-17: Send message returns SSE stream
**Steps:**
```bash
curl -s -N -X POST http://localhost:8000/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":"Hello, what is 2+2?"}' \
  --max-time 60
```
**Acceptance Criteria:** Response contains `event: text_delta` lines with `data:` payloads containing `"content"` fields. Stream ends with `event: done` and `data: {}`. HTTP 200.

---

#### API-18: Messages persist after chat
**Steps:**
```bash
curl -s http://localhost:8000/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP 200. Response array contains at least 2 messages: one with `"role":"user"` and `"content":"Hello, what is 2+2?"`, and one with `"role":"assistant"`.

---

#### API-19: User 2 cannot access User 1's messages
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN2"
```
**Acceptance Criteria:** HTTP status code is `404`.

---

### Documents

#### API-20: Upload .txt file
**Steps:**
```bash
curl -s -X POST http://localhost:8000/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@.agent/validation/fixtures/test_document.txt"
```
**Acceptance Criteria:** HTTP 201. Response contains `"filename":"test_document.txt"`, `"file_type":".txt"`, `"status":"pending"`, `file_size` > 0. Save `id` as `$DOC_ID`.

---

#### API-21: Upload .md file
**Steps:**
```bash
curl -s -X POST http://localhost:8000/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@.agent/validation/fixtures/test_document.md"
```
**Acceptance Criteria:** HTTP 201. Response contains `"filename":"test_document.md"`, `"file_type":".md"`, `"status":"pending"`. Save `id` as `$DOC_ID_MD`.

---

#### API-22: Reject invalid file type (.py)
**Steps:**
```bash
# Create a temporary .py file
echo "print('hello')" > /tmp/test_invalid.py
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8000/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@/tmp/test_invalid.py"
```
**Acceptance Criteria:** HTTP status code is `400`.

---

#### API-23: Reject empty file
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8000/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@.agent/validation/fixtures/empty.txt"
```
**Acceptance Criteria:** HTTP status code is `400`.

---

#### API-24: List documents shows uploaded files
**Steps:**
```bash
curl -s http://localhost:8000/documents \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP 200. Response array contains documents with IDs `$DOC_ID` and `$DOC_ID_MD`.

---

#### API-25: Document status transitions to completed
**Steps:**
```bash
# Poll every 2 seconds for up to 30 seconds
for i in $(seq 1 15); do
  STATUS=$(curl -s http://localhost:8000/documents \
    -H "Authorization: Bearer $TOKEN1" | jq -r ".[] | select(.id==\"$DOC_ID\") | .status")
  if [ "$STATUS" = "completed" ]; then break; fi
  sleep 2
done
echo $STATUS
```
**Acceptance Criteria:** `$STATUS` is `"completed"` within 30 seconds. Document `chunk_count` > 0.

---

#### API-26: Upload RAG test document
**Steps:**
```bash
curl -s -X POST http://localhost:8000/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@.agent/validation/fixtures/test_rag_document.txt"
```
**Acceptance Criteria:** HTTP 201. Save `id` as `$RAG_DOC_ID`. Wait for status to transition to `"completed"` (poll as in API-25).

---

#### API-27: RAG retrieval returns relevant chunks
**Steps:**
```bash
curl -s -N -X POST http://localhost:8000/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":"How tall is the Eiffel Tower and when was it built?"}' \
  --max-time 60
```
**Acceptance Criteria:** SSE stream contains text mentioning "330 meters" or "1,083 feet" and "1889" or "1887". The response references information from the uploaded Eiffel Tower document.

---

#### API-28: Delete document
**Steps:**
```bash
curl -s -X DELETE http://localhost:8000/documents/$DOC_ID \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP 200. Response contains `"status":"deleted"`.

---

#### API-29: Deleted document no longer in list
**Steps:**
```bash
curl -s http://localhost:8000/documents \
  -H "Authorization: Bearer $TOKEN1" | jq ".[] | select(.id==\"$DOC_ID\")"
```
**Acceptance Criteria:** Output is empty (document not found in list).

---

#### API-30: User 2 cannot access User 1's documents
**Steps:**
```bash
curl -s http://localhost:8000/documents \
  -H "Authorization: Bearer $TOKEN2"
```
**Acceptance Criteria:** HTTP 200. Response array does NOT contain `$DOC_ID_MD` or `$RAG_DOC_ID`.

---

### Settings & Admin

#### API-31: Get global settings (any authenticated user)
**Steps:**
```bash
curl -s http://localhost:8000/settings \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP 200. Response contains fields: `llm_model`, `llm_base_url`, `llm_api_key`, `embedding_model`, `embedding_base_url`, `embedding_api_key`, `embedding_dimensions`, `has_chunks`.

---

#### API-32: Non-admin GET settings also succeeds
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/settings \
  -H "Authorization: Bearer $TOKEN2"
```
**Acceptance Criteria:** HTTP status code is `200` (non-admins can read global settings).

---

#### API-33: Non-admin PUT settings returns 403
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X PUT http://localhost:8000/settings \
  -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d '{"llm_model":"gpt-4o-mini"}'
```
**Acceptance Criteria:** HTTP status code is `403`.

---

#### API-34: Admin PUT settings succeeds
**Steps:**
```bash
curl -s -X PUT http://localhost:8000/settings \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"llm_model":"gpt-4o-mini"}'
```
**Acceptance Criteria:** HTTP 200. Response contains `"llm_model":"gpt-4o-mini"`.

---

#### API-35: API key masking in response
**Steps:**
```bash
curl -s -X PUT http://localhost:8000/settings \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"llm_api_key":"sk-test-key-12345678"}'
# Then GET settings to check masking
curl -s http://localhost:8000/settings \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** GET response shows `llm_api_key` as masked value (e.g., `"***5678"` format), NOT the full key.

---

#### API-36: GET /auth/me returns is_admin field for admin
**Steps:**
```bash
curl -s http://localhost:8000/auth/me \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP 200. Response contains `"is_admin":true` for test@test.com.

---

#### API-37: GET /auth/me returns is_admin=false for non-admin
**Steps:**
```bash
curl -s http://localhost:8000/auth/me \
  -H "Authorization: Bearer $TOKEN2"
```
**Acceptance Criteria:** HTTP 200. Response contains `"is_admin":false` for test2@test.com.

---

### Error Handling

#### API-38: Get nonexistent thread returns 404
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/threads/00000000-0000-0000-0000-000000000000 \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP status code is `404`.

---

#### API-39: Send empty message rejected
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8000/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":""}'
```
**Acceptance Criteria:** HTTP status code is `400` or `422` (validation error for empty content).

---

#### API-40: No auth on protected endpoint
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/auth/me
```
**Acceptance Criteria:** HTTP status code is `403`.

---

### Record Manager (Deduplication)

#### API-41: Upload document returns content_hash
**Steps:**
```bash
echo "record manager test content" > /tmp/test_hash.txt
curl -s -X POST http://localhost:8000/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@/tmp/test_hash.txt"
```
**Acceptance Criteria:** HTTP 200. Response contains `content_hash` field with a 64-character hex string.

---

#### API-42: Duplicate upload returns 409
**Steps:**
```bash
# Upload the same file again (identical content)
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8000/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@/tmp/test_hash.txt"
```
**Acceptance Criteria:** HTTP status code is `409`. Response body contains `"Duplicate content"`.

---

#### API-43: Re-upload after deleting original succeeds
**Steps:**
```bash
# Delete the original document first, then re-upload
# (Get document ID from API-41 response, delete it, then upload again)
curl -s -X DELETE http://localhost:8000/documents/$DOC_ID_HASH \
  -H "Authorization: Bearer $TOKEN1"
curl -s -X POST http://localhost:8000/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@/tmp/test_hash.txt"
```
**Acceptance Criteria:** Delete returns `{"status":"deleted"}`. Second upload returns HTTP 200 with new document record.

---

#### API-44: Same filename with different content replaces old document
**Steps:**
```bash
# Upload file with same name but different content
echo "updated content for record manager" > /tmp/test_hash.txt
curl -s -X POST http://localhost:8000/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@/tmp/test_hash.txt"
# List documents and check only one test_hash.txt exists
curl -s http://localhost:8000/documents \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** Upload returns HTTP 200. Document list contains only one `test_hash.txt` with the new content hash. Old document was auto-replaced.

---

## E2E Browser Tests (Playwright MCP)

### Auth Flow

#### E2E-01: Unauthenticated redirect to /auth
**Steps:**
1. `browser_navigate` to `http://localhost:5173`
2. `browser_snapshot`
**Acceptance Criteria:** Page shows the sign-in form with email and password fields. URL is `/auth` or login UI is visible.

---

#### E2E-02: Sign in with valid credentials
**Steps:**
1. `browser_navigate` to `http://localhost:5173/auth`
2. `browser_snapshot` to find email/password fields
3. `browser_fill_form` with email: `test@test.com`, password: `M+T!kV3v2d_xn/p`
4. `browser_click` the Sign In button
5. `browser_wait_for` text to appear indicating successful login (thread list or chat UI)
6. `browser_snapshot`
**Acceptance Criteria:** After sign-in, user is redirected to chat page. Page shows thread list or "New Chat" button. No error messages visible.

---

#### E2E-03: Sign in with invalid credentials shows error
**Steps:**
1. `browser_navigate` to `http://localhost:5173/auth`
2. `browser_fill_form` with email: `wrong@test.com`, password: `wrongpassword`
3. `browser_click` the Sign In button
4. `browser_wait_for` time: 3 seconds
5. `browser_snapshot`
**Acceptance Criteria:** Error message is visible on page (e.g., "Invalid login credentials"). User remains on auth page.

---

#### E2E-04: Protected routes redirect when not authenticated
**Steps:**
1. Close any existing session (clear cookies or use new context)
2. `browser_navigate` to `http://localhost:5173/documents`
3. `browser_snapshot`
**Acceptance Criteria:** User is redirected to auth page. Documents page is NOT shown.

---

### Chat Flow

#### E2E-05: Create new thread
**Steps:**
1. Sign in as test@test.com (use steps from E2E-02)
2. `browser_snapshot` to find new chat/thread button
3. `browser_click` the new thread button
4. `browser_snapshot`
**Acceptance Criteria:** A new thread appears in the thread list. Chat area is empty/ready for input.

---

#### E2E-06: Send message in chat
**Steps:**
1. From E2E-05 state (new thread selected)
2. `browser_snapshot` to find message input
3. `browser_type` into message input: `What is the capital of France?`
4. `browser_click` send button or press Enter
5. `browser_wait_for` time: 5 seconds (wait for streaming to start)
6. `browser_snapshot`
**Acceptance Criteria:** User message appears in chat. Assistant response begins streaming (partial or complete text visible).

---

#### E2E-07: Streaming response completes
**Steps:**
1. From E2E-06 state
2. `browser_wait_for` time: 15 seconds (allow full response)
3. `browser_snapshot`
**Acceptance Criteria:** Assistant response is fully rendered (mentions "Paris"). No loading indicators remain. Message is displayed in the chat area.

---

#### E2E-08: Messages persist after page reload
**Steps:**
1. From E2E-07 state, note the thread in sidebar
2. `browser_navigate` to `http://localhost:5173` (reload)
3. `browser_wait_for` time: 3 seconds
4. `browser_snapshot` and click on the thread from the sidebar
5. `browser_wait_for` time: 3 seconds
6. `browser_snapshot`
**Acceptance Criteria:** Previous messages (user question and assistant response) are still visible in the chat after reload.

---

#### E2E-09: Delete thread
**Steps:**
1. From authenticated state
2. `browser_snapshot` to find thread in sidebar
3. Hover or right-click on a thread to reveal delete option
4. `browser_click` delete button/icon
5. `browser_snapshot`
**Acceptance Criteria:** Thread is removed from the sidebar list. Chat area resets or shows empty state.

---

### Navigation

#### E2E-10: Navigate to Documents page
**Steps:**
1. From authenticated chat page
2. `browser_snapshot` to find Documents navigation link
3. `browser_click` the Documents link/button
4. `browser_wait_for` time: 2 seconds
5. `browser_snapshot`
**Acceptance Criteria:** Documents page is shown with upload zone and document list area. URL contains `/documents`.

---

#### E2E-11: Navigate back to Chat page
**Steps:**
1. From Documents page (E2E-10)
2. `browser_snapshot` to find Chat navigation link
3. `browser_click` the Chat link/button
4. `browser_wait_for` time: 2 seconds
5. `browser_snapshot`
**Acceptance Criteria:** Chat page is shown with thread list sidebar. URL is `/` or `/chat`.

---

### Documents

#### E2E-12: Upload zone is visible
**Steps:**
1. Navigate to Documents page
2. `browser_snapshot`
**Acceptance Criteria:** Upload zone/dropzone is visible with instructions to upload files. Accepted file types (.txt, .md) are indicated.

---

#### E2E-13: Upload file via UI
**Steps:**
1. From Documents page
2. `browser_snapshot` to find file input
3. `browser_file_upload` with path to `.agent/validation/fixtures/test_document.txt`
4. `browser_wait_for` time: 5 seconds
5. `browser_snapshot`
**Acceptance Criteria:** Document appears in the document list with filename "test_document.txt". Status shows "pending" initially.

---

#### E2E-14: Document status updates in realtime
**Steps:**
1. From E2E-13 state
2. `browser_wait_for` time: 20 seconds (wait for processing)
3. `browser_snapshot`
**Acceptance Criteria:** Document status has transitioned from "pending" to "completed" in the UI without page refresh (realtime update via Supabase).

---

#### E2E-15: Delete document via UI
**Steps:**
1. From Documents page with at least one document
2. `browser_snapshot` to find delete button for a document
3. `browser_click` the delete button
4. `browser_wait_for` time: 3 seconds
5. `browser_snapshot`
**Acceptance Criteria:** Document is removed from the list. No error messages shown.

---

### RAG Integration

#### E2E-16: Upload RAG document and wait for processing
**Steps:**
1. Navigate to Documents page
2. `browser_file_upload` with path to `.agent/validation/fixtures/test_rag_document.txt`
3. `browser_wait_for` time: 30 seconds (wait for "completed" status)
4. `browser_snapshot`
**Acceptance Criteria:** Document "test_rag_document.txt" shows status "completed" with chunk_count > 0.

---

#### E2E-17: Ask question about uploaded document
**Steps:**
1. Navigate to Chat page
2. Create a new thread
3. Type message: `What year was the Eiffel Tower completed and how tall is it?`
4. Send the message
5. `browser_wait_for` time: 30 seconds (allow tool calling + response)
6. `browser_snapshot`
**Acceptance Criteria:** Assistant response mentions "1889" (completion year) and "330 meters" or "1,083 feet" (height). This confirms the RAG retrieval tool was used successfully.

---

### Data Isolation

#### E2E-18: Sign out
**Steps:**
1. From authenticated state
2. `browser_snapshot` to find user menu or sign out button
3. `browser_click` sign out / user menu
4. If user menu opened, `browser_click` the sign out option
5. `browser_wait_for` time: 3 seconds
6. `browser_snapshot`
**Acceptance Criteria:** User is redirected to auth page. No user-specific data visible.

---

#### E2E-19: Sign in as User 2
**Steps:**
1. From auth page
2. `browser_fill_form` with email: `test2@test.com`, password: `M+T!kV3v2d_xn/p`
3. `browser_click` Sign In
4. `browser_wait_for` time: 3 seconds
5. `browser_snapshot`
**Acceptance Criteria:** User 2 is signed in. Chat page shown.

---

#### E2E-20: User 2 cannot see User 1's threads
**Steps:**
1. From E2E-19 state (signed in as User 2)
2. `browser_snapshot` the thread list
**Acceptance Criteria:** Thread list does NOT contain any threads created by User 1 during this test run. List may be empty or contain only User 2's own threads.

---

#### E2E-21: User 2 cannot see User 1's documents
**Steps:**
1. Navigate to Documents page as User 2
2. `browser_snapshot`
**Acceptance Criteria:** Document list does NOT contain "test_rag_document.txt" or any documents uploaded by User 1.

---

#### E2E-22: Sign back in as User 1
**Steps:**
1. Sign out from User 2
2. Sign in as `test@test.com` with password `M+T!kV3v2d_xn/p`
3. `browser_snapshot`
**Acceptance Criteria:** User 1 is signed in. Their threads and documents are visible again.

---

### Admin Settings Access

#### E2E-23: Non-admin user does not see Settings in UserMenu
**Steps:**
1. Sign in as `test2@test.com` (non-admin)
2. `browser_snapshot` to find user menu
3. `browser_click` on user menu avatar/button
4. `browser_snapshot` the popover menu
**Acceptance Criteria:** The popover menu does NOT contain a "Settings" option. Only "Log out" is visible.

---

#### E2E-24: Non-admin navigating to /settings is redirected
**Steps:**
1. Sign in as `test2@test.com`
2. `browser_navigate` to `http://localhost:5173/settings`
3. `browser_wait_for` time: 3 seconds
4. `browser_snapshot`
**Acceptance Criteria:** User is redirected to `/` (chat page). Settings page is NOT shown.

---

#### E2E-25: Admin can access Settings page
**Steps:**
1. Sign in as `test@test.com` (admin)
2. `browser_snapshot` to find user menu
3. `browser_click` on user menu avatar/button
4. `browser_snapshot` to verify Settings option is visible
5. `browser_click` Settings
6. `browser_wait_for` time: 2 seconds
7. `browser_snapshot`
**Acceptance Criteria:** Settings page is shown with LLM Configuration and Embedding Configuration sections.

---

#### E2E-26: Admin can save settings
**Steps:**
1. From Settings page (as admin)
2. `browser_fill_form` with model name: `gpt-4o-mini`
3. `browser_click` Save button
4. `browser_wait_for` time: 3 seconds
5. `browser_snapshot`
**Acceptance Criteria:** Success message "Settings saved successfully." is visible. No error messages.

---

### Error Handling

#### E2E-27: Invalid file type rejection in UI
**Steps:**
1. Navigate to Documents page
2. Attempt to upload a file with invalid extension (e.g., `.py` or `.jpg`)
3. `browser_wait_for` time: 3 seconds
4. `browser_snapshot`
**Acceptance Criteria:** Error message is shown indicating the file type is not supported. File is NOT added to the document list.

---

### Record Manager (Deduplication)

#### E2E-28: Duplicate upload shows yellow warning
**Steps:**
1. Sign in as `test@test.com`
2. Navigate to Documents page
3. Upload a `.txt` file
4. `browser_wait_for` time: 5 seconds (wait for processing)
5. Upload the same file again
6. `browser_wait_for` time: 3 seconds
7. `browser_snapshot`
**Acceptance Criteria:** A yellow warning message is visible containing "Duplicate content". The duplicate file is NOT added to the document list.

---

## Cleanup

After all tests pass, clean up test data:

### Cleanup-01: Delete test documents
```bash
# Delete remaining test documents
for DOC in $DOC_ID_MD $RAG_DOC_ID; do
  curl -s -X DELETE http://localhost:8000/documents/$DOC \
    -H "Authorization: Bearer $TOKEN1"
done
```

### Cleanup-02: Delete test threads
```bash
curl -s -X DELETE http://localhost:8000/threads/$THREAD_ID \
  -H "Authorization: Bearer $TOKEN1"
```

### Cleanup-03: Reset settings
```bash
curl -s -X PUT http://localhost:8000/settings \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"llm_model":null,"llm_api_key":null}'
```

### Cleanup-04: Verify clean state
```bash
# Verify no test threads remain
curl -s http://localhost:8000/threads \
  -H "Authorization: Bearer $TOKEN1"

# Verify no test documents remain
curl -s http://localhost:8000/documents \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** Thread list and document list do not contain any items created during this test run.

---

## Results Summary Template

| Section | Total | Passed | Failed | Skipped |
|---------|-------|--------|--------|---------|
| API: Health & Auth | 4 | | | |
| API: Thread CRUD | 7 | | | |
| API: Data Isolation | 4 | | | |
| API: Chat/Messages | 4 | | | |
| API: Documents | 11 | | | |
| API: Settings & Admin | 7 | | | |
| API: Error Handling | 3 | | | |
| API: Record Manager | 4 | | | |
| E2E: Auth Flow | 4 | | | |
| E2E: Chat Flow | 5 | | | |
| E2E: Navigation | 2 | | | |
| E2E: Documents | 4 | | | |
| E2E: RAG Integration | 2 | | | |
| E2E: Data Isolation | 5 | | | |
| E2E: Admin Settings | 4 | | | |
| E2E: Error Handling | 1 | | | |
| E2E: Record Manager | 1 | | | |
| **TOTAL** | **72** | | | |
