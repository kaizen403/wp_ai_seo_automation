# Usage Examples

This document provides practical examples for using the AI SEO Blog Automation system.

## Basic Usage

### Starting the Server

```bash
# Start the server
node index.js

# Or using npm
npm start
```

Expected output:
```
╔════════════════════════════════════════════════════════════╗
║   🚀 AI SEO Blog Automation Server                         ║
╠════════════════════════════════════════════════════════════╣
║   Server: http://localhost:8787                            ║
║   Daily Post Time: 10:00                                   ║
...
```

## Queue Management

### Check Queue Status

```bash
# Using curl
curl http://localhost:8787/queue-status

# Using npm script
npm run queue-status

# Pretty print with jq
curl -s http://localhost:8787/queue-status | jq '.'
```

Example response:
```json
{
  "ok": true,
  "queue": {
    "count": 9,
    "urls": [
      {
        "url": "https://www.securityweek.com/article-1/",
        "title": "Article Title 1"
      },
      ...
    ],
    "lastFetched": "2025-10-08T10:00:00.000Z",
    "isEmpty": false
  }
}
```

### Fetch New URLs

```bash
# Using curl
curl -X POST http://localhost:8787/fetch-urls

# Using npm script
npm run fetch-urls

# With pretty output
curl -s -X POST http://localhost:8787/fetch-urls | jq '.'
```

Example output:
```
fetching SecurityWeek homepage...
Scraping main content for URLs...
Found 50 total links
Selected URLs 5-13 (9 URLs):
  5. https://www.securityweek.com/critical-vulnerability-discovered/
  6. https://www.securityweek.com/ransomware-group-targets-healthcare/
  7. https://www.securityweek.com/zero-day-exploit-framework/
  8. https://www.securityweek.com/data-breach-customer-records/
  9. https://www.securityweek.com/ai-phishing-attacks-rise/
  10. https://www.securityweek.com/malware-mobile-banking/
  11. https://www.securityweek.com/supply-chain-attack/
  12. https://www.securityweek.com/apt-group-warning/
  13. https://www.securityweek.com/cloud-security-leak/
Added 9 URLs to queue. Total in queue: 9
```

## Posting Articles

### Post as Draft (Review Before Publishing)

```bash
# Using curl
curl -X POST http://localhost:8787/post-from-queue \
  -H "Content-Type: application/json" \
  -d '{"publish": false}'

# Using npm script
npm run post-draft
```

Example output:
```
=== Starting post from queue ===
Processing URL: https://www.securityweek.com/article-1/
Title: Critical Vulnerability Discovered in Enterprise Software
Scraping article content...
Summary length: 2847 chars
Generating blog post with Groq...
Generated title: Critical Enterprise Software Flaw Exposes Organizations to Remote Attacks
Hook: A newly discovered critical vulnerability in widely-used enterprise software...
Posting to WordPress (status: draft)...
✓ Posted! Post ID: 456
  Link: https://yoursite.com/blog/?p=456
URLs remaining in queue: 8
```

Response:
```json
{
  "ok": true,
  "success": true,
  "sourceUrl": "https://www.securityweek.com/article-1/",
  "sourceTitle": "Critical Vulnerability Discovered in Enterprise Software",
  "postId": 456,
  "postLink": "https://yoursite.com/blog/?p=456",
  "queueRemaining": 8
}
```

### Post and Publish Immediately

```bash
# Using curl
curl -X POST http://localhost:8787/post-from-queue \
  -H "Content-Type: application/json" \
  -d '{"publish": true}'

# Using npm script
npm run post-now

# With pretty output
curl -s -X POST http://localhost:8787/post-from-queue \
  -H "Content-Type: application/json" \
  -d '{"publish": true}' | jq '.'
```

## Daily Automation

The system automatically posts at the configured hour. Here's what happens:

### Automatic Daily Post (10 AM by default)

Server logs:
```
🕐 Daily post time! (2025-10-08T10:00:15.234Z)

=== Starting post from queue ===
Processing URL: https://www.securityweek.com/...
...
✓ Posted! Post ID: 789
Daily post successful: { success: true, postId: 789, ... }
```

### Change Daily Post Time

Edit `.env`:
```env
DAILY_POST_HOUR=14  # Posts at 2 PM
```

Restart the server:
```bash
# Stop with Ctrl+C
# Start again
node index.js
```

## Advanced Workflows

### Workflow 1: Fresh Start

```bash
# 1. Start server
npm start

# 2. In another terminal, fetch URLs
curl -X POST http://localhost:8787/fetch-urls

# 3. Check what we got
curl http://localhost:8787/queue-status | jq '.queue.count'
# Output: 9

# 4. Post first article as draft to review
curl -X POST http://localhost:8787/post-from-queue \
  -H "Content-Type: application/json" \
  -d '{"publish": false}'

# 5. Review the draft in WordPress, then leave it running
# It will post automatically every day
```

### Workflow 2: Quick Testing

```bash
# Use the test script for interactive testing
./test-queue.sh
```

This will guide you through:
- Health check
- Viewing queue
- Fetching URLs
- Posting articles

### Workflow 3: Batch Preview

```bash
# Post 3 articles as drafts for review
for i in {1..3}; do
  echo "Posting article $i..."
  curl -s -X POST http://localhost:8787/post-from-queue \
    -H "Content-Type: application/json" \
    -d '{"publish": false}' | jq '.postId'
  sleep 2
done
```

### Workflow 4: Monitor Queue Over Time

```bash
# Watch queue count
watch -n 60 'curl -s http://localhost:8787/queue-status | jq ".queue.count"'
```

