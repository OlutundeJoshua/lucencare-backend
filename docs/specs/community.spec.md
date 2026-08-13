# Community Module Specification

## 1. Module Overview

The Community module owns the peer-support space: communities (groups) that patients found, memberships, posts, comments, "helpful" reactions, and the report → moderation pipeline behind them. It also owns `GET /community/stats`, the only source for the community numbers on the professional and benefactor dashboards.

Three roles participate — `patient`, `professional`, `benefactor` — and `platform_admin` moderates. `ngo_admin`, `hmo_coordinator` and `researcher` are refused at the controller's class-level `RoleGuard` and can reach no route in this module. That boundary is the point: a free-text post about someone's condition is health data no `ConsentGrant` covers, and an organisation reading it would be reading exactly what the consent model exists to gate.

Only patients may **found** a community. Everyone eligible may join one.

---

## 2. Entities Involved

**Owns:**
- `communities`
- `community_memberships`
- `community_posts`
- `community_comments`
- `community_reactions`
- `community_reports`

**Reads (does not own):**
- `users` — `resolveAuthors()` turns an author id into a display name and a verified badge.
- `patients` — one column, `name`, read through a raw `LEFT JOIN` inside `resolveAuthors()` and never through a repository. Never `phone`, `condition_tags`, `medication_list` or `location_state`.
- `professional_applications` / `benefactor_applications` — `status` (and `specialty`, `full_name`) for the verified badge.

---

## 3. DTOs

```typescript
// dto/create-community.dto.ts        name, description?, icon?, accent?, tags?
// dto/update-community.dto.ts        (admin) name?, description?, disclaimer?, icon?, accent?, tags?, status?
// dto/list-communities.dto.ts        extends PaginationDto: tag?, joinedOnly?
// dto/create-post.dto.ts             title?, body, tags?
// dto/update-post.dto.ts             title?, body?, tags?
// dto/list-posts.dto.ts              extends PaginationDto: tag?
// dto/list-feed.dto.ts               extends ListPostsDto: communityId?, joinedOnly?
// dto/create-comment.dto.ts          body, parentCommentId?
// dto/update-comment.dto.ts          body
// dto/create-report.dto.ts           reason, details?   (details required iff reason = 'other')
// dto/list-reports.dto.ts            extends PaginationDto: status?
// dto/resolve-report.dto.ts          action, note?      (note required iff action = 'hide')
// dto/set-visibility.dto.ts          hidden, reason?    (reason required iff hidden = true)
```

Conditional requirements use `@ValidateIf` **without** `@IsOptional()`. `@IsOptional()` short-circuits on `undefined` regardless of the condition, so pairing them makes the requirement silently never fire — the same defect that once shipped a reject-with-no-reason as a 200.

### Response Shapes

```typescript
// interfaces/author-display.interface.ts
interface AuthorDisplay {
  userId: string;
  displayName: string;   // "Amaka O." for patients; full name for pro/benefactor
  initial: string;
  verified: boolean;
  badge?: 'verified-professional' | 'verified-benefactor';
  specialty?: string | null;
}

// interfaces/post-view.interface.ts     id, communityId, communityName, communityAccent,
//   author, title, body, tags, commentCount, reactionCount, reactedByMe, createdAt,
//   lastActivityAt, status, visibleToOthers, hiddenReason, hiddenAt
// interfaces/comment-view.interface.ts  id, postId, parentCommentId, author, body,
//   reactionCount, reactedByMe, createdAt, status, visibleToOthers, hiddenReason
// interfaces/community-view.interface.ts, report-view.interface.ts,
// interfaces/community-stats-view.interface.ts, community-overview.interface.ts,
// interfaces/trending-tag.interface.ts
```

---

## 4. Endpoints

All under `CommunityController` (`@Roles(...COMMUNITY_PARTICIPANT_ROLES)`) unless noted.

### `GET /community/overview`
Platform-wide counters for the portal header. Bare response.

