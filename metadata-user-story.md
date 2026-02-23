# User Story: Fetch and Store Metadata in Batchable Queries (Same HTTP Request, Separate from Entities)

## As a developer
I want metadata to be fetched and stored for all subgraphs (governance, vaults, collective-rewards) **in the same batched HTTP request** as the existing batchable strategies (proposals, contributors, vaults), while keeping metadata logic **separate from any entity strategy**—handled in one dedicated place, not inside proposal/contributor/vault code.

---

## Goal

- **Use the batchable flow**: Metadata is requested and returned **inside the same GraphQL batch** as entity queries. No extra HTTP call per subgraph.
- **Keep metadata separate**: No entity strategy requests or handles `_meta`. A single, dedicated place (batch executor + a small metadata helper/module) is responsible for adding the metadata request to each batch and persisting `_meta` after the response.

---

## Context and current behavior

### Full sync path (subgraphSyncer)
- For each subgraph, the syncer sets **`withMetadata: true`** on the first request of the batch. **`buildBatchQuery`** includes **`_meta { block { number, hash, timestamp }, deployment, hasIndexingErrors }`** when any request has `withMetadata: true`. The response contains `_meta`; the syncer calls **`saveSubgraphMetadata(context, subgraphName, _meta)`**. One HTTP request per batch, metadata included.

### Block watcher path (batchExecutor + BatchableStrategy)
- Batchable strategies contribute **entity** queries; the executor groups them by endpoint and runs **one** `executeRequests()` per group. Today no request has `withMetadata: true`, so the batch never includes `_meta` and metadata is never stored for block-watcher runs.

---

## Approach: Metadata inside each batch group (no extra HTTP call)

1. **Per batch group**, before calling `executeRequests`:
   - Resolve **subgraph name** for that group (e.g. from `context.graphqlContexts`: the key whose value is this group’s `graphqlContext`).
   - If **`context.schema.entities.has('SubgraphMetadata')`**, append **one** request to the group’s request list: a minimal entity query for that subgraph with **`withMetadata: true`** (e.g. pick any entity whose `subgraphProvider` is this subgraph, then `createEntityQuery(schema, entityName, { first: 1, withMetadata: true })`).  
   So the **same** list of requests sent to `executeRequests` now includes entity queries (from strategies) plus this one metadata-triggering query. **`buildBatchQuery`** already adds the `_meta` selection when any request has `withMetadata: true`, so the single HTTP request returns both entity data and `_meta`.

2. **After** `executeRequests` returns for that group:
   - If the result has **`_meta`**, call **`saveSubgraphMetadata(context, subgraphName, _meta)`** (reuse the same function used in full sync, e.g. export from subgraphSyncer or move to a shared module).
   - When routing results to strategies, continue to pass **only entity data** (by entity name). The metadata request’s “entity” slice (e.g. one row) is not routed to any strategy; **`_meta`** is not passed to any strategy. So entity strategies are unchanged.

3. **Where the logic lives**  
   The logic for “add metadata request to this group” and “persist _meta from response” can live in the **batch executor** or in a small **metadata helper** the executor calls (e.g. `ensureMetadataInBatchGroup` / `persistMetadataFromBatchResult`). Either way, **one** place owns metadata; entity strategies do not.

This gives:
- **Same HTTP request**: No additional call; metadata is part of the existing batched query for each subgraph.
- **Separation**: Entity strategies never see or handle `_meta`; only the executor (or its helper) does.

---

## Acceptance criteria

1. **Metadata in the same batch**  
   For each batch group executed by the block watcher, when the schema defines **SubgraphMetadata**, **one** of the requests in that group has **`withMetadata: true`**, so the single GraphQL request for that subgraph includes **`_meta`** in the response. No separate HTTP request for metadata.

2. **Metadata persisted per subgraph**  
   When the batch response contains **`_meta`**, it is saved via **`saveSubgraphMetadata(context, subgraphName, _meta)`** (same storage contract as full sync). This happens for every batch group that was executed (governance, vaults, collective-rewards, etc.).

3. **Entity strategies unchanged**  
   Strategies still receive only **entity** data in **`processBatchResults()`**. They do not request `withMetadata`; they do not receive or handle `_meta`. Routing continues to use entity names only; the metadata request’s entity result (if any) is not routed to any strategy.

4. **Single place for metadata logic**  
   The logic that (a) adds the metadata request to each batch group and (b) extracts `_meta` and calls **`saveSubgraphMetadata`** lives in one place: the batch executor and/or a small dedicated helper/module it uses. No metadata logic inside entity strategies.

5. **Works for single-query and fallback**  
   When a group has only one (entity) query, or when fallback runs queries one-by-one, metadata is still requested and saved for that subgraph when applicable (same conditions: SubgraphMetadata in schema, one request with `withMetadata: true`, then persist `_meta`).

6. **Reuse of existing code**  
   Reuse **`saveSubgraphMetadata`** (export or move to shared code) and **`createEntityQuery`** / **`executeRequests`** / **`buildBatchQuery`** so behavior matches full sync and no logic is duplicated.

---

## Technical notes (implementation hints)

- **Subgraph name for a group**  
  When processing a batch group you have `group.graphqlContext`. Resolve **subgraphName** with:  
  `Object.entries(params.context.graphqlContexts).find(([, ctx]) => ctx === group.graphqlContext)?.[0]`.

- **Minimal metadata request**  
  From **`params.context.schema.entities`**, pick any entity whose **`subgraphProvider === subgraphName`**. Then **`createEntityQuery(schema, entityName, { first: 1, withMetadata: true })`**. Append this request to the list passed to **`executeRequests`**. The response will contain `_meta`; the extra entity slice (e.g. `proposals_3`) does not need to be routed to any strategy (only entries in **`group.queries`** are routed by entity name).

- **Where to add the request**  
  In **processBatchGroup** (and in the single-query path): build the final request list from **group.queries**; if SubgraphMetadata is in schema, append the one metadata request. Pass this combined list to **executeRequests**. After **executeRequests** returns, if the result has **`_meta`**, call **saveSubgraphMetadata(context, subgraphName, _meta)** before or after **routeResultsToStrategies** (which only uses entity keys from strategy requests, so `_meta` is never passed to strategies).

- **saveSubgraphMetadata**  
  Currently in **subgraphSyncer**. Export it from there and use it from the batch executor (or from a small **handlers/subgraphMetadata.ts** that both subgraphSyncer and the executor use).

- **Fallback**  
  In **executeSingleQuery**, when there is only one query in the group, still add the metadata request to the single-element array when SubgraphMetadata is in schema, so the one HTTP call includes `_meta`. Then persist from the result. In **executeFallback**, each **executeSingleQuery** call will do the same per subgraph.

---

## Definition of done

- [ ] For every batch group (and single-query/fallback path), when SubgraphMetadata is in the schema, one request in that group has `withMetadata: true`; the same HTTP request returns `_meta`.
- [ ] No extra HTTP request is made for metadata; metadata is always part of the existing batched (or single) GraphQL request for that subgraph.
- [ ] Every such response that includes `_meta` leads to **saveSubgraphMetadata(context, subgraphName, _meta)**.
- [ ] Entity strategies are unchanged: they do not request or receive `_meta`.
- [ ] Metadata logic (add request + persist) lives in one place (executor or dedicated helper).
- [ ] Tests or manual verification confirm that after block watcher runs, SubgraphMetadata is updated for each subgraph that was queried (governance, usd-vault, collective-rewards, etc.).
