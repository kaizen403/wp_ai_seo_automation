# Changes Summary

## What Was Fixed

### Problem
The Firecrawl extract API was failing with errors about unrecognized keys:
```
Firecrawl extract rejected keys [prompt,schema,url]; trying next shape
Firecrawl extract rejected keys [prompt,schema,page]; trying next shape
...
SecurityWeek extract failed: Firecrawl extract 400 BAD_REQUEST
```

### Solution
**Removed the Firecrawl extract function entirely** and replaced it with a simpler scraping approach that uses only the crawl API to get the markdown/HTML content, then parses it for URLs.

## New Features Added

### 1. Queue System (FIFO)
- URLs are stored in `url_queue.json`
- First In, First Out ordering
- Automatically refetches when empty
- Persistent storage between restarts

### 2. URL Selection Logic
- Scrapes SecurityWeek homepage
- Extracts URLs at positions **5-13** (9 URLs total)
- Logs all selected URLs for visibility
- Skips the first 4 URLs (typically ads or sticky posts)

### 3. Daily Automated Posting
- Runs continuously as a worker
- Checks every hour if it's time to post
- Posts at configured hour (default: 10 AM)
- Only posts once per day
- Automatically pulls from queue

### 4. New API Endpoints

#### `GET /queue-status`
Check the current queue:
```bash
curl http://localhost:8787/queue-status
```

Response:
```json
{
  "ok": true,
  "queue": {
    "count": 9,
    "urls": [...],
    "lastFetched": "2025-10-08T10:00:00.000Z",
    "isEmpty": false
  }
}
```

#### `POST /fetch-urls`
Manually fetch URLs from SecurityWeek:
```bash
curl -X POST http://localhost:8787/fetch-urls
```

Response:
```json
{
  "ok": true,
  "message": "Added 9 URLs to queue",
  "queueCount": 9,
  "urls": [...]
}
```

#### `POST /post-from-queue`
Post one article from the queue on demand:
```bash
# Publish
curl -X POST http://localhost:8787/post-from-queue \
  -H "Content-Type: application/json" \
  -d '{"publish": true}'

# Draft
curl -X POST http://localhost:8787/post-from-queue \
  -H "Content-Type: application/json" \
  -d '{"publish": false}'
```

Response:
```json
{
  "ok": true,
  "success": true,
  "sourceUrl": "https://www.securityweek.com/...",
  "sourceTitle": "Article Title",
  "postId": 123,
  "postLink": "https://yoursite.com/blog/...",
  "queueRemaining": 8
}
```

### 5. Enhanced Logging
The system now logs:
- URL selection (positions 5-13)
- Queue operations (add, pop, status)
- Daily post triggers
- Complete workflow for each post