### `GET /community/trending`
Top tags on posts from the last 7 days, computed by unnesting `community_posts.tags`.

### `GET /community/stats`
The caller's own numbers. See §5 `getStats`.

### `GET /community/communities`
Active communities, keyset `id ASC`. `?tag`, `?joinedOnly`. Paginated `{ data, meta }`.

### `POST /community/communities`
**`@Roles(UserRole.PATIENT)`** — narrows the class guard. Founder is auto-joined; `memberCount` starts at 1.
The admin twin is `POST /admin/community/communities`, which does not join its creator.

### `GET /community/communities/:id`
404 if archived or soft-deleted.

### `POST` / `DELETE /community/communities/:id/join`
Idempotent both ways. Returns `{ joined, memberCount }`.

### `POST /community/communities/:id/posts`
403 without an active membership. 409 if the community is archived. `@Throttle` 10/min.

### `GET /community/posts`
The one post feed: `?communityId`, `?tag`, `?joinedOnly`, keyset `id DESC`.

### `GET /community/posts/mine`
The caller's own posts, hidden ones included.

### `GET /community/posts/unanswered`
Published posts with `comment_count = 0`, excluding the caller's own.

### `GET` / `PATCH` / `DELETE /community/posts/:id`
Read: a hidden post is visible only to its author; **404, not 403**, to anyone else. Edit and delete are author-only; edit is 409 once hidden.

### `GET` / `POST /community/posts/:id/comments`
List is keyset `id ASC` so a thread reads top-down. Create takes `parentCommentId` for a reply.

### `PATCH` / `DELETE /community/comments/:id`
Author-only; 409 once hidden.

### `POST` / `DELETE /community/{posts,comments}/:id/reactions`
Not a toggle — a toggle double-fired by a flaky client silently un-reacts. Both idempotent, both return the authoritative count. 409 on your own content.

### `POST /community/{posts,comments}/:id/reports`
409 on a duplicate open report from the same reporter, or on your own content.

### `CommunityModerationController` — `@Controller('admin/community')`, `@Roles(PLATFORM_ADMIN)`

| Method | Path | Description |
|---|---|---|
| GET | `/admin/community/reports` | Queue, keyset `id DESC`, `?status` |
| PATCH | `/admin/community/reports/:id` | `hide` or `dismiss` |
| PATCH | `/admin/community/posts/:id/visibility` | Direct hide/restore |
| PATCH | `/admin/community/comments/:id/visibility` | Direct hide/restore |
| PATCH | `/admin/community/communities/:id` | Edit or archive |

Kept in `CommunityModule` rather than `AdminController` so `AdminModule` need not import `CommunityModule` and every community query stays in one service. The URL still sits under `/admin/*`.

---

## 5. Service Methods

