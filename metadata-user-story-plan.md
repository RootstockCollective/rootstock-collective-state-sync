# Implementation Plan: Fetch and Store Metadata in Batchable Queries

This plan implements the user story in `metadata-user-story.md`: metadata for all subgraphs (governance, vaults, collective-rewards) is fetched and stored **in the same batched HTTP request** as entity queries, with metadata logic **fully separate** from entity strategies.

---

## 1. Summary of Changes

| Area | Change |
|------|--------|
| **batchExecutor** | Per batch group: add one metadata request when schema has SubgraphMetadata; after `executeRequests`, persist `_meta` via shared helper. Apply in batched path, single-query path, and fallback path. |
| **Shared metadata** | Export or move `saveSubgraphMetadata` to a shared module (e.g. `handlers/subgraphMetadata.ts`) and use it from both subgraphSyncer and batch executor. |
| **Entity strategies** | No changes. They do not request or receive `_meta`. |

---

## 2. Prerequisites / Reuse

- **`saveSubgraphMetadata`**: Currently in `src/handlers/subgraphSyncer.ts`. Export it from there **or** move it to a new shared module (e.g. `src/handlers/subgraphMetadata.ts`) and import from both subgraphSyncer and batch executor.
- **`createEntityQuery`**: From `src/handlers/subgraphQueryBuilder.ts` — already used by strategies; use for the minimal metadata request.
- **`executeRequests`** / **`buildBatchQuery`**: No changes; they already include `_meta` when any request has `withMetadata: true` and return `_meta` in the result.

---

## 3. Implementation Steps

### Step 1: Make `saveSubgraphMetadata` reusable

**Option A (minimal):** Export `saveSubgraphMetadata` from `subgraphSyncer.ts` and export the types it needs (e.g. `GraphQLMetadata` from subgraphProvider is already exported). Ensure the function and any types it use are part of the public API.

**Option B (recommended):** Create `src/handlers/subgraphMetadata.ts`:
- Move `saveSubgraphMetadata` and its local type `SubgraphMetadataRecord` (or equivalent) into this file.
- Import `AppContext` and `GraphQLMetadata` (from `context/types` and `context/subgraphProvider`).
- Keep the same behavior: if `!context.schema.entities.has('SubgraphMetadata')` return; otherwise upsert into `SubgraphMetadata` table.
- In `subgraphSyncer.ts`: remove the local `saveSubgraphMetadata` and `SubgraphMetadataRecord`, and import `saveSubgraphMetadata` from `./subgraphMetadata`.
- **Logging:** At the start of `saveSubgraphMetadata`, add `console.debug('[saveSubgraphMetadata] reached', { subgraphName })` so call sites can confirm the function is reached. After a successful upsert, use `log.info` (not `log.debug`) for the "Saved SubgraphMetadata for {subgraphName}" message.

**Deliverable:** Callers (subgraphSyncer and later batch executor) can call `saveSubgraphMetadata(context, subgraphName, _meta)` from one shared place.

- [x] Approved
- [x] Implemented
- [x] Reviewed
- [ ] Tested

---

### Step 2: Add a small metadata helper for the batch executor

Add a helper module (e.g. `src/watchers/batchMetadata.ts` or inline in `batchExecutor.ts`) that provides:

1. **Resolve subgraph name for a group**  
   - Input: `params.context`, `group.graphqlContext`.  
   - Implementation:  
     `Object.entries(params.context.graphqlContexts).find(([, ctx]) => ctx === group.graphqlContext)?.[0]`  
   - Return: `string | undefined` (subgraph name).

