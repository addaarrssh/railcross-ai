# RailCross

RailCross is a railway-crossing-aware navigation concept. It makes the delay
behind a red traffic segment explainable: is the railway gate likely closed,
when will the queue clear, and is a detour worth it?

## What this prototype demonstrates

- A map-first route-planning interface with a Google Maps-like interaction model
- An arrival-risk score: the chance a crossing will delay a traveller when they reach it
- A route decision that adds predicted crossing delay to travel time
- Signal fusion across traffic patterns, community reports, and historical behavior
- Community confirmation controls with a reputation-aware explanation
- Three replayable scenarios: gate closed, queue reopening, and clear flow

The displayed signals are a clearly labelled local demo. They are not live
railway or Google traffic data.

## Production data plan

1. Register verified crossing coordinates from OpenStreetMap and field checks.
2. Log ground-truth gate events through an admin, camera, or sensor workflow.
3. Request Google traffic-aware route measurements with controlled quotas.
4. Train a closure classifier and remaining-wait regressor against labelled events.
5. Store reports, voting reputation, crossing events, and model output in D1 or PostgreSQL.

## Run locally

```bash
npm install
npm run dev
```

## Resume-ready project statement

> Built RailCross, a railway-crossing-aware navigation prototype that fuses traffic patterns, crowd verification, and arrival-risk prediction to recommend whether travellers should wait or reroute.
