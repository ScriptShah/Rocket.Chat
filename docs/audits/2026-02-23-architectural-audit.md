# Rocket.Chat Architectural & Quality Audit (2026-02-23)

This audit focuses on high-impact issues discovered directly in the current codebase, while avoiding direct duplication of the already-reported backlog where possible.

---

## 1) Functional Bugs

### Category
Functional Bug

### Issue Title
`open` room filter uses `$exists` semantics instead of boolean equality.

### The "Why"
When querying Omnichannel rooms with `open=false`, the query may return incorrect results (or empty sets) because it checks field presence rather than value. This can break admin dashboards, exports, and any automation relying on accurate open/closed room filtering.

### The "How"
The query builder maps `open` into `{ open: { $exists: open } }`. For `open=false`, MongoDB interprets that as “documents where `open` does not exist,” not “documents where `open === false`.”

### Location
`packages/models/src/models/LivechatRooms.ts` (around the paginated room query builder).

### Original Code Snippet
```ts
...(open !== undefined && { open: { $exists: open }, onHold: { $ne: true } }),
```

### Recommended Fix
```ts
...(open !== undefined && { open, onHold: { $ne: true } }),
```

If there are historical documents without `open`, handle explicitly:

```ts
...(open === true && { open: true, onHold: { $ne: true } }),
...(open === false && { $or: [{ open: false }, { open: { $exists: false } }] }),
```

### Steps to Reproduce
1. Seed/create two livechat rooms: one with `open: true`, one with `open: false`.
2. Execute the room search path that calls this query with `open=false`.
3. Observe returned data excludes `open: false` documents when `open` exists.
4. Patch query to equality semantics and re-run; the expected room appears.

---

## 2) Security & Access Control

### Category
Security

### Issue Title
Unescaped user-controlled regex construction in custom fields filtering enables regex injection/ReDoS.

### The "Why"
Attackers (or even accidental malformed input) can inject expensive regex patterns into server-side Mongo queries. This can cause high CPU usage and request latency spikes (ReDoS-style behavior), potentially degrading service availability.

### The "How"
The code directly passes `customFields[key]` to `new RegExp(...)` without escaping metacharacters or bounding complexity.

### Location
`packages/models/src/models/LivechatRooms.ts` (customFields filtering in paginated search).

### Original Code Snippet
```ts
query.$and = Object.keys(customFields).map((key) => ({
  [`livechatData.${key}`]: new RegExp(customFields[key], 'i'),
}));
```

### Recommended Fix
```ts
query.$and = Object.keys(customFields).map((key) => ({
  [`livechatData.${key}`]: new RegExp(escapeRegExp(String(customFields[key] ?? '')), 'i'),
}));
```

Optionally, enforce max input length before regex creation:

```ts
const safeValue = String(customFields[key] ?? '').slice(0, 200);
```

### Steps to Reproduce
1. Call the livechat room listing endpoint using a custom field value like `(.+)+$` or `(a+)+$`.
2. Ensure enough documents exist to evaluate regex across many records.
3. Observe elevated CPU and degraded response time.
4. Apply escaping and re-run; query behaves as a literal match.

---

## 3) Performance Bottlenecks

### Category
Performance

### Issue Title
Regex fallback on `email.thread` creates non-sargable query paths and collection scans.

### The "Why"
The room model defines an index for `'v.token' + 'email.thread'`, but regex fallbacks (`new RegExp(emailThread.join('|'))`) prevent effective index usage, increasing query cost and latency under load.

### The "How"
The query uses `$or` with one index-friendly `$elemMatch` branch and one regex branch. The regex branch can trigger scan-heavy execution plans.

### Location
`packages/models/src/models/LivechatRooms.ts` in:
- `findOneByVisitorTokenAndEmailThread`
- `findOneByVisitorTokenAndEmailThreadAndDepartment`
- `findOneOpenByVisitorTokenAndEmailThread`

### Original Code Snippet
```ts
'$or': [{ 'email.thread': { $elemMatch: { $in: emailThread } } }, { 'email.thread': new RegExp(emailThread.join('|')) }],
```

### Recommended Fix
Prefer normalized storage and exact matching only:

```ts
'email.thread': { $elemMatch: { $in: emailThread } }
```

If backward compatibility is needed, migrate legacy string payloads once, then remove regex fallback.

### Steps to Reproduce
1. Populate `room` with a large dataset (>=100k docs) and mixed `email.thread` formats.
2. Execute these find methods repeatedly.
3. Compare Mongo explain plans: regex branch shows poor index usage.
4. Remove regex fallback and verify improved execution stats.

---

## 4) Accessibility (a11y)

### Category
Accessibility

### Issue Title
Upload icon-only buttons in custom emoji admin views are missing accessible names.

### The "Why"
Screen reader users cannot identify the purpose of icon-only controls without an accessible name (`aria-label` or explicit text), reducing task completion for admin workflows.

### The "How"
`IconButton` is rendered with icon only and no `aria-label`/`title` in both add/edit screens.

### Location
- `apps/meteor/client/views/admin/customEmoji/AddCustomEmoji.tsx`
- `apps/meteor/client/views/admin/customEmoji/EditCustomEmoji.tsx`