```typescript
/** Browsable communities, keyset id ASC, with the caller's own membership resolved. */
listCommunities(userId, query: ListCommunitiesDto)
/** One community. 404 if archived or soft-deleted. */
getCommunity(userId, id)
/** Founds a community. Patients only. Founder auto-joined. */
createCommunity(userId, dto: CreateCommunityDto)
/** Idempotent join: an existing active membership is returned, not duplicated. */
joinCommunity(userId, communityId)
/** Soft-deletes the membership. Leaving never removes what the member wrote. */
leaveCommunity(userId, communityId)
/** Admin edit/archive. */
updateCommunity(adminId, id, dto: UpdateCommunityDto)

/** The one post feed: whole platform, one community, or joined only. Keyset id DESC. */
listFeed(userId, query: ListFeedDto)
/** The caller's own posts, newest first, hidden ones included. */
listMyPosts(userId, query: PaginationDto)
/** Published posts with no comments yet, excluding the caller's own. */
listUnanswered(userId, query: PaginationDto)
/** 403 unless the caller holds an active membership. */
createPost(userId, communityId, dto: CreatePostDto)
/** Hidden posts visible to their author with hiddenReason; 404 to everyone else. */
getPost(userId, postId)
/** Author-only. 409 once hidden — nobody edits their way out of moderation. */
updatePost(userId, postId, dto: UpdatePostDto)
/** Author-only soft delete. Report and audit rows survive it. */
deletePost(userId, postId)

/** Keyset id ASC so a thread reads top-down. */
listComments(userId, postId, query: PaginationDto)
/** Adds a comment or reply, bumps counters, notifies the post author. */
createComment(userId, postId, dto: CreateCommentDto)
updateComment(userId, commentId, dto: UpdateCommentDto)
deleteComment(userId, commentId)

/** Idempotent. 409 on your own content. Milestone notification at 1/5/25/100. */
react(userId, target, targetId)
/** HARD delete, never soft — see BR-6. */
unreact(userId, target, targetId)

/** Files a report, audits it, enqueues the admin fan-out. 409 on a duplicate. */
reportContent(userId, target, targetId, dto: CreateReportDto)

/** Real index-backed COUNT()s. Never reads the denormalised display counters. */
getStats(userId): CommunityStatsView
getOverview(): CommunityOverviewView
getTrending(): TrendingTag[]

listReports(query: ListReportsDto)
/** Hide or dismiss. See BR-8/BR-9. */
resolveReport(adminId, reportId, dto: ResolveReportDto)
setPostVisibility(adminId, postId, dto: SetVisibilityDto)
setCommentVisibility(adminId, commentId, dto: SetVisibilityDto)

/** private — userId → display name + badge for a whole page in one query. */
resolveAuthors(userIds: string[]): Map<string, AuthorDisplay>
/** private — "Amaka Okafor" → "Amaka O." */
toPatientDisplayName(name?: string | null): string
```

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-1 | Only `patient`, `professional` and `benefactor` may reach any participant route; `platform_admin` may reach only the moderation routes. `ngo_admin`, `hmo_coordinator` and `researcher` get 403 at the class-level guard. |
| BR-2 | Among participants, only a `patient` may create a community, and the founder is joined automatically. A `platform_admin` may also create one — to seed the starter set and to curate — and is NOT joined, because an admin is not a participant and would otherwise sit in every community's member roster. Without this an empty platform is deadlocked: nobody can post until some patient happens to found the first community. |
| BR-3 | Posting requires an active membership in that community. |
| BR-4 | A patient's display name is `"First L."`, derived at read time. The raw `patients.name` never appears in any payload this module returns. |
| BR-5 | `verified` is a live claim: the badge requires the application to be `approved` **and** the user account to be `active`. It is never snapshotted onto content, so a revoked licence removes the badge from everything that author ever wrote, on their next request. |
| BR-6 | Un-reacting HARD deletes the row. A soft delete would still occupy the partial unique index, so re-reacting would violate it and surface as a 500. |
| BR-7 | Reacting to your own content is a 409. This keeps `helpfulMarks` an index-only count — excluding self-reactions at read time would force a heap fetch per row. The count is index-only only because `IDX_community_reactions_target_author_live` is partial on `deleted_at IS NULL` (migration `1785700000000`). |
| BR-8 | Hiding content resolves **every** pending report on that target. One action closes the whole pile. |
| BR-9 | Dismissing a report closes only that report. Another reporter's complaint about the same content may have merit for a different reason. |
| BR-10 | Hidden content is not deleted and not soft-deleted: the report that caused the hide points at it, and removing it would destroy the evidence. |
| BR-11 | Comments under a hidden post are NOT cascade-hidden. They become unreachable but stay `published`, so they keep counting toward their own authors' "Questions answered". |
| BR-12 | An author always sees their own hidden content, with `hiddenReason` and `visibleToOthers: false`. Everyone else gets **404, not 403** — a 403 confirms the content exists. |
| BR-13 | A hidden post cannot be edited (409) but can still be deleted by its author. |
| BR-14 | Comment nesting is exactly one level. A reply to a reply is re-parented onto its top-level ancestor rather than rejected. |
| BR-15 | One open report per reporter per target, backed by a partial unique index; a repeat is a 409. |
| BR-16 | Denormalised counters (`member_count`, `post_count`, `comment_count`, `reaction_count`) are display-only and must never be read by `getStats()`. That split is the safety argument for denormalising them at all. |
| BR-17 | Reactions never notify per-like. Milestones only, at 1, 5, 25 and 100. |

