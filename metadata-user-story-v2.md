# User Story (v2): Fetch and Store Subgraph Metadata — Process Not Tied to Any Entity

## As a developer
I want to fetch and store subgraph metadata for all subgraphs (governance, vaults, collective-rewards) **in the same batched HTTP request** as batchable strategies, while keeping the **process completely independent of entities**: no picking an entity by subgraph, no dependency on the entity list or schema entities for metadata. Metadata is requested and persisted via a dedicated, entity-agnostic path that reuses infrastructure where it makes sense.

---

## Goal

- **Same HTTP request**: Metadata is included in the existing GraphQL batch for each subgraph (no extra HTTP call).
- **Process not tied to an entity**: The metadata flow never references or selects an entity. No "pick any entity for this subgraph"; no `createEntityQuery(schema, entityName, ...)` for metadata. The operation is "request metadata for subgraph X" and "persist it"—implemented via a **metadata-only request** abstraction.
- **Reuse where it fits**: Reuse `saveSubgraphMetadata`, `executeRequests`, batch grouping, and response handling. Add only an entity-agnostic way to create a "metadata request" and plug it into the batch.

---

## Process (entity-free)

1. **Per batch group** (same as today: one group per subgraph endpoint):
   - Resolve **subgraph name** for that group (e.g. from `context.graphqlContexts`: key whose value is this group's `graphqlContext`).
   - If the schema defines **SubgraphMetadata**, append **one metadata-only request** to the group's requests. This request is obtained from a **dedicated abstraction** (e.g. `createMetadataRequest()` or similar). The caller does **not** pass an entity name or look up any entity; the abstraction returns a request whose sole purpose is to cause the batch to include **`_meta`** in the response.
2. **Execute** the batch (entity requests + metadata request) with the existing **`executeRequests`**; same single HTTP call.
3. **After** the response: if it contains **`_meta`**, call **`saveSubgraphMetadata(context, subgraphName, _meta)`**. Do **not** route the metadata request's result to any strategy; only **`_meta`** is used. Entity strategies continue to receive only entity data.

No step in this process consults the entity list, picks an entity by subgraph, or uses an entity name for metadata.

---

## Metadata-only request abstraction

- **Purpose**: Provide a single, entity-agnostic way to "add a request that will make this batch return `_meta`." The batch executor (or a small metadata helper) calls this and gets a request to append; it never deals with entity names or schema entities for metadata.
- **Contract**: Returns something that can be passed into the existing batch pipeline (same shape as other requests for `buildBatchQuery` / `executeRequests`) with **`withMetadata: true`**, so the batch includes the **`_meta`** selection. The pipeline may still require a query string and a key for response mapping; that is an **implementation detail** of the abstraction (e.g. a reserved internal query and key, or a dedicated "metadata-only" request type the pipeline supports). The important point: **no entity name or entity lookup** is part of the public contract or the caller's logic.
- **Placement**: Implement in one place (e.g. `subgraphQueryBuilder`, or a small `metadataRequest.ts` / `subgraphMetadata.ts`). Full sync (subgraphSyncer) can also use this abstraction instead of "set `withMetadata: true` on the first entity query," so both full sync and block watcher share the same entity-free metadata path.

---

## What we reuse

- **Batch flow**: Same grouping by endpoint, same `executeRequests`, same single HTTP request per group. The only change is that we append one metadata-only request per group when SubgraphMetadata is in the schema.
- **Response handling**: Existing logic that splits **`_meta`** from entity data and returns `EntityDataCollection<WithMetadata>` when metadata is present. We only add: after the call, if `_meta` is present, call **`saveSubgraphMetadata(context, subgraphName, _meta)`** (and do not route the metadata request to any strategy).
- **Persistence**: **`saveSubgraphMetadata`** unchanged (export or move to shared code as needed). Same storage contract (SubgraphMetadata table, id = subgraph name).
- **Subgraph name resolution**: Same as before (e.g. from `context.graphqlContexts` by matching `graphqlContext`). No entity involved.

---

## What is new (and entity-agnostic)

- **Metadata-only request**: One function or factory that returns a request used only to get **`_meta`** in the batch. Callers never pass or derive an entity name. How that request is represented internally (so that `buildBatchQuery` and `executeRequests` work) is encapsulated in this abstraction; the process does not depend on any entity.

---

## Acceptance criteria

1. **Same batch, no extra HTTP call**  
   For each batch group, when SubgraphMetadata is in the schema, one **metadata-only request** (from the dedicated abstraction) is appended. The single GraphQL request for that subgraph includes **`_meta`**. No separate HTTP call for metadata.

2. **Process never references an entity**  
   The metadata flow does not call `createEntityQuery` with an entity name for metadata, does not iterate or select from `schema.entities` for metadata, and does not take an entity name as input. The only addition to the batch is "one metadata-only request" from the abstraction.

3. **Metadata persisted**  
   When the batch response contains **`_meta`**, it is saved via **`saveSubgraphMetadata(context, subgraphName, _meta)`**. Entity strategies are unchanged and do not receive **`_meta`**.

4. **Single abstraction**  
   One dedicated place provides the metadata-only request (e.g. `createMetadataRequest()` or equivalent). Both block watcher batch flow and, if desired, full sync can use it so the process is consistent and not tied to entities anywhere.

5. **Reuse of existing pieces**  
   Batch grouping, **`executeRequests`**, **`buildBatchQuery`**, **`saveSubgraphMetadata`**, and response parsing are reused. Only the way we *create* the metadata request is new and must be entity-agnostic.

6. **Single-query and fallback**  
   When a group has only one query or when fallback runs one-by-one, the same rule applies: add the metadata-only request when SubgraphMetadata is in the schema, so the one HTTP call still includes **`_meta`**; then persist.

---

## Technical notes (implementation hints)

- **Implementing the metadata-only request**: The current pipeline expects each request to have a `query` string and an `entityName` (used for response keys and logging). To keep the *process* entity-free, the abstraction can:
  - **Option A**: Return a request with a fixed, reserved "metadata" query and key (e.g. a minimal valid GraphQL query that satisfies the batch builder, and a reserved key so the executor knows not to route it to any strategy and only to use **`_meta`**). No entity is looked up; the reserved query/key are constants in one module.
  - **Option B**: Extend the pipeline to support a "metadata-only" request type (e.g. `request.kind === 'metadata'`) that has no entity name. The batch builder and executor treat it only as "include **`_meta`** in the batch and in the response"; no entity slice is expected or routed.

  In both cases, the **caller** (batch executor or metadata helper) never sees or supplies an entity name; it only says "add metadata request for this group."

- **Subgraph name**: Still derived from **`context.graphqlContexts`** (key for this group's **`graphqlContext`**). No entity involved.

- **Full sync**: If subgraphSyncer today sets `withMetadata: true` on the first *entity* query, it can be refactored to append the same metadata-only request (from the new abstraction) instead, so full sync also stops depending on "first entity query" for metadata.

---

## Definition of done

- [ ] Metadata is requested in the same batched HTTP request as entity queries; no extra HTTP call.
- [ ] The metadata flow never references or selects an entity (no entity name, no schema entity lookup for metadata).
- [ ] A single metadata-only request abstraction exists and is used when adding metadata to a batch (and optionally in full sync).
- [ ] **`saveSubgraphMetadata`** is reused; **`_meta`** is persisted for each subgraph when present in the response.
- [ ] Entity strategies are unchanged and do not receive **`_meta`**.
- [ ] Tests or manual verification confirm SubgraphMetadata is updated for each queried subgraph (governance, usd-vault, collective-rewards, etc.) without any entity being used in the metadata process.