### Original Code Snippet
```tsx
<IconButton secondary small icon='upload' onClick={clickUpload} />
```

```tsx
<IconButton icon='upload' secondary onClick={clickUpload} />
```

### Recommended Fix
```tsx
<IconButton
  secondary
  small
  icon='upload'
  onClick={clickUpload}
  aria-label={t('Upload')}
  title={t('Upload')}
/>
```

(and similarly in `EditCustomEmoji.tsx`)

### Steps to Reproduce
1. Open Add/Edit Custom Emoji views.
2. Use a screen reader (NVDA/VoiceOver) or accessibility tree inspector.
3. Focus the upload icon button.
4. Observe missing/insufficient control name announcement.

---

## 5) Anti-Patterns & Best Practices

### Category
Anti-Pattern / Best Practice

### Issue Title
`URL.createObjectURL` used without revocation, with side-effects in render-time memoization.

### The "Why"
Object URLs retain browser memory until revoked. Repeated file selection can leak memory during long admin sessions. Also, generating object URLs inside `useMemo` mixes side effects with memoization.

### The "How"
- Add screen: creates object URL when file selected and never revokes.
- Edit screen: creates object URL inside `useMemo` and never revokes previous URLs.

### Location
- `apps/meteor/client/views/admin/customEmoji/AddCustomEmoji.tsx`
- `apps/meteor/client/views/admin/customEmoji/EditCustomEmoji.tsx`

### Original Code Snippet
```ts
setNewEmojiPreview(URL.createObjectURL(file));
```

```ts
const newEmojiPreview = useMemo(() => {
  if (emojiFile) {
    return URL.createObjectURL(emojiFile);
  }
  ...
}, [absoluteUrl, data, emojiFile]);
```

### Recommended Fix
```ts
const [previewUrl, setPreviewUrl] = useState<string>('');

useEffect(() => {
  if (!emojiFile) {
    setPreviewUrl('');
    return;
  }

  const url = URL.createObjectURL(emojiFile);
  setPreviewUrl(url);

  return () => {
    URL.revokeObjectURL(url);
  };
}, [emojiFile]);
```

Use `previewUrl` in render and keep `useMemo` side-effect free.

### Steps to Reproduce
1. Open Add/Edit Custom Emoji.
2. Select many large files sequentially.
3. Observe browser memory growth in performance tooling.
4. Apply revocation fix and repeat; memory stabilizes.

---

## Notes on Cross-Referencing Existing Issues

- The provided issue list already includes many UI/a11y and regex-related items. This report focuses on **code locations and patterns currently present** and highlights where they still represent production risk.
- Some findings may be related to already-open tickets, but the specific line-level vulnerabilities and combined impact (functional correctness + performance + security) remain actionable in the current tree.


---

## Contribution Opportunities (Prioritized)

Below is a pragmatic list of contribution opportunities aligned with the current findings and with the issue backlog themes you shared.

### High-impact / Security & Correctness

1. **Fix livechat `open` filter semantics in room queries**  
   - **Suggested scope:** patch query construction to use boolean equality, add regression tests for `open=true/false`.  
   - **Complexity:** Medium  
   - **Why this is valuable:** correctness bug impacting room search/reporting.

2. **Harden regex construction for custom field filters**  
   - **Suggested scope:** escape user input before regex compilation, add max-length guardrails, add unit tests for malicious patterns.  
   - **Complexity:** Medium  
   - **Why this is valuable:** reduces regex-injection/ReDoS risk.

3. **Remove regex fallback from `email.thread` matching**  
   - **Suggested scope:** migrate legacy `email.thread` data format (if needed), then rely on indexed exact matching only.  
   - **Complexity:** Medium/High (depending on migration strategy)  
   - **Why this is valuable:** substantial query-plan and scalability improvements.

### Accessibility / UX (good contributor-friendly wins)

4. **Add accessible names to icon-only upload buttons in Custom Emoji admin**  
   - **Suggested scope:** add `aria-label` + `title`, include accessibility test coverage where available.  
   - **Complexity:** Low  
   - **Why this is valuable:** immediate improvement for screen-reader users.

5. **Run a targeted icon-button a11y sweep in Admin surfaces**  
   - **Suggested scope:** identify icon-only actions lacking text alternatives; patch labels consistently.  
   - **Complexity:** Low/Medium  
   - **Why this is valuable:** broad a11y impact with relatively small, isolated patches.

### Performance / Front-end reliability

6. **Revoke object URLs created for preview images**  
   - **Suggested scope:** refactor `URL.createObjectURL` usage to lifecycle-safe `useEffect` + `URL.revokeObjectURL`.  
   - **Complexity:** Low/Medium  
   - **Why this is valuable:** prevents memory growth during long admin sessions.

7. **Add a lint/check guideline for object URL lifecycle hygiene**  
   - **Suggested scope:** document or codify frontend pattern (`createObjectURL` requires cleanup).  
   - **Complexity:** Low  
   - **Why this is valuable:** prevents recurrence and improves code review quality.

### Suggested contribution sequencing

- **Starter PRs (fast):** #4 and #6.
- **Follow-up PRs (medium):** #1 and #2 with tests.
- **Advanced PR (performance-heavy):** #3 with migration/explain-plan evidence.