2. **Build the metadata request for a group**  
   - Input: `params.context`, `subgraphName`, and the set of **entity names already in the group** (from `group.queries`, e.g. `group.queries.map(q => q.request.entityName)`).  
   - If `!params.context.schema.entities.has('SubgraphMetadata')` → return `null`.  
   - From `params.context.schema.entities`, pick **any entity** such that `entity.subgraphProvider === subgraphName` and **`entityName` is not in the set of already-requested entity names** (to avoid overwriting a strategy's entity slice in the batch response; see note below).  
   - If none found, pick any entity with `subgraphProvider === subgraphName` (and accept that one strategy might get one extra row; prefer avoiding overwrite when possible).  
   - Return `createEntityQuery(schema, entityName, { first: 1, withMetadata: true })`.

**Important:** In `subgraphProvider.executeRequests`, results are keyed by `request.entityName` and later entries overwrite earlier ones. So the metadata request should use an entity name that is **not** already in the group's queries when possible, so the metadata request's entity slice is not mistaken for a strategy's data.

- **Logging:** Use **log.info** for critical info (e.g. when adding a metadata request for a subgraph). Use **log.debug** for diagnostic detail (subgraph name resolution, no SubgraphMetadata in schema, no entity for subgraph, which entity was chosen and whether it was fallback).

**Deliverable:** A function like `getMetadataRequest(context, subgraphName, existingEntityNames): GraphQLRequest | null`.

- [x] Approved
- [x] Implemented
- [x] Reviewed
- [ ] Tested

---

### Step 3: Integrate metadata into `processBatchGroup` (batched path)

In `batchExecutor.ts`, in **`executeBatchedQueries`**:

1. **Before** building the request list:
   - Resolve `subgraphName` for this group using the helper from Step 2.
   - If no `subgraphName`, skip metadata.
   - Compute `existingEntityNames = new Set(group.queries.map(q => q.request.entityName))`.
   - Call `getMetadataRequest(params.context, subgraphName, existingEntityNames)`.

2. **Build final request list:**
   - `requests = group.queries.map(q => q.request)`.
   - If metadata request is non-null, append it to `requests`.

3. Call `executeRequests(group.graphqlContext, requests)` as today.

4. **After** `executeRequests` returns:
   - If the result has `_meta`, call `saveSubgraphMetadata(params.context, subgraphName, result._meta)` (cast or type-narrow as needed for `WithMetadata`).
   - Then call `routeResultsToStrategies(group.queries, batchResults, params, results)` unchanged.

**Note:** `routeResultsToStrategies` only passes entity data for entity names that appear in `group.queries`; the metadata request's entity key (if any) is not in any strategy's set, so strategies never see it or `_meta`.

**Deliverable:** For multi-query batch groups, one request in the batch has `withMetadata: true`, and `_meta` is persisted; no extra HTTP call.

- [x] Approved
- [x] Implemented
- [x] Reviewed
- [ ] Tested

---

### Step 4: Integrate metadata into single-query path

In **`executeSingleQuery`**:

1. Build list: `requests = [entry.request]`.
2. Resolve `subgraphName` for `group.graphqlContext` (same helper as Step 2).
3. If schema has SubgraphMetadata and we have `subgraphName`, append the metadata request:  
   `getMetadataRequest(params.context, subgraphName, new Set([entry.request.entityName]))` (if non-null) to `requests`.
4. Call `executeRequests(graphqlContext, requests)`.
5. If the result has `_meta`, call `saveSubgraphMetadata(params.context, subgraphName, result._meta)`.
6. Pass to the strategy only the slice for that strategy's entity: e.g. `extractResults(queryResults, new Set([entry.request.entityName]))`, then `entry.strategy.processBatchResults(extracted, params)`.

**Deliverable:** When there is only one query in the group, the single HTTP request still includes metadata when SubgraphMetadata is in the schema, and metadata is saved; the strategy still receives only its entity data.

- [x] Approved
- [x] Implemented
- [ ] Reviewed
- [ ] Tested

---

### Step 5: Integrate metadata into fallback path

**`executeFallback`** currently loops over `group.queries` and calls `executeSingleQuery(entry, group.graphqlContext, params, results)` for each entry.

- No change to the loop.
- Once Step 4 is done, each `executeSingleQuery` call will add the metadata request when applicable and persist `_meta`. So for fallback, each per-query call may send 2 requests (entity + metadata) in one HTTP call and save metadata for that subgraph. Some subgraphs may get metadata saved multiple times in one fallback run; that is idempotent and acceptable.

**Deliverable:** Fallback path also requests and saves metadata for each subgraph when applicable.

- [x] Approved
- [x] Implemented
- [ ] Reviewed
- [ ] Tested

---

### Step 6: Pass `group` (or subgraph name) where needed

- **executeSingleQuery** currently does not receive `group`; it only receives one `QueryEntry` and `graphqlContext`. To resolve `subgraphName` we need either:
  - to pass `params` and `graphqlContext` and resolve subgraph from `params.context.graphqlContexts` and `graphqlContext`, or
  - to pass `subgraphName` from the caller.
- **processBatchGroup** already has `group`; it can resolve `subgraphName` once and pass it to `executeBatchedQueries`. For **executeSingleQuery**, the caller (`processBatchGroup` or `executeFallback`) has access to `group.graphqlContext`, so resolve `subgraphName` in the caller and pass it into `executeSingleQuery(subgraphName, ...)` (or pass `group` and resolve inside `executeSingleQuery`). Prefer resolving in one place (e.g. at the start of `processBatchGroup` and at each iteration in `executeFallback`) to avoid duplication.

**Concrete:** Add an optional `subgraphName: string | undefined` to `executeSingleQuery` (or derive it inside from `params.context.graphqlContexts` and `graphqlContext`). Use it when adding the metadata request and when calling `saveSubgraphMetadata`.

**Deliverable:** No duplicate resolution logic; `executeSingleQuery` has the information it needs to add and persist metadata.

- [x] Approved
- [x] Implemented
- [ ] Reviewed
- [ ] Tested

---

### Step 7: Tests and verification

- **Unit tests (optional but recommended):**
  - Helper: when schema has SubgraphMetadata and subgraph has entities, `getMetadataRequest` returns a request with `withMetadata: true` and an entity from that subgraph; when entity set is provided, it prefers an entity not in the set when possible.
  - batchExecutor: with a mock that returns `_meta`, assert that `saveSubgraphMetadata` is called with the correct `(context, subgraphName, _meta)` and that strategies receive only entity keys (no `_meta` and no extra entity from the metadata request).

- **Integration / manual:**
  - Run the block watcher against an environment that has SubgraphMetadata in the schema and multiple subgraphs (governance, vaults, collective-rewards). After a run, verify that `SubgraphMetadata` table (or equivalent) is updated for each subgraph that was queried.

**Deliverable:** Acceptance criteria from the user story are met and verified.

- [ ] Approved
- [ ] Implemented
- [ ] Reviewed
- [ ] Tested

---

## 4. File Touch List

| File | Action |
|------|--------|
| `src/handlers/subgraphMetadata.ts` | **Create** (if Option B): move `saveSubgraphMetadata` + types here. |
| `src/handlers/subgraphSyncer.ts` | **Edit**: use shared `saveSubgraphMetadata` (import from same file or from `subgraphMetadata.ts`). |
| `src/watchers/batchExecutor.ts` | **Edit**: add metadata request to each group; persist `_meta` after `executeRequests`; integrate in single-query and fallback (via `executeSingleQuery`). |
| `src/watchers/batchMetadata.ts` (or equivalent) | **Create** (optional): helper to resolve subgraph name and build metadata request; or inline in `batchExecutor.ts`. |
| Tests | **Edit/Add**: unit tests for metadata helper and/or batch executor metadata behavior; manual or integration test for SubgraphMetadata updates. |

---

## 5. Acceptance Criteria Checklist (from user story)

- [ ] **Metadata in the same batch:** For each batch group, when schema has SubgraphMetadata, one request has `withMetadata: true`; the single GraphQL request includes `_meta`; no separate HTTP request.
- [ ] **Metadata persisted per subgraph:** Every batch response that contains `_meta` leads to `saveSubgraphMetadata(context, subgraphName, _meta)` for that subgraph.
- [ ] **Entity strategies unchanged:** Strategies do not request `withMetadata`; they receive only entity data in `processBatchResults`; no `_meta` and no routing of the metadata request's entity slice to any strategy.
- [ ] **Single place for metadata logic:** Adding the metadata request and persisting `_meta` is done only in the batch executor (and/or its dedicated helper); no metadata logic in entity strategies.
- [ ] **Single-query and fallback:** When a group has one query or when fallback runs one-by-one, metadata is still requested and saved when SubgraphMetadata is in the schema.
- [ ] **Reuse:** `saveSubgraphMetadata`, `createEntityQuery`, `executeRequests`, and `buildBatchQuery` are reused; no duplicated metadata persistence or query-building logic.

---

## 6. Definition of Done (from user story)

- [ ] For every batch group (and single-query/fallback), when SubgraphMetadata is in the schema, one request has `withMetadata: true` and the same HTTP request returns `_meta`.
- [ ] No extra HTTP request for metadata.
- [ ] Every response that includes `_meta` leads to `saveSubgraphMetadata(context, subgraphName, _meta)`.
- [ ] Entity strategies are unchanged (no `_meta`, no metadata request).
- [ ] Metadata logic lives in one place (executor or dedicated helper).
- [ ] Tests or manual verification confirm SubgraphMetadata is updated per subgraph after block watcher runs.