---

## 7. Dependencies on Other Modules

| Module | How | Why |
|---|---|---|
| `AuditModule` | `auditService.log()` | Report submitted, content hidden/restored, report resolved, community created. Always in try/catch — an audit outage must not fail a user's request. |
| `NotificationsModule` | `createOne` / `createBulk` | Reply, reaction milestone, content hidden, report resolved. |
| `QueuesModule` | `adminQueue.add(COMMUNITY_REPORT_JOB, …)` | Fans the "content reported" notice out to platform admins. |
| `AuthModule` (entity only) | `Repository<User>` | `resolveAuthors()`. |

---

## 8. Events Emitted

| Event | Queue / mechanism | Recipient |
|---|---|---|
| `COMMUNITY_POST_REPLY` | inline `createOne` | Post author (skipped when self) |
| `COMMUNITY_REACTION_MILESTONE` | inline `createOne` | Content author, at 1/5/25/100 |
| `COMMUNITY_CONTENT_HIDDEN` | inline `createOne` | Content author |
| `COMMUNITY_REPORT_RESOLVED` | inline `createBulk` | Every reporter on the target |
| `COMMUNITY_CONTENT_REPORTED` | `ADMIN_QUEUE` → `COMMUNITY_REPORT_JOB` | All platform admins |

No new queue. `MAIL_QUEUE` is untouched — community activity does not warrant email in V1.

---

## 9. Open Questions or Ambiguities

> ⚠️ **Unconsented health data.** Every other patient-data path on this platform runs through `ConsentGrant` and `sharedDataSnapshot`. A free-text post bypasses all of it and is readable by every professional and benefactor on the platform. Mitigations in place: `communities.disclaimer` shown before first post, `code_of_conduct_at` stamped on join, and `CommunityReportReason.PERSONAL_DATA`. This wants a legal/product sign-off, not only an engineering decision.

> ⚠️ **Patient-created communities go live with no prior review.** Recourse is a report, or an admin archiving it after the fact. If a review gate is wanted, it is `communities.status = 'pending_review'` plus a second admin queue.

> ⚠️ **A verified badge beside individualised clinical advice** is the platform endorsing treatment guidance to an unexamined patient. `CommunityReportReason.MEDICAL_ADVICE` exists, but reactive moderation is thin cover.

> ⚠️ **Moderation is reactive only** — no screening of unreported content, no per-community moderators, one `platform_admin` role. `community_memberships` has room for a `role` column when a mid-size community outruns the queue.

> ⚠️ **Patients are pseudonymous, not anonymous.** `author.userId` is returned so a client can render "your post" affordances, which means a determined client can correlate every post by "Amaka O.". `patientId` is never returned.

> ⚠️ **`@Throttle` per-route is a new pattern in this codebase.** Only the global 60/60s `ThrottlerModule` existed before.

> ⚠️ **`getOverview()` is the next scaling limit.** Measured on a 1M-post / 2M-comment dataset, migration `1785700000000` takes it from ~2.1s to ~78ms — but `memberCount` is a `COUNT(DISTINCT user_id)` over the whole memberships table, which no index removes and which grows linearly: ~40ms at 150k memberships, so roughly 2.7s at 10M. It is platform-wide and identical for every viewer, so the fix is a short-TTL Redis cache rather than more indexing. Do it before memberships pass ~1M.
