#!/bin/bash

# AI SEO Blog Automation - Test Script
# This script helps you test the queue system

BASE_URL="http://localhost:8787"

echo "╔════════════════════════════════════════════════════════════╗"
echo "║   AI SEO Blog Automation - Test Script                    ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Function to print section header
section() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  $1"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Check if server is running
section "1. Health Check"
echo "GET $BASE_URL/healthz"
curl -s $BASE_URL/healthz
echo ""

# Get queue status
section "2. Queue Status"
echo "GET $BASE_URL/queue-status"
curl -s $BASE_URL/queue-status | jq '.' 2>/dev/null || curl -s $BASE_URL/queue-status
echo ""

# Fetch URLs
section "3. Fetch URLs from SecurityWeek (URLs 5-13)"
echo "POST $BASE_URL/fetch-urls"
read -p "Do you want to fetch URLs? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    curl -s -X POST $BASE_URL/fetch-urls | jq '.' 2>/dev/null || curl -s -X POST $BASE_URL/fetch-urls
    echo ""
fi

# Check queue status again
section "4. Queue Status After Fetch"
echo "GET $BASE_URL/queue-status"
curl -s $BASE_URL/queue-status | jq '.queue | {count, lastFetched, isEmpty}' 2>/dev/null || curl -s $BASE_URL/queue-status
echo ""

# Post from queue
section "5. Post from Queue (On-Demand)"
echo "POST $BASE_URL/post-from-queue"
read -p "Do you want to post an article? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "Publish or Draft? (publish/draft): " status
    if [[ $status == "draft" ]]; then
        curl -s -X POST $BASE_URL/post-from-queue \
            -H "Content-Type: application/json" \
            -d '{"publish": false}' | jq '.' 2>/dev/null || curl -s -X POST $BASE_URL/post-from-queue -H "Content-Type: application/json" -d '{"publish": false}'
    else
        curl -s -X POST $BASE_URL/post-from-queue \
            -H "Content-Type: application/json" \
            -d '{"publish": true}' | jq '.' 2>/dev/null || curl -s -X POST $BASE_URL/post-from-queue -H "Content-Type: application/json" -d '{"publish": true}'
    fi
    echo ""
fi

# Final queue status
section "6. Final Queue Status"
echo "GET $BASE_URL/queue-status"
curl -s $BASE_URL/queue-status | jq '.queue | {count, isEmpty}' 2>/dev/null || curl -s $BASE_URL/queue-status
echo ""

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║   Test Complete!                                           ║"
echo "╚════════════════════════════════════════════════════════════╝"