Example log:
```
Found 50 total links
Selected URLs 5-13 (9 URLs):
  5. https://www.securityweek.com/article-1/
  6. https://www.securityweek.com/article-2/
  ...
  13. https://www.securityweek.com/article-9/

=== Starting post from queue ===
Processing URL: https://www.securityweek.com/...
Scraping article content...
Summary length: 2500 chars
Generating blog post with Groq...
Generated title: ...
Posting to WordPress (status: publish)...
✓ Posted! Post ID: 123
URLs remaining in queue: 8
```

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SecurityWeek.com                         │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  │ Scrape URLs 5-13
                  │ (Firecrawl Crawl API)
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    Queue (url_queue.json)                   │
│                                                              │
│  [URL 1] → [URL 2] → [URL 3] → ... → [URL 9]               │
│   FIFO (First In, First Out)                                │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  │ Pop first URL
                  │ (Daily at configured hour OR on-demand)
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              Scrape Article Content                         │
│              (Firecrawl Crawl API)                          │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  │ Summary text
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│           Generate Blog Post (Groq AI)                      │
│                                                              │
│  Input:  Summary + URL + Title                              │
│  Output: Title + Hook + HTML Content                        │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  │ Title + Hook + HTML
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              Post to WordPress                              │
│              (WordPress REST API)                           │
└─────────────────────────────────────────────────────────────┘
                  │
                  │ Success!
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│         Published Blog Post                                 │
│         Queue count decrements                              │
└─────────────────────────────────────────────────────────────┘
```

## Workflow

### Daily Automated Flow
1. **Hour Check** - Every hour, system checks if it's time to post
2. **Queue Check** - If queue is empty, fetch new URLs from SecurityWeek
3. **Pop URL** - Remove first URL from queue (FIFO)
4. **Scrape** - Get article content using Firecrawl
5. **Generate** - Create blog post using Groq AI
6. **Post** - Publish to WordPress
7. **Log** - Record success and remaining queue count

### Manual Flow (On-Demand)
1. **Endpoint Hit** - User calls `POST /post-from-queue`
2. **Queue Check** - If queue is empty, fetch new URLs
3. **Pop URL** - Remove first URL from queue
4. **Scrape** - Get article content
5. **Generate** - Create blog post with AI
6. **Post** - Publish or save as draft (based on request)
7. **Response** - Return post details and queue status

### Queue Refill Flow
1. **Trigger** - Queue becomes empty OR manual `POST /fetch-urls`
2. **Scrape** - Fetch SecurityWeek homepage
3. **Parse** - Extract all article URLs
4. **Select** - Take URLs at positions 5-13 (9 URLs)
5. **Add** - Append to queue (avoiding duplicates)
6. **Log** - Show all selected URLs with positions

## Code Changes

### Added Files
- `README.md` - Comprehensive documentation
- `QUICKSTART.md` - Quick start guide
- `CHANGES.md` - This file
- `test-queue.sh` - Interactive test script
- `url_queue.example.json` - Example queue structure

### Modified Files

#### `index.js`
1. **Removed** `firecrawlExtract()` function (lines ~371-410)
2. **Added** Queue management functions:
   - `loadQueue()`
   - `saveQueue()`
   - `addUrlsToQueue()`
   - `popUrlFromQueue()`
   - `getQueueStatus()`
3. **Simplified** `fetchSecurityWeekTrendingCandidates()`:
   - Removed extract API calls
   - Added URL selection logic (5-13)
   - Added detailed logging
4. **Added** `postFromQueue()` function:
   - Complete workflow for posting from queue
   - Auto-refetch when empty
   - Detailed logging
5. **Added** Daily scheduler:
   - `checkAndPostDaily()`
   - Hourly interval check
   - Startup check with 5s delay
6. **Added** New endpoints:
   - `GET /queue-status`
   - `POST /fetch-urls`
   - `POST /post-from-queue`
7. **Enhanced** server startup message with ASCII art

#### `package.json`
1. **Added** npm scripts:
   - `start` - Start the server
   - `fetch-urls` - Fetch URLs via curl
   - `queue-status` - Check queue via curl
   - `post-now` - Post and publish via curl
   - `post-draft` - Post as draft via curl
   - `test-queue` - Run test script
2. **Updated** metadata:
   - Version: 2.0.0
   - Description
   - Keywords
   - Author

## Environment Variables

### New Variables
- `DAILY_POST_HOUR` - Hour of day to post (0-23, default: 10)

### Existing Variables (unchanged)
- `FIRECRAWL_API_KEY`
- `GROQ_API_KEY`
- `WP_SITE_URL`
- `WP_USER`
- `WP_APP_PASSWORD`
- `GROQ_MODEL`
- `PORT`

## Queue File Format

The queue is stored in `url_queue.json`:

```json
{
  "urls": [
    {
      "url": "https://www.securityweek.com/...",
      "title": "Article Title",
      "description": "",
      "snippet": ""
    }
  ],
  "lastFetched": "2025-10-08T10:00:00.000Z"
}
```

## Benefits

### Before
- ❌ Extract API failing with errors
- ❌ No queue system
- ❌ No automated daily posting
- ❌ Manual intervention required for each post
- ❌ No visibility into URL selection

### After
- ✅ Simple, reliable scraping (no extract API)
- ✅ FIFO queue system with persistence
- ✅ Automated daily posting
- ✅ On-demand posting capability
- ✅ Clear logging of URL selection (5-13)
- ✅ Auto-refetch when queue is empty
- ✅ Multiple endpoints for management
- ✅ Helper scripts and documentation

## Testing

### Quick Test
```bash
# Terminal 1: Start server
npm start

# Terminal 2: Test the system
./test-queue.sh
```

### Manual Testing
```bash
# 1. Check health
curl http://localhost:8787/healthz

# 2. Fetch URLs
curl -X POST http://localhost:8787/fetch-urls

# 3. Check queue
curl http://localhost:8787/queue-status

# 4. Post as draft
curl -X POST http://localhost:8787/post-from-queue \
  -H "Content-Type: application/json" \
  -d '{"publish": false}'

# 5. Check queue again
curl http://localhost:8787/queue-status
```

### NPM Scripts
```bash
npm run fetch-urls    # Fetch URLs
npm run queue-status  # Check queue
npm run post-draft    # Post as draft
npm run post-now      # Post and publish
```

## Migration Guide

If you were using the old version:

1. **Backup** your current setup
2. **Pull** the new code
3. **No database changes** - queue is file-based
4. **Start** the server: `npm start`
5. **Fetch** initial URLs: `npm run fetch-urls`
6. **Test** posting: `npm run post-draft`
7. **Monitor** the logs for 24 hours to ensure daily posts work

## Performance

- **Queue Operations**: O(1) - Fast read/write to JSON file
- **Memory**: Minimal - Queue stored on disk
- **Network**: Efficient - Only scrapes when needed
- **Daily Check**: Runs every hour (low overhead)

## Future Enhancements (Ideas)

- 📧 Email notifications on successful posts
- 📊 Analytics dashboard
- 🔄 Multi-source support (other security news sites)
- 🎯 Custom URL selection rules
- 📅 Multiple posts per day
- 🏷️ Auto-tagging based on content
- 🖼️ Featured image extraction
- 📝 Custom templates for different post types
- 🔐 API authentication for endpoints
- 🐳 Docker Compose setup
- 📈 Monitoring and metrics

## Troubleshooting

See [README.md](README.md) and [QUICKSTART.md](QUICKSTART.md) for detailed troubleshooting guides.


