'use strict';

const { ReplitConnectors } = require('@replit/connectors-sdk');
const eventsRepo = require('./repo/events');

const POSH_GROUP_URL = 'https://posh.vip/g/thenovasocialclub';
const POSH_ACTOR = 'trev0n~posh-vip-scraper';
const MAX_EVENTS = 12;
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

let lastSuccessfulSyncAt = 0;
let activeSync = null;

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeEvent(item) {
  const startsAt = item.startUtc || item.start;
  const eventUrl = item.url || item.shortUrl;
  if (!item.eventId || !item.name || !startsAt || !eventUrl || Number.isNaN(new Date(startsAt).getTime())) {
    return null;
  }

  return {
    id: String(item.eventId),
    title: cleanText(item.name, 220),
    eventUrl: String(eventUrl),
    startsAt: new Date(startsAt).toISOString(),
    venueName: cleanText(item.venueName, 160),
    city: cleanText(item.city, 120),
    description: cleanText(item.shortDescription || item.description, 350),
    imageUrl: String(item.flyer || ''),
  };
}

async function fetchPoshEvents() {
  const connectors = new ReplitConnectors();
  const response = await connectors.proxy(
    'apify',
    `/v2/actors/${POSH_ACTOR}/run-sync-get-dataset-items?format=json&clean=true&maxItems=${MAX_EVENTS}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startUrls: [{ url: POSH_GROUP_URL }],
        eventTimeFilter: 'upcoming',
        sortBy: 'startDateAsc',
        maxEvents: MAX_EVENTS,
        scrapeEventDetails: true,
        proxyConfiguration: { useApifyProxy: true },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Apify POSH sync failed (${response.status}): ${await response.text()}`);
  }

  const items = await response.json();
  const now = Date.now();
  return items
    .map(normalizeEvent)
    .filter(event => event && new Date(event.startsAt).getTime() >= now)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

async function refreshEvents(db, force = false) {
  if (!force && Date.now() - lastSuccessfulSyncAt < REFRESH_INTERVAL_MS) return false;
  if (activeSync) return activeSync;

  activeSync = (async () => {
    const events = await fetchPoshEvents();
    await eventsRepo.upsertMany(db, events);
    lastSuccessfulSyncAt = Date.now();
    console.log(`Synced ${events.length} upcoming POSH event(s).`);
    return true;
  })().finally(() => {
    activeSync = null;
  });

  return activeSync;
}

module.exports = { eventsRepo, refreshEvents };