### Workflow 5: Weekly Refill

If you want to manually refill the queue weekly:

```bash
# Add to crontab (every Monday at 9 AM)
0 9 * * 1 curl -X POST http://localhost:8787/fetch-urls
```

## Error Handling Examples

### Empty Queue

```bash
curl -X POST http://localhost:8787/post-from-queue
```

Output:
```
Queue is empty! Fetching new URLs from SecurityWeek...
fetching SecurityWeek homepage...
Selected URLs 5-13 (9 URLs):
...
Added 9 URLs to queue. Total in queue: 9
Processing URL: https://www.securityweek.com/...
```

The system automatically refetches when needed!

### Server Not Running

```bash
curl http://localhost:8787/healthz
```

If you get:
```
curl: (7) Failed to connect to localhost port 8787: Connection refused
```

Start the server:
```bash
npm start
```

## Monitoring Examples

### Check if Server is Healthy

```bash
#!/bin/bash
# healthcheck.sh

if curl -s http://localhost:8787/healthz | grep -q "ok"; then
  echo "✓ Server is healthy"
  exit 0
else
  echo "✗ Server is down"
  exit 1
fi
```

### Monitor Queue Size

```bash
#!/bin/bash
# monitor-queue.sh

COUNT=$(curl -s http://localhost:8787/queue-status | jq '.queue.count')

if [ "$COUNT" -lt 3 ]; then
  echo "⚠ Queue is low ($COUNT items). Consider refetching."
  curl -X POST http://localhost:8787/fetch-urls
else
  echo "✓ Queue is healthy ($COUNT items)"
fi
```

### Daily Summary

```bash
#!/bin/bash
# daily-summary.sh

echo "=== Daily Summary ==="
echo ""
echo "Queue Status:"
curl -s http://localhost:8787/queue-status | jq '{count: .queue.count, lastFetched: .queue.lastFetched}'
echo ""
echo "URLs in Queue:"
curl -s http://localhost:8787/queue-status | jq -r '.queue.urls[].title'
```

## Integration Examples

### Slack Notification After Post

```bash
#!/bin/bash
# post-with-notification.sh

RESPONSE=$(curl -s -X POST http://localhost:8787/post-from-queue \
  -H "Content-Type: application/json" \
  -d '{"publish": true}')

POST_LINK=$(echo $RESPONSE | jq -r '.postLink')
TITLE=$(echo $RESPONSE | jq -r '.sourceTitle')

# Send to Slack
curl -X POST YOUR_SLACK_WEBHOOK \
  -H 'Content-Type: application/json' \
  -d "{\"text\":\"📝 New blog post published: $TITLE\n$POST_LINK\"}"
```

### Scheduled Posts with Cron

```bash
# Edit crontab
crontab -e

# Add daily post at 10 AM (if not using built-in scheduler)
0 10 * * * curl -X POST http://localhost:8787/post-from-queue -H "Content-Type: application/json" -d '{"publish":true}'

# Refetch URLs on Sundays at 9 AM
0 9 * * 0 curl -X POST http://localhost:8787/fetch-urls
```

### Email Report

```bash
#!/bin/bash
# email-report.sh

QUEUE_STATUS=$(curl -s http://localhost:8787/queue-status)
COUNT=$(echo $QUEUE_STATUS | jq '.queue.count')
LAST_FETCHED=$(echo $QUEUE_STATUS | jq -r '.queue.lastFetched')

echo "Subject: SEO Blog Queue Report

Queue Count: $COUNT
Last Fetched: $LAST_FETCHED

" | sendmail your-email@example.com
```

## Debugging Examples

### Verbose Logging

Watch the server logs in real-time:

```bash
node index.js 2>&1 | tee -a seo-blog.log
```

### Check Specific URL Processing

```bash
# Add a specific URL manually to the queue
# Edit url_queue.json and add your URL, then:

curl -X POST http://localhost:8787/post-from-queue
```

### Test Groq Integration

The Groq prompt is embedded in the code. If you want to test it separately:

```bash
# Look at the groqExpandToBlog function in index.js
# The prompt is in lines ~547-565
```

### Test WordPress Connection

```bash
# Check WordPress REST API
curl https://yoursite.com/blog/wp-json/wp/v2/posts

# Test authentication
curl https://yoursite.com/blog/wp-json/wp/v2/posts \
  -u "USERNAME:APP_PASSWORD"
```

## Performance Examples

### Measure Post Time

```bash
time curl -X POST http://localhost:8787/post-from-queue
```

Typical timing:
- Scraping: 2-5 seconds
- Groq generation: 10-20 seconds
- WordPress post: 1-2 seconds
- **Total: ~15-30 seconds**

### Batch Post with Delays

```bash
# Post 5 articles with 30 second delays
for i in {1..5}; do
  echo "Posting article $i at $(date)"
  curl -X POST http://localhost:8787/post-from-queue \
    -H "Content-Type: application/json" \
    -d '{"publish": true}'
  echo ""
  sleep 30
done
```

## Summary

The system is designed to be simple and reliable:

1. **Set it and forget it**: Start the server, it posts daily automatically
2. **On-demand control**: Use `/post-from-queue` when you need immediate posts
3. **Auto-recovery**: Queue refills automatically when empty
4. **Transparent**: Detailed logs show exactly what's happening

For more information, see:
- [README.md](README.md) - Full documentation
- [QUICKSTART.md](QUICKSTART.md) - Getting started guide
- [CHANGES.md](CHANGES.md) - What changed in this version